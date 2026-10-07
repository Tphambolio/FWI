/**
 * Shared Node vm harness for the browser engines (fwi.js / bc/fwi.js).
 *
 * Loads an engine as a classic script into its own vm context with:
 *   - a pinned clock (Date.now overridden on the engine's own Date intrinsic),
 *   - a URL-routed fetch mock (offline, deterministic) with a call log,
 *   - a minimal DOM stub that records textContent for [data-fwi="…"] and
 *     registered element ids,
 *   - an optional Leaflet stub for buildStationMap.
 *
 * Tests reach engine functions by their global names (initFWI, wireDOM, …), so
 * they pin behaviour, not file layout. Not a test file itself (no .test. infix).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

// Emulate an Alberta viewer's browser so viewer-timezone bugs reproduce the
// same way on CI (UTC) as on a workstation. Must be set before any Date use.
process.env.TZ = 'America/Edmonton';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Province fixtures. lstOffset = hours behind UTC for noon-LST (CFFDRS day),
 * localOffset = daylight-time offset used for Today/Tomorrow + peak burn,
 * localDateFn = that province's daylight-date helper.
 */
export const ENGINES = [
  {
    prov: 'AB', path: join(root, 'fwi.js'),
    lat: 53.567, lng: -113.517, name: 'Edmonton Blatchford', cwfisName: 'EDMONTON BLATCHFORD', prevDC: 327.8, prevFFMC: 88.8,
    lstOffset: 7, noonUTC: 19, localOffset: 6, localDateFn: '_mdtDateStr',
  },
  {
    prov: 'BC', path: join(root, 'bc', 'fwi.js'),
    lat: 50.70, lng: -120.45, name: 'Kamloops A', cwfisName: 'KAMLOOPS A', prevDC: 450.0, prevFFMC: 87.0,
    lstOffset: 8, noonUTC: 20, localOffset: 7, localDateFn: '_pdtDateStr',
  },
];

export const HOUR = 3600000;
export const DAY = 24 * HOUR;
/** UTC ms for a given local-standard-time clock reading on 2026-MM-DD. */
export const lstClock = (eng, month, day, hourLST, min = 0) =>
  Date.UTC(2026, month - 1, day, hourLST + eng.lstOffset, min);
export const isoDate = ms => new Date(ms).toISOString().slice(0, 10);

// ─── Mock payloads ───────────────────────────────────────────────────────────

/** CWFIS firewx_stns_current GeoJSON feature. */
export function cwfisFeature(props) {
  const p = {
    name: 'STATION', lat: 0, lon: 0, temp: 24, rh: 30, ws: 15, wdir: 270, precip: 0,
    ffmc: 89.0, dmc: 45.0, dc: 350.0, isi: 6.5, bui: 70.0, fwi: 18.0, rep_date: null,
    ...props,
  };
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [+p.lon, +p.lat] }, properties: p };
}

/** CWFIS feature with the FWI codes stripped (weather-only station). */
export const cwfisWxOnly = props =>
  cwfisFeature({ ffmc: null, dmc: null, dc: null, isi: null, bui: null, fwi: null, ...props });

/** MSC SWOB realtime feature (api.weather.gc.ca swob-realtime). */
export function swobFeature({ lat, lon, temp = 20, rh = 35, wind = 12, wdir = 250, rain24 = 0, name = 'SWOB STN', obsISO }) {
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      air_temp: temp, rel_hum: rh, avg_wnd_spd_10m_pst1hr: wind, avg_wnd_dir_10m_pst1hr: wdir,
      pcpn_amt_pst24hrs: rain24, 'date_tm-value': obsISO, 'stn_nam-value': name,
    },
  };
}

/**
 * Open-Meteo hourly payload shaped from the request URL (past_days /
 * forecast_days, timezone=UTC). Default temperature encodes the slot so tests
 * can tell which hour was selected: temp = UTC hour + UTC day-of-month / 100.
 */
