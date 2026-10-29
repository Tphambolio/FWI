/**
 * Usage counting + feedback (core/telemetry.js) — privacy contract:
 *   - provider 'none' / empty endpoint: no sendBeacon, no fetch, no third-party script;
 *   - provider 'post' + endpoint: exactly one beacon per page view whose payload
 *     has exactly the allowed keys and never a station, coordinates or the URL's ?stn=;
 *   - provider 'cloudflare': only their cookieless script is added, no beacon;
 *   - ratings go out only in 'post' mode; otherwise they stay on the device;
 *   - the prefilled GitHub issue carries page/version/province, never the station;
 *   - the Email option exists only with feedbackEmail set.
 * Runs the real config/telemetry.js then core/telemetry.js in a vm with a DOM stub.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { root } from './_harness.mjs';

const CONFIG_SRC = readFileSync(join(root, 'config', 'telemetry.js'), 'utf8');
const TELEMETRY_SRC = readFileSync(join(root, 'core', 'telemetry.js'), 'utf8');
const PAGEVIEW_KEYS = ['type', 'page', 'province', 'version', 'installed', 'viewport', 'session'];

function stubEl() {
  const attrs = {};
  return {
    style: {}, dataset: {}, attributes: attrs, children: [], textContent: '', innerHTML: '', hidden: false,
    setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k] ?? null,
    appendChild(c) { this.children.push(c); return c; }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    focus() {}, remove() {},
  };
}

/**
 * Load the two scripts. `config` overrides the shipped config (null = ship as is).
 * Returns spies: beacons [{url, body}], fetches, headScripts [src].
 */
async function load({ config, path = '/FWI/station_detail/code.html', search = '?stn=Hussar%20AGDM', width = 390 } = {}) {
  const beacons = [], fetches = [], headScripts = [];
  const session = new Map(), local = new Map();
  const head = stubEl();
  head.appendChild = el => { headScripts.push(el); return el; };
  const ctx = {
    document: {
      currentScript: { src: `https://tphambolio.github.io/FWI/core/telemetry.js?v=149` },
      readyState: 'loading', head, documentElement: { clientWidth: width },
      createElement: () => stubEl(), getElementById: () => null, addEventListener() {}, body: null,
    },
    location: { pathname: path, search, href: `https://tphambolio.github.io${path}${search}`, protocol: 'https:' },
    navigator: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; }, onLine: true, standalone: false },
    sessionStorage: { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)) },
    localStorage: { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)) },
    matchMedia: () => ({ matches: false }),
    innerWidth: width,
    fetch: (...a) => { fetches.push(a); return Promise.resolve({ ok: true }); },
    Blob, URL, JSON, Math, console, encodeURIComponent, Date,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(CONFIG_SRC, ctx, { filename: 'config/telemetry.js' });
  if (config) vm.runInContext(`window.PYRA_TELEMETRY = ${JSON.stringify(config)};`, ctx);
  vm.runInContext(TELEMETRY_SRC, ctx, { filename: 'core/telemetry.js' });
  const payloads = [];
  for (const b of beacons) payloads.push(JSON.parse(await b.blob.text()));
  return { ctx, T: ctx.window.PyraTelemetry, beacons, payloads, fetches, headScripts, session, local };
}

test('shipped config/telemetry.js is well-formed (provider none|cloudflare|post; strings)', () => {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(CONFIG_SRC, ctx);
  const c = ctx.window.PYRA_TELEMETRY;
  assert.ok(['none', 'cloudflare', 'post'].includes(c.provider), c.provider);
  assert.equal(typeof c.endpoint, 'string');
  assert.equal(typeof c.feedbackEmail, 'string');
  if (c.provider === 'post') assert.ok(c.endpoint, 'post needs an endpoint');
  if (c.provider === 'cloudflare') assert.match(c.token, /^[0-9a-f]{32}$/);
});

test("provider 'none' / empty endpoint: nothing is sent and no third-party script is added", async () => {
  for (const config of [{ provider: 'none', endpoint: '' }, { provider: 'post', endpoint: '' }, { provider: 'none', endpoint: 'https://example.invalid/x' }]) {
    const r = await load({ config });
    assert.equal(r.beacons.length, 0, `no beacon for ${JSON.stringify(config)}`);
    assert.equal(r.fetches.length, 0, 'no fetch');
    assert.equal(r.headScripts.length, 0, 'no script injected');
    assert.equal(r.T.sentPageview, false);
    assert.equal(r.T.send(r.T.payload('pageview')), false, 'send() is a no-op');
  }
});

test("provider 'post': exactly one beacon per page view with exactly the allowed keys, no station or coordinates", async () => {
  const endpoint = 'https://pyra-telemetry.example.workers.dev/v1';
  const r = await load({ config: { provider: 'post', endpoint } });
  assert.equal(r.beacons.length, 1, 'one beacon');
  assert.equal(r.beacons[0].url, endpoint);
  assert.equal(r.beacons[0].blob.type.toLowerCase(), 'text/plain;charset=utf-8', 'CORS-safelisted type, no preflight');
  assert.equal(r.fetches.length, 0, 'sendBeacon, not fetch');
  const p = r.payloads[0];
  assert.deepEqual(Object.keys(p).sort(), [...PAGEVIEW_KEYS].sort());
  assert.equal(p.type, 'pageview');
  assert.equal(p.page, 'ab/station');
  assert.equal(p.province, 'AB');
  assert.equal(p.version, 'v149');
  assert.equal(p.installed, false);
  assert.equal(p.viewport, 'phone');
  assert.match(p.session, /^[0-9a-f]{16}$/);
  assert.equal(r.session.get('pyra-session'), p.session, 'session id lives in sessionStorage only');
  assert.equal(r.local.size, 0, 'nothing written to localStorage on a page view');
  const raw = JSON.stringify(p);
  for (const banned of ['Hussar', 'stn', 'lat', 'lng', 'lon', '53.', '-113.']) assert.ok(!raw.includes(banned), `payload has no ${banned}`);
});

