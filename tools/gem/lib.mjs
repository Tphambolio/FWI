/**
 * Pure helpers for the GEM point-series Action (tools/gem/gem_points.mjs).
 * No network, no dependencies — everything here is unit-tested offline in
 * tests/gem_action.test.mjs. The runner adds the GeoTIFF decoding (geotiff
 * npm) and the HTTP layer on top.
 *
 * Source: ECCC MSC GeoMet, WCS 2.0.1 GetCoverage (https://geo.weather.gc.ca/geomet).
 *   HRDPS 2.5 km  hourly to +48 h   HRDPS.CONTINENTAL_{TT,HR,WSPD,WD,PR}
 *   RDPS 10 km    hourly to +84 h   RDPS_10km_{AirTemp_2m,RelativeHumidity_2m,WindSpeed_10m,WindDir_10m,Precip-Accum1h}
 *   GDPS 15 km    hourly to +84 h, 3-hourly to +240 h
 *                                   GDPS_15km_{AirTemp_2m,RelativeHumidity_2m,WindSpeed_10m,WindDir_10m,Precip-Accum1h,Precip-Accum3h}
 * Units (verified against the WMS layer titles and a spot comparison with
 * Open-Meteo gem_seamless, 2026-10-29): temperature °C, RH %, wind m/s at
 * 10 m (converted here to km/h — the CFFDRS 10 m open wind), direction
 * degrees (from), precipitation mm. HRDPS `PR` is the accumulation since the
 * model run started, so consecutive hours are differenced; RDPS/GDPS
 * `Precip-Accum1h` is already the 1-hour total ending at TIME.
 */

export const HOUR = 3600000;
export const PAST_H = 48;      // history kept in the file (hours before "now")
export const FUTURE_H = 240;   // forecast horizon kept (GDPS reaches +240 h)
export const SCHEMA = 1;

/** One combined request window for both provinces (WCS output is a lat/lon grid). */
export const BBOX = { west: -139.1, south: 48.3, east: -109.5, north: 60.1 };
export const PROVINCE_BBOX = {
  ab: { west: -120.5, south: 48.9, east: -109.5, north: 60.1 },
  bc: { west: -139.1, south: 48.3, east: -114.0, north: 60.1 },
};

export const VARS = ['temp', 'rh', 'wind', 'wdir', 'rain'];

export const MODELS = {
  hrdps: {
    code: 'H', res: '2.5 km',
    layers: { temp: 'HRDPS.CONTINENTAL_TT', rh: 'HRDPS.CONTINENTAL_HR', wind: 'HRDPS.CONTINENTAL_WSPD', wdir: 'HRDPS.CONTINENTAL_WD', rain: 'HRDPS.CONTINENTAL_PR' },
    rainKind: 'run-accum',   // difference consecutive hours of the same run
  },
  rdps: {
    code: 'R', res: '10 km',
    layers: { temp: 'RDPS_10km_AirTemp_2m', rh: 'RDPS_10km_RelativeHumidity_2m', wind: 'RDPS_10km_WindSpeed_10m', wdir: 'RDPS_10km_WindDir_10m', rain: 'RDPS_10km_Precip-Accum1h' },
    rainKind: '1h',
  },
  gdps: {
    code: 'G', res: '15 km',
    layers: { temp: 'GDPS_15km_AirTemp_2m', rh: 'GDPS_15km_RelativeHumidity_2m', wind: 'GDPS_15km_WindSpeed_10m', wdir: 'GDPS_15km_WindDir_10m', rain: 'GDPS_15km_Precip-Accum1h', rain3h: 'GDPS_15km_Precip-Accum3h' },
    rainKind: '1h',
  },
};

/** Per-hour source codes written to the file's `src` string (one char per hour). */
export const SRC_CODES = {
  H: 'HRDPS 2.5 km (current run)', h: 'HRDPS 2.5 km, lead ≤ 6 h from an earlier run (history)',
  R: 'RDPS 10 km', G: 'GDPS 15 km hourly', g: 'GDPS 15 km 3-hourly, interpolated to the hour',
  p: 'carried from the previous file', '-': 'no data',
};

export const ATTRIBUTION = 'Data Source: Environment and Climate Change Canada';

// ─── Time ────────────────────────────────────────────────────────────────────

export const floorHour = ms => Math.floor(ms / HOUR) * HOUR;
export const isoHour = ms => new Date(ms).toISOString().slice(0, 13) + ':00:00Z';

/** Parse an ISO-8601 duration like PT1H / PT6H / PT12H / P1D into ms. */
export function parseDuration(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(s || '');
  if (!m) throw new Error(`unsupported duration ${s}`);
  return (+(m[1] || 0)) * 24 * HOUR + (+(m[2] || 0)) * HOUR + (+(m[3] || 0)) * 60000;
}

