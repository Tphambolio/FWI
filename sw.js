/*
 * Pyra service worker — offline shell + last-briefing cache.
 *
 * Scope: the repo root (/FWI/ on GitHub Pages, / on a local server). Registered
 * by core/pwa.js from every page.
 *
 * Strategy
 *   App shell (pages, engine scripts, theme, icons, manifest)  cache-first.
 *     Cache name carries VERSION, which must equal the ?v= on the engine script
 *     tags (tests/pwa.test.mjs checks). A new version installs a new cache and
 *     the old one is deleted on activate. Navigations also revalidate the page
 *     in the background so an update is at most one page load behind.
 *   Repo data (data/*.json, data/*.csv)  stale-while-revalidate, bounded:
 *     a cached copy younger than DATA_FRESH_MS is served at once while the
 *     network refreshes it; an older copy is only the fallback for a failed or
 *     slow (> NET_TIMEOUT_MS) network, so the data tiers keep seeing the day's
 *     mirror. No data-tier or science logic lives here.
 *   Third-party (CWFIS, ECCC, Open-Meteo, ArcGIS tiles, CDNs, fonts)
 *     network-first with cache fallback; failed responses (non-2xx) are never
 *     cached. Analytics and payment hosts are never cached or intercepted.
 *
 * A response served from cache because the network failed carries the header
 *   X-Pyra-Cache: hit;<ISO time it was cached>
 * (core/pwa.js shows the "offline — showing data cached at …" strip on it);
 * a fresh-enough data file served while revalidating carries
 *   X-Pyra-Cache: stale;<ISO time>
 * which is normal operation and raises no banner.
 */
'use strict';

const VERSION = '149';                     // = ?v= on fwi.js / core/fwi-core.js script tags
const SHELL_CACHE = `pyra-shell-v${VERSION}`;
const DATA_CACHE = `pyra-data-v${VERSION}`;
const RUNTIME_CACHE = 'pyra-runtime-v1';   // third-party responses; capped, survives version bumps
const KEEP = new Set([SHELL_CACHE, DATA_CACHE, RUNTIME_CACHE]);
const RUNTIME_MAX = 400;                   // entries (map tiles dominate)
const NET_TIMEOUT_MS = 6000;               // after this, a cached copy is served if one exists
const DATA_FRESH_MS = 15 * 60 * 1000;      // repo data served stale-while-revalidate within this age

const BASE = new URL('./', self.location.href).pathname;   // '/FWI/' or '/'

