/**
 * BC↔AB engine parity test — verifies that the BC and AB engines produce
 * identical FWI chain results across diverse fire weather scenarios.
 *
 * Also validates science core byte-identity between the two engine files.
 *
 * Run: node tests/bc_parity.mjs
 */
import { loadEngine, checkScienceCoreSingleSource } from './load-engine.mjs';
import { readFileSync } from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const AB = loadEngine(path.join(ROOT, 'fwi.js'));
const BC = loadEngine(path.join(ROOT, 'bc', 'fwi.js'));

// Raw BC sandbox — exposes internal functions not in window.FWI
const bcCode = readFileSync(path.join(ROOT, 'bc', 'fwi.js'), 'utf8');
const bcSandbox = {
  window: {}, document: { querySelectorAll: () => [], getElementById: () => null },
  console: { log: () => {}, warn: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: { userAgent: 'node-test' }, location: { search: '' },
  fetch: async () => { throw new Error('network disabled'); },
  AbortController, URLSearchParams, setTimeout, clearTimeout, Date, Math, JSON, Promise,
};
bcSandbox.globalThis = bcSandbox; bcSandbox.self = bcSandbox.window;
vm.createContext(bcSandbox);
vm.runInContext(bcCode, bcSandbox);
vm.runInContext(readFileSync(path.join(ROOT, 'core', 'fwi-core.js'), 'utf8'), bcSandbox); // shared core after the province module

let pass = 0, fail = 0;
const issues = [];

// ─── Science core single source ───────────────────────────────────────────────
// The science core lives once, in core/fwi-core.js (loaded by both province
// modules) — replaces the old AB↔BC byte-identity check of two copies.
console.log('\n── Science core single source ──');
{
  const { problems, coreChars } = checkScienceCoreSingleSource([path.join(ROOT, 'fwi.js'), path.join(ROOT, 'bc', 'fwi.js')]);
  if (!problems.length) {
    console.log(`  PASS  Science core defined once, in core/fwi-core.js (${coreChars} chars); no province redefinitions`);
    pass++;
  } else {
    for (const p of problems) { console.log(`  FAIL  ${p}`); issues.push(p); }
    fail++;
  }
}

// ─── Diverse FWI chain scenarios ─────────────────────────────────────────────
const STARTUP = { ffmc: 85, dmc: 6, dc: 15 };

const CASES = [
  // label, weather, prev
  ['Extreme summer AB (Lethbridge heat dome)', { temp: 39, rh: 8,  wind: 45, rain: 0, month: 7  }, { ffmc: 93, dmc: 120, dc: 650 }],
  ['Very high July afternoon',                  { temp: 32, rh: 18, wind: 28, rain: 0, month: 7  }, { ffmc: 90, dmc: 80,  dc: 400 }],
  ['High FWI June windy',                       { temp: 28, rh: 22, wind: 40, rain: 0, month: 6  }, { ffmc: 88, dmc: 50,  dc: 250 }],
  ['Moderate May typical',                      { temp: 18, rh: 45, wind: 15, rain: 0, month: 5  }, { ffmc: 80, dmc: 20,  dc: 100 }],
  ['Rain event — 15mm',                         { temp: 14, rh: 75, wind: 8,  rain: 15, month: 6 }, { ffmc: 85, dmc: 35,  dc: 200 }],
  ['Heavy rain reset — 40mm',                   { temp: 10, rh: 90, wind: 5,  rain: 40, month: 7 }, { ffmc: 88, dmc: 90,  dc: 500 }],
  ['Spring startup (April cold)',               { temp: 8,  rh: 60, wind: 12, rain: 0, month: 4  }, STARTUP],
  ['Near-zero humidity high wind',              { temp: 35, rh: 5,  wind: 60, rain: 0, month: 8  }, { ffmc: 95, dmc: 150, dc: 700 }],
  ['Cold snap August high elev',               { temp: 5,  rh: 85, wind: 10, rain: 2, month: 8   }, { ffmc: 72, dmc: 30,  dc: 180 }],
  ['Calm humid overcast',                       { temp: 16, rh: 80, wind: 3,  rain: 0.5, month: 6 }, { ffmc: 78, dmc: 25, dc: 150 }],
  ['Fort Mac terrain wind',                     { temp: 26, rh: 25, wind: 35, rain: 0, month: 6  }, { ffmc: 87, dmc: 40,  dc: 230 }],
  ['BC coast wet spring',                       { temp: 12, rh: 70, wind: 18, rain: 3, month: 5  }, { ffmc: 76, dmc: 12,  dc: 60  }],
];

console.log('\n── Chain calculation parity (AB vs BC engine) ──');
const TOL = 0.01; // float tolerance

for (const [label, weather, prev] of CASES) {
  const abR = AB.calculateFWI({ ...weather, fwiFromCWFIS: false }, prev);
  const bcR = BC.calculateFWI({ ...weather, fwiFromCWFIS: false }, prev);

  const fields = ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi'];
  const diffs = fields.map(f => ({ f, d: Math.abs((abR[f] ?? 0) - (bcR[f] ?? 0)) }));
  const maxDiff = Math.max(...diffs.map(x => x.d));
  const worst = diffs.find(x => x.d === maxDiff);

  const lbl = label.padEnd(40);
  if (maxDiff <= TOL) {
    console.log(`  PASS  ${lbl}  FWI=${abR.fwi?.toFixed(2).padStart(7)}  FFMC=${abR.ffmc?.toFixed(2)}`);
    pass++;
  } else {
    const msg = `  FAIL  ${lbl}  ${worst.f}: AB=${abR[worst.f]?.toFixed(4)} BC=${bcR[worst.f]?.toFixed(4)} Δ=${worst.d.toFixed(4)}`;
    console.log(msg);
    issues.push(msg);
    fail++;
  }
}

// ─── NaN / OOB sanity for edge inputs ────────────────────────────────────────
console.log('\n── Edge input guard (no NaN/OOB) ──');
const EDGE = [
  ['Zero wind zero rain',   { temp: 20, rh: 50, wind: 0,  rain: 0,  month: 6 }, STARTUP],
  ['Max plausible temp',    { temp: 45, rh: 3,  wind: 80, rain: 0,  month: 7 }, { ffmc: 96, dmc: 200, dc: 800 }],
  ['Saturated soil (rain)', { temp: 5,  rh: 98, wind: 2,  rain: 80, month: 6 }, { ffmc: 70, dmc: 10,  dc: 30  }],
];

for (const [label, weather, prev] of EDGE) {
  const abR = AB.calculateFWI({ ...weather, fwiFromCWFIS: false }, prev);
  const ok = !isNaN(abR.fwi) && abR.ffmc >= 0 && abR.ffmc <= 101 && abR.dmc >= 0 && abR.dc >= 0;
  const lbl = label.padEnd(40);
  if (ok) {
    console.log(`  PASS  ${lbl}  FWI=${abR.fwi?.toFixed(2).padStart(7)}  FFMC=${abR.ffmc?.toFixed(2)}`);
    pass++;
  } else {
    const msg = `  FAIL  ${lbl}  NaN or OOB: fwi=${abR.fwi} ffmc=${abR.ffmc} dmc=${abR.dmc} dc=${abR.dc}`;
    console.log(msg);
    issues.push(msg);
    fail++;
  }
}

// ─── BC danger rating boundaries ─────────────────────────────────────────────
// BC uses a 5-class system distinct from AB: Very Low(<5), Low(<12), Moderate(<21),
// High(<34), Extreme(≥34). No "Very High" class. This is tested here because the
// AB calc_audit only verifies the AB dangerRating — BC is BC.dangerRatingBC.
console.log('\n── BC danger rating boundaries ──');
const BC_DANGER_CASES = [
  [0,    'Very Low'],
  [4.9,  'Very Low'],
  [5,    'Low'],
  [11.9, 'Low'],
  [12,   'Moderate'],
  [20.9, 'Moderate'],
  [21,   'High'],
  [33.9, 'High'],
  [34,   'Extreme'],
  [100,  'Extreme'],
];
for (const [fwi, expected] of BC_DANGER_CASES) {
  const got = BC.dangerRatingBC(fwi);
  const ok  = got === expected;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  FWI=${String(fwi).padStart(5)}  → ${got.padEnd(10)} (expected ${expected})`);
  if (ok) pass++;
  else { issues.push(`  dangerRatingBC FAIL: FWI=${fwi} got "${got}" expected "${expected}"`); fail++; }
}

// ─── BC Fire Danger Class — Wildfire Regulation Schedule 2 ─────────────────
// Real BCWS Data Mart noon rows (2026 season): code, lat, lng, BUI, FWI and BCWS's
// own DANGER_RATING (1–5). With BUI and location, dangerRatingBC must reproduce
// the official class: 4 rows per Danger Region × class, all three regions.
console.log('\n── BC Schedule 2 danger class vs BCWS official rating ──');
{
  const L = ['Very Low', 'Low', 'Moderate', 'High', 'Extreme'];
  const ROWS = [
  [   93, 53.2532, -132.1156, 14.014, 0.455, 1], // HONNA 20260801 R1
  [ 1165, 54.1693, -121.6519, 10.789, 0.267, 1], // SEVEREID 20260612 R1
  [   75, 50.5711, -124.0777, 19.926, 0.03, 1], // TOBA CAMP 20260829 R1
  [   93, 53.2532, -132.1156, 13.492, 0.162, 1], // HONNA 20260526 R1
  [ 1066, 49.5855, -123.3873, 28.127, 7.75, 2], // TS MCNABB 20260522 R1
  [  904, 52.3873, -126.5897, 37.295, 0.802, 2], // HAGENSBORG 2 20260830 R1
  [  189, 53.4937, -123.6089, 57.024, 0.742, 2], // CHILAKO 20260526 R1
  [  945, 50.3701, -126.4339, 34.592, 0.89, 2], // TS NAKA CREEK 20260725 R1
  [  153, 54.7442, -123.0187, 63.723, 16.312, 3], // MCLEOD LAKE 20260819 R1
  [  431, 55.6015, -128.0478, 51.446, 2.632, 3], // UPPER KISPIOX 20260514 R1
  [  155, 55.2864, -123.1359, 36.739, 12.002, 3], // MACKENZIE FS 20260808 R1
  [  383, 50.383, -117.8799, 25.363, 11.213, 3], // FALLS CREEK 20260613 R1
  [  110, 57.9141, -131.1711, 56.1, 22.394, 4], // TELEGRAPH CREEK 20260509 R1
  [   37, 49.3776, -124.9337, 67.113, 18.447, 4], // BEAVER CREEK 20260523 R1
  [  173, 55.135, -126.2073, 69.553, 20.518, 4], // NORTH BABINE 20260816 R1
  [ 1176, 51.3127, -119.3926, 106.23, 16.208, 4], // MUDPIT 20260812 R1
  [  158, 54.0554, -124.0102, 128.919, 34.516, 5], // VANDERHOOF HUB 20260614 R1
  [  873, 50.765, -117.9578, 130.361, 21.538, 5], // CRAWFORD 20260726 R1
  [   82, 50.3317, -122.5658, 132.839, 42.709, 5], // SCAR CREEK 20260622 R1
  [  868, 51.8533, -118.5914, 125.459, 30.263, 5], // BIG MOUTH 2 20260820 R1
  [  211, 52.9575, -123.5958, 46.788, 0.381, 1], // NAZKO 20260522 R2
  [  230, 52.3278, -121.3983, 19.184, 0.941, 1], // HORSEFLY 20260930 R2
  [  227, 52.4709, -121.743, 30.479, 1.275, 1], // GAVIN 20260906 R2
  [  230, 52.3278, -121.3983, 30.686, 0.005, 1], // HORSEFLY 20260606 R2
  [  228, 52.91, -122.0667, 63.366, 12.499, 2], // BENSON 20260708 R2
  [  227, 52.4709, -121.743, 53.195, 16.296, 2], // GAVIN 20260527 R2
  [  230, 52.3278, -121.3983, 22.289, 6.599, 2], // HORSEFLY 20260907 R2
  [  206, 52.5387, -123.3433, 46.885, 9.912, 2], // TAUTRI 20260524 R2
  [  221, 52.7101, -124.4823, 93.331, 7.609, 3], // BALDFACE 20260530 R2
  [  232, 51.7238, -120.3899, 63.19, 22.794, 3], // COLDSCAUR LAKE 20260505 R2
  [  227, 52.4709, -121.743, 101.334, 14.303, 3], // GAVIN 20260727 R2
  [  209, 52.0838, -123.2733, 89.611, 24.383, 3], // ALEXIS CREEK 20260921 R2
  [  225, 52.0497, -121.8738, 151.278, 24.375, 4], // KNIFE 20260514 R2
  [  236, 51.375, -121.72, 115.035, 28.196, 4], // MEADOW LAKE 20260622 R2
  [  222, 51.4508, -122.6603, 112.914, 30.028, 4], // GASPARD 20260722 R2
  [  216, 51.48, -123.8181, 145.33, 22.174, 4], // NEMIAH 20260518 R2
  [  235, 51.2378, -120.9976, 232.817, 32.706, 5], // YOUNG LAKE 20260806 R2
  [  226, 51.7017, -124.875, 194.051, 42.443, 5], // MIDDLE LAKE 20260602 R2
  [  222, 51.4508, -122.6603, 181.418, 42.165, 5], // GASPARD 20260808 R2
  [  226, 51.7017, -124.875, 238.445, 41.593, 5], // MIDDLE LAKE 20260716 R2
  [  309, 50.7963, -122.8805, 22.962, 0.687, 1], // GWYNETH LAKE 20260916 R3
  [  286, 50.8036, -119.6307, 34.368, 3.079, 1], // TURTLE 20260929 R3
  [ 1075, 49.0469, -115.2253, 11.119, 0.001, 1], // KOOCANUSA 20260602 R3
  [  977, 49.6551, -121.3576, 38.271, 0.006, 1], // ANDERSON CREEK 20260526 R3
  [  396, 49.699, -118.081, 23.326, 14.42, 2], // OCTOPUS CREEK 20260921 R3
  [  393, 49.5267, -118.3603, 38.732, 16.423, 2], // NICOLL 20260920 R3
  [  977, 49.6551, -121.3576, 54.925, 2.869, 2], // ANDERSON CREEK 20260928 R3
  [  331, 49.1391, -120.1844, 45.607, 12.643, 2], // ASHNOLA 20260607 R3
  [  301, 50.3059, -122.7287, 116.85, 24.903, 3], // PEMBERTON BASE 20260716 R3
  [  307, 50.6153, -120.8362, 89.208, 26.421, 3], // LEIGHTON LAKE 20260521 R3
  [  311, 50.7923, -121.3582, 77.048, 20.239, 3], // MCLEAN LAKE 20260911 R3
  [  292, 50.5217, -122.4978, 140.764, 24.588, 3], // DARCY 20260512 R3
  [  426, 49.6672, -115.8483, 200.558, 39.518, 4], // CRANBROOK 20260808 R3
  [ 1029, 50.9109, -122.6889, 117.811, 38.251, 4], // FIVE MILE 20260514 R3
  [  396, 49.699, -118.081, 134.55, 28.112, 4], // OCTOPUS CREEK 20260812 R3
  [  836, 49.4335, -120.4571, 191.601, 27.932, 4], // AUGUST LAKE 20260702 R3
  [  317, 49.0625, -120.7668, 221.691, 50.231, 5], // ALLISON PASS 20260805 R3
  [ 1055, 50.3511, -121.655, 462.968, 48.372, 5], // SPLINTLUM 20260808 R3
  [ 1399, 50.1214, -120.7442, 362.36, 99.266, 5], // MERRITT 2 HUB 20260730 R3
  [  317, 49.0625, -120.7668, 165.404, 50.388, 5], // ALLISON PASS 20260721 R3
  ];
  for (const [code, lat, lng, bui, fwi, off] of ROWS) {
    const got = BC.dangerRatingBC(fwi, bui, lat, lng);
    const ok = got === L[off - 1];
    if (ok) pass++; else { issues.push(`  Schedule 2 FAIL: station ${code} BUI=${bui} FWI=${fwi} got "${got}" expected "${L[off - 1]}"`); fail++; }
  }
  console.log(`  ${ROWS.length} real station-days checked`);
  // Table edges: values are truncated, so FWI 0.9 is column "0" in Region 1 and BUI 19.9 is row "0–19".
  const edges = [[1, 19.9, 0.9, 1], [1, 20, 0.9, 2], [1, 19.9, 1, 2], [2, 48.9, 4.9, 1], [3, 140.9, 46.9, 4],
                 [3, 141, 47, 5], [1, 119, 31, 5], [3, 201, 47, 5], [2, 158.9, 37.9, 4]];
  for (const [rg, bui, fwi, exp] of edges) {
    const got = BC.bcSchedule2Class(bui, fwi, rg);
    if (got === exp) pass++; else { issues.push(`  Schedule 2 edge FAIL: R${rg} BUI=${bui} FWI=${fwi} got ${got} exp ${exp}`); fail++; }
  }
  // Region lookup by nearest BCWS station (Schedule 1 map): Williams Lake area = 2, Kamloops = 3, Prince George = 1.
  for (const [lat, lng, exp, nm] of [[52.13, -122.14, 2, 'Williams Lake'], [50.67, -120.33, 3, 'Kamloops'], [53.92, -122.75, 1, 'Prince George'], [51.0, -118.2, 1, 'Revelstoke']]) {
    const got = BC.bcDangerRegion(lat, lng);
    if (got === exp) pass++; else { issues.push(`  Danger Region FAIL: ${nm} got ${got} exp ${exp}`); fail++; }
  }
  // No BUI → the FWI-only proxy (unchanged behaviour).
  if (BC.dangerRatingBC(25) === 'High') pass++; else { issues.push('  proxy fallback FAIL'); fail++; }
}

// ─── BC-specific internal functions ──────────────────────────────────────────
// Tests applyDCFloor (BC) and getStartupDC (BC) — not exported in window.FWI
// but critical to correct spring chain initialization.
console.log('\n── BC applyDCFloor (BC-specific floors + PST month window) ──');
{
  const adf = bcSandbox.applyDCFloor;

  // Always-safe: outside BC geographic bounds → no correction
  {
    const r = adf(30, 53.5, -113.5);  // Edmonton AB
    const ok = r.dc === 30 && r.corrected === false;
    console.log(`  ${ok?'PASS':'FAIL'}  AB coords (Edmonton) DC=30 → dc=${r.dc} corrected=${r.corrected} (exp 30, false)`);
    if (ok) pass++; else { issues.push(`BC applyDCFloor AB coords: ${JSON.stringify(r)}`); fail++; }
  }

  // DC above cold-start ceiling (60) → never corrected
  {
    const r = adf(200, 50.7, -120.4);  // Kamloops BC, but DC=200
    const ok = r.dc === 200 && r.corrected === false;
    console.log(`  ${ok?'PASS':'FAIL'}  Kamloops DC=200 (>ceiling) → dc=${r.dc} corrected=${r.corrected} (exp 200, false)`);
    if (ok) pass++; else { issues.push(`BC applyDCFloor Kamloops DC=200: ${JSON.stringify(r)}`); fail++; }
  }

  // Spring-window BC corrections (months 3–7 PST)
  const mo = new Date(Date.now() - 8 * 3600000).getUTCMonth() + 1; // PST month
  if (mo >= 3 && mo <= 7) {
    // Thompson/Kootenay zone: lat 50-52 → floor 75
    {
      const r = adf(30, 50.7, -120.4);  // Kamloops lat=50.7
      const ok = r.dc === 75 && r.corrected === true;
      console.log(`  ${ok?'PASS':'FAIL'}  Kamloops DC=30 spring(mo=${mo}) → dc=${r.dc} corrected=${r.corrected} (exp 75, true)`);
      if (ok) pass++; else { issues.push(`BC applyDCFloor Kamloops DC=30: ${JSON.stringify(r)}`); fail++; }
    }
    // South coast / Okanagan: lat<50 → floor 50
    {
      const r = adf(30, 49.2, -123.1);  // Vancouver lat=49.2
      const ok = r.dc === 50 && r.corrected === true;
      console.log(`  ${ok?'PASS':'FAIL'}  Vancouver DC=30 spring(mo=${mo}) → dc=${r.dc} corrected=${r.corrected} (exp 50, true)`);
      if (ok) pass++; else { issues.push(`BC applyDCFloor Vancouver DC=30: ${JSON.stringify(r)}`); fail++; }
    }
    // Cariboo/Skeena: lat 52-56 → floor 80
    {
      const r = adf(40, 53.9, -122.7);  // Prince George lat=53.9
      const ok = r.dc === 80 && r.corrected === true;
      console.log(`  ${ok?'PASS':'FAIL'}  Prince George DC=40 spring(mo=${mo}) → dc=${r.dc} corrected=${r.corrected} (exp 80, true)`);
      if (ok) pass++; else { issues.push(`BC applyDCFloor PG DC=40: ${JSON.stringify(r)}`); fail++; }
    }
    // NW boreal: lat≥56 → floor 60
    {
      const r = adf(40, 58.0, -130.0);  // NW BC
      const ok = r.dc === 60 && r.corrected === true;
      console.log(`  ${ok?'PASS':'FAIL'}  NW BC DC=40 spring(mo=${mo}) → dc=${r.dc} corrected=${r.corrected} (exp 60, true)`);
      if (ok) pass++; else { issues.push(`BC applyDCFloor NW BC DC=40: ${JSON.stringify(r)}`); fail++; }
    }
  } else {
    console.log(`  SKIP  Spring corrections (mo=${mo} outside BC spring window Mar–Jul)`);
  }
}

console.log('\n── BC getStartupDC ──');
{
  const gsd = bcSandbox.getStartupDC;

  // Known BC station lookups — one representative per startup DC tier
  const bcStCases = [
    ['Summit',     50],   // Coastal tier-50
    ['Darcy',      75],   // Interior wet-belt tier-75
    ['Vanderhoof Hub', 100], // default tier-100 named station
    ['Lillooet',   125],  // Kamloops Fire Centre tier-125
    ['Whiskey',    150],  // Southeast Fire Centre tier-150
    ['Cranbrook',  175],  // Southeast Fire Centre tier-175
    // Unknown station → BC default 100
    ['UnknownBC',  100],
  ];
  for (const [name, exp] of bcStCases) {
    const got = gsd(name);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  getStartupDC("${name}") → ${got} (exp ${exp})`);
    if (ok) pass++; else { issues.push(`BC getStartupDC("${name}"): got ${got} exp ${exp}`); fail++; }
  }
}

