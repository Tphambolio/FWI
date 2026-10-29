/**
 * GEM point-series Action (tools/gem/lib.mjs) — offline unit tests.
 *
 *   - GeoMet time / reference_time dimension parsing (ranges and lists);
 *   - compositing: HRDPS → RDPS → GDPS hourly → GDPS 3-hourly (interpolated),
 *     history left for the previous file / short-lead backfill, rain source rules;
 *   - bilinear and vector (direction) sampling on a lat/lon grid, including on a
 *     real GeoTIFF written and read back with the pinned geotiff package when it
 *     is installed (npm install --prefix tools/gem; skipped otherwise, never fails);
 *   - EPSG:3979 projection used to read the NRCan CDEM COG;
 *   - station extraction / de-duplication, file assembly, history merge, coverage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { root } from './_harness.mjs';
import {
  HOUR, parseDuration, parseTimeDimension, parseLayerCapabilities, planHours, chooseSources, backfillRun,
  bilinear, bilinearDir, samplePoints, lerp, lerpDir, lcc3979, extractStationList, dedupeStations, haversineKm,
  buildFile, mergeHistory, coverage, round1, VARS, MODELS, SRC_CODES,
} from '../tools/gem/lib.mjs';

const T = iso => Date.parse(iso);

// ─── Time dimensions ─────────────────────────────────────────────────────────

test('parseDuration / parseTimeDimension: ranges, lists, and GeoMet mixes of both', () => {
  assert.equal(parseDuration('PT1H'), HOUR);
  assert.equal(parseDuration('PT6H'), 6 * HOUR);
  assert.equal(parseDuration('P1D'), 24 * HOUR);
  const r = parseTimeDimension('2026-10-29T00:00:00Z/2026-10-29T03:00:00Z/PT1H');
  assert.deepEqual(r.map(t => new Date(t).toISOString()), ['2026-10-29T00:00:00.000Z', '2026-10-29T01:00:00.000Z', '2026-10-29T02:00:00.000Z', '2026-10-29T03:00:00.000Z']);
  const l = parseTimeDimension('2026-11-01T12:00:00Z,2026-11-01T15:00:00Z, 2026-11-01T18:00:00Z');
  assert.equal(l.length, 3);
  assert.equal(l[1] - l[0], 3 * HOUR);
  const mix = parseTimeDimension('2026-10-29T00:00:00Z/2026-10-29T02:00:00Z/PT1H,2026-10-29T06:00:00Z');
  assert.equal(mix.length, 4);
  assert.equal(mix[3], T('2026-10-29T06:00:00Z'));
});

test('parseLayerCapabilities pulls time + reference_time for the named layer only', () => {
  const xml = `<Layer><Name>HRDPS.CONTINENTAL_TT</Name><Title>t</Title>
    <Dimension name="time" units="ISO8601" default="2026-10-29T08:00:00Z" nearestValue="0">2026-10-29T00:00:00Z/2026-10-31T00:00:00Z/PT1H</Dimension>
    <Dimension name="reference_time" units="ISO8601" default="2026-10-29T00:00:00Z" multipleValues="1" nearestValue="0">2026-10-27T18:00:00Z/2026-10-29T00:00:00Z/PT6H</Dimension>
    </Layer><Layer><Name>HRDPS.CONTINENTAL_PR</Name>
    <Dimension name="time" units="ISO8601" default="2026-10-29T08:00:00Z">2026-10-29T01:00:00Z/2026-10-31T00:00:00Z/PT1H</Dimension></Layer>`;
  const tt = parseLayerCapabilities(xml, 'HRDPS.CONTINENTAL_TT');
  assert.equal(tt.times.length, 49);
  assert.equal(tt.refTimes.length, 6);
  assert.equal(tt.defaultRef, T('2026-10-29T00:00:00Z'));
  const pr = parseLayerCapabilities(xml, 'HRDPS.CONTINENTAL_PR');
  assert.equal(pr.times.length, 48, 'rain accumulation starts one hour after the run');
  assert.equal(pr.times[0], T('2026-10-29T01:00:00Z'));
  assert.throws(() => parseLayerCapabilities(xml, 'HRDPS.CONTINENTAL_WD'), /not in capabilities/);
});

// ─── Compositing ─────────────────────────────────────────────────────────────

/** Fixture capabilities: three models all run at `run`, horizons like GeoMet's. */
function fixtureCaps(run = T('2026-10-29T00:00:00Z')) {
  const hours = (from, to, step = 1) => { const a = []; for (let t = run + from * HOUR; t <= run + to * HOUR; t += step * HOUR) a.push(t); return a; };
  const mk = (times, rain, rain3h, refs) => ({ ref: run, refTimes: refs, times, timeSet: new Set(times), rainSet: new Set(rain), rain3hSet: rain3h ? new Set(rain3h) : null, rainTotSet: rain3h ? new Set([...hours(1, 84), ...hours(87, 240, 3)]) : null });
  const refs6 = [-30, -24, -18, -12, -6, 0].map(h => run + h * HOUR);
  return {
    hrdps: mk(hours(0, 48), hours(1, 48), null, refs6),
    rdps: mk(hours(0, 84), hours(1, 84), null, refs6),
    gdps: mk([...hours(0, 84), ...hours(87, 240, 3)], hours(1, 84), hours(3, 168, 3), [run - 12 * HOUR, run]),
  };
}

