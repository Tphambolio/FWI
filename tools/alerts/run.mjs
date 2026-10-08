#!/usr/bin/env node
/**
 * Pyra threshold alerts — evaluate watched stations against fire-behaviour
 * thresholds and build ONE plain-text message for field / ICS users.
 *
 *   node tools/alerts/run.mjs --config tools/alerts/config.json [--dry-run] [--now ISO]
 *                             [--update-state] [--send]
 *
 * Science and data tiers come from the engine itself: each station runs the
 * province module + core/fwi-core.js in its own Node vm context (the same
 * loader the tests use) and goes through the station page's path —
 * initFWI (incl. carry-over) → fetchForecastDays → calcMultiDayFBP chained from
 * today's state → today's 16:00 peak burn and tomorrow's. No equation is
 * re-implemented here.
 *
 * Exit codes: 0 no alert · 10 alert produced · 1 error.
 * Delivery: --dry-run (default) prints the message and the exact `openclaw`
 * command it would run. --send runs it only when config.delivery.enabled is
 * true; otherwise it refuses (exit 1).
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const ENGINE_PATHS = { AB: join(REPO, 'fwi.js'), BC: join(REPO, 'bc', 'fwi.js') };
const CORE_PATH = join(REPO, 'core', 'fwi-core.js');
export const SITE_URL = 'https://tphambolio.github.io/FWI/';
export const FOOTER = 'Pyra — informational only; verify with your FBAN/agency';
export const EXIT = { OK: 0, ALERT: 10, ERROR: 1 };
export const BCWS_CLASSES = ['Very Low', 'Low', 'Moderate', 'High', 'Extreme']; // BCWS DANGER_RATING 1-5

// ─── Engine context (live) ───────────────────────────────────────────────────

function stubEl() {
  return {
    textContent: '', innerHTML: '', className: '', value: '', style: {}, dataset: {}, options: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
  };
}

/**
 * Live engine context: real fetch, the context's own (real) Date — pinned to
 * `now` only when --now is given — and minimal DOM / localStorage stubs, as
 * tests/load-engine.mjs. Returns { run } like the test harness.
 */
export function makeLiveEngine(prov, { now = null, fetchImpl = globalThis.fetch } = {}) {
  const enginePath = ENGINE_PATHS[prov];
  if (!enginePath) throw new Error(`unknown province "${prov}" (AB|BC)`);
  const storage = new Map();
  const ctx = {
    window: {},
    document: {
      getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
      addEventListener() {}, createElement: stubEl, body: { appendChild() {} },
    },
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
    },
    navigator: { geolocation: { getCurrentPosition() {} }, userAgent: 'pyra-alerts' },
    location: { search: '', href: SITE_URL, pathname: '/' },
    AbortController, URLSearchParams, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {},
    console: { log() {}, info() {}, warn() {}, error() {} },
    // SCRIBE validation is display-only (fired un-awaited by wireDOM) — skip it.
    fetch: (url, opts) => (String(url).includes('firewx_scribe')
      ? Promise.reject(new Error('skipped')) : fetchImpl(url, opts)),
  };
  ctx.globalThis = ctx;
  ctx.self = ctx.window;
  vm.createContext(ctx);
  const run = src => vm.runInContext(src, ctx);
  if (now != null) {
    // Same clock pin as tests/_harness.mjs: zero-arg `new Date()` follows Date.now.
    run(`(() => { const RD = Date; function D(...a) { if (!new.target) return RD();
      return a.length ? new RD(...a) : new RD(D.now()); }
      Object.setPrototypeOf(D, RD); D.prototype = RD.prototype;
      D.now = () => ${Number(now)}; D.UTC = RD.UTC; D.parse = RD.parse; globalThis.Date = D; })();`);
  }
  vm.runInContext(readFileSync(enginePath, 'utf8'), ctx, { filename: enginePath });
  vm.runInContext(readFileSync(CORE_PATH, 'utf8'), ctx, { filename: CORE_PATH });
  return { ctx, run };
}