/**
 * Parse a WMS <Dimension> value: either comma-separated instants or one or
 * more "start/end/period" ranges (GeoMet mixes both). Returns sorted unique ms.
 */
export function parseTimeDimension(text) {
  const out = new Set();
  for (const part of String(text || '').split(',')) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes('/')) {
      const [a, b, d] = p.split('/');
      const start = Date.parse(a), end = Date.parse(b), step = parseDuration(d);
      if (!isFinite(start) || !isFinite(end) || !(step > 0)) throw new Error(`bad range ${p}`);
      for (let t = start; t <= end + 1; t += step) out.add(t);
    } else {
      const t = Date.parse(p);
      if (isFinite(t)) out.add(t);
    }
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * Pull the time and reference_time dimensions for one layer out of a WMS
 * GetCapabilities document (GeoMet, filtered with &layer=). Returns
 * { times: ms[], refTimes: ms[], defaultRef: ms, defaultTime: ms }.
 */
export function parseLayerCapabilities(xml, layerName) {
  const esc = layerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`<Layer[^>]*>\\s*<Name>${esc}</Name>[\\s\\S]*?</Layer>`).exec(xml)?.[0];
  if (!block) throw new Error(`layer ${layerName} not in capabilities`);
  const dim = name => {
    const m = new RegExp(`<Dimension name="${name}"([^>]*)>([^<]*)</Dimension>`).exec(block);
    if (!m) return null;
    const def = /default="([^"]+)"/.exec(m[1])?.[1];
    return { values: parseTimeDimension(m[2]), def: def ? Date.parse(def) : null };
  };
  const t = dim('time'), r = dim('reference_time');
  if (!t) throw new Error(`layer ${layerName}: no time dimension`);
  return { times: t.values, refTimes: r?.values || [], defaultRef: r?.def ?? null, defaultTime: t.def };
}

/** Hour grid for a file: `n` hourly steps from startMs (now − pastH, floored to the hour). */
export function planHours(nowMs, { pastH = PAST_H, futureH = FUTURE_H } = {}) {
  const startMs = floorHour(nowMs) - pastH * HOUR;
  return { startMs, n: pastH + futureH + 1 };
}

/**
 * Decide which model supplies each hour of the grid, from each model's time
 * list (for its default/latest run). HRDPS first, then RDPS, then GDPS
 * hourly (hour and the hour before both listed, so Precip-Accum1h is valid),
 * then GDPS 3-hourly (bracketed by two listed instants 3 h apart → 'g').
 * Hours before the newest run's first forecast hour are left for history
 * (null), to be backfilled from the previous file or short-lead older runs.
 * Returns an array of { model, code, t0?, t1? } | null per hour.
 */
export function chooseSources(startMs, n, caps) {
  // timeSet = hours every instantaneous layer (temp, rh, wind, wdir) lists;
  // rainSet = hours the 1-h precipitation layer lists; rain3hSet = the 3-h one.
  const has = (m, t) => caps[m]?.timeSet?.has(t);
  const rain = (m, t) => caps[m]?.rainSet?.has(t);
  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const t = startMs + i * HOUR;
    // Only forecast hours (t > run start) — analysis hour 0 has no accumulated rain yet
    if (has('hrdps', t) && rain('hrdps', t) && t > caps.hrdps.ref) out[i] = { model: 'hrdps', code: 'H' };
    else if (has('rdps', t) && rain('rdps', t) && t > caps.rdps.ref) out[i] = { model: 'rdps', code: 'R' };
    // GDPS hourly only where the output is truly hourly (the hour before is listed too)
    else if (has('gdps', t) && has('gdps', t - HOUR) && rain('gdps', t) && t > caps.gdps.ref) out[i] = { model: 'gdps', code: 'G' };
    else if (caps.gdps?.times?.length && t > caps.gdps.ref) {
      // 3-hourly tail: bracket by listed instants; rain = Precip-Accum3h(t1) / 3
      const times = caps.gdps.times;
      let t0 = null, t1 = null;
      for (const x of times) { if (x <= t) t0 = x; if (x >= t && t1 === null) t1 = x; }
      if (t0 !== null && t1 !== null && t1 - t0 === 3 * HOUR) out[i] = { model: 'gdps', code: 'g', t0, t1 };
      else if (t0 === t && has('gdps', t)) out[i] = { model: 'gdps', code: 'g', t0: t - 3 * HOUR, t1: t };
      if (out[i] && caps.gdps.rain3hSet && !caps.gdps.rain3hSet.has(out[i].t1)) out[i].noRain = true;
    }
  }
  return out;
}

/**
 * For a past hour with no data, the newest earlier run whose lead to that
 * hour is 1–6 h (the runs publish every 6 h, so this is the best short-lead
 * forecast available). Returns the run's ms or null.
 */