test('planHours: 48 h back, 240 h ahead, floored to the hour', () => {
  const now = T('2026-10-29T03:41:17Z');
  const { startMs, n } = planHours(now);
  assert.equal(new Date(startMs).toISOString(), '2026-10-27T03:00:00.000Z');
  assert.equal(n, 289);
});

test('chooseSources: HRDPS to +48, RDPS to +84, GDPS 3-hourly tail interpolated; history hours left null', () => {
  const run = T('2026-10-29T00:00:00Z');
  const caps = fixtureCaps(run);
  const { startMs, n } = planHours(run + 3.5 * HOUR);          // 03:30Z, like the Action
  const src = chooseSources(startMs, n, caps);
  const code = h => src[Math.round((run + h * HOUR - startMs) / HOUR)];
  assert.equal(new Date(startMs).toISOString(), '2026-10-27T03:00:00.000Z', 'grid starts 48 h before the floored run time');
  for (let h = -45; h <= 0; h++) assert.equal(code(h), null, `hour ${h}: history`);
  assert.equal(code(1).code, 'H'); assert.equal(code(48).code, 'H');
  assert.equal(code(49).code, 'R'); assert.equal(code(84).code, 'R');
  assert.equal(code(85).code, 'g'); assert.equal(code(85).t0, run + 84 * HOUR); assert.equal(code(85).t1, run + 87 * HOUR);
  assert.equal(code(87).code, 'g'); assert.equal(code(87).t1, run + 87 * HOUR, 'listed 3-hourly instant → frac 1 of its own bracket');
  assert.equal(code(87).rainFrom, '3h');
  assert.equal(code(170).rainFrom, 'total', 'beyond Precip-Accum3h the run total is differenced');
  assert.equal(code(240).code, 'g');
  const counts = {}; for (const s of src) counts[s?.code || '-'] = (counts[s?.code || '-'] || 0) + 1;
  assert.deepEqual(counts, { '-': 49, H: 48, R: 36, g: 156 });
});

test('chooseSources: GDPS hourly ("G") only when the hour before is listed too; a run with no HRDPS still composites', () => {
  const run = T('2026-10-29T00:00:00Z');
  const caps = fixtureCaps(run);
  delete caps.hrdps;
  caps.rdps.timeSet = new Set([...caps.rdps.times].filter(t => t <= run + 10 * HOUR)); // RDPS only to +10
  const { startMs, n } = planHours(run + 3 * HOUR);
  const src = chooseSources(startMs, n, caps);
  const code = h => src[Math.round((run + h * HOUR - startMs) / HOUR)];
  assert.equal(code(10).code, 'R');
  assert.equal(code(11).code, 'G');
  assert.equal(code(84).code, 'G');
  assert.equal(code(85).code, 'g');
});

