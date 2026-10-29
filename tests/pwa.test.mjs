/**
 * Installable web app (PWA) wiring — static checks, no browser:
 *   - manifest.webmanifest parses and carries the required fields; its icons exist;
 *   - every app page links the manifest, theme-color and apple-touch-icon and
 *     loads config/telemetry.js, core/telemetry.js and core/pwa.js (which
 *     registers the service worker) at the engine's ?v=; landings link the manifest;
 *   - sw.js parses, registers install/activate/fetch handlers, its PRECACHE
 *     entries all exist, and its cache name carries the pages' current ?v=;
 *   - the inline Cloudflare tag is gone from the pages (config/telemetry.js owns it);
 *   - every page footer has a Privacy link and the privacy page exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { root } from './_harness.mjs';

const read = rel => readFileSync(join(root, rel), 'utf8');

const APP_PAGES = [
  'station_detail/code.html', 'regional_summary/code.html', 'forecast_trends/code.html', 'science_guide/code.html', 'briefing/index.html',
  'bc/station_detail/code.html', 'bc/regional_summary/code.html', 'bc/forecast_trends/code.html', 'bc/science_guide/code.html', 'bc/briefing/index.html',
  'privacy/index.html',
];
// Pages that load the engine (the science guides and the privacy page do not).
const ENGINE_PAGES = APP_PAGES.filter(p => !p.startsWith('privacy/') && !p.includes('science_guide'));
const LANDINGS = ['index.html', 'bc/index.html'];

/** The ?v= on a page's core/fwi-core.js tag. */
const engineVersion = html => (/core\/fwi-core\.js\?v=(\d+)/.exec(html) || [])[1];
/** The page's app version: the engine tag's ?v=, else core/pwa.js's. */
const pageVersion = html => engineVersion(html) || (/core\/pwa\.js\?v=(\d+)/.exec(html) || [])[1];
/** href/src attribute values on <link rel=…> / <script src=…> tags. */
const attr = (html, re) => [...html.matchAll(re)].map(m => m[1]);

// ─── Manifest ────────────────────────────────────────────────────────────────

test('manifest.webmanifest parses with the required fields and existing icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Pyra — Fire Weather');
  assert.equal(m.short_name, 'Pyra');
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url.startsWith('./'), 'start_url is relative so it works under /FWI/');
  assert.ok(m.scope.startsWith('./'));
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  assert.equal(m.theme_color, '#0b1326', 'dark surface colour used by the pages');
  const sizes = new Set(m.icons.map(i => i.sizes));
  assert.ok(sizes.has('192x192') && sizes.has('512x512'));
  assert.ok(m.icons.some(i => (i.purpose || '').includes('maskable')), 'a maskable icon');
  for (const i of m.icons) {
    assert.ok(existsSync(join(root, i.src)), `icon exists: ${i.src}`);
    assert.equal(i.type, 'image/png');
  }
  for (const s of m.shortcuts || []) assert.ok(existsSync(join(root, s.url)), `shortcut target exists: ${s.url}`);
});

// ─── Pages ───────────────────────────────────────────────────────────────────

test('every engine page shares one ?v= and it is what sw.js caches under', () => {
  const versions = new Set(ENGINE_PAGES.map(p => engineVersion(read(p))));
  assert.equal(versions.size, 1, `one engine version across pages, got ${[...versions]}`);
  const [v] = versions;
  const sw = read('sw.js');
  const swv = (/const VERSION = '(\d+)'/.exec(sw) || [])[1];
  assert.equal(swv, v, 'sw.js VERSION equals the pages\' ?v=');
  assert.match(sw, new RegExp('pyra-shell-v\\$\\{VERSION\\}'), 'shell cache name is versioned');
});

