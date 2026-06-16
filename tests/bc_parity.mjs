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

  // Known BC station lookups (Southeast Fire Centre has higher carry-over)
  const bcStCases = [
    ['Cranbrook',  175],
    ['Lillooet',   125],
    ['Whiskey',    150],
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

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`PASS ${pass}  FAIL ${fail}`);
if (issues.length) { console.log('\nIssues:'); issues.forEach(i => console.log(i)); }
process.exit(fail > 0 ? 1 : 0);