// ─── Per-station evaluation (runs inside the engine context) ─────────────────

// Mirrors the station page: initFWI → wireDOM state (_lastFWI, carry-over,
// provenance) → buildD1Card's chain (fetchForecastDays + calcMultiDayFBP from
// today's state) → _renderPeakSummary's 16:00 danger / FWI / worst-fuel HFI.
const STATION_SCRIPT = `(async (a) => {
  const warns = [];
  console.warn = (...m) => warns.push(m.map(x => (x && x.message) || String(x)).join(' '));
  console.error = console.warn;
  const norm = s => String(s || '').trim().toLowerCase();
  let stn = getStationList().find(s => norm(s.name) === norm(a.name))
    || (getRegions() || []).find(s => norm(s.name) === norm(a.name));
  if (a.lat != null && a.lng != null) stn = { name: stn?.name || a.name, lat: +a.lat, lng: +a.lng };
  if (!stn) throw new Error('station "' + a.name + '" not in the ' + a.prov + ' station list (set lat/lng to override)');
  const { name, lat, lng } = stn;

  await initFWI(lat, lng, name);
  const r = _lastFWI;
  if (!r) throw new Error('station data load failed' + (warns.length ? ': ' + warns[warns.length - 1] : ''));
  const prov = _provenance(r.weather, r._cachedFWI || null);
  const out = {
    name, lat, lng, tz: PROVINCE.tzLabel, inactive: !!r._inactive || r.ffmc == null,
    provenance: { kind: prov.kind, network: prov.network, age: prov.age, ageH: prov.ageH, level: prov.level, detail: prov.detail },
    official: r.dangerSource === 'official' ? r.danger : null,
    carriedFrom: r._cachedFWI?.obsDate ?? null,
    dangerSource: r.dangerSource || 'fwi',
    chain: r.ffmc != null ? { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc, obsDate: r._obsDate ?? null } : null,
  };
  if (out.inactive) return out;

  // Fuels: configured, else the page defaults (AB auto-fuel from the station table).
  let fuels;
  if (a.fuels && a.fuels.length) fuels = a.fuels.map(f => _seasonalFuel(String(f), lat));
  else {
    const fa = PROVINCE.autoFuelOnSelect ? _seasonalFuel(PROVINCE.stationFuel(name, lat), lat)
                                         : _seasonalFuel(PROVINCE.fuelDefaults.a, lat);
    let fb = _seasonalFuel(PROVINCE.fuelDefaults.b, lat);
    if (fb === fa) fb = _seasonalPair(fa, lat);
    fuels = [fa, fb];
  }
  for (const f of fuels) if (!FUEL_TYPES[f]) throw new Error('unknown fuel type "' + f + '"');
  const curing = a.curing ?? _savedCuring();
  const ps = a.ps ?? _savedPS();
  out.fuels = fuels;

  const { days, source } = await fetchForecastDays(lat, lng);
  if (!days?.length) throw new Error('forecast returned no days');
  out.forecastSource = source;
  const chainStart = { ffmc: r.ffmc, dmc: r.dmc,
    dc: applyDCFloor(r.dc ?? getStartupDC(name), lat, lng).dc, obsDate: r._obsDate ?? null };
  const startupDC = getStartupDC(name);
  const perFuel = fuels.map(f => ({ fuel: f, res: calcMultiDayFBP(days, startupDC, chainStart, f, curing, ps) }));

  const nowLocal = _localDateStr();
  const todayIdx = days.findIndex(d => d._ts && _localDateStr(d._ts) === nowLocal);
  const tomorrowIdx = days.findIndex(d => d._ts && _localDateStr(d._ts) > nowLocal);
  const peak = idx => {
    if (idx < 0) return null;
    const r0 = perFuel[0].res[idx];
    if (!r0) return null;
    const wind = r0.peakWeather?.wind ?? r0.weather?.wind ?? 10;
    const fwi = _fwi(_isi(r0.ffmc, wind), _bui(r0.dmc, r0.dc));
    const cands = perFuel.map(p => ({ fuel: p.fuel, fbp: p.res[idx]?.fbp })).filter(c => c.fbp);
    const w = cands.reduce((x, y) => (y.fbp.hfi > x.fbp.hfi ? y : x));
    const cl = hfiClassInfo(w.fbp.hfi);
    return {
      date: _localDateStr(days[idx]._ts), label: days[idx].label || null,
      ensembleTail: !!days[idx].ensembleTail,
      fwi, danger: dangerRatingProv(fwi), wind,
      worst: { fuel: w.fuel, fuelName: FUEL_TYPES[w.fuel]?.name || w.fuel, hfi: w.fbp.hfi,
               cls: cl.num, clsLabel: cl.label, desc: cl.desc, ros: w.fbp.ros, area60: w.fbp.area60,
               fireType: w.fbp.fireType },
    };
  };
  out.today = peak(todayIdx);
  out.tomorrow = peak(tomorrowIdx);
  return out;
})`;