for (const page of APP_PAGES) {
  test(`${page}: links the manifest, theme-color, apple-touch-icon; loads telemetry + pwa at the engine version`, () => {
    const html = read(page);
    const dir = dirname(join(root, page));
    const v = pageVersion(html);
    assert.ok(v, 'has a version');
    const swv = (/const VERSION = '(\d+)'/.exec(read('sw.js')) || [])[1];
    assert.equal(v, swv, 'page version equals the service worker cache version');

    const manifests = attr(html, /<link[^>]*rel="manifest"[^>]*href="([^"]+)"/g);
    assert.equal(manifests.length, 1, 'exactly one manifest link');
    assert.ok(existsSync(resolve(dir, manifests[0])), `manifest href resolves: ${manifests[0]}`);
    assert.match(html, /<meta name="theme-color" content="#0b1326"\/>/);
    const touch = attr(html, /<link[^>]*rel="apple-touch-icon"[^>]*href="([^"]+)"/g);
    assert.equal(touch.length, 1);
    assert.ok(existsSync(resolve(dir, touch[0])), 'apple-touch-icon resolves');

    for (const f of ['config/telemetry.js', 'core/telemetry.js', 'core/pwa.js']) {
      const tags = attr(html, new RegExp(`<script src="([^"]*${f.replace('/', '\\/')}\\?v=\\d+)"`, 'g'));
      assert.equal(tags.length, 1, `${f} loaded once`);
      assert.ok(tags[0].endsWith(`?v=${v}`), `${f} at ?v=${v}: ${tags[0]}`);
      assert.ok(existsSync(resolve(dir, tags[0].split('?')[0])), `${f} src resolves`);
    }
    // load order: config → telemetry → pwa
    const order = ['config/telemetry.js', 'core/telemetry.js', 'core/pwa.js'].map(f => html.indexOf(f));
    assert.ok(order[0] < order[1] && order[1] < order[2], 'config/telemetry.js before core/telemetry.js before core/pwa.js');

    // Engine pages: province module → config/weather.js → core/gem.js → core/fwi-core.js, all at ?v=
    if (ENGINE_PAGES.includes(page)) {
      for (const f of ['config/weather.js', 'core/gem.js']) {
        const tags = attr(html, new RegExp(`<script src="([^"]*${f.replace('/', '\\/')}\\?v=\\d+)"`, 'g'));
        assert.equal(tags.length, 1, `${f} loaded once`);
        assert.ok(tags[0].endsWith(`?v=${v}`), `${f} at ?v=${v}: ${tags[0]}`);
        assert.ok(existsSync(resolve(dir, tags[0].split('?')[0])), `${f} src resolves`);
      }
      const eo = ['fwi.js?v=', 'config/weather.js', 'core/gem.js', 'core/fwi-core.js'].map(f => html.indexOf(f));
      assert.ok(eo[0] < eo[1] && eo[1] < eo[2] && eo[2] < eo[3], 'province module before config/weather.js before core/gem.js before core/fwi-core.js');
    }

    assert.doesNotMatch(html, /static\.cloudflareinsights\.com/, 'no inline Cloudflare tag — config/telemetry.js owns the provider');
    assert.ok(html.includes('<footer'), 'has a footer');
    if (!page.startsWith('privacy/')) {
      const privacy = attr(html, /<a href="([^"]*privacy\/)"/g);
      assert.ok(privacy.length >= 1, 'footer Privacy link');
      assert.ok(existsSync(resolve(dir, privacy[0], 'index.html')), 'privacy link resolves');
    }
    assert.match(html, /For informational use only/, 'disclaimer intact');
  });
}

for (const page of LANDINGS) {
  test(`${page}: landing links the manifest and theme-color`, () => {
    const html = read(page);
    const dir = dirname(join(root, page));
    const manifests = attr(html, /<link[^>]*rel="manifest"[^>]*href="([^"]+)"/g);
    assert.equal(manifests.length, 1);
    assert.ok(existsSync(resolve(dir, manifests[0])));
    assert.match(html, /<meta name="theme-color" content="#0b1326"\/>/);
  });
}

