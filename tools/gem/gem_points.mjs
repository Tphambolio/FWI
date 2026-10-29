#!/usr/bin/env node
/**
 * GEM point series for Pyra — ECCC MSC GeoMet (WCS 2.0.1) → data/gem/ab.json, data/gem/bc.json
 *
 * Run by .github/workflows/gem-points.yml every 6 h (~3 h 40 after the 00/06/12/18Z
 * HRDPS/RDPS cycles publish), or by hand from the repo root:
 *
 *   npm install --prefix tools/gem          # geotiff (pinned) — the only dependency
 *   node tools/gem/gem_points.mjs           # writes data/gem/*.json (+ data/station_elevation.json)
 *   node tools/gem/gem_points.mjs --dry     # plan only, no downloads, no writes
 *   node tools/gem/gem_points.mjs --no-elev # skip the elevation step
 *
 * What it does
 *   1. Station points: ALBERTA_STATIONS (fwi.js), BC_STATIONS (bc/fwi.js) and every
 *      station in data/cwfis_prev.json (stations / bcStations), keyed by the exact
 *      names the browser uses; points within 100 m share one series (aliases).
 *   2. Reads each layer's time / reference_time dimension from the GeoMet WMS
 *      capabilities and pins every request to the newest run (DIM_REFERENCE_TIME).
 *   3. Composites HRDPS (≤ +48 h) → RDPS (≤ +84 h) → GDPS hourly → GDPS 3-hourly
 *      (interpolated to the hour) over now−48 h … now+240 h, one WCS GetCoverage
 *      per layer per hour over one AB+BC bounding box, sampled bilinearly at the
 *      points. Hours before the newest run are carried from the previous file,
 *      or backfilled from an earlier run's 1–6 h lead when the file is new.
 *   4. Writes the two province files (1-decimal numbers, nulls where no model
 *      covers an hour) and, for stations missing from data/station_elevation.json,
 *      reads their ground elevation from NRCan's CDEM cloud-optimised GeoTIFF.
 *
 * Budget: ~700–900 requests of 50 KB–1 MB per cycle (HRDPS requests dominate),
 * concurrency 5 with retries; about 2–3 minutes. See docs/data-sources.md.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  HOUR, PAST_H, FUTURE_H, BBOX, PROVINCE_BBOX, VARS, MODELS, ATTRIBUTION,
  isoHour, parseLayerCapabilities, planHours, chooseSources, backfillRun,
  samplePoints, lerp, lerpDir, lcc3979, extractStationList, dedupeStations, inBox,
  buildFile, mergeHistory, coverage,
} from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEOMET = 'https://geo.weather.gc.ca/geomet';
const CDEM_COG = 'https://datacube-prod-data-public.s3.amazonaws.com/store/elevation/cdem-cdsm/cdem/cdem-canada-dem.tif';
const UA = 'pyra-gem-points/1 (+https://github.com/Tphambolio/FWI)';
const CONCURRENCY = +(process.env.GEM_CONCURRENCY || 5);
const RETRIES = 3;
const MIN_OK_FRACTION = 0.9;   // below this share of successful requests the files are left as they were
const argv = new Set(process.argv.slice(2));
const DRY = argv.has('--dry'), NO_ELEV = argv.has('--no-elev');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const t0 = Date.now();
const stats = { requests: 0, ok: 0, failed: 0, bytes: 0, retries: 0 };

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function getBuf(url, { timeout = 90000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': UA } });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (/xml|html|text/.test(ct)) throw new Error(`service exception: ${buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 200)}`);
      stats.bytes += buf.length;
      return buf;
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) { stats.retries++; await new Promise(r => setTimeout(r, 1500 * (attempt + 1) + Math.random() * 500)); }
    }
  }
  throw lastErr;
}

async function getText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Run async jobs with a concurrency cap; collects results in order. */
async function pool(items, worker, limit = CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await worker(items[i], i); }
  }));
  return out;
}

// ─── Stations ────────────────────────────────────────────────────────────────

function loadStations() {
  const ab = extractStationList(readFileSync(join(ROOT, 'fwi.js'), 'utf8'), 'ALBERTA_STATIONS');
  const bc = extractStationList(readFileSync(join(ROOT, 'bc', 'fwi.js'), 'utf8'), 'BC_STATIONS');
  let prev = {};
  try { prev = JSON.parse(readFileSync(join(ROOT, 'data', 'cwfis_prev.json'), 'utf8')); } catch (_) { log('warn: data/cwfis_prev.json unreadable — engine lists only'); }
  const fromPrev = sec => Object.entries(prev[sec] || {}).map(([name, s]) => ({ name, lat: +s.lat, lon: +s.lon }));
  const abList = [...ab.map(s => ({ name: s.name, lat: s.lat, lon: s.lng })), ...fromPrev('stations')].filter(s => inBox(PROVINCE_BBOX.ab, s.lat, s.lon));
  const bcList = [...bc.map(s => ({ name: s.name, lat: s.lat, lon: s.lng })), ...fromPrev('bcStations')].filter(s => inBox(PROVINCE_BBOX.bc, s.lat, s.lon));
  return { ab: dedupeStations(abList), bc: dedupeStations(bcList) };
}