/**
 * Evaluate one configured station. `engineFactory(prov, station)` returns
 * { run } (live: makeLiveEngine; tests: the harness context).
 */
export async function evaluateStation(st, engineFactory) {
  const prov = String(st.province || '').toUpperCase();
  if (!ENGINE_PATHS[prov]) throw new Error(`province must be AB or BC (got "${st.province}")`);
  const eng = await engineFactory(prov, st);
  eng.run('globalThis.__alertStation = ' + STATION_SCRIPT);
  const args = { prov, name: st.name, lat: st.lat ?? null, lng: st.lng ?? null,
                 fuels: st.fuels ?? (st.fuel ? [st.fuel] : null), curing: st.curing ?? null, ps: st.ps ?? null };
  const res = await eng.run(`__alertStation(${JSON.stringify(args)})`);
  return { province: prov, ...JSON.parse(JSON.stringify(res)) };
}

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** BCWS class name or 1-5 → number (1 Very Low … 5 Extreme), or null. */
export function bcwsClassNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v >= 1 && v <= 5 ? v : null;
  const i = BCWS_CLASSES.findIndex(c => c.toLowerCase() === String(v).trim().toLowerCase());
  return i >= 0 ? i + 1 : (/^[1-5]$/.test(String(v).trim()) ? +v : null);
}

/**
 * Which thresholds a station result crosses. Returns a list of crossing keys:
 * today.fwi · today.hfi · today.bcws · tomorrow.fwi · tomorrow.hfi.
 * A threshold left null/undefined is not evaluated.
 */
export function evaluateThresholds(res, th = {}, { lookAhead = true } = {}) {
  const out = [];
  if (!res || res.inactive) return out;
  const check = (key, p) => {
    if (!p) return;
    if (th.fwi != null && p.fwi >= th.fwi) out.push(`${key}.fwi`);
    if (th.hfiClass != null && p.worst && p.worst.cls >= th.hfiClass) out.push(`${key}.hfi`);
  };
  check('today', res.today);
  if (res.province === 'BC' && th.bcwsDanger != null && res.official) {
    const want = bcwsClassNum(th.bcwsDanger), got = bcwsClassNum(res.official);
    if (want != null && got != null && got >= want) out.push('today.bcws');
  }
  if (lookAhead) check('tomorrow', res.tomorrow);
  return out;
}

// ─── Quiet mode ──────────────────────────────────────────────────────────────

export const stationKey = st => `${String(st.province).toUpperCase()}:${st.name}`;