export function backfillRun(hourMs, refTimes, maxLeadH = 6) {
  let best = null;
  for (const r of refTimes) {
    const lead = (hourMs - r) / HOUR;
    if (lead >= 1 && lead <= maxLeadH && (best === null || r > best)) best = r;
  }
  return best;
}

// ─── Grids ───────────────────────────────────────────────────────────────────

/**
 * Bilinear sample of a north-up lat/lon grid { w, h, bbox:[minx,miny,maxx,maxy], data }
 * at (lat, lon). Pixel-is-area: pixel centres sit half a cell in from the
 * edges. Clamps to the edge cells; returns null when any corner is non-finite.
 */
export function bilinear(grid, lat, lon) {
  const { w, h, data } = grid;
  const [x0, y0, x1, y1] = grid.bbox;
  if (lon < x0 || lon > x1 || lat < y0 || lat > y1) return null;
  const rx = (x1 - x0) / w, ry = (y1 - y0) / h;
  const fx = Math.min(Math.max((lon - x0) / rx - 0.5, 0), w - 1);
  const fy = Math.min(Math.max((y1 - lat) / ry - 0.5, 0), h - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  const i1 = Math.min(i0 + 1, w - 1), j1 = Math.min(j0 + 1, h - 1);
  const tx = fx - i0, ty = fy - j0;
  const g = (i, j) => data[j * w + i];
  const c = [g(i0, j0), g(i1, j0), g(i0, j1), g(i1, j1)];
  if (c.some(v => !Number.isFinite(v) || Math.abs(v) > 1e30)) return null;
  return c[0] * (1 - tx) * (1 - ty) + c[1] * tx * (1 - ty) + c[2] * (1 - tx) * ty + c[3] * tx * ty;
}

/** Direction (deg) sampled through its unit-vector components, so 359° and 1° average to 0°, not 180°. */
export function bilinearDir(grid, lat, lon) {
  const rad = Math.PI / 180;
  const u = bilinear({ ...grid, data: mapGrid(grid.data, v => Math.sin(v * rad)) }, lat, lon);
  const v = bilinear({ ...grid, data: mapGrid(grid.data, x => Math.cos(x * rad)) }, lat, lon);
  if (u == null || v == null) return null;
  return (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
}
function mapGrid(data, fn) { const o = new Float64Array(data.length); for (let i = 0; i < data.length; i++) o[i] = fn(data[i]); return o; }

/** Sample every variable's grid at every point. Direction uses the vector form. */
export function samplePoints(grid, points, isDir = false) {
  const out = new Array(points.length);
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    out[k] = isDir ? bilinearDir(grid, p.lat, p.lon) : bilinear(grid, p.lat, p.lon);
  }
  return out;
}

/** Linear interpolation of a direction (deg) between two bracketing values. */
export function lerpDir(a, b, f) {
  if (a == null || b == null) return null;
  const rad = Math.PI / 180;
  const u = Math.sin(a * rad) * (1 - f) + Math.sin(b * rad) * f;
  const v = Math.cos(a * rad) * (1 - f) + Math.cos(b * rad) * f;
  return (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
}
export const lerp = (a, b, f) => (a == null || b == null) ? null : a * (1 - f) + b * f;

// ─── Projection (NRCan CDEM COG, EPSG:3979 NAD83(CSRS) / Canada Atlas Lambert) ─

/** Forward Lambert Conformal Conic 2SP: lat0 49, lon0 −95, sp 49/77, FE=FN=0, GRS80. */
export function lcc3979(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f), rad = Math.PI / 180;
  const p1 = 49 * rad, p2 = 77 * rad, p0 = 49 * rad, l0 = -95 * rad;
  const m = p => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = p => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * Math.pow(t(p1), n));
  const r0 = a * F * Math.pow(t(p0), n);
  const r = a * F * Math.pow(t(lat * rad), n);
  const th = n * (lon * rad - l0);
  return [r * Math.sin(th), r0 - r * Math.cos(th)];
}

// ─── Stations ────────────────────────────────────────────────────────────────

/** Pull a `const NAME = [ … ];` array literal out of a province module. */
export function extractStationList(src, constName) {
  // Stop at the first line that is just `]` — the module may chain `.sort(…)` after the literal.
  const m = new RegExp(`const ${constName}\\s*=\\s*(\\[[\\s\\S]*?\\n\\])`).exec(src);
  if (!m) throw new Error(`${constName} not found`);
  // The literal is plain data (objects with name/lat/lng[/code]) — evaluate it in isolation.
  const arr = new Function(`return (${m[1]});`)();
  return arr.filter(s => s && typeof s.lat === 'number' && typeof s.lng === 'number' && s.name);
}