// ─── Capabilities ────────────────────────────────────────────────────────────

async function loadCapabilities() {
  const caps = {};
  for (const [model, m] of Object.entries(MODELS)) {
    const layers = { ...m.layers };
    const perLayer = {};
    await pool(Object.entries(layers), async ([v, layer]) => {
      const xml = await getText(`${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${encodeURIComponent(layer)}`);
      perLayer[v] = parseLayerCapabilities(xml, layer);
    }, 3);
    // The model's run = the temperature layer's default reference time; the
    // model's hour list = hours every instantaneous variable has. Rain layers
    // are tracked separately (1-h accumulation starts one hour after the run;
    // GDPS lists 1-h values only where output is hourly, 3-h beyond that).
    const ref = perLayer.temp.defaultRef;
    const common = perLayer.temp.times.filter(t => ['rh', 'wind', 'wdir'].every(v => perLayer[v].times.includes(t)));
    caps[model] = {
      ref, refTimes: perLayer.temp.refTimes, times: common, timeSet: new Set(common),
      rainSet: new Set(perLayer.rain.times), rain3hSet: perLayer.rain3h ? new Set(perLayer.rain3h.times) : null, perLayer,
    };
    log(`${model}: run ${isoHour(ref)} · ${common.length} hours ${isoHour(common[0])} → ${isoHour(common[common.length - 1])} · rain1h ${perLayer.rain.times.length}${perLayer.rain3h ? ` · rain3h ${perLayer.rain3h.times.length}` : ''} · ${perLayer.temp.refTimes.length} runs listed`);
  }
  return caps;
}

// ─── Requests ────────────────────────────────────────────────────────────────

const wcsUrl = (layer, refMs, timeMs) =>
  `${GEOMET}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${encodeURIComponent(layer)}` +
  `&subsettingcrs=EPSG:4326&subset=x(${BBOX.west},${BBOX.east})&subset=y(${BBOX.south},${BBOX.north})` +
  `&TIME=${isoHour(timeMs)}&DIM_REFERENCE_TIME=${isoHour(refMs)}&format=image/tiff`;

/**
 * Plan every (layer, run, time) coverage needed. `need` maps a request key to
 * its URL; consumers resolve values from the sample cache afterwards.
 */
function planRequests(startMs, n, sources, caps, prevFile) {
  const need = new Map();
  const add = (layer, ref, t) => { const k = `${layer}|${ref}|${t}`; if (!need.has(k)) need.set(k, wcsUrl(layer, ref, t)); return k; };
  const plan = new Array(n).fill(null);     // per hour: { code, model, ref, keys:{var:key}, rainPrev?, t0/t1 for 'g' }
  const prevHas = i => {
    if (!prevFile) return false;
    const j = Math.round((startMs + i * HOUR - Date.parse(prevFile.start)) / HOUR);
    if (j < 0 || j >= prevFile.n) return false;
    const names = Object.keys(prevFile.stations).filter(k => !prevFile.stations[k].alias);
    // "has" = at least 90% of stations carry a temperature for that hour
    let have = 0; for (const k of names) if (prevFile.stations[k].temp[j] != null) have++;
    return names.length > 0 && have / names.length >= 0.9;
  };
  for (let i = 0; i < n; i++) {
    const t = startMs + i * HOUR;
    const s = sources[i];
    if (s) {
      const m = MODELS[s.model], ref = caps[s.model].ref;
      const entry = { code: s.code, model: s.model, ref, keys: {} };
      if (s.code === 'g') {
        // interpolate temp/rh/wind/wdir between t0 and t1; rain = Accum3h(t1) / 3
        entry.t0 = s.t0; entry.t1 = s.t1;
        entry.keys0 = {}; entry.keys1 = {};
        for (const v of ['temp', 'rh', 'wind', 'wdir']) { entry.keys0[v] = add(m.layers[v], ref, s.t0); entry.keys1[v] = add(m.layers[v], ref, s.t1); }
        if (!s.noRain) entry.keys.rain = add(m.layers.rain3h, ref, s.t1);
      } else {
        for (const v of VARS) entry.keys[v] = add(m.layers[v], ref, t);
        if (m.rainKind === 'run-accum' && t - HOUR > ref) entry.rainPrev = add(m.layers.rain, ref, t - HOUR);
      }
      plan[i] = entry;
      continue;
    }
    // History hour: previous file first, else a short-lead HRDPS (then RDPS) backfill
    if (prevHas(i)) { plan[i] = { code: 'p' }; continue; }
    for (const model of ['hrdps', 'rdps']) {
      const run = backfillRun(t, caps[model]?.refTimes || []);
      if (run == null) continue;
      const m = MODELS[model];
      const entry = { code: model === 'hrdps' ? 'h' : 'r', model, ref: run, keys: {} };
      for (const v of VARS) entry.keys[v] = add(m.layers[v], run, t);
      if (m.rainKind === 'run-accum' && t - HOUR > run) entry.rainPrev = add(m.layers.rain, run, t - HOUR);
      plan[i] = entry;
      break;
    }
  }
  return { need, plan };
}