export function openMeteoFor(url, now, { temp, rh = () => 35, wind = () => 12, precip = () => 0 } = {}) {
  const q = new URL(url).searchParams;
  const past = +(q.get('past_days') ?? 0), fc = +(q.get('forecast_days') ?? 2);
  const d0 = new Date(now);
  const start = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - past * DAY;
  const n = 24 * (past + fc);
  const ts = Array.from({ length: n }, (_, i) => start + i * HOUR);
  const tempFn = temp ?? (t => new Date(t).getUTCHours() + new Date(t).getUTCDate() / 100);
  return {
    hourly: {
      time: ts.map(t => new Date(t).toISOString().slice(0, 16)),
      temperature_2m: ts.map(tempFn), relative_humidity_2m: ts.map(rh),
      wind_speed_10m: ts.map(wind), wind_direction_10m: ts.map(() => 270),
      wind_gusts_10m: ts.map(() => 20), precipitation: ts.map(precip),
      thunderstorm_probability: ts.map(() => 0),
    },
  };
}

/** data/cwfis_prev.json payload with one AB and one BC station. */
export function prevPayload(now, repDate, overrides = {}) {
  return {
    generated: new Date(now - 6 * HOUR).toISOString(),
    stations: {
      'EDMONTON BLATCHFORD': { ffmc: 88.8, dmc: 71.4, dc: 327.8, isi: 4.7, bui: 92.5, fwi: 17.9, lat: 53.567, lon: -113.517, repDate, ...overrides },
    },
    bcStations: {
      'KAMLOOPS A': { ffmc: 87.0, dmc: 40.0, dc: 450.0, isi: 3.5, bui: 65.0, fwi: 11.0, lat: 50.70, lon: -120.45, repDate, ...overrides },
    },
  };
}

// ─── DOM + Leaflet stubs ─────────────────────────────────────────────────────

function makeEl(id) {
  const classes = new Set();
  return {
    id, textContent: '', innerHTML: '', className: '', value: '', style: {}, dataset: {}, options: [],
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle() {}, contains: c => classes.has(c) },
    setAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
  };
}

/** DOM stub. `ids` = element ids that exist on the "page"; data-fwi slots always exist. */
export function makeDom(ids = []) {
  const byId = new Map(ids.map(id => [id, makeEl(id)]));
  const slots = new Map();
  const slot = k => { if (!slots.has(k)) slots.set(k, makeEl(`data-fwi:${k}`)); return slots.get(k); };
  const document = {
    getElementById: id => byId.get(id) ?? null,
    querySelectorAll: sel => {
      const m = /^\[data-fwi="([^"]+)"\]$/.exec(sel);
      return m ? [slot(m[1])] : [];
    },
    querySelector: () => null, addEventListener() {},
    body: { appendChild() {} }, createElement: () => makeEl(null),
  };
  return {
    document,
    text: key => (slots.has(key) ? slots.get(key).textContent : undefined),
    el: id => byId.get(id) ?? null,
  };
}

/** Minimal Leaflet stub: enough surface for buildStationMap. */
export function makeLeaflet() {
  const layer = () => {
    const o = {
      addTo: () => o, bindPopup: () => o, setPopupContent: () => o, setIcon: () => o,
      setLatLng: () => o, addLayer: () => o, removeLayer: () => o, on: () => o,
    };
    return o;
  };
  const map = { ...layer(), getZoom: () => 5, hasLayer: () => false };
  return {
    map: () => map, marker: layer, markerClusterGroup: layer, tileLayer: layer,
    layerGroup: layer, circleMarker: layer, divIcon: opts => ({ ...opts }),
  };
}

// ─── Context ─────────────────────────────────────────────────────────────────

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** Route a URL to a mock-handler key. */
export function routeOf(url) {
  if (url.includes('cwfis_prev.json')) return 'prev';
  if (url.includes('bcws_noon.json')) return 'bcws';
  if (url.includes('aef_pmwx.csv')) return 'aef';
  if (url.includes('cwfis.cfs.nrcan.gc.ca')) {
    if (url.includes('firewx_stns_current')) return 'cwfis';
    if (url.includes('firewx_naefs')) return 'naefs';
    return 'cwfisOther'; // SCRIBE, active fires, hotspots
  }
  if (url.includes('api.weather.gc.ca')) return 'swob';
  if (url.includes('api.open-meteo.com')) return 'openmeteo';
  return 'other';
}