/**
 * Quiet mode: a station alerts only on crossings it did not have at the last
 * run. `prev` / returned `state` = { [stationKey]: { crossings: [...], at } }.
 * `current` = { [stationKey]: crossings[] | null } — null = station failed
 * this run, so its previous state is kept (no spurious re-alert on recovery).
 * Returns { newBy: { [key]: newCrossings[] }, state }.
 */
export function applyQuiet(prev = {}, current = {}, { quiet = true, at = null } = {}) {
  const state = { ...prev };
  const newBy = {};
  for (const [k, cross] of Object.entries(current)) {
    if (cross == null) continue; // failed: keep previous state
    const before = new Set(prev[k]?.crossings || []);
    const fresh = quiet ? cross.filter(c => !before.has(c)) : [...cross];
    if (fresh.length) newBy[k] = fresh;
    state[k] = { crossings: [...cross].sort(), at };
  }
  return { newBy, state };
}

// ─── Message ─────────────────────────────────────────────────────────────────

const f1 = v => (v == null || !isFinite(v) ? '—' : (+v).toFixed(1));
const kwm = v => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-CA'));
const area = v => (v == null || !isFinite(v) ? '—' : v < 10 ? (+v).toFixed(1) : Math.round(v).toLocaleString('en-CA'));

export function formatLocal(nowMs, timeZone = 'America/Edmonton') {
  const d = new Date(nowMs);
  const date = d.toLocaleDateString('en-CA', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
  return `${date} ${time}`;
}

function dataLine(res) {
  const p = res.provenance || {};
  const age = p.age ? ` · ${p.age}` : '';
  const stale = p.level === 'amber' ? ' (1 day behind)' : p.level === 'red' ? ' (STALE)' : '';
  const chain = res.carriedFrom && p.kind === 'CARRIED FROM YESTERDAY' ? ` (${res.carriedFrom} chain)` : '';
  return `Data: ${p.kind || '?'}${chain} · ${p.network || '?'}${age}${stale}`;
}

function stationBlock(res, cross, th) {
  const L = [];
  const has = k => cross.includes(k);
  L.push(`${res.name.toUpperCase()} (${res.province})`);
  const t = res.today;
  if (t) {
    L.push(`Today 16:00 ${res.tz}: ${t.danger.toUpperCase()} · FWI ${f1(t.fwi)}`);
    if (res.province === 'BC' && res.official) L.push(`BCWS official rating: ${res.official}`);
    const w = t.worst;
    L.push(`HFI ${w.cls} ${w.clsLabel} · ${w.fuelName} (${w.fuel}) · ${kwm(w.hfi)} kW/m`);
    L.push(`Tactic: ${w.desc}`);
    L.push(`Head ROS ${f1(w.ros)} m/min · 60-min point fire ${area(w.area60)} ha`);
  } else {
    L.push(`Today 16:00 ${res.tz}: no peak-burn forecast available`);
  }
  L.push(dataLine(res));
  const m = res.tomorrow;
  if (m && (has('tomorrow.fwi') || has('tomorrow.hfi'))) {
    const tail = m.ensembleTail ? ' (ensemble, lower confidence)' : '';
    L.push(`Tomorrow ${m.label || m.date} 16:00: ${m.danger.toUpperCase()} · FWI ${f1(m.fwi)} · HFI ${m.worst.cls} ${m.worst.clsLabel} ${m.worst.fuel} ${kwm(m.worst.hfi)} kW/m${tail}`);
  }
  const why = [];
  if (has('today.fwi')) why.push(`FWI ≥ ${th.fwi} today`);
  if (has('today.hfi')) why.push(`HFI ≥ ${th.hfiClass} today`);
  if (has('today.bcws')) why.push(`BCWS ≥ ${typeof th.bcwsDanger === 'number' ? BCWS_CLASSES[th.bcwsDanger - 1] : th.bcwsDanger}`);
  if (has('tomorrow.fwi')) why.push(`FWI ≥ ${th.fwi} tomorrow`);
  if (has('tomorrow.hfi')) why.push(`HFI ≥ ${th.hfiClass} tomorrow`);
  if (why.length) L.push(`Trigger: ${why.join(', ')}`);
  return L.join('\n');
}

/**
 * Build the alert text. `alerts` = [{ res, crossings }] (stations to report),
 * `failures` = [{ station, error }]. Returns null when there is nothing to alert.
 */
export function buildMessage({ alerts, failures = [], nowMs, timeZone, thresholds = {} }) {
  if (!alerts.length) return null;
  const parts = [`PYRA FIRE BEHAVIOUR ALERT`, formatLocal(nowMs, timeZone)];
  for (const a of alerts) parts.push('', stationBlock(a.res, a.crossings, thresholds));
  if (failures.length) {
    parts.push('', 'NOT CHECKED (data error):');
    for (const f of failures) parts.push(`- ${f.station.name} (${String(f.station.province).toUpperCase()}): ${f.error}`);
  }
  parts.push('', FOOTER, SITE_URL);
  return parts.join('\n');
}

// ─── Delivery (stub — prints the command; runs it only with --send + enabled) ─

export function deliveryCommand(message, delivery = {}) {
  const agent = delivery.agent || 'main';
  return { file: delivery.command || 'openclaw', args: ['agent', '--agent', agent, '--message', message] };
}

const shq = s => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
export const shellLine = ({ file, args }) => [file, ...args].map(shq).join(' ');

// ─── Config / state / CLI ────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = { config: null, dryRun: true, send: false, now: null, updateState: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') o.config = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--send') { o.send = true; o.dryRun = false; }
    else if (a === '--now') o.now = argv[++i];
    else if (a === '--update-state') o.updateState = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument "${a}"`);
  }
  if (o.now != null) {
    const ms = Date.parse(o.now);
    if (!isFinite(ms)) throw new Error(`--now: not an ISO date/time ("${o.now}")`);
    o.nowMs = ms;
  }
  return o;
}

export function loadConfig(path) {
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(cfg.stations) || !cfg.stations.length) throw new Error('config.stations must be a non-empty list');
  for (const s of cfg.stations) {
    if (!s || !s.name || !s.province) throw new Error('each station needs "province" (AB|BC) and "name"');
  }
  return cfg;
}

function readState(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')).stations || {}; } catch (_) { return {}; }
}
function writeState(path, stations, nowMs) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify({ updated: new Date(nowMs).toISOString(), stations }, null, 2) + '\n');
  renameSync(tmp, path);
}

const USAGE = `usage: node tools/alerts/run.mjs --config tools/alerts/config.json [--dry-run] [--now ISO] [--update-state] [--send]
  --dry-run       (default) print the message and the delivery command; state is not changed
  --update-state  with --dry-run: also record this run's crossings in the quiet-mode state file
  --send          deliver via OpenClaw — refused unless config.delivery.enabled is true
  --now ISO       evaluate as of this instant (clock pin; data is still fetched live)
exit: 0 no alert · 10 alert produced · 1 error`;

/**
 * CLI entry. deps (for tests): engineFactory, exec(file, args) → Promise,
 * out / err (line writers), statePath override.
 */
export async function main(argv, deps = {}) {
  const out = deps.out || (s => process.stdout.write(s + '\n'));
  const err = deps.err || (s => process.stderr.write(s + '\n'));
  let opts, cfg;
  try {
    opts = parseArgs(argv);
    if (opts.help) { out(USAGE); return EXIT.OK; }
    if (!opts.config) throw new Error('--config is required');
    cfg = loadConfig(opts.config);
  } catch (e) {
    err(`error: ${e.message}`); err(USAGE); return EXIT.ERROR;
  }

  // Refuse --send before touching the network.
  const delivery = cfg.delivery || {};
  if (opts.send && delivery.enabled !== true) {
    err('refusing --send: delivery is not enabled. Set "delivery": { "enabled": true, ... } in your config ' +
        '(tools/alerts/config.json) to allow delivery. Use --dry-run to preview.');
    return EXIT.ERROR;
  }

  const nowMs = opts.nowMs ?? Date.now();
  const engineFactory = deps.engineFactory || ((prov) => makeLiveEngine(prov, { now: opts.nowMs ?? null }));
  const th = cfg.thresholds || {};
  const quiet = cfg.quiet?.enabled !== false;
  const lookAhead = cfg.forecastLookAhead?.enabled !== false;
  const statePath = deps.statePath || resolve(dirname(resolve(opts.config)), cfg.quiet?.stateFile || 'state.json');

  // Evaluate stations in parallel; one failure never stops the others.
  const settled = await Promise.allSettled(cfg.stations.map(st => evaluateStation(st, engineFactory)));
  const results = [], failures = [], current = {};
  settled.forEach((s, i) => {
    const st = cfg.stations[i];
    const k = stationKey(st);
    if (s.status === 'fulfilled') {
      const stTh = { ...th, ...(st.thresholds || {}) };
      const crossings = evaluateThresholds(s.value, stTh, { lookAhead });
      results.push({ st, res: s.value, crossings, th: stTh });
      current[k] = crossings;
    } else {
      const msg = String(s.reason?.message || s.reason).split('\n')[0].slice(0, 160);
      failures.push({ station: st, error: msg });
      current[k] = null;
    }
  });

  const prevState = readState(statePath);
  const { newBy, state } = applyQuiet(prevState, current, { quiet, at: new Date(nowMs).toISOString() });
  // Report every current crossing of a station that has at least one new one.
  const alerts = results.filter(r => newBy[stationKey(r.st)]).map(r => ({ res: r.res, crossings: r.crossings }));
  const message = buildMessage({ alerts, failures, nowMs, timeZone: cfg.timezone || 'America/Edmonton', thresholds: th });

  for (const r of results) {
    const t = r.res.today;
    err(`[alerts] ${r.st.province}:${r.res.name} — ` + (r.res.inactive ? 'no FWI chain (inactive)'
      : `16:00 ${t ? `${t.danger} FWI ${f1(t.fwi)} HFI ${t.worst.cls} (${t.worst.fuel})` : 'n/a'} · ${r.res.provenance.kind}` +
        ` · crossings [${r.crossings.join(', ') || 'none'}]${newBy[stationKey(r.st)] ? ' NEW' : ''}`));
  }
  for (const f of failures) err(`[alerts] ${f.station.province}:${f.station.name} — FAILED: ${f.error}`);

  if (!results.length) { err('error: every station failed'); return EXIT.ERROR; }

  const persist = () => { try { writeState(statePath, state, nowMs); } catch (e) { err(`warning: state not saved: ${e.message}`); } };

  if (!message) {
    out('No alert: no new threshold crossing.' + (failures.length ? ` (${failures.length} station(s) not checked)` : ''));
    if (opts.send || opts.updateState) persist();
    return EXIT.OK;
  }

  const cmd = deliveryCommand(message, delivery);
  out(message);
  out('');
  if (!opts.send) {
    out('--- dry run: would deliver with ---');
    out(shellLine(cmd));
    if (opts.updateState) persist();
    return EXIT.ALERT;
  }
  const exec = deps.exec || ((file, args) => new Promise((ok, no) =>
    execFile(file, args, { timeout: 120000 }, (e, so, se) => (e ? no(new Error(se || e.message)) : ok(so)))));
  try {
    await exec(cmd.file, cmd.args);
  } catch (e) {
    err(`error: delivery failed: ${e.message}`); // state not saved → retried next run
    return EXIT.ERROR;
  }
  persist();
  out('delivered.');
  return EXIT.ALERT;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => {
    process.stderr.write(`error: ${e?.stack || e}\n`); process.exit(EXIT.ERROR);
  });
}