// ─── Download + sample ───────────────────────────────────────────────────────

async function downloadAndSample(need, points) {
  const { fromArrayBuffer } = await import('geotiff');
  const samples = new Map();   // key → Float64 arrays per point (number|null)
  const entries = [...need.entries()];
  log(`downloading ${entries.length} coverages (concurrency ${CONCURRENCY})…`);
  let done = 0;
  await pool(entries, async ([key, url]) => {
    stats.requests++;
    try {
      const buf = await getBuf(url);
      const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const img = await tiff.getImage();
      const data = (await img.readRasters())[0];
      const grid = { w: img.getWidth(), h: img.getHeight(), bbox: img.getBoundingBox(), data };
      const isDir = /_WD$|WindDir/.test(key);
      samples.set(key, samplePoints(grid, points, isDir));
      stats.ok++;
    } catch (e) {
      stats.failed++;
      console.warn(`  fail ${key}: ${e.message}`);
      samples.set(key, null);
    }
    done++;
    if (done % 100 === 0) log(`  ${done}/${entries.length} (${(stats.bytes / 1048576).toFixed(0)} MB)`);
  });
  return samples;
}

/** Resolve the per-hour plan into per-point series (wind → km/h, rain → mm/h). */
function assemble(plan, samples, nPoints, n) {
  const series = Array.from({ length: nPoints }, () => Object.fromEntries(VARS.map(v => [v, new Array(n).fill(null)])));
  const src = new Array(n).fill('-');
  const get = (key, k) => { const s = key && samples.get(key); return s ? s[k] : null; };
  for (let i = 0; i < n; i++) {
    const e = plan[i];
    if (!e || e.code === 'p') continue;
    let any = false;
    for (let k = 0; k < nPoints; k++) {
      let temp, rh, wind, wdir, rain;
      if (e.code === 'g') {
        const fr = e.frac;   // position of this hour inside the 3-h bracket (0 → t0, 1 → t1)
        temp = lerp(get(e.keys0.temp, k), get(e.keys1.temp, k), fr);
        rh = lerp(get(e.keys0.rh, k), get(e.keys1.rh, k), fr);
        wind = lerp(get(e.keys0.wind, k), get(e.keys1.wind, k), fr);
        wdir = lerpDir(get(e.keys0.wdir, k), get(e.keys1.wdir, k), fr);
        const r3 = get(e.keys.rain, k);
        rain = r3 == null ? null : r3 / 3;
      } else {
        temp = get(e.keys.temp, k); rh = get(e.keys.rh, k); wind = get(e.keys.wind, k); wdir = get(e.keys.wdir, k);
        const r = get(e.keys.rain, k);
        if (MODELS[e.model].rainKind === 'run-accum') {
          const rp = e.rainPrev ? get(e.rainPrev, k) : 0;
          rain = (r == null || rp == null) ? null : r - rp;
        } else rain = r;
      }
      if (temp == null) continue;
      any = true;
      series[k].temp[i] = temp; series[k].rh[i] = rh; series[k].wind[i] = wind == null ? null : wind * 3.6;
      series[k].wdir[i] = wdir; series[k].rain[i] = rain;
    }
    if (any) src[i] = e.code;
  }
  return { series, src };
}

// ─── Elevation (NRCan CDEM COG) ──────────────────────────────────────────────