// App shell precache — paths relative to BASE, no query strings (matching
// ignores ?v= and ?stn=). Every entry must exist in the repo (tests check).
const PRECACHE = [
  'index.html',
  'bc/index.html',
  'station_detail/code.html',
  'regional_summary/code.html',
  'forecast_trends/code.html',
  'science_guide/code.html',
  'briefing/index.html',
  'bc/station_detail/code.html',
  'bc/regional_summary/code.html',
  'bc/forecast_trends/code.html',
  'bc/science_guide/code.html',
  'bc/briefing/index.html',
  'privacy/index.html',
  'core/fwi-core.js',
  'fwi.js',
  'bc/fwi.js',
  'fwi-theme.js',
  'core/pwa.js',
  'core/telemetry.js',
  'config/telemetry.js',
  'manifest.webmanifest',
  'icons/pyra-192.png',
  'icons/pyra-512.png',
  'icons/pyra-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// Never intercepted: analytics beacons, payments, anything with a side effect.
const PASSTHROUGH_HOSTS = new Set([
  'static.cloudflareinsights.com', 'cloudflareinsights.com',
  'www.paypal.com', 'paypal.com',
]);

const stripSearch = url => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
const nowISO = () => new Date().toISOString();

/** Copy a response with X-Pyra-Cached-At so a later fallback can say how old it is. Opaque responses pass through. */
function withCachedAt(res) {
  if (!res || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('X-Pyra-Cached-At', nowISO());
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** Copy a cached response, marking it as served from cache ('hit' = network failed, 'stale' = revalidating). */
function markCache(res, kind) {
  if (!res || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('X-Pyra-Cache', `${kind};${res.headers.get('X-Pyra-Cached-At') || ''}`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const cacheable = res => !!res && (res.ok || res.type === 'opaque');   // never cache failed responses

async function putLimited(cache, req, res) {
  try {
    await cache.put(req, res);
    const keys = await cache.keys();
    if (keys.length > RUNTIME_MAX) await Promise.all(keys.slice(0, keys.length - RUNTIME_MAX).map(k => cache.delete(k)));
  } catch (_) { /* quota, partial content, … — caching is best effort */ }
}

function offlineResponse(req) {
  if (req.mode === 'navigate') {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Pyra — offline</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1326;color:#dae2fd;font:16px/1.5 Inter,system-ui,sans-serif;padding:16px">' +
      '<main style="max-width:26rem"><h1 style="color:#7bd0ff;font-size:1.3rem">Pyra is offline</h1>' +
      '<p>This page has not been opened on this device yet, so there is no cached copy. Connect once and it will be kept for offline use.</p>' +
      '<p><a href="' + BASE + 'station_detail/code.html" style="color:#7bd0ff">Open the station page</a></p></main>',
      { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Pyra-Cache': 'miss' } });
  }
  return new Response('', { status: 503, statusText: 'Offline', headers: { 'X-Pyra-Cache': 'miss' } });
}

/** Race a network promise against a soft timeout: resolves 'timeout' / 'error' / the response. The fetch keeps running. */
function raceNet(net, ms) {
  let timer;
  const t = new Promise(r => { timer = setTimeout(() => r('timeout'), ms); });
  return Promise.race([net.then(r => r, () => 'error'), t]).finally(() => clearTimeout(timer));
}

// ─── Strategies ──────────────────────────────────────────────────────────────

/** App shell: cache-first; navigations revalidate in the background. */
async function shellFirst(event, req) {
  const cache = await caches.open(SHELL_CACHE);
  const key = stripSearch(req.url);
  const cached = await cache.match(key, { ignoreVary: true });
  const refresh = () => fetch(req).then(res => { if (res.ok) cache.put(key, withCachedAt(res.clone())); return res; });
  if (cached) {
    if (req.mode === 'navigate') event.waitUntil(refresh().catch(() => {}));
    return cached;
  }
  try {
    return await refresh();
  } catch (_) {
    return offlineResponse(req);
  }
}

/** Repo data files: bounded stale-while-revalidate, then network-first with cache fallback. */
async function dataSWR(event, req) {
  const cache = await caches.open(DATA_CACHE);
  const key = stripSearch(req.url);
  const cached = await cache.match(key, { ignoreVary: true });
  const net = fetch(req).then(res => { if (res.ok) cache.put(key, withCachedAt(res.clone())); return res; });
  const age = cached ? Date.now() - Date.parse(cached.headers.get('X-Pyra-Cached-At') || 0) : Infinity;
  if (cached && age < DATA_FRESH_MS) {
    event.waitUntil(net.catch(() => {}));
    return markCache(cached, 'stale');
  }
  const first = await raceNet(net, NET_TIMEOUT_MS);
  if (first !== 'timeout' && first !== 'error') return first;
  if (cached) { event.waitUntil(net.catch(() => {})); return markCache(cached, 'hit'); }
  if (first === 'timeout') { try { return await net; } catch (_) { /* fall through */ } }
  return offlineResponse(req);
}

/** Third-party: network-first (soft timeout) with cache fallback; failed responses never cached. */
async function networkFirst(event, req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const net = fetch(req).then(res => { if (cacheable(res)) event.waitUntil(putLimited(cache, req, withCachedAt(res.clone()))); return res; });
  const first = await raceNet(net, NET_TIMEOUT_MS);
  if (first !== 'timeout' && first !== 'error') return first;
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) { event.waitUntil(net.catch(() => {})); return markCache(cached, 'hit'); }
  if (first === 'timeout') { try { return await net; } catch (_) { /* fall through */ } }
  return offlineResponse(req);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const results = await Promise.allSettled(PRECACHE.map(async p => {
      const url = BASE + p;
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      await cache.put(url, withCachedAt(res));
    }));
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason && r.reason.message);
    if (failed.length) console.warn('[pyra-sw] precache skipped:', failed);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('pyra-') && !KEEP.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  if (url.origin === self.location.origin) {
    if (!url.pathname.startsWith(BASE)) return;
    const rel = url.pathname.slice(BASE.length);
    if (rel === 'sw.js') return;                                   // the browser manages the worker itself
    if (rel.startsWith('data/') && /\.(json|csv)$/i.test(rel)) { event.respondWith(dataSWR(event, req)); return; }
    event.respondWith(shellFirst(event, req));
    return;
  }
  if (PASSTHROUGH_HOSTS.has(url.hostname)) return;
  event.respondWith(networkFirst(event, req));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'PYRA_VERSION' && event.source) {
    event.source.postMessage({ type: 'PYRA_VERSION', version: VERSION });
  }
});