test('backfillRun picks the newest earlier run with a 1–6 h lead', () => {
  const run = T('2026-10-29T00:00:00Z');
  const refs = [-30, -24, -18, -12, -6, 0].map(h => run + h * HOUR);
  assert.equal(backfillRun(run - 2 * HOUR, refs), run - 6 * HOUR, '22Z ← 18Z run (lead 4)');
  assert.equal(backfillRun(run - 6 * HOUR, refs), run - 12 * HOUR, 'exactly on a run → the run before (lead 6)');
  assert.equal(backfillRun(run - 40 * HOUR, refs), null, 'older than the listed runs');
  assert.equal(backfillRun(run + 1 * HOUR, refs), run, 'lead 1 from the newest run');
});

// ─── Sampling ────────────────────────────────────────────────────────────────

/** 4 × 3 north-up grid over lon −114…−113, lat 53…54: value = 10·row + col (row 0 = north). */
const GRID = { w: 4, h: 3, bbox: [-114, 53, -113, 54], data: Float32Array.from([0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23]) };
const cell = (col, row) => [54 - (row + 0.5) * (1 / 3), -114 + (col + 0.5) * 0.25];   // [lat, lon] of a pixel centre

test('bilinear: pixel centres return the cell value, midpoints the mean, edges clamp, outside → null', () => {
  assert.equal(bilinear(GRID, ...cell(1, 1)), 11);
  assert.equal(bilinear(GRID, ...cell(3, 2)), 23);
  const [la, lo] = cell(1, 1), [lb, lo2] = cell(2, 1);
  assert.equal(bilinear(GRID, la, (lo + lo2) / 2), 11.5);
  const [lc] = cell(1, 2);
  assert.ok(Math.abs(bilinear(GRID, (la + lc) / 2, lo) - 16) < 1e-9, 'between rows 1 and 2');
  assert.equal(bilinear(GRID, 53.9999, -113.9999), 0, 'corner clamps to the corner cell');
  assert.equal(bilinear(GRID, 52.9, -113.5), null);
  const nan = { ...GRID, data: Float32Array.from(GRID.data) }; nan.data[5] = NaN;
  assert.equal(bilinear(nan, ...cell(1, 1)), null, 'non-finite corner → null');
});

test('bilinearDir / lerpDir: directions average through their vectors (359° and 1° → 0°, never 180°)', () => {
  const g = { w: 2, h: 1, bbox: [-114, 53, -113, 54], data: Float32Array.from([359, 1]) };
  const v = bilinearDir(g, 53.5, -113.5);
  assert.ok(v < 0.001 || v > 359.999, `got ${v}`);
  assert.ok(Math.abs(lerpDir(350, 10, 0.5)) < 1e-9);
  assert.equal(Math.round(lerpDir(90, 180, 0.5)), 135);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(lerp(null, 20, 0.5), null);
  const s = samplePoints(g, [{ lat: 53.5, lon: -113.5 }, { lat: 53.5, lon: -113.875 }], true);
  assert.ok(s[0] < 0.001 || s[0] > 359.999);
  assert.equal(s[1], 359);
});

