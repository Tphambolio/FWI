/**
 * BC↔AB engine parity test — verifies that the BC and AB engines produce
 * identical FWI chain results across diverse fire weather scenarios.
 *
 * Also validates science core byte-identity between the two engine files.
 *
 * Run: node tests/bc_parity.mjs
 */
import { loadEngine, extractScienceCore } from './load-engine.mjs';
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

let pass = 0, fail = 0;
const issues = [];

// ─── Science core identity ────────────────────────────────────────────────────
console.log('\n── Science core identity ──');
const abCore = extractScienceCore(path.join(ROOT, 'fwi.js'));
const bcCore = extractScienceCore(path.join(ROOT, 'bc', 'fwi.js'));

if (!abCore) {
  console.log('  FAIL  AB engine has no SCIENCE CORE BEGIN/END markers');
  issues.push('AB engine missing science core markers');
  fail++;
} else if (!bcCore) {
  console.log('  FAIL  BC engine has no SCIENCE CORE BEGIN/END markers');
  issues.push('BC engine missing science core markers');
  fail++;
} else if (abCore === bcCore) {
  console.log(`  PASS  Science cores are byte-identical (${abCore.length} chars)`);
  pass++;
} else {
  // Find first difference
  let diffPos = 0;
  while (diffPos < Math.min(abCore.length, bcCore.length) && abCore[diffPos] === bcCore[diffPos]) diffPos++;
  const snippet = JSON.stringify(abCore.slice(Math.max(0, diffPos - 20), diffPos + 20));
  console.log(`  FAIL  Science cores differ at position ${diffPos}: ${snippet}`);
  issues.push(`Science core diverges at position ${diffPos}`);
  fail++;
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
// Only surface-fire fuel types (D1, O1a) are used here. Crown-fire fuels (C2,
// C6, etc.) use calcFMC internally, and calcFMC depends on _stationLat which
// defaults to different values in each engine (AB=53.5, BC=50.70), making a
// fair parity comparison impossible without opts overrides.
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

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`PASS ${pass}  FAIL ${fail}`);
if (issues.length) { console.log('\nIssues:'); issues.forEach(i => console.log(i)); }
process.exit(fail > 0 ? 1 : 0);