/**
 * Build an engine context.
 * @param {string} enginePath
 * @param {object} o
 *   now       – pinned epoch ms
 *   mocks     – { [route]: body | (url) => body | { $status: 500 } | Error }
 *               routes: cwfis, swob, openmeteo, prev, bcws, aef, naefs, cwfisOther, other
 *   storage   – initial localStorage entries (read at engine load, e.g. fwi_idw_mode)
 *   ids       – DOM element ids that exist
 *   leaflet   – true to expose a Leaflet stub as global L
 */
export function makeContext(enginePath, { now, mocks = {}, storage: init = {}, ids = [], leaflet = false } = {}) {
  const storage = new Map(Object.entries(init));
  const calls = [];
  const dom = makeDom(ids);
  const defaults = {
    cwfis: { type: 'FeatureCollection', features: [] },
    swob: { type: 'FeatureCollection', features: [] },
    openmeteo: url => openMeteoFor(url, now),
    naefs: { features: [] },
    cwfisOther: { features: [] },
    prev: { $status: 404 }, bcws: { $status: 404 }, aef: { $status: 404 }, other: { $status: 404 },
  };
  const ctx = {
    window: {},
    document: dom.document,
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
    },
    navigator: { geolocation: { getCurrentPosition() {} }, userAgent: 'node-test' },
    location: { search: '', href: 'http://localhost/', pathname: '/' },
    AbortController, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    console: { log() {}, warn() {}, error() {}, info() {} },
  };
  if (leaflet) ctx.L = makeLeaflet();
  ctx.fetch = async url => {
    const route = routeOf(url);
    calls.push({ route, url });
    let h = route in mocks ? mocks[route] : defaults[route];
    if (typeof h === 'function') h = h(url);
    if (h instanceof Error) throw h;
    if (h && typeof h === 'object' && '$status' in h) return json(null, h.$status);
    return json(h);
  };
  ctx.globalThis = ctx;
  ctx.self = ctx.window;
  vm.createContext(ctx);
  const run = src => vm.runInContext(src, ctx);
  // The engines read the clock both via Date.now() and via `new Date()` with no
  // arguments. Wrap the context's own Date so the zero-arg constructor follows
  // Date.now; the clock is then pinned the documented way: `Date.now = () => ms`.
  run(`(() => {
    const RD = Date;
    function D(...a) {
      if (!new.target) return RD();
      return a.length ? new RD(...a) : new RD(D.now());
    }
    Object.setPrototypeOf(D, RD);
    D.prototype = RD.prototype;
    D.now = RD.now; D.UTC = RD.UTC; D.parse = RD.parse;
    globalThis.Date = D;
  })();`);
  const setNow = ms => run(`Date.now = () => ${ms};`);
  if (now != null) setNow(now);
  vm.runInContext(readFileSync(enginePath, 'utf8'), ctx, { filename: enginePath });
  return { ctx, run, storage, calls, dom, setNow };
}

/** Pass a host value into the context as a literal expression. */
export const lit = v => JSON.stringify(v);

// ─── Common scenario fixtures (mid-season day, 2026-07-15) ───────────────────
export const TODAY = '2026-07-15';
export const YDAY = '2026-07-14';
export const rep = d => `${d}T12:00:00Z`;
export const fc = features => ({ type: 'FeatureCollection', features });
/** CWFIS feature co-located with the engine's reference station. */
export const stationFeature = (eng, props = {}) =>
  cwfisFeature({ name: eng.cwfisName, lat: eng.lat, lon: eng.lng, ...props });
/** SWOB station ~1 km north of the reference station, observed at `now`. */
export const swobNear = (eng, now, props = {}) =>
  swobFeature({ lat: eng.lat + 0.01, lon: eng.lng, name: 'MSC AIRPORT', obsISO: new Date(now).toISOString(), ...props });
