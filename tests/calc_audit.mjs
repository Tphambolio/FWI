/**
 * Calculation audit — runs the FWI/FBP engine against a range of real and
 * synthetic conditions, checks for physical plausibility, and flags anomalies.
 *
 * Run: node tests/calc_audit.mjs
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import vm from 'vm';

// ─── Load AB engine into sandbox ─────────────────────────────────────────────
const code = readFileSync(new URL('../fwi.js', import.meta.url), 'utf8');
const sandbox = {
  window: {}, document: { querySelectorAll: () => [], getElementById: () => null },
  console, localStorage: { getItem: () => null, setItem: () => {} },
  fetch: globalThis.fetch,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const FWI = sandbox.window.FWI;

// ─── Reference equations (Van Wagner FTR-33) ─────────────────────────────────
function refISI(ffmc, wind) {
  const m = 147.2 * (101 - ffmc) / (59.5 + ffmc);
  const fF = 91.9 * Math.exp(-0.1386 * m) * (1 + m ** 5.31 / 4.93e7);
  return 0.208 * Math.exp(0.05039 * wind) * fF;
}
function refBUI(dmc, dc) {
  if (dmc <= 0.4 * dc) return 0.8 * dmc * dc / (dmc + 0.4 * dc);
  return dmc - (1 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + (0.0114 * dmc) ** 1.7);
}
function refFWI(isi, bui) {
  const fD = bui >= 80 ? 1000 / (25 + 108.64 * Math.exp(-0.023 * bui)) : 0.626 * bui ** 0.809 + 2;
  const B = 0.1 * isi * fD;
  return B > 1 ? Math.exp(2.72 * (0.434 * Math.log(B)) ** 0.647) : B;
}

// ─── Test cases ──────────────────────────────────────────────────────────────
const tests = [
  // [label, weather, prev, expected_fwi_range, notes]
  {
    label: 'Edmonton Jun 11 actual (cool, cloud)',
    w: { temp: 14.5, rh: 57, wind: 16.1, rain: 0, month: 6, fwiFromCWFIS: false },
    prev: { ffmc: 82, dmc: 14, dc: 160 },
    range: [1, 12],
    note: 'Cool post-frontal day — FWI 2-10 expected (prev FFMC affects result)',
  },
  {
    label: 'Edmonton Jun 9 hot/dry (pre-front)',
    w: { temp: 31, rh: 20, wind: 20, rain: 0, month: 6, fwiFromCWFIS: false },
    prev: { ffmc: 88, dmc: 25, dc: 200 },
    range: [25, 55],
    note: 'Hot/dry — should be Very High to Extreme',
  },
  {
    label: 'Van Wagner FTR-33 worked example',
    w: { temp: 17, rh: 42, wind: 25, rain: 0, month: 4, fwiFromCWFIS: false },
    prev: { ffmc: 85, dmc: 6, dc: 15 },
    range: [5, 20],
    note: 'FTR-33 Appendix I — FWI should be ~8.5',
  },
  {
    label: 'Spring cold-start (DC=15 artifact)',
    w: { temp: 18, rh: 35, wind: 18, rain: 0, month: 5, fwiFromCWFIS: false },
    prev: { ffmc: 85, dmc: 8, dc: 15 },
    range: [1, 10],
    note: 'Low DC from startup; BUI low, FWI should still reflect dryness but not 40+',
  },
  {
    label: 'Extreme fire weather (Lethbridge midsummer)',
    w: { temp: 38, rh: 12, wind: 40, rain: 0, month: 7, fwiFromCWFIS: false },
    prev: { ffmc: 92, dmc: 60, dc: 500 },
    range: [40, 200],
    note: 'Extreme — FWI above 100 possible at these conditions',
  },
  {
    label: 'Rainy day (precip suppresses)',
    w: { temp: 15, rh: 80, wind: 10, rain: 15, month: 6, fwiFromCWFIS: false },
    prev: { ffmc: 80, dmc: 20, dc: 150 },
    range: [0, 3],
    note: '15mm rain — FFMC/FWI should collapse',
  },
  {
    label: 'Null DC cold-start (null coerces to 0 in _dc)',
    w: { temp: 32, rh: 21, wind: 14, rain: 0, month: 6, fwiFromCWFIS: false },
    prev: { ffmc: 83, dmc: 15, dc: null },
    range: [1, 30],
    note: 'null DC → dc_prev=0 (JS coercion). Production code guards with ?? getStartupDC before calling.',
  },
  {
    label: 'CWFIS passthrough (fwiFromCWFIS=true)',
    w: { temp: 14.5, rh: 57, wind: 16.1, rain: 0, month: 6, fwiFromCWFIS: true,
         ffmc: 70.5, dmc: 13.1, dc: 165.5, isi: null, bui: null, fwi: 2.1 },
    prev: null,
    range: [1, 4],
    note: 'CWFIS pre-computed — engine should pass through ffmc/dmc/dc and recompute ISI/BUI/FWI',
  },
];

// ─── Run tests ────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, warn = 0;
const issues = [];

for (const t of tests) {
  const result = FWI.calculateFWI(t.w, t.prev ?? undefined);
  const fwi = result.fwi;

  // Verify ISI/BUI/FWI are internally consistent (unless CWFIS passthrough where isi/bui come from chain)
  if (!t.w.fwiFromCWFIS && fwi != null) {
    const expISI = refISI(result.ffmc, t.w.wind);
    const expBUI = refBUI(result.dmc, result.dc);
    const expFWI = refFWI(expISI, expBUI);
    const fwiDiff = Math.abs(fwi - expFWI);
    if (fwiDiff > 0.5) {
      issues.push(`  INTERNAL INCONSISTENCY: ${t.label} — computed FWI=${fwi.toFixed(2)}, ref FWI=${expFWI.toFixed(2)} (diff ${fwiDiff.toFixed(2)})`);
      fail++;
      continue;
    }
  }

  // Range check
  if (fwi == null) {
    if (t.expectLow) {
      console.log(`SKIP (null FWI expected for inactive station): ${t.label}`);
      pass++;
    } else {
      console.log(`FAIL (null FWI): ${t.label}`);
      issues.push(`  null FWI: ${t.label}`);
      fail++;
    }
    continue;
  }

  const [lo, hi] = t.range;
  const ok = fwi >= lo && fwi <= hi;
  if (ok) {
    console.log(`PASS  FWI=${fwi.toFixed(1).padStart(5)} [${lo}-${hi}] ${t.label}`);
    pass++;
  } else {
    const severity = (fwi < lo && fwi < 1) || (fwi > hi && fwi > 120) ? 'FAIL' : 'WARN';
    console.log(`${severity}  FWI=${fwi.toFixed(1).padStart(5)} [${lo}-${hi}] ${t.label} — ${t.note}`);
    issues.push(`  ${severity}: ${t.label} — FWI=${fwi.toFixed(1)}, expected [${lo}-${hi}]`);
    if (severity === 'FAIL') fail++; else warn++;
  }

  // Sanity: FWI=2 with hot/dry conditions is a red flag
  if (fwi < 3 && t.w.temp > 25 && t.w.rh < 30 && !t.expectLow) {
    issues.push(`  RED FLAG: ${t.label} — FWI=${fwi.toFixed(1)} at ${t.w.temp}°C/${t.w.rh}%RH`);
    fail++;
  }
}

// ─── applyDCFloor audit ───────────────────────────────────────────────────────
// applyDCFloor is internal to fwi.js. The VM sandbox makes all module-level
// declarations accessible directly (they land on the global/sandbox object).
console.log('\n── DC Floor audit ──');

const applyDCFloor = sandbox.applyDCFloor;
if (typeof applyDCFloor !== 'function') {
  console.log('  FAIL  applyDCFloor not found in sandbox — engine refactor may have moved it');
  fail++;
} else {
  // Each case: [rawDC, lat, lon, expectCorrected, label]
  // Ceiling is DC_COLDSTART_CEILING=60; floor window is months 3-6 (spring); AB+BC interior
  // Month is real-time in the engine — tests are month-agnostic: we call applyDCFloor directly.
  const FLOOR_CASES = [
    [15,   53.5, -113.5, true,  'AB Edmonton, DC=15 (below ceiling+floor → corrected)'],
    [15,   56.5, -111.2, true,  'AB Fort Mac zone, DC=15 (below ceiling+floor → corrected)'],
    [61,   53.5, -113.5, false, 'AB Edmonton, DC=61 (above ceiling → pass-through)'],
    [300,  53.5, -113.5, false, 'AB Edmonton, DC=300 (well above floor → pass-through)'],
    [15,   51.0, -120.0, true,  'BC interior, DC=15 (within bounds → corrected)'],
    [15,   62.0, -114.0, false, 'North of AB bounds, DC=15 (lat>60.5 → no floor)'],
    [null, 53.5, -113.5, false, 'null DC → pass-through with dc=null'],
  ];

  // The engine uses real Date.now() internally for month check — in June (month 6)
  // the floor window is active. These tests run in June so correction cases are live.
  // Month is determined by the engine at call time, not passed as a parameter.
  for (const [raw, lat, lon, expectCorrected, label] of FLOOR_CASES) {
    try {
      const result = applyDCFloor(raw, lat, lon);
      const corrOk = result.corrected === expectCorrected;
      const dcOk   = raw == null
        ? result.dc == null
        : (expectCorrected ? result.dc > raw : result.dc === raw);
      const ok = corrOk && dcOk;
      const tag = ok ? 'PASS' : 'FAIL';
      const detail = `dc=${raw ?? 'null'} → ${result.dc?.toFixed(1) ?? 'null'}  corrected=${result.corrected}`;
      console.log(`  ${tag}  ${label}`);
      console.log(`         ${detail}  (expected corrected=${expectCorrected})`);
      if (ok) pass++; else { fail++; issues.push(`  DC Floor FAIL: ${label} — ${detail}`); }
    } catch (e) {
      console.log(`  FAIL  CRASH: ${label}: ${e.message}`);
      issues.push(`  DC Floor CRASH: ${label}: ${e.message}`);
      fail++;
    }
  }
}

// ─── FBP plausibility check ───────────────────────────────────────────────────
console.log('\n── FBP plausibility ──');
// calculateFBP(fuelCode, ffmc, dmc, dc, windSpeed, slope=0, curing=100, ps=50, opts={})
const fbpCases = [
  // High fire danger — C2 with well-developed chain
  { fuel: 'C2',  ffmc: 88, dmc: 40, dc: 300, wind: 20, curing: 0,  label: 'C2 high danger',       expectROS: [2,  30],  expectHFI: [500,  15000] },
  // Grass at 80% curing (matted O1a)
  { fuel: 'O1a', ffmc: 84, dmc: 20, dc: 100, wind: 15, curing: 80, label: 'O1a matted 80%',        expectROS: [0.5,15],  expectHFI: [20,   2000] },
  // Standing grass at 80% curing (O1b)
  { fuel: 'O1b', ffmc: 88, dmc: 40, dc: 300, wind: 20, curing: 80, label: 'O1b standing 80%',      expectROS: [3,  40],  expectHFI: [100,  6000] },
  // Cool day — low danger
  { fuel: 'C2',  ffmc: 70, dmc: 13, dc: 165, wind: 16, curing: 0,  label: 'C2 cool day',          expectROS: [0,  2],   expectHFI: [0,    200] },
  // Extreme dry — C7 Ponderosa
  { fuel: 'C7',  ffmc: 92, dmc: 60, dc: 500, wind: 30, curing: 0,  label: 'C7 extreme',           expectROS: [1,  20],  expectHFI: [500,  20000] },
  // D1 leafless aspen (low unless BUI very high)
  { fuel: 'D1',  ffmc: 85, dmc: 30, dc: 250, wind: 20, curing: 0,  label: 'D1 leafless',          expectROS: [0,  15],  expectHFI: [0,    3000] },
  // C1 spruce-lichen woodland (common in AB boreal)
  { fuel: 'C1',  ffmc: 88, dmc: 40, dc: 300, wind: 20, curing: 0,  label: 'C1 spruce-lichen',     expectROS: [0.5, 8],  expectHFI: [100,  4000] },
  // C3 mature lodgepole pine (Rocky Mountain parks)
  { fuel: 'C3',  ffmc: 88, dmc: 40, dc: 300, wind: 20, curing: 0,  label: 'C3 mature pine',       expectROS: [1,  12],  expectHFI: [300,  8000] },
  // M1 mixed wood 50% conifer (AB boreal transition)
  { fuel: 'M1',  ffmc: 88, dmc: 40, dc: 300, wind: 20, curing: 0,  label: 'M1 mixed 50% conifer', expectROS: [2,  20],  expectHFI: [500,  15000] },
  // S1 slash (harvested areas)
  { fuel: 'S1',  ffmc: 88, dmc: 40, dc: 300, wind: 20, curing: 0,  label: 'S1 slash',             expectROS: [4,  40],  expectHFI: [5000, 60000] },
];

for (const c of fbpCases) {
  try {
    // _stationLat is not set in sandbox, so pass lat via opts
    const r = FWI.calculateFBP(c.fuel, c.ffmc, c.dmc, c.dc, c.wind, 0, c.curing, 50, { lat: 53.5, lng: -113.5 });
    if (!r) { console.log(`  SKIP (null result) FBP ${c.label}`); warn++; continue; }
    const [rLo, rHi] = c.expectROS;
    const [hLo, hHi] = c.expectHFI;
    const rosOk = isFinite(r.ros) && r.ros >= rLo && r.ros <= rHi;
    const hfiOk = isFinite(r.hfi) && r.hfi >= hLo && r.hfi <= hHi;
    const ok = rosOk && hfiOk;
    const status = ok ? 'PASS' : (isNaN(r.ros) || isNaN(r.hfi) ? 'FAIL' : 'WARN');
    console.log(`${status}  ${c.label}: ROS=${isFinite(r.ros) ? r.ros.toFixed(2) : r.ros} m/min HFI=${isFinite(r.hfi) ? r.hfi.toFixed(0) : r.hfi} kW/m`);
    if (status === 'PASS') pass++;
    else if (status === 'FAIL') { fail++; issues.push(`  FAIL FBP NaN: ${c.label}`); }
    else { warn++; issues.push(`  WARN FBP: ${c.label} ROS=${r.ros?.toFixed(2)} HFI=${r.hfi?.toFixed(0)}`); }
  } catch (e) {
    console.log(`  CRASH FBP ${c.label}: ${e.message}`);
    issues.push(`  CRASH FBP ${c.label}: ${e.message}`);
    fail++;
  }
}

// ─── dangerRating boundary conditions ────────────────────────────────────────
// Thresholds: Low <5.5, Moderate <15.5, High <22.5, Very High <29.5, Extreme ≥29.5
console.log('\n── dangerRating boundaries ──');
const BOUNDARY_CASES = [
  [0,    'Low'],
  [5.49, 'Low'],
  [5.5,  'Moderate'],
  [15.49,'Moderate'],
  [15.5, 'High'],
  [22.49,'High'],
  [22.5, 'Very High'],
  [29.49,'Very High'],
  [29.5, 'Extreme'],
  [100,  'Extreme'],
];
for (const [fwi, expected] of BOUNDARY_CASES) {
  const got = FWI.dangerRating(fwi);
  const ok = got === expected;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  FWI=${String(fwi).padStart(5)}  → ${got.padEnd(9)} (expected ${expected})`);
  if (ok) pass++;
  else { fail++; issues.push(`  dangerRating FAIL: FWI=${fwi} got "${got}" expected "${expected}"`); }
}

// ─── calcSFC reference values (FCFDG 1992 / ST-X-3 equations) ────────────────
// Direct equation verification — SFC feeds into TFC → HFI, so drift here
// propagates silently through all FBP outputs. Tolerance 0.001 kg/m².
console.log('\n── calcSFC reference values ──');
const SFC_CASES = [
  // [fuel, ffmc, bui, pc, gfl, label, expected]
  // C1 Eqs. 9a/9b — FFMC-dependent, two branches
  ['C1',  88,  0,  50, 0.35, 'C1 FFMC=88 (Eq.9a above 84)',   1.33166],
  ['C1',  80,  0,  50, 0.35, 'C1 FFMC=80 (Eq.9b below 84)',   0.16834],
  // C2/C3/C5 BUI-driven equations
  ['C2',  85, 50,  50, 0.35, 'C2 BUI=50  (Eq.10)',            2.18648],
  ['C3',  85, 80,  50, 0.35, 'C3 BUI=80  (Eq.11)',            2.47612],
  // D1 — leafless aspen / deciduous
  ['D1',  85, 40,  50, 0.35, 'D1 BUI=40  (Eq.16)',            0.77858],
  // M1 — PC-weighted C2/D1 blend
  ['M1',  85, 60,  50, 0.35, 'M1 pc=50 BUI=60 (Eq.17)',       1.74591],
  // O1a — constant grass fuel load
  ['O1a', 85, 40,  50, 0.35, 'O1a gfl=0.35 (Eq.18)',          0.35000],
  // S1/S2 — two-component slash equations
  ['S1',  85, 50,  50, 0.35, 'S1 BUI=50  (Eqs.19,20,25)',     6.12325],
  ['S2',  85, 80,  50, 0.35, 'S2 BUI=80  (Eqs.21,22,25)',    12.41607],
];
const SFC_TOL = 0.001;
for (const [fuel, ffmc, bui, pc, gfl, label, expected] of SFC_CASES) {
  const sfc = FWI.calcSFC(fuel, ffmc, bui, pc, gfl);
  const ok  = Math.abs(sfc - expected) <= SFC_TOL;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${label.padEnd(38)}  SFC=${sfc.toFixed(5)} (expected ${expected.toFixed(5)})`);
  if (ok) pass++;
  else { fail++; issues.push(`  calcSFC FAIL: ${label} got ${sfc.toFixed(5)} expected ${expected.toFixed(5)}`); }
}

// ─── hfiClassInfo boundary conditions ────────────────────────────────────────
// Six HFI intensity classes: Low(<10), Moderate(<500), High(<2000),
// Very High(<4000), Extreme(<10000), Catastrophic(≥10000) kW/m
console.log('\n── hfiClassInfo boundaries ──');
const HFI_BOUNDARY_CASES = [
  [0,     1, 'Low'],
  [9.9,   1, 'Low'],
  [10,    2, 'Moderate'],
  [499,   2, 'Moderate'],
  [500,   3, 'High'],
  [1999,  3, 'High'],
  [2000,  4, 'Very High'],
  [3999,  4, 'Very High'],
  [4000,  5, 'Extreme'],
  [9999,  5, 'Extreme'],
  [10000, 6, 'Catastrophic'],
  [50000, 6, 'Catastrophic'],
];
for (const [hfi, expectedNum, expectedLabel] of HFI_BOUNDARY_CASES) {
  const info = FWI.hfiClassInfo(hfi);
  const ok = info.num === expectedNum && info.label === expectedLabel;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  HFI=${String(hfi).padStart(6)} kW/m  → class ${info.num} ${info.label.padEnd(12)} (expected ${expectedNum} ${expectedLabel})`);
  if (ok) pass++;
  else { fail++; issues.push(`  hfiClassInfo FAIL: HFI=${hfi} got class ${info.num} "${info.label}" expected ${expectedNum} "${expectedLabel}"`); }
}

// ─── Multi-day FBP chain ──────────────────────────────────────────────────────
// calcMultiDayFBP drives the forecast trends page. Tests that:
//   · FWI chain is continuous (state propagates day-to-day)
//   · Hot/dry days raise FWI; heavy rain collapses it
//   · FBP ros/hfi are non-NaN and non-negative every day
console.log('\n── Multi-day FBP chain ──');
const CHAIN_DAYS = [
  { temp: 20, rh: 45, wind: 15, rain: 0,  month: 7, label: 'Day 1 moderate' },
  { temp: 34, rh: 15, wind: 30, rain: 0,  month: 7, label: 'Day 2 hot/dry'  },
  { temp: 16, rh: 80, wind: 8,  rain: 25, month: 7, label: 'Day 3 heavy rain'},
  { temp: 22, rh: 40, wind: 12, rain: 0,  month: 7, label: 'Day 4 recovery'  },
  { temp: 31, rh: 20, wind: 25, rain: 0,  month: 7, label: 'Day 5 hot/dry'  },
];
const CHAIN_START = { ffmc: 85, dmc: 30, dc: 200 };

try {
  const chain = FWI.calcMultiDayFBP(CHAIN_DAYS, 300, CHAIN_START, 'C2', 80, 50);

  if (!Array.isArray(chain) || chain.length !== CHAIN_DAYS.length) {
    console.log(`  FAIL  calcMultiDayFBP returned wrong length: ${chain?.length}`);
    fail++;
  } else {
    let chainOk = true;

    // (a) Each day: no NaN/OOB in FWI chain
    for (const [i, r] of chain.entries()) {
      const dayOk = !isNaN(r.fwi) && r.ffmc >= 0 && r.ffmc <= 101 && r.dmc >= 0 && r.dc >= 0;
      if (!dayOk) { chainOk = false; issues.push(`  FAIL multi-day chain Day ${i+1}: fwi=${r.fwi} ffmc=${r.ffmc}`); }
    }

    // (b) FBP result non-NaN/non-negative every day
    for (const [i, r] of chain.entries()) {
      const fbpOk = r.fbp && isFinite(r.fbp.ros) && r.fbp.ros >= 0 && isFinite(r.fbp.hfi) && r.fbp.hfi >= 0;
      if (!fbpOk) { chainOk = false; issues.push(`  FAIL multi-day FBP Day ${i+1}: ros=${r.fbp?.ros} hfi=${r.fbp?.hfi}`); }
    }

    // (c) Hot/dry day 2 must have higher FWI than moderate day 1
    if (chain[1].fwi <= chain[0].fwi) {
      chainOk = false; issues.push(`  FAIL Day 2 FWI=${chain[1].fwi.toFixed(1)} not > Day 1 FWI=${chain[0].fwi.toFixed(1)}`);
    }

    // (d) Rain day 3 FFMC must be substantially lower than day 2 (25mm rain suppresses)
    if (chain[2].ffmc >= chain[1].ffmc - 10) {
      chainOk = false; issues.push(`  FAIL Day 3 FFMC=${chain[2].ffmc.toFixed(1)} not suppressed vs Day 2=${chain[1].ffmc.toFixed(1)}`);
    }

    // (e) Day 5 (hot/dry after recovery) FWI must be above Low (not stuck at 0)
    if (chain[4].fwi < 5) {
      chainOk = false; issues.push(`  FAIL Day 5 FWI=${chain[4].fwi.toFixed(1)} implausibly low after dry sequence`);
    }

    for (const [i, r] of chain.entries()) {
      const label = CHAIN_DAYS[i].label.padEnd(20);
      console.log(`  ${label}  FWI=${r.fwi.toFixed(1).padStart(6)}  FFMC=${r.ffmc.toFixed(1).padStart(5)}  ROS=${r.fbp?.ros?.toFixed(1).padStart(5)} m/min  HFI=${r.fbp?.hfi?.toFixed(0).padStart(6)} kW/m`);
    }

    if (chainOk) { console.log('  PASS  chain continuous, rain-suppressed, FBP valid'); pass++; }
    else { console.log('  FAIL  chain anomaly — see issues'); fail++; }
  }
} catch (e) {
  console.log(`  FAIL  calcMultiDayFBP threw: ${e.message}`);
  issues.push(`  FAIL calcMultiDayFBP: ${e.message}`);
  fail++;
}

// ─── componentRating boundaries ──────────────────────────────────────────────
// componentRating maps each FWI component to a label using component-specific
// thresholds (not the FWI danger-rating scale). Accessed via VM sandbox.
// Thresholds from fwi.js: ffmc[77,84,88,91] dmc[21,27,40,60]
//   dc[80,190,300,500] isi[2,5,10,20] bui[31,40,60,90]
console.log('\n── componentRating boundaries ──');
{
  const componentRating = sandbox.componentRating;
  if (typeof componentRating !== 'function') {
    console.log('  FAIL  componentRating not found in sandbox — engine may have moved it');
    issues.push('componentRating missing from sandbox');
    fail++;
  } else {
    const CR_CASES = [
      // [key, val, expected, note]
      // ffmc: thresholds 77 / 84 / 88 / 91
      ['ffmc',  76,  'Low',       'below first threshold'],
      ['ffmc',  77,  'Moderate',  'at first threshold'],
      ['ffmc',  88,  'Very High', 'at third threshold'],
      ['ffmc',  91,  'Extreme',   'at fourth threshold'],
      // dmc: thresholds 21 / 27 / 40 / 60
      ['dmc',   20,  'Low',       'below first threshold'],
      ['dmc',   21,  'Moderate',  'at first threshold'],
      ['dmc',   60,  'Extreme',   'at fourth threshold'],
      // dc: thresholds 80 / 190 / 300 / 500
      ['dc',    79,  'Low',       'below first threshold'],
      ['dc',    80,  'Moderate',  'at first threshold'],
      ['dc',   300,  'Very High', 'at third threshold'],
      ['dc',   500,  'Extreme',   'at fourth threshold'],
      // isi: thresholds 2 / 5 / 10 / 20
      ['isi',    1,  'Low',       'below first threshold'],
      ['isi',    2,  'Moderate',  'at first threshold'],
      ['isi',   20,  'Extreme',   'at fourth threshold'],
      // bui: thresholds 31 / 40 / 60 / 90
      ['bui',   30,  'Low',       'below first threshold'],
      ['bui',   31,  'Moderate',  'at first threshold'],
      ['bui',   90,  'Extreme',   'at fourth threshold'],
      // fwi key has no component threshold → falls back to dangerRating (AB scale)
      ['fwi',    4,  'Low',       'fwi fallback: <5.5 → Low'],
      ['fwi',   16,  'High',      'fwi fallback: 15.5≤x<22.5 → High'],
    ];

    for (const [key, val, expected, note] of CR_CASES) {
      const got = componentRating(key, val);
      const ok  = got === expected;
      const tag = ok ? 'PASS' : 'FAIL';
      const lbl = `${key}=${val}`.padEnd(10);
      console.log(`  ${tag}  ${lbl}  → ${got.padEnd(12)} (${note})`);
      if (ok) pass++;
      else { issues.push(`  componentRating FAIL: ${key}=${val} got "${got}" expected "${expected}" (${note})`); fail++; }
    }
  }
}

// ─── calcFMC branch boundaries (FCFDG 1992 Eqs. 1,2,5-8) ────────────────────
// FMC has 3 branches: nd<30 Eq.6, 30≤nd<50 Eq.7, nd≥50 Eq.8.
// Test at exact boundary nd values using Edmonton (lat=53.5, lng=-113.5, d0=154).
console.log('\n── calcFMC branch boundaries ──');
{
  const TOL = 0.001;
  // (lat, lng, doy, expected_fmc, note)
  // Edmonton d0=154; nd = |doy - 154|
  const FMC_CASES = [
    [53.5, -113.5, 154, 85.0000,    'nd=0  minimum FMC (Eq.6)'],
    [53.5, -113.5, 183, 100.8949,   'nd=29 last Eq.6 value'],
    [53.5, -113.5, 184, 102.0800,   'nd=30 first Eq.7 value'],
    [53.5, -113.5, 203, 119.0812,   'nd=49 last Eq.7 value'],
    [53.5, -113.5, 204, 120.0,      'nd=50 Eq.8 saturates at 120'],
    // Same nd=50 but using doy before d0 (nd counted symmetrically)
    [53.5, -113.5, 104, 120.0,      'nd=50 early season also saturates at 120'],
    // BC interior: Kamloops (lat=50.7, lng=-120.4, d0=142)
    [50.7, -120.4, 142, 85.0000,    'Kamloops nd=0 minimum FMC'],
    [50.7, -120.4, 192, 120.0,      'Kamloops nd=50 saturated'],
  ];

  for (const [lat, lng, doy, expected, note] of FMC_CASES) {
    const got = FWI.calcFMC(lat, lng, doy);
    const diff = Math.abs(got - expected);
    const ok   = diff <= TOL;
    const tag  = ok ? 'PASS' : 'FAIL';
    const lbl  = `lat=${lat} doy=${doy}`.padEnd(22);
    console.log(`  ${tag}  ${lbl}  FMC=${got.toFixed(4).padStart(8)}  (${note})`);
    if (ok) pass++;
    else { issues.push(`  calcFMC FAIL: ${note}: got ${got.toFixed(4)} expected ${expected} Δ=${diff.toFixed(4)}`); fail++; }
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`PASS ${pass}  WARN ${warn}  FAIL ${fail}`);
if (issues.length) {
  console.log('\nIssues:');
  issues.forEach(i => console.log(i));
}
process.exit(fail > 0 ? 1 : 0);