async function updateElevations(allPoints) {
  const path = join(ROOT, 'data', 'station_elevation.json');
  let file = { source: 'NRCan CDEM (Canadian Digital Elevation Model), 16 m cloud-optimised GeoTIFF, EPSG:3979 — Open Government Licence – Canada', url: CDEM_COG, stations: {} };
  try { const f = JSON.parse(readFileSync(path, 'utf8')); if (f?.stations) file = { ...file, ...f }; } catch (_) {}
  const missing = allPoints.filter(p => file.stations[p.name]?.elev == null);
  if (!missing.length) { log('elevation: all stations present'); return; }
  log(`elevation: ${missing.length} stations to look up in the CDEM COG`);
  const { fromUrl } = await import('geotiff');
  const tiff = await fromUrl(CDEM_COG, { allowFullFile: false, headers: { 'user-agent': UA } });
  const img = await tiff.getImage(0);
  const [x0, y0, x1, y1] = img.getBoundingBox();
  const W = img.getWidth(), H = img.getHeight(), nodata = img.getGDALNoData();
  let okN = 0;
  await pool(missing, async p => {
    try {
      const [x, y] = lcc3979(p.lat, p.lon);
      const px = Math.floor((x - x0) / (x1 - x0) * W), py = Math.floor((y1 - y) / (y1 - y0) * H);
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const r = await img.readRasters({ window: [px, py, px + 1, py + 1] });
      const v = r[0][0];
      if (v == null || v === nodata || !isFinite(v) || v < -500 || v > 9000) return;
      file.stations[p.name] = { lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4), elev: Math.round(v) };
      okN++;
    } catch (e) { console.warn(`  elev fail ${p.name}: ${e.message}`); }
  }, 4);
  file.generated = new Date().toISOString();
  file.crs_note = 'Points projected to EPSG:3979 (LCC 2SP, lat0 49, lon0 −95, sp 49/77, GRS80) and read as the nearest 16 m cell.';
  if (!DRY) writeFileSync(path, JSON.stringify(file, null, 0) + '\n');
  log(`elevation: ${okN}/${missing.length} resolved → ${Object.keys(file.stations).length} stations in data/station_elevation.json`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const now = Date.now();
  const stations = loadStations();
  log(`stations: AB ${stations.ab.points.length} points (+${Object.keys(stations.ab.aliases).length} aliases) · BC ${stations.bc.points.length} (+${Object.keys(stations.bc.aliases).length})`);
  const allPoints = [...stations.ab.points, ...stations.bc.points];

  const caps = await loadCapabilities();
  const { startMs, n } = planHours(now, { pastH: PAST_H, futureH: FUTURE_H });
  const sources = chooseSources(startMs, n, caps);
  // Fraction along the 3-h bracket for interpolated hours
  sources.forEach((s, i) => { if (s?.code === 'g') s.frac = ((startMs + i * HOUR) - s.t0) / (s.t1 - s.t0); });

  const readPrev = prov => { try { return JSON.parse(readFileSync(join(ROOT, 'data', 'gem', `${prov}.json`), 'utf8')); } catch (_) { return null; } };
  const prevFiles = { ab: readPrev('ab'), bc: readPrev('bc') };
  const prevForPlan = prevFiles.ab || prevFiles.bc;

  const { need, plan } = planRequests(startMs, n, sources, caps, prevForPlan);
  plan.forEach((e, i) => { if (e?.code === 'g') e.frac = sources[i].frac; });
  const counts = {}; for (const e of plan) counts[e?.code || '-'] = (counts[e?.code || '-'] || 0) + 1;
  log(`grid: ${n} hours ${isoHour(startMs)} → ${isoHour(startMs + (n - 1) * HOUR)} · sources ${JSON.stringify(counts)} · ${need.size} coverages to fetch`);
  if (DRY) { log('dry run — stopping before downloads'); return; }

  const samples = await downloadAndSample(need, allPoints);
  const okFrac = stats.requests ? stats.ok / stats.requests : 0;
  log(`downloaded ${stats.ok}/${stats.requests} (${(stats.bytes / 1048576).toFixed(0)} MB, ${stats.retries} retries) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (okFrac < MIN_OK_FRACTION) throw new Error(`only ${(okFrac * 100).toFixed(0)}% of coverages downloaded — keeping the previous files`);

  const { series, src } = assemble(plan, samples, allPoints.length, n);
  const runs = { hrdps: caps.hrdps.ref, rdps: caps.rdps.ref, gdps: caps.gdps.ref };
  mkdirSync(join(ROOT, 'data', 'gem'), { recursive: true });
  let offset = 0;
  for (const prov of ['ab', 'bc']) {
    const pts = stations[prov].points;
    const file = buildFile({ province: prov, startMs, n, runs, points: pts, aliases: stations[prov].aliases,
      series: series.slice(offset, offset + pts.length), src, generatedMs: now });
    offset += pts.length;
    const filled = mergeHistory(file, prevFiles[prov]);
    const cov = coverage(file);
    const out = JSON.stringify(file) + '\n';
    writeFileSync(join(ROOT, 'data', 'gem', `${prov}.json`), out);
    log(`data/gem/${prov}.json: ${cov.stations} stations (+${cov.aliases} aliases), ${cov.pct}% of cells filled, ${filled} history hours carried, ${(out.length / 1048576).toFixed(2)} MB · src ${file.src.replace(/(.)\1*/g, m => m[0] + m.length)}`);
  }

  if (!NO_ELEV) await updateElevations(allPoints);
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${ATTRIBUTION}`);
}

main().catch(e => { console.error(`gem_points: ${e.stack || e}`); process.exit(1); });