console.log('\n── BC dangerRatingProv (routes to dangerRatingBC) ──');
{
  const drp = bcSandbox.dangerRatingProv;
  // In BC build, dangerRatingProv must equal dangerRatingBC at every threshold
  const provCases = [
    [0,   'Very Low'],
    [4.9, 'Very Low'],
    [5,   'Low'],
    [12,  'Moderate'],
    [21,  'High'],
    [34,  'Extreme'],
  ];
  for (const [fwi, exp] of provCases) {
    const got = drp(fwi);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  dangerRatingProv(${fwi}) → "${got}" (exp "${exp}")`);
    if (ok) pass++; else { issues.push(`BC dangerRatingProv(${fwi}): got "${got}" exp "${exp}"`); fail++; }
  }
}

// ─── BC _stationFireCentre — lat/lng to Fire Centre assignment ───────────────
// Verifies all 6 BC Fire Centre classifications from geographically unambiguous
// reference points. A regression here would mislabel regional summary rows.
console.log('\n── BC _stationFireCentre (all 6 Fire Centres) ──');
{
  const fc = bcSandbox._stationFireCentre;
  if (typeof fc !== 'function') {
    console.log('  FAIL  _stationFireCentre not in bcSandbox');
    fail++;
  } else {
    const CENTRE_CASES = [
      // [lat, lng, expectedCentre, label]
      [58.42, -130.02, 'Northwest',     'Dease Lake (lat≥57)'],
      [54.52, -128.59, 'Northwest',     'Terrace (lat≥54 & lon<-124)'],
      [50.68, -127.37, 'Coastal',       'Port Hardy (lon<-125.5)'],
      [49.28, -123.12, 'Coastal',       'Vancouver (lon<-122.5 & lat<52)'],
      [49.60, -115.78, 'Southeast',     'Cranbrook (lat<51.5 & lon>-118.5)'],
      [53.88, -122.68, 'Prince George', 'Prince George (lat≥53)'],
      [52.13, -122.14, 'Cariboo',       'Williams Lake (lat≥51.5)'],
      [50.70, -120.45, 'Kamloops',      'Kamloops (southern interior default)'],
    ];
    for (const [lat, lng, expCentre, label] of CENTRE_CASES) {
      const got = fc(lat, lng);
      const ok = got === expCentre;
      console.log(`  ${ok?'PASS':'FAIL'}  ${label} → "${got}" (exp "${expCentre}")`);
      if (ok) pass++; else { issues.push(`BC _stationFireCentre(${lat},${lng}): got "${got}" exp "${expCentre}"`); fail++; }
    }
  }
}

// ─── BC ?stn= URL deep-link station matching ─────────────────────────────────
// The BC station picker normalises the ?stn= query the same way as AB:
// lowercase + strip non-alphanumeric, then exact > prefix > substring.
// Key difference: BC_STATIONS has 241 entries — "Kamloops" is NOT in the
// list (it is the default lat/lng, not a named BCWS fire weather station),
// so ?stn=Kamloops falls through to null and the page shows the default.
console.log('\n── BC ?stn= URL station matching (BC_STATIONS) ──');
{
  const bcStations = BC.BC_STATIONS;
  function matchStn(query, stations) {
    if (!query) return null;
    const q    = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    const norm = s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      stations.find(s => norm(s) === q) ||
      stations.find(s => norm(s).startsWith(q)) ||
      stations.find(s => norm(s).includes(q)) ||
      null
    );
  }
  // [query, expected_name_or_null, label]
  const bcStnCases = [
    ['Cranbrook',    'Cranbrook',       'exact match'],
    ['Lillooet',     'Lillooet',        'exact match (internal station)'],
    ['vanderhoof',   'Vanderhoof Hub',  'case-insensitive → Vanderhoof Hub'],
    ['CRANBROOK',    'Cranbrook',       'all-caps case-insensitive'],
    ['kelowna',      'West Kelowna',    'substring match (no bare Kelowna station)'],
    ['Kamloops',     null,              'no match — Kamloops is BC default, not in list'],
    ['XYZ_NOMATCH',  null,              'no match'],
    ['',             null,              'empty query → null'],
  ];
  for (const [query, expName, label] of bcStnCases) {
    const got = matchStn(query, bcStations);
    const ok  = expName === null ? got === null : got?.name === expName;
    const gotStr = got?.name ?? 'null';
    console.log(`  ${ok?'PASS':'FAIL'}  matchStn("${query}") → ${gotStr}  [${label}]`);
    if (ok) pass++; else { issues.push(`BC matchStn("${query}"): got "${gotStr}" exp "${expName ?? 'null'}"`); fail++; }
  }
  // Sanity: BC_STATIONS has ~241 entries; a grossly wrong import would be caught
  const countOk = bcStations.length >= 200 && bcStations.length <= 300;
  console.log(`  ${countOk?'PASS':'FAIL'}  BC_STATIONS length=${bcStations.length} (exp 200–300)`);
  if (countOk) pass++; else { fail++; issues.push(`BC_STATIONS.length=${bcStations.length} unexpected`); }
}

// ─── BC findNearestNAEFS — routes to NAEFS_BC_STATIONS (not AB list) ─────────
// In bc/fwi.js, _province='BC' is a compile-time constant so findNearestNAEFS
// always searches NAEFS_BC_STATIONS. Undetected divergence (e.g. the function
// accidentally using the AB list) would silently route 10-day forecasts to
// wrong stations. The 150 km cutoff must also work correctly — Edmonton AB
// is >400 km from any BC NAEFS point and must return null.
console.log('\n── BC findNearestNAEFS (BC station list, 150 km cutoff) ──');
{
  const fnn = bcSandbox.findNearestNAEFS;
  if (typeof fnn !== 'function') {
    console.log('  FAIL  findNearestNAEFS not in bcSandbox');
    fail++;
  } else {
    const NAEFS_CASES = [
      // [lat, lng, expectedCode, expectedName, label]
      [49.60, -115.78, 10189, 'Cranbrook',     'Cranbrook exact match'],
      [50.70, -120.45, 10195, 'Kamloops',      'Kamloops exact match'],
      [49.18, -123.17, 10211, 'Vancouver Intl','Vancouver exact match'],
      [53.88, -122.68, 10202, 'Prince George', 'Prince George exact match'],
      [58.42, -130.02, 10190, 'Dease Lake',    'Dease Lake — far-north BC coverage'],
    ];
    for (const [lat, lng, expCode, expName, label] of NAEFS_CASES) {
      const got = fnn(lat, lng);
      const ok  = got !== null && got.code === expCode && got.name === expName;
      const gotStr = got ? `${got.name}(${got.code})` : 'null';
      console.log(`  ${ok?'PASS':'FAIL'}  ${label} → ${gotStr}`);
      if (ok) pass++; else { issues.push(`BC findNearestNAEFS(${lat},${lng}): got ${gotStr} exp ${expName}(${expCode})`); fail++; }
    }

    // Edmonton AB must return null — too far from all BC NAEFS stations
    const edm = fnn(53.57, -113.52);
    const edmOk = edm === null;
    console.log(`  ${edmOk?'PASS':'FAIL'}  Edmonton AB → ${edm ? edm.name : 'null'} (exp null — >400 km from BC stations)`);
    if (edmOk) pass++; else { issues.push(`BC findNearestNAEFS Edmonton: expected null, got ${edm?.name}`); fail++; }
  }
}

// ─── calcMultiDayFBP parity (AB vs BC engine) ────────────────────────────────
// calcMultiDayFBP powers the forecast trends page. It chains calculateFWI then
// calls calculateFBP on each day — testing it end-to-end catches bugs that
// calculateFBP-alone or calculateFWI-alone tests cannot detect (e.g. a broken
// state hand-off between days, or rain reset applied twice).
//
// Surface fuels (D1, O1a): tested without opts — FMC-independent, parity is
// guaranteed regardless of _stationLat default.
// Crown-fire fuels (C2): tested with explicit opts {lat, lng, doy} which are
// now threaded through calcMultiDayFBP → calculateFBP → calcFMC, ensuring both
// engines use identical FMC and produce byte-identical crown-fire results.
console.log('\n── calcMultiDayFBP parity (AB vs BC engine) ──');
{
  const DAYS = [
    { temp: 28, rh: 30, wind: 20, rain:  0, month: 7, label: 'Day1-hot'  },
    { temp: 14, rh: 85, wind:  5, rain: 15, month: 7, label: 'Day2-rain' },
    { temp: 32, rh: 18, wind: 30, rain:  0, month: 7, label: 'Day3-hot'  },
  ];
  const START = { ffmc: 85, dmc: 40, dc: 200 };
  const TOL   = 0.001;

  // D1 — deciduous aspen, always surface fire (cfb=0), FMC-independent
  const D1_REF = [
    { fwi: 32.20306, ffmc: 91.86789, ros: 4.68820,  hfi: 1383.783 },
    { fwi:  0.01012, ffmc: 32.34857, ros: 0.00003,  hfi:    0.007 },
    { fwi: 38.45552, ffmc: 92.15120, ros: 8.87773,  hfi: 2058.813 },
  ];
  const abD1 = AB.calcMultiDayFBP(DAYS, 300, START, 'D1', 100, 50);
  const bcD1 = BC.calcMultiDayFBP(DAYS, 300, START, 'D1', 100, 50);
  for (let i = 0; i < DAYS.length; i++) {
    const ref = D1_REF[i];
    const aR = abD1[i], bR = bcD1[i];
    const abOk = Math.abs(aR.fwi - ref.fwi) < TOL && Math.abs((aR.fbp?.ros ?? 0) - ref.ros) < TOL;
    const parOk = Math.abs(aR.fwi - bR.fwi) < TOL && Math.abs((aR.fbp?.ros ?? 0) - (bR.fbp?.ros ?? 0)) < TOL;
    const ok = abOk && parOk;
    console.log(`  ${ok?'PASS':'FAIL'}  D1 ${DAYS[i].label}  FWI=${aR.fwi.toFixed(3)} ROS=${(aR.fbp?.ros??0).toFixed(3)}  AB≈ref=${abOk} AB==BC=${parOk}`);
    if (ok) pass++;
    else {
      issues.push(`calcMultiDayFBP D1 Day${i+1}: ref mismatch or AB/BC divergence (fwi AB=${aR.fwi.toFixed(5)} BC=${bR.fwi.toFixed(5)} ref=${ref.fwi})`);
      fail++;
    }
  }

  // O1a — grass (100% curing), surface only, FMC-independent
  const O1A_ROS_REF = [48.70450, 0.00177, 84.15251];
  const abO1 = AB.calcMultiDayFBP(DAYS, 300, START, 'O1a', 100, 50);
  const bcO1 = BC.calcMultiDayFBP(DAYS, 300, START, 'O1a', 100, 50);
  for (let i = 0; i < DAYS.length; i++) {
    const aR = abO1[i], bR = bcO1[i];
    const abOk  = Math.abs((aR.fbp?.ros ?? 0) - O1A_ROS_REF[i]) < TOL;
    const parOk = Math.abs((aR.fbp?.ros ?? 0) - (bR.fbp?.ros ?? 0)) < TOL;
    const ok = abOk && parOk;
    console.log(`  ${ok?'PASS':'FAIL'}  O1a ${DAYS[i].label}  ROS=${(aR.fbp?.ros??0).toFixed(3)}  AB≈ref=${abOk} AB==BC=${parOk}`);
    if (ok) pass++;
    else {
      issues.push(`calcMultiDayFBP O1a Day${i+1}: ref mismatch or AB/BC divergence`);
      fail++;
    }
  }

  // C2 Boreal Spruce with explicit opts — crown-fire fuel, FMC depends on lat/lng.
  // calcMultiDayFBP now accepts opts={} and threads it to calculateFBP, so both
  // engines receive the same FMC and must produce identical CFB/ROS/HFI.
  const C2_OPT = { lat: 51.5, lng: -116.5, doy: 180 }; // Rocky Mountain foothills, midsummer
  const C2_REF = [
    { fwi: 32.20306, ros: 22.25376, cfb: 0.99195, hfi: 21604.907 },
    { fwi:  0.01012, ros:  0.00029, cfb: 0.00000, hfi:     0.135 },
    { fwi: 38.45552, ros: 35.24438, cfb: 0.99955, hfi: 27786.359 },
  ];
  const abC2 = AB.calcMultiDayFBP(DAYS, 300, START, 'C2', 100, 50, C2_OPT);
  const bcC2 = BC.calcMultiDayFBP(DAYS, 300, START, 'C2', 100, 50, C2_OPT);
  for (let i = 0; i < DAYS.length; i++) {
    const ref = C2_REF[i];
    const aR = abC2[i], bR = bcC2[i];
    const abOk = Math.abs(aR.fwi - ref.fwi) < TOL &&
                 Math.abs((aR.fbp?.ros ?? 0) - ref.ros) < TOL &&
                 Math.abs((aR.fbp?.cfb ?? 0) - ref.cfb) < TOL;
    const parOk = Math.abs(aR.fwi - bR.fwi) < TOL &&
                  Math.abs((aR.fbp?.ros ?? 0) - (bR.fbp?.ros ?? 0)) < TOL;
    const ok = abOk && parOk;
    console.log(`  ${ok?'PASS':'FAIL'}  C2 ${DAYS[i].label}  ROS=${(aR.fbp?.ros??0).toFixed(3)}  CFB=${(aR.fbp?.cfb??0).toFixed(3)}  AB≈ref=${abOk} AB==BC=${parOk}`);
    if (ok) pass++;
    else {
      issues.push(`calcMultiDayFBP C2 Day${i+1}: ref mismatch or AB/BC divergence (ros AB=${(aR.fbp?.ros??0).toFixed(5)} BC=${(bR.fbp?.ros??0).toFixed(5)} ref=${ref.ros})`);
      fail++;
    }
  }
}

// ─── calculateFBP parity (AB vs BC engine) ───────────────────────────────────
// The science core is byte-identical, so calculateFBP must return identical
// results from both engines for all fuel types. This catches accidental
// divergence in FUEL_TYPES constants, calcSFC, or calling conventions.
//
// IMPORTANT: opts.lat/lng must be explicit — the two engines have different
// module-level _stationLat defaults (AB=53.5, BC=50.70) which feed calcFMC
// and shift the crown-fire threshold. Parity tests must supply a shared
// location so FMC is identical in both engines.
console.log('\n── calculateFBP parity (AB vs BC engine) ──');
{
  // Shared opts: Rocky Mountain foothills — midpoint between AB/BC typical stations
  const OPT = { lat: 51.5, lng: -116.5, doy: 180 }; // midsummer, neutral location

  const FBP_CASES = [
    // [label, fuelCode, ffmc, dmc, dc, wind, slope, curing, ps]
    ['C2  Boreal Spruce  high crown',  'C2',  91, 100, 500, 45, 0,   100, 50],
    ['C7  Ponderosa Pine moderate',    'C7',  88,  50, 250, 25, 0,   100, 50],
    ['C3  Mature Jack Pine slope=10',  'C3',  86,  40, 200, 30, 10,  100, 50],
    ['M1  Mixedwood pc=40',            'M1',  85,  35, 180, 20, 0,   100, 40],
    ['O1b Grass curing=85',            'O1b', 88,  50, 250, 25, 0,    85, 50],
    ['S1  Slash moderate',             'S1',  82,  30, 150, 15, 5,   100, 50],
    ['D1  Deciduous aspen',            'D1',  80,  25, 120, 20, 0,   100, 50],
    ['C6  Conifer two-equation',       'C6',  91, 100, 500, 45, 0,   100, 50],
  ];

  const FBP_FIELDS = ['ros', 'hfi', 'cfb', 'sfc', 'tfc'];
  const FBP_TOL = 0.001;

  for (const [label, fuelCode, ffmc, dmc, dc, wind, slope, curing, ps] of FBP_CASES) {
    const abR = AB.calculateFBP(fuelCode, ffmc, dmc, dc, wind, slope, curing, ps, OPT);
    const bcR = BC.calculateFBP(fuelCode, ffmc, dmc, dc, wind, slope, curing, ps, OPT);
    const diffs = FBP_FIELDS.map(f => ({
      f, d: Math.abs((abR[f] ?? 0) - (bcR[f] ?? 0))
    }));
    const maxDiff = Math.max(...diffs.map(x => x.d));
    const worst = diffs.find(x => x.d === maxDiff);
    const ok = maxDiff <= FBP_TOL;
    const lbl = label.padEnd(35);
    if (ok) {
      console.log(`  PASS  ${lbl}  ROS=${(abR.ros ?? 0).toFixed(2).padStart(7)} m/min  HFI=${(abR.hfi ?? 0).toFixed(0).padStart(7)} kW/m  ${abR.fireType ?? ''}`);
      pass++;
    } else {
      const msg = `  FAIL  ${lbl}  ${worst.f}: AB=${abR[worst.f]?.toFixed(4)} BC=${bcR[worst.f]?.toFixed(4)} Δ=${worst.d.toFixed(4)}`;
      console.log(msg);
      issues.push(msg);
      fail++;
    }
  }
}

// ─── hfiClassInfo boundary conditions ────────────────────────────────────────
// hfiClassInfo is outside the science core so byte-identity checks don't cover it.
// Verify both engines return the correct class at each threshold and agree with each other.
console.log('\n── hfiClassInfo boundary conditions (AB parity + BC correctness) ──');
{
  // [hfi, expectedNum, expectedLabel]
  const HFI_CASES = [
    [0,      1, 'Low'],
    [9.9,    1, 'Low'],
    [10,     2, 'Moderate'],
    [499,    2, 'Moderate'],
    [500,    3, 'High'],
    [1999,   3, 'High'],
    [2000,   4, 'Very High'],
    [3999,   4, 'Very High'],
    [4000,   5, 'Extreme'],
    [9999,   5, 'Extreme'],
    [10000,  6, 'Catastrophic'],
    [50000,  6, 'Catastrophic'],
  ];

  for (const [hfi, expectedNum, expectedLabel] of HFI_CASES) {
    const ab = AB.hfiClassInfo(hfi);
    const bc = BC.hfiClassInfo(hfi);
    const abOk = ab.num === expectedNum && ab.label === expectedLabel;
    const bcOk = bc.num === expectedNum && bc.label === expectedLabel;
    const parityOk = ab.num === bc.num && ab.label === bc.label && ab.bg === bc.bg && ab.text === bc.text;
    const ok = abOk && bcOk && parityOk;
    const lbl = `HFI=${String(hfi).padStart(6)}  class ${expectedNum} ${expectedLabel}`;
    if (ok) {
      console.log(`  PASS  ${lbl}`);
      pass++;
    } else {
      let msg = `  FAIL  ${lbl}`;
      if (!abOk)      msg += `  AB=${ab.num}(${ab.label})`;
      if (!bcOk)      msg += `  BC=${bc.num}(${bc.label})`;
      if (!parityOk)  msg += `  PARITY MISMATCH`;
      console.log(msg);
      issues.push(msg);
      fail++;
    }
  }
}

// ─── BC _stationFireCentre routing ───────────────────────────────────────────
// BC.stationSector routes to _stationFireCentre(lat, lng) in BC build.
// Rules (in order): lat>=57 → NW; lat>=54&&lng<-124 → NW; lat>=52&&lng<-127 → NW;
// lat<51.5&&lng>-118.5 → SE; lng<-122.5&&lat<52 → Coastal; lng<-125.5 → Coastal;
// lat>=53 → PG; lat>=51.5 → Cariboo; default → Kamloops.
console.log('\n── BC stationSector (_stationFireCentre routing) ──');
{
  const SECTOR_CASES = [
    // [lat, lng, expected, note]
    [58.4, -130.0,  'Northwest',      'Dease Lake — lat≥57'],
    [54.8, -127.2,  'Northwest',      'Smithers — lat≥54 && lng<−124'],
    [54.3, -128.5,  'Northwest',      'Prince Rupert — lat≥54 && lng<−124'],
    [52.4, -126.8,  'Coastal',        'Bella Coola — lng<−125.5'],
    [49.2, -123.2,  'Coastal',        'Vancouver — lng<−122.5 && lat<52'],
    [50.0, -125.3,  'Coastal',        'Campbell River — lng<−122.5 && lat<52'],
    [49.6, -115.8,  'Southeast',      'Cranbrook — lat<51.5 && lng>−118.5'],
    [49.3, -116.5,  'Southeast',      'Nelson — lat<51.5 && lng>−118.5'],
    [53.9, -122.7,  'Prince George',  'Prince George — lat≥53'],
    [56.2, -120.8,  'Prince George',  'Fort St John — lat≥53'],
    [52.1, -122.1,  'Cariboo',        'Williams Lake — lat≥51.5'],
    [51.8, -121.5,  'Cariboo',        'Cache Creek — lat≥51.5'],
    [50.7, -120.4,  'Kamloops',       'Kamloops — default southern interior'],
    [49.5, -119.5,  'Kamloops',       'Penticton — default southern interior'],
  ];

  for (const [lat, lng, expected, note] of SECTOR_CASES) {
    const got = BC.stationSector(lat, lng);
    const ok = got === expected;
    const lbl = `${String(lat).padStart(5)}, ${String(lng).padStart(7)}  → ${(got ?? '').padEnd(14)} (${note})`;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${lbl}`);
    if (ok) pass++;
    else { issues.push(`stationSector(${lat},${lng}): got "${got}" exp "${expected}"`); fail++; }
  }

  // getRegions() in BC build must return 6 BC regions with required fields
  const regions = BC.getRegions();
  const regOk = Array.isArray(regions) && regions.length === 6 &&
    regions.every(r => r.name && typeof r.lat === 'number' && typeof r.lng === 'number');
  console.log(`  ${regOk ? 'PASS' : 'FAIL'}  getRegions() → ${Array.isArray(regions) ? regions.length : '?'} regions with name/lat/lng`);
  if (regOk) pass++; else { issues.push(`getRegions() failed: ${JSON.stringify(regions)}`); fail++; }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`PASS ${pass}  FAIL ${fail}`);
if (issues.length) { console.log('\nIssues:'); issues.forEach(i => console.log(i)); }
process.exit(fail > 0 ? 1 : 0);