test('lcc3979 (NRCan CDEM COG projection) matches the catalogue: Edmonton, Kamloops, Fort Chipewyan', () => {
  // Reference easting/northing from the probe that read 667 / 344 / 225 m against the COG (2026-10-29)
  const close = (a, b, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
  let [x, y] = lcc3979(53.567, -113.517); close(x, -1191198); close(y, 678648);
  [x, y] = lcc3979(50.70, -120.45); close(x, -1739510); close(y, 541207);
  [x, y] = lcc3979(58.767, -111.117); close(x, -898330); close(y, 1185094);
  [x, y] = lcc3979(49, -95); close(x, 0); close(y, 0);   // projection origin
});

// Real GeoTIFF round trip with the Action's pinned reader, when it is installed.
let geotiff = null;
try {
  const req = createRequire(join(root, 'tools', 'gem', 'package.json'));
  geotiff = await import(pathToFileURL(req.resolve('geotiff')).href);
} catch (_) { /* tools/gem not installed — skipped below */ }

test('fixture GeoTIFF (WGS84, pixel-is-area) decodes to the same grid and samples like the Action', { skip: !geotiff && 'geotiff not installed (npm install --prefix tools/gem)' }, async () => {
  // geotiff's writer emits 8-bit samples (GeoMet serves float32; decoding is the
  // library's job, the georeferencing + sampling below is ours). Values 0–23 fit.
  const { writeArrayBuffer, fromArrayBuffer } = geotiff;
  const w = 4, h = 3, [minx, miny, maxx, maxy] = GRID.bbox;
  const buf = await writeArrayBuffer(Array.from(GRID.data), {
    width: w, height: h, ModelTiepoint: [0, 0, 0, minx, maxy, 0], ModelPixelScale: [(maxx - minx) / w, (maxy - miny) / h, 0],
    GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 1, GeographicTypeGeoKey: 4326,
  });
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const data = (await img.readRasters())[0];
  const grid = { w: img.getWidth(), h: img.getHeight(), bbox: img.getBoundingBox(), data };
  assert.equal(grid.w, 4); assert.equal(grid.h, 3);
  assert.deepEqual(grid.bbox.map(v => +v.toFixed(6)), [-114, 53, -113, 54]);
  assert.equal(bilinear(grid, ...cell(1, 1)), 11);
  assert.equal(bilinear(grid, ...cell(3, 0)), 3);
  const [la, lo] = cell(1, 1), [, lo2] = cell(2, 1);
  assert.equal(bilinear(grid, la, (lo + lo2) / 2), 11.5);
});

// ─── Stations ────────────────────────────────────────────────────────────────

test('extractStationList reads the engines\' literals (incl. a .sort() chain) and keeps only valid coordinates', () => {
  const src = `const X = [\n  // comment\n  { name: 'A', lat: 53.5, lng: -113.5 },\n  { name: 'B', lat: 50.1, lng: -120.2, code: 7 },\n  { name: 'bad', lat: null, lng: -1 },\n].sort((a, b) => a.name.localeCompare(b.name));\nconst Y = [\n];`;
  const list = extractStationList(src, 'X');
  assert.deepEqual(list.map(s => s.name), ['A', 'B']);
  const ab = extractStationList(readFileSync(join(root, 'fwi.js'), 'utf8'), 'ALBERTA_STATIONS');
  assert.ok(ab.length >= 190, `ALBERTA_STATIONS ${ab.length}`);
  const bc = extractStationList(readFileSync(join(root, 'bc', 'fwi.js'), 'utf8'), 'BC_STATIONS');
  assert.ok(bc.length >= 200, `BC_STATIONS ${bc.length}`);
  assert.ok(bc.every(s => s.code != null));
});

test('dedupeStations: first name wins, later names within 100 m become aliases, bad rows dropped', () => {
  const { points, aliases } = dedupeStations([
    { name: 'Fort Chipewyan', lat: 58.767, lng: -111.117 },
    { name: 'Fort Chipewyan RCS', lat: 58.767, lon: -111.117 },
    { name: 'FORT CHIPEWYAN', lat: 58.7671, lon: -111.1171 },
    { name: 'Elsewhere', lat: 53, lon: -113 },
    { name: '', lat: 1, lon: 1 }, { name: 'NaN', lat: 'x', lon: 1 },
  ]);
  assert.deepEqual(points.map(p => p.name), ['Fort Chipewyan', 'Elsewhere']);
  assert.deepEqual(aliases, { 'Fort Chipewyan RCS': 'Fort Chipewyan', 'FORT CHIPEWYAN': 'Fort Chipewyan' });
  assert.ok(haversineKm(58.767, -111.117, 58.7671, -111.1171) < 0.1);
});

// ─── File assembly, merge, coverage ─────────────────────────────────────────

function fixtureSeries(n, k) {
  return Object.fromEntries(VARS.map(v => [v, Array.from({ length: n }, (_, i) => i < 2 ? null : (v === 'wind' ? (i + k) * 3.6 : i + k + 0.04))]));
}

test('buildFile: rounds to 1 decimal (RH/dir integers), writes aliases, runs, units, src, attribution', () => {
  const startMs = T('2026-10-27T03:00:00Z'), n = 6;
  const points = [{ name: 'A', lat: 53.56789, lon: -113.51234 }, { name: 'B', lat: 50.7, lon: -120.45 }];
  const file = buildFile({ province: 'ab', startMs, n, runs: { hrdps: T('2026-10-29T00:00:00Z'), rdps: T('2026-10-29T00:00:00Z'), gdps: null },
    points, aliases: { 'A2': 'A', 'Z': 'nope' }, series: [fixtureSeries(n, 0), fixtureSeries(n, 10)], src: ['-', '-', 'H', 'H', 'R', 'g'], generatedMs: T('2026-10-29T03:40:00Z') });
  assert.equal(file.schema, 1);
  assert.equal(file.start, '2026-10-27T03:00:00Z');
  assert.equal(file.step_h, 1); assert.equal(file.n, 6);
  assert.equal(file.src, '--HHRg');
  assert.equal(file.model_runs.hrdps, '2026-10-29T00:00:00Z'); assert.equal(file.model_runs.gdps, null);
  assert.equal(file.attribution, 'Data Source: Environment and Climate Change Canada');
  assert.deepEqual(file.stations.A.temp, [null, null, 2, 3, 4, 5]);
  assert.deepEqual(file.stations.A.rh, [null, null, 2, 3, 4, 5], 'RH integer');
  assert.deepEqual(file.stations.A.wind, [null, null, 7.2, 10.8, 14.4, 18]);
  assert.deepEqual(file.stations.B.wdir, [null, null, 12, 13, 14, 15]);
  assert.equal(file.stations.A.lat, 53.5679);
  assert.deepEqual(file.stations.A2, { alias: 'A' });
  assert.equal(file.stations.Z, undefined, 'alias of an unknown point dropped');
  assert.equal(round1(-0.04), -0);
  assert.equal(Object.keys(SRC_CODES).join(''), 'HhRGgp-');
  assert.equal(MODELS.hrdps.rainKind, 'run-accum');
});

test('mergeHistory carries the previous file\'s hours into the new file\'s null history and marks src lower-case', () => {
  const run = T('2026-10-29T00:00:00Z');
  const n = 6, prevStart = run - 3 * HOUR, newStart = run - 1 * HOUR;
  const points = [{ name: 'A', lat: 53.5, lon: -113.5 }];
  const prev = buildFile({ province: 'ab', startMs: prevStart, n, runs: {}, points, aliases: {}, series: [Object.fromEntries(VARS.map(v => [v, [1, 2, 3, 4, 5, 6]]))], src: ['h', 'h', 'H', 'H', 'H', 'H'] });
  const cur = buildFile({ province: 'ab', startMs: newStart, n, runs: {}, points, aliases: { A2: 'A' }, series: [Object.fromEntries(VARS.map(v => [v, [null, null, 30, 40, 50, 60]]))], src: ['-', '-', 'H', 'H', 'H', 'H'] });
  const filled = mergeHistory(cur, prev);
  assert.equal(filled, 2);
  assert.deepEqual(cur.stations.A.temp, [3, 4, 30, 40, 50, 60], 'hours run−1h and run+0 taken from prev (its indices 2, 3)');
  assert.equal(cur.src, 'hhHHHH', 'carried hours keep the previous code in lower case');
  assert.deepEqual(cur.stations.A2, { alias: 'A' });
  const cov = coverage(cur);
  assert.deepEqual(cov, { stations: 1, aliases: 1, cells: 30, nulls: 0, pct: 100 });
  assert.equal(mergeHistory(cur, null), 0);
});

test('coverage counts nulls across all variables and excludes aliases', () => {
  const file = buildFile({ province: 'bc', startMs: 0, n: 4, runs: {}, points: [{ name: 'A', lat: 1, lon: 1 }], aliases: { B: 'A' },
    series: [Object.fromEntries(VARS.map(v => [v, [null, 1, 2, null]]))], src: ['-', 'H', 'H', '-'] });
  assert.deepEqual(coverage(file), { stations: 1, aliases: 1, cells: 20, nulls: 10, pct: 50 });
});