export const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
};

/**
 * Province point set: every station the browser can ask for, keyed by the
 * exact name it uses. Stations within `dedupeKm` of an earlier one become
 * aliases of it (one series stored). Input: [{ name, lat, lon }] in priority
 * order. Returns { points: [{ name, lat, lon }], aliases: { name: canonicalName } }.
 */
export function dedupeStations(list, dedupeKm = 0.1) {
  const points = [], aliases = {}, seen = new Set();
  for (const s of list) {
    const name = String(s.name).trim();
    if (!name || seen.has(name)) continue;
    const lat = +s.lat, lon = +(s.lon ?? s.lng);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    seen.add(name);
    const dup = points.find(p => haversineKm(lat, lon, p.lat, p.lon) <= dedupeKm);
    if (dup) aliases[name] = dup.name;
    else points.push({ name, lat, lon });
  }
  return { points, aliases };
}

/** Stations whose coordinates fall in a province box. */
export const inBox = (box, lat, lon) => lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;

// ─── File assembly ───────────────────────────────────────────────────────────

export const round1 = v => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 10) / 10;
export const round0 = v => (v == null || !Number.isFinite(v)) ? null : Math.round(v);
export const clampRain = v => (v == null ? null : Math.max(0, v));

/**
 * Assemble one province file from per-point series.
 *   series[k] = { temp:[], rh:[], wind:[], wdir:[], rain:[] } (raw units already
 *   converted: wind km/h, rain mm/h), src = per-hour code array.
 */
export function buildFile({ province, startMs, n, runs, points, aliases, series, src, generatedMs = Date.now() }) {
  const stations = {};
  points.forEach((p, k) => {
    const s = series[k];
    stations[p.name] = {
      lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4),
      temp: s.temp.map(round1), rh: s.rh.map(round0), wind: s.wind.map(round1),
      wdir: s.wdir.map(round0), rain: s.rain.map(v => round1(clampRain(v))),
    };
  });
  for (const [alias, canon] of Object.entries(aliases)) if (stations[canon]) stations[alias] = { alias: canon };
  return {
    schema: SCHEMA, province, generated: new Date(generatedMs).toISOString(),
    attribution: ATTRIBUTION, licence: 'https://eccc-msc.github.io/open-data/licence/readme_en/',
    model_runs: { hrdps: runs.hrdps ? isoHour(runs.hrdps) : null, rdps: runs.rdps ? isoHour(runs.rdps) : null, gdps: runs.gdps ? isoHour(runs.gdps) : null },
    start: isoHour(startMs), step_h: 1, n,
    units: { temp: '°C (2 m)', rh: '% (2 m)', wind: 'km/h (10 m)', wdir: 'deg, from', rain: 'mm in the hour ending at the step' },
    src: src.join(''), src_legend: SRC_CODES,
    stations,
  };
}

/**
 * Carry history forward: for every hour of the new grid that is null in the
 * new file and present in the previous file (same absolute hour, same station
 * name), copy the previous value (all five variables together) and mark the
 * hour 'p' when it had no source. Returns the number of hours filled.
 */
export function mergeHistory(file, prev) {
  if (!prev?.stations || !prev.start || prev.step_h !== 1) return 0;
  const prevStart = Date.parse(prev.start), start = Date.parse(file.start);
  const src = file.src.split('');
  let filled = 0;
  const filledHours = new Set();
  for (const [name, st] of Object.entries(file.stations)) {
    if (st.alias) continue;
    const ps = prev.stations[name];
    if (!ps || ps.alias) continue;
    for (let i = 0; i < file.n; i++) {
      const t = start + i * HOUR;
      const j = Math.round((t - prevStart) / HOUR);
      if (j < 0 || j >= (prev.n ?? ps.temp.length)) continue;
      if (st.temp[i] != null) continue;
      if (ps.temp[j] == null) continue;
      for (const v of VARS) st[v][i] = ps[v]?.[j] ?? null;
      filled++;
      filledHours.add(i);
    }
  }
  for (const i of filledHours) if (src[i] === '-') src[i] = prev.src?.[Math.round((start + i * HOUR - prevStart) / HOUR)]?.toLowerCase() || 'p';
  file.src = src.join('');
  return filled;
}

/** Coverage summary for the log and for the write/keep decision. */
export function coverage(file) {
  const names = Object.keys(file.stations).filter(k => !file.stations[k].alias);
  let cells = 0, nulls = 0;
  for (const k of names) for (const v of VARS) for (const x of file.stations[k][v]) { cells++; if (x == null) nulls++; }
  return { stations: names.length, aliases: Object.keys(file.stations).length - names.length, cells, nulls, pct: cells ? +(100 * (1 - nulls / cells)).toFixed(1) : 0 };
}