test('page ids: bc/regional, ab/trends, ab/science, bc/briefing, ab/privacy, landing; desktop viewport', async () => {
  const cases = [
    ['/FWI/bc/regional_summary/code.html', 'bc/regional', 'BC'],
    ['/FWI/forecast_trends/code.html', 'ab/trends', 'AB'],
    ['/FWI/science_guide/code.html', 'ab/science', 'AB'],
    ['/FWI/bc/briefing/', 'bc/briefing', 'BC'],
    ['/FWI/privacy/', 'ab/privacy', 'AB'],
    ['/FWI/', 'ab/landing', 'AB'],
    ['/FWI/bc/', 'bc/landing', 'BC'],
  ];
  for (const [path, page, prov] of cases) {
    const r = await load({ config: { provider: 'post', endpoint: 'https://e.invalid/x' }, path, search: '', width: 1366 });
    assert.equal(r.payloads[0].page, page, path);
    assert.equal(r.payloads[0].province, prov, path);
    assert.equal(r.payloads[0].viewport, 'desktop');
  }
});

test("provider 'cloudflare': only their beacon script is added (cookieless), no Pyra beacon", async () => {
  const r = await load({ config: { provider: 'cloudflare', endpoint: '', token: '0123456789abcdef0123456789abcdef' } });
  assert.equal(r.beacons.length, 0);
  assert.equal(r.headScripts.length, 1);
  assert.equal(r.headScripts[0].src, 'https://static.cloudflareinsights.com/beacon.min.js');
  assert.equal(r.headScripts[0].defer, true);
  assert.deepEqual(JSON.parse(r.headScripts[0].getAttribute('data-cf-beacon')), { token: '0123456789abcdef0123456789abcdef' });
});

test("rating: sent as a second beacon only in 'post' mode; otherwise kept on the device", async () => {
  const post = await load({ config: { provider: 'post', endpoint: 'https://e.invalid/x' } });
  assert.equal(post.T.rate(4), true);
  assert.equal(post.beacons.length, 2);
  const p = JSON.parse(await post.beacons[1].blob.text());
  assert.deepEqual(Object.keys(p).sort(), [...PAGEVIEW_KEYS, 'rating'].sort());
  assert.equal(p.type, 'rating');
  assert.equal(p.rating, 4);

  const none = await load({ config: { provider: 'none', endpoint: '' } });
  assert.equal(none.T.rate(7), false, 'nothing sent');
  assert.equal(none.beacons.length, 0);
  const saved = JSON.parse(none.local.get('pyra-feedback-rating'));
  assert.equal(saved.rating, 5, 'clamped to 1–5 and noted locally');
});

test('payload() ignores keys outside the allow-list', async () => {
  const r = await load({ config: { provider: 'none', endpoint: '' } });
  const p = r.T.payload('pageview', { station: 'Hussar AGDM', lat: 51.0, lng: -112.6, rating: 3 });
  assert.deepEqual(Object.keys(p).sort(), [...PAGEVIEW_KEYS, 'rating'].sort());
});

test('GitHub issue prefill: page, version, province and the typed text — never the station from the URL', async () => {
  const r = await load({ config: { provider: 'none', endpoint: '' } });
  const url = new URL(r.T.issueURL('The D+1 card was blank this morning.', 4));
  assert.equal(url.origin + url.pathname, 'https://github.com/Tphambolio/FWI/issues/new');
  assert.equal(url.searchParams.get('title'), 'Feedback: ab/station (v149)');
  const body = url.searchParams.get('body');
  assert.match(body, /\*\*Page:\*\* ab\/station/);
  assert.match(body, /\*\*Province:\*\* AB/);
  assert.match(body, /\*\*Version:\*\* v149/);
  assert.match(body, /4\/5/);
  assert.match(body, /The D\+1 card was blank this morning\./);
  assert.ok(!body.includes('Hussar'), 'station not included unless typed');
  assert.ok(!/\d{2}\.\d{3,}/.test(body), 'no coordinates');
});

test('Email option only with feedbackEmail; mailto carries page/version, not the station', async () => {
  const off = await load({ config: { provider: 'none', endpoint: '', feedbackEmail: '' } });
  assert.equal(off.T.mailURL('hi', 0), '');
  assert.equal(off.T.config.feedbackEmail, '');
  const on = await load({ config: { provider: 'none', endpoint: '', feedbackEmail: 'ops@example.ca' } });
  const m = on.T.mailURL('Great tool.', 5);
  assert.ok(m.startsWith('mailto:ops@example.ca?subject='));
  const decoded = decodeURIComponent(m);
  assert.match(decoded, /Page: ab\/station/);
  assert.match(decoded, /Version: v149/);
  assert.ok(!decoded.includes('Hussar'));
});