test('science guides explain iOS Share → Add to Home Screen', () => {
  for (const p of ['science_guide/code.html', 'bc/science_guide/code.html']) {
    assert.match(read(p), /Add to Home Screen/, p);
  }
});

// ─── Service worker ──────────────────────────────────────────────────────────

function loadSW() {
  const handlers = {};
  const self = {
    location: { href: 'https://tphambolio.github.io/FWI/sw.js' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  const ctx = { self, URL, Headers, Response, Request, console, setTimeout, clearTimeout, Promise, Date, Set, fetch: async () => { throw new Error('offline'); } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('sw.js'), ctx, { filename: 'sw.js' });
  return { ctx, handlers };
}

test('sw.js evaluates, registers install/activate/fetch handlers, scopes to the repo root', () => {
  const { ctx, handlers } = loadSW();
  for (const h of ['install', 'activate', 'fetch']) assert.equal(typeof handlers[h], 'function', `${h} handler`);
  assert.equal(vm.runInContext('BASE', ctx), '/FWI/');
});

test('sw.js PRECACHE lists only files that exist, and covers every page + engine file + icons', () => {
  const src = read('sw.js');
  const block = /const PRECACHE = \[([\s\S]*?)\];/.exec(src)[1];
  const files = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(files.length >= 20);
  for (const f of files) {
    assert.ok(!f.includes('?'), `no query strings in precache keys: ${f}`);
    assert.ok(existsSync(join(root, f)), `precache file exists: ${f}`);
  }
  for (const must of [...APP_PAGES, ...LANDINGS, 'core/fwi-core.js', 'fwi.js', 'bc/fwi.js', 'fwi-theme.js', 'core/pwa.js', 'core/telemetry.js', 'config/telemetry.js', 'config/weather.js', 'core/gem.js', 'manifest.webmanifest', 'icons/pyra-192.png', 'icons/pyra-512.png']) {
    assert.ok(files.includes(must), `precache includes ${must}`);
  }
});

test('sw.js never caches failed responses and marks cache fallbacks with X-Pyra-Cache: hit;<time>', async () => {
  const { ctx } = loadSW();
  const bad = new Response('', { status: 502 });
  assert.equal(vm.runInContext('cacheable', ctx)(bad), false);
  assert.equal(vm.runInContext('cacheable', ctx)(new Response('ok', { status: 200 })), true);
  const stamped = vm.runInContext('withCachedAt', ctx)(new Response('x', { status: 200 }));
  assert.match(stamped.headers.get('X-Pyra-Cached-At'), /^\d{4}-\d{2}-\d{2}T/);
  const marked = vm.runInContext('markCache', ctx)(stamped, 'hit');
  assert.match(marked.headers.get('X-Pyra-Cache'), /^hit;\d{4}-\d{2}-\d{2}T/);
  assert.equal(await marked.text(), 'x');
});

test('sw.js passes analytics and payment hosts through untouched', () => {
  const { ctx } = loadSW();
  const hosts = vm.runInContext('PASSTHROUGH_HOSTS', ctx);
  assert.ok(hosts.has('static.cloudflareinsights.com'));
  assert.ok(hosts.has('www.paypal.com'));
});

test('core/pwa.js, core/telemetry.js, core/gem.js and the config files are classic scripts (no import/export)', () => {
  for (const f of ['core/pwa.js', 'core/telemetry.js', 'config/telemetry.js', 'core/gem.js', 'config/weather.js', 'sw.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /^\s*(import|export)\s/m, `${f} has no ES module syntax`);
    new vm.Script(s, { filename: f }); // parses
  }
});

test('docs/privacy.md and privacy/index.html exist and agree on the modes', () => {
  const md = read('docs/privacy.md'), html = read('privacy/index.html');
  for (const k of ['none', 'cloudflare', 'post', 'sessionStorage'.toLowerCase().slice(0, 7), 'Never the station']) {
    assert.ok(md.includes(k), `md mentions ${k}`);
    assert.ok(html.includes(k), `html mentions ${k}`);
  }
});
