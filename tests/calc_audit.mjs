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

// ─── getRegionalDCFloor zone reference values ────────────────────────────────
// Tests that the exact floor value is correct for each AB geographic zone.
// The existing applyDCFloor tests only verify direction (dc > raw), not the
// specific expected value — a zone floor set to 250 instead of 300 would pass
// those tests but be wrong. These tests pin the exact value per zone.
console.log('\n── AB getRegionalDCFloor zone reference values ──');
{
  const grd = sandbox.getRegionalDCFloor;
  if (typeof grd !== 'function') {
    console.log('  FAIL  getRegionalDCFloor not in sandbox');
    fail++;
  } else {
    const mo = new Date(Date.now() - 7 * 3600000).getUTCMonth() + 1; // MST
    if (mo < 3 || mo > 6) {
      console.log(`  SKIP  spring window inactive (mo=${mo}; active Mar–Jun)`);
    } else {
      // [lat, lon, expectedFloor, label]
      const ZONE_CASES = [
        [49.7, -112.8, 450, 'SE prairies (Lethbridge, lat<50.5 lon>-113.5)'],
        [49.5, -113.8, 300, 'SW foothills (Pincher Creek, lat<50.5 lon≤-113.5)'],
        [51.2, -112.0, 360, 'Drumheller corridor (lat<51.5 lon>-112.5)'],
        [51.0, -114.0, 280, 'Calgary metro (lat<51.5 lon≤-112.5)'],
        [52.0, -113.8, 290, 'Red Deer/Camrose (lat<52.5)'],
        [53.5, -113.5, 300, 'Edmonton metro (lat<54.0)'],
        [55.0, -114.0, 180, 'Slave Lake zone (lat<56.5)'],
        [57.0, -117.0, 120, 'Northern boreal (lat≥56.5)'],
        // Out-of-bounds → 0 (no floor applied)
        [48.5, -113.5,   0, 'South of AB (lat<48.8) → 0'],
        [53.5, -121.0,   0, 'West of AB (lon<-120.5) → 0'],
        [53.5, -108.0,   0, 'East of AB (lon>-109.5) → 0'],
        [61.5, -113.5,   0, 'North of AB (lat>60.5) → 0'],
      ];
      for (const [lat, lon, expFloor, label] of ZONE_CASES) {
        const got = grd(lat, lon);
        const ok = got === expFloor;
        console.log(`  ${ok?'PASS':'FAIL'}  ${label} → floor=${got} (exp ${expFloor})`);
        if (ok) pass++; else { fail++; issues.push(`getRegionalDCFloor FAIL: ${label} → ${got} exp ${expFloor}`); }
      }
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

// ─── FBP all-fuel-types sweep ────────────────────────────────────────────────
// Runs all 18 fuel types through calculateFBP and checks for NaN regression.
// FFMC=85 DMC=30 DC=200 wind=20 → BUI≈44 (below D2's BUI=80 gate).
// Separate D2 test at high BUI (DMC=70 DC=400 → BUI≈80) confirms gate lifts.
{
  console.log('\n── FBP all-fuel-types sweep ──');
  const VALID_TYPES = new Set(['Surface', 'Passive Crown', 'Active Crown', 'Torching']);
  const opts = { lat: 53.0, lng: -114.0, doy: 180 };
  const FUELS = Object.keys(FWI.FUEL_TYPES);

  for (const fuel of FUELS) {
    const r = FWI.calculateFBP(fuel, 85, 30, 200, 20, 0, 100, 50, opts);
    if (!r) {
      console.log(`  FAIL  ${fuel}: calculateFBP returned null`);
      fail++; issues.push(`calculateFBP(${fuel}) returned null`); continue;
    }
    const nanFields = Object.entries(r).filter(([, v]) => typeof v === 'number' && isNaN(v)).map(([k]) => k);
    const rosFinite = isFinite(r.ros) && r.ros >= 0;
    const hfiFinite = isFinite(r.hfi) && r.hfi >= 0;
    const typeValid = VALID_TYPES.has(r.fireType);

    // D2 below BUI 80 gate: rsi=0 so ros floors at near-zero, hfi ≈ 0
    const d2GateOk = fuel !== 'D2' || (r.ros < 0.01 && r.hfi < 1);

    const ok = nanFields.length === 0 && rosFinite && hfiFinite && typeValid && d2GateOk;
    const note = fuel === 'D2' ? ` (d2_gate_ok=${d2GateOk})` : '';
    console.log(`  ${ok?'PASS':'FAIL'}  ${fuel.padEnd(4)} ros=${r.ros.toFixed(3).padStart(7)} hfi=${Math.round(r.hfi).toString().padStart(6)} type=${r.fireType}${note}`);
    if (ok) pass++;
    else {
      fail++;
      if (nanFields.length) issues.push(`calculateFBP(${fuel}): NaN in ${nanFields.join(',')}`);
      if (!rosFinite)       issues.push(`calculateFBP(${fuel}): ROS not finite (${r.ros})`);
      if (!hfiFinite)       issues.push(`calculateFBP(${fuel}): HFI not finite (${r.hfi})`);
      if (!typeValid)       issues.push(`calculateFBP(${fuel}): unknown fireType "${r.fireType}"`);
      if (!d2GateOk)        issues.push(`calculateFBP(D2): BUI<80 gate should suppress fire, ros=${r.ros}`);
    }
  }

  // D2 at BUI≥80: DMC=70, DC=400 → BUI = 70 - (1 - 0.8*400/(70+160)) * (0.92 + (0.0114*70)^1.7)
  // Easier: use DMC=100, DC=300 which definitely clears BUI=80 for D2
  const rD2hi = FWI.calculateFBP('D2', 88, 100, 300, 25, 0, 100, 50, opts);
  const d2HiOk = rD2hi && rD2hi.ros > 0.01 && isFinite(rD2hi.ros);
  console.log(`  ${d2HiOk?'PASS':'FAIL'}  D2 high-BUI gate lifts: ros=${rD2hi?.ros?.toFixed(3)} bui=${rD2hi?.bui?.toFixed(1)}`);
  if (d2HiOk) pass++; else { fail++; issues.push(`D2 high-BUI gate not lifting: ros=${rD2hi?.ros}`); }
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
  // C5/C6 — same equation as C4 but different β (Eq.12)
  ['C5',  85, 80,  50, 0.35, 'C5 BUI=80  (Eq.12)',             2.03816],
  ['C6',  85, 80,  50, 0.35, 'C6 BUI=80  (Eq.12)',             2.03816],
  // C7 — forest-floor (FFMC-gated) + BUI component (Eqs.13-15)
  ['C7',  88, 60,  50, 0.35, 'C7 FFMC=88 BUI=60 (Eqs.13-15)', 2.74328],
  ['C7',  65, 60,  50, 0.35, 'C7 FFMC=65 BUI=60 (no ff term)', 1.05091],
  // M2 — same blend equation as M1 but different PC (Eq.17)
  ['M2',  85, 60,  75, 0.35, 'M2 pc=75 BUI=60 (Eq.17)',        2.11901],
  // M3/M4 — dead balsam fir slash, same as C2 (Eq.10)
  ['M3',  85, 50,  50, 0.35, 'M3 BUI=50  (Eq.10, = C2)',       2.18648],
  ['M4',  85, 50,  50, 0.35, 'M4 BUI=50  (Eq.10, = C2)',       2.18648],
  // D2 — same as D1 (Eq.16; toggled by BUI season gate in calculateFBP)
  ['D2',  85, 40,  50, 0.35, 'D2 BUI=40  (Eq.16, = D1)',       0.77858],
  // S1/S2/S3 — two-component slash equations
  ['S1',  85, 50,  50, 0.35, 'S1 BUI=50  (Eqs.19,20,25)',      6.12325],
  ['S2',  85, 80,  50, 0.35, 'S2 BUI=80  (Eqs.21,22,25)',     12.41607],
  ['S3',  85, 80,  50, 0.35, 'S3 BUI=80  (Eqs.23,24,25)',     25.09244],
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
      // ffmc: thresholds 77 / 84 / 88 / 91 — all 5 classes
      ['ffmc',  76,  'Low',       'ffmc below first (76<77)'],
      ['ffmc',  77,  'Moderate',  'ffmc at first threshold'],
      ['ffmc',  83,  'Moderate',  'ffmc just below second (83<84)'],
      ['ffmc',  84,  'High',      'ffmc at second threshold'],
      ['ffmc',  87,  'High',      'ffmc mid-High band'],
      ['ffmc',  88,  'Very High', 'ffmc at third threshold'],
      ['ffmc',  90,  'Very High', 'ffmc mid-Very High band'],
      ['ffmc',  91,  'Extreme',   'ffmc at fourth threshold'],
      ['ffmc',  99,  'Extreme',   'ffmc well above'],
      // dmc: thresholds 21 / 27 / 40 / 60 — all 5 classes
      ['dmc',   20,  'Low',       'dmc below first (20<21)'],
      ['dmc',   21,  'Moderate',  'dmc at first threshold'],
      ['dmc',   26,  'Moderate',  'dmc just below second'],
      ['dmc',   27,  'High',      'dmc at second threshold'],
      ['dmc',   39,  'High',      'dmc just below third'],
      ['dmc',   40,  'Very High', 'dmc at third threshold'],
      ['dmc',   59,  'Very High', 'dmc just below fourth'],
      ['dmc',   60,  'Extreme',   'dmc at fourth threshold'],
      // dc: thresholds 80 / 190 / 300 / 500 — all 5 classes
      ['dc',    79,  'Low',       'dc below first (79<80)'],
      ['dc',    80,  'Moderate',  'dc at first threshold'],
      ['dc',   189,  'Moderate',  'dc just below second'],
      ['dc',   190,  'High',      'dc at second threshold'],
      ['dc',   299,  'High',      'dc just below third'],
      ['dc',   300,  'Very High', 'dc at third threshold'],
      ['dc',   499,  'Very High', 'dc just below fourth'],
      ['dc',   500,  'Extreme',   'dc at fourth threshold'],
      // isi: thresholds 2 / 5 / 10 / 20 — all 5 classes
      ['isi',    1,  'Low',       'isi below first (1<2)'],
      ['isi',    2,  'Moderate',  'isi at first threshold'],
      ['isi',    4,  'Moderate',  'isi just below second'],
      ['isi',    5,  'High',      'isi at second threshold'],
      ['isi',    9,  'High',      'isi just below third'],
      ['isi',   10,  'Very High', 'isi at third threshold'],
      ['isi',   19,  'Very High', 'isi just below fourth'],
      ['isi',   20,  'Extreme',   'isi at fourth threshold'],
      // bui: thresholds 31 / 40 / 60 / 90 — all 5 classes
      ['bui',   30,  'Low',       'bui below first (30<31)'],
      ['bui',   31,  'Moderate',  'bui at first threshold'],
      ['bui',   39,  'Moderate',  'bui just below second'],
      ['bui',   40,  'High',      'bui at second threshold'],
      ['bui',   59,  'High',      'bui just below third'],
      ['bui',   60,  'Very High', 'bui at third threshold'],
      ['bui',   89,  'Very High', 'bui just below fourth'],
      ['bui',   90,  'Extreme',   'bui at fourth threshold'],
      // fwi key → falls back to dangerRating (AB scale: 5.5/15.5/22.5/29.5)
      ['fwi',    4,  'Low',       'fwi fallback: <5.5 → Low'],
      ['fwi',    5.5, 'Moderate', 'fwi fallback: at 5.5 threshold'],
      ['fwi',   16,  'High',      'fwi fallback: 15.5≤x<22.5 → High'],
      ['fwi',   22.5, 'Very High','fwi fallback: at 22.5 threshold'],
      ['fwi',   29.5, 'Extreme',  'fwi fallback: at 29.5 threshold'],
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
    // Extreme latitude/longitude — verifies latn (Eq.1) and d0 (Eq.2) computation
    // Each row: at doy=d0 FMC must be 85; at d0+30 FMC=102.08; at d0+50 FMC=120.
    // Cranbrook BC (lat=49.6, lng=-115.8): latn=52.831 → d0=142 (May 22, earlier than Edmonton)
    [49.6, -115.8, 142, 85.0000,    'Cranbrook BC nd=0 — d0=142 same as Kamloops'],
    [49.6, -115.8, 172, 102.0800,   'Cranbrook BC nd=30 first Eq.7 (doy=d0+30)'],
    [49.6, -115.8, 192, 120.0,      'Cranbrook BC nd=50 saturated (doy=d0+50)'],
    // Vancouver BC (lat=49.2, lng=-123.2): latn=54.917 → d0=135 (May 15, earliest — coastal)
    [49.2, -123.2, 135, 85.0000,    'Vancouver BC nd=0 — d0=135 earliest (coastal Eq.1)'],
    [49.2, -123.2, 165, 102.0800,   'Vancouver BC nd=30 first Eq.7'],
    [49.2, -123.2, 185, 120.0,      'Vancouver BC nd=50 saturated'],
    // Fort Nelson BC (lat=58.8, lng=-122.7): latn=54.758 → d0=162 (Jun 11, latest BC)
    [58.8, -122.7, 162, 85.0000,    'Fort Nelson BC nd=0 — d0=162 far-north late minimum'],
    [58.8, -122.7, 212, 120.0,      'Fort Nelson BC nd=50 saturated'],
    // Fort Chipewyan AB (lat=60.0, lng=-112.0): latn=51.961 → d0=174 (Jun 23, latest AB)
    [60.0, -112.0, 174, 85.0000,    'Fort Chipewyan AB nd=0 — d0=174 northernmost AB'],
    [60.0, -112.0, 204, 102.0800,   'Fort Chipewyan AB nd=30 first Eq.7'],
    [60.0, -112.0, 224, 120.0,      'Fort Chipewyan AB nd=50 saturated'],
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

// ─── _buildupEffect (ST-X-3 Eq. 54) ─────────────────────────────────────────
// BE = exp(50·ln(q)·(1/bui − 1/bui0)). At bui=bui0 always 1; q=1 always 1.
console.log('\n── _buildupEffect (Eq. 54) ──');
{
  const TOL = 0.000001;
  const buildupEffect = sandbox._buildupEffect;
  if (typeof buildupEffect !== 'function') {
    console.log('  FAIL  _buildupEffect not found in sandbox');
    issues.push('_buildupEffect missing from sandbox'); fail++;
  } else {
    const BE_CASES = [
      // [fuelCode, bui, expected, note]
      ['C2',  0,    1,          'bui=0 guard → 1'],
      ['C2',  64,   1,          'C2 bui=bui0=64 neutral → 1'],
      ['C2',  32,   0.756803,   'C2 bui below bui0 → dampens'],
      ['C2',  128,  1.149499,   'C2 bui above bui0 → amplifies'],
      ['O1a', 50,   1,          'O1a q=1.0 → always 1'],
      ['C7',  106,  1,          'C7 bui=bui0=106 neutral → 1'],
      ['C7',  53,   0.926205,   'C7 half-bui0 dampens'],
      ['D1',  32,   1,          'D1 bui=bui0=32 neutral → 1'],
      ['D1',  16,   0.848211,   'D1 half-bui0 dampens'],
    ];
    for (const [fuel, bui, expected, note] of BE_CASES) {
      const got  = buildupEffect(fuel, bui);
      const diff = Math.abs(got - expected);
      const ok   = diff <= TOL;
      const tag  = ok ? 'PASS' : 'FAIL';
      const lbl  = `${fuel} bui=${bui}`.padEnd(14);
      console.log(`  ${tag}  ${lbl}  BE=${got.toFixed(6)}  (${note})`);
      if (ok) pass++;
      else { issues.push(`  _buildupEffect FAIL: ${note}: got ${got.toFixed(6)} expected ${expected}`); fail++; }
    }
  }
}

// ─── _rsiBasic (ST-X-3 Eq. 26) ───────────────────────────────────────────────
// RSI = a·(1−e^{−b·ISI})^c. At ISI=0 always 0.
console.log('\n── _rsiBasic (Eq. 26) ──');
{
  const TOL = 0.001;
  const rsiBasic = sandbox._rsiBasic;
  if (typeof rsiBasic !== 'function') {
    console.log('  FAIL  _rsiBasic not found in sandbox');
    issues.push('_rsiBasic missing from sandbox'); fail++;
  } else {
    const RSI_CASES = [
      // [fuelCode, isi, expected, note]
      ['C2',  0,   0,       'ISI=0 always gives zero RSI'],
      ['C2',  10,  13.3989, 'C2 a=110 b=0.0282 c=1.5 at ISI=10'],
      ['O1a', 10,  29.8436, 'O1a a=190 b=0.031 c=1.4 at ISI=10'],
      ['C7',  15,  6.0655,  'C7 a=45 b=0.0305 c=2.0 at ISI=15'],
      ['O1b', 8,   22.7592, 'O1b a=250 b=0.035 c=1.7 at ISI=8'],
      ['C1',  5,   0.2794,  'C1 a=90 b=0.0649 c=4.5 at ISI=5'],
    ];
    for (const [fuel, isi, expected, note] of RSI_CASES) {
      const got  = rsiBasic(fuel, isi);
      const diff = Math.abs(got - expected);
      const ok   = diff <= TOL;
      const tag  = ok ? 'PASS' : 'FAIL';
      const lbl  = `${fuel} ISI=${isi}`.padEnd(12);
      console.log(`  ${tag}  ${lbl}  RSI=${got.toFixed(4).padStart(8)}  (${note})`);
      if (ok) pass++;
      else { issues.push(`  _rsiBasic FAIL: ${note}: got ${got.toFixed(4)} expected ${expected}`); fail++; }
    }
  }
}

// ─── Crown-fire initiation (ST-X-3 Eqs. 56-58) ──────────────────────────────
// CSI = 0.001·cbh^1.5·(460+25.9·fmc)^1.5  (Eq.56)
// RSO = CSI/(300·SFC)                       (Eq.57)
// CFB = 1−exp(−0.23·(RSS−RSO)) when RSS>RSO (Eq.58)
// fireType: cfb≥0.9→Active Crown, ≥0.1→Passive Crown, else Surface
console.log('\n── Crown-fire initiation (Eqs. 56-58) ──');
{
  const TOL = 0.001;

  // C2 extreme summer — should be active crown (cfb≈1)
  const c2 = FWI.calculateFBP('C2', 92, 80, 400, 30, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
  // Verify Eq.56 self-consistency using engine's own fmc/cbh
  const cbh_c2 = 3;
  const csiExpected = 0.001 * Math.pow(cbh_c2, 1.5) * Math.pow(460 + 25.9 * c2.fmc, 1.5);
  const rsoExpected = c2.csi / (300 * c2.sfc);

  const csiOk = Math.abs(c2.csi - csiExpected) < TOL;
  const rsoOk = Math.abs(c2.rso - rsoExpected) < 0.000001;
  console.log(`  ${csiOk ? 'PASS' : 'FAIL'}  C2 Eq.56 CSI formula self-consistent: engine=${c2.csi.toFixed(3)} formula=${csiExpected.toFixed(3)}`);
  if (csiOk) pass++; else { issues.push(`  CSI Eq.56 mismatch: engine ${c2.csi} vs formula ${csiExpected}`); fail++; }
  console.log(`  ${rsoOk ? 'PASS' : 'FAIL'}  C2 Eq.57 RSO formula self-consistent: engine=${c2.rso.toFixed(6)} formula=${rsoExpected.toFixed(6)}`);
  if (rsoOk) pass++; else { issues.push(`  RSO Eq.57 mismatch`); fail++; }

  // Active crown: C2 extreme conditions
  const c2Active = c2.cfb >= 0.9 && c2.fireType === 'Active Crown';
  console.log(`  ${c2Active ? 'PASS' : 'FAIL'}  C2 extreme → Active Crown (cfb=${c2.cfb.toFixed(4)})`);
  if (c2Active) pass++; else { issues.push(`  C2 should be Active Crown, got cfb=${c2.cfb} fireType=${c2.fireType}`); fail++; }

  // Passive crown: C6 moderate conditions
  const c6 = FWI.calculateFBP('C6', 90, 60, 300, 25, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
  const c6Passive = c6.cfb >= 0.1 && c6.cfb < 0.9 && c6.fireType === 'Passive Crown';
  console.log(`  ${c6Passive ? 'PASS' : 'FAIL'}  C6 moderate → Passive Crown (cfb=${c6.cfb.toFixed(4)})`);
  if (c6Passive) pass++; else { issues.push(`  C6 should be Passive Crown, got cfb=${c6.cfb} fireType=${c6.fireType}`); fail++; }

  // C6 Eq.56 CSI and Eq.57 RSO self-consistency (cbh=7)
  const cbh_c6 = 7;
  const csiC6Expected = 0.001 * Math.pow(cbh_c6, 1.5) * Math.pow(460 + 25.9 * c6.fmc, 1.5);
  const rsoC6Expected = c6.csi / (300 * c6.sfc);
  const csiC6Ok = Math.abs(c6.csi - csiC6Expected) < TOL;
  const rsoC6Ok = Math.abs(c6.rso - rsoC6Expected) < 0.000001;
  console.log(`  ${csiC6Ok ? 'PASS' : 'FAIL'}  C6 Eq.56 CSI self-consistent: engine=${c6.csi.toFixed(3)} formula=${csiC6Expected.toFixed(3)}`);
  if (csiC6Ok) pass++; else { issues.push(`  CSI C6 Eq.56 mismatch: engine ${c6.csi} vs formula ${csiC6Expected}`); fail++; }
  console.log(`  ${rsoC6Ok ? 'PASS' : 'FAIL'}  C6 Eq.57 RSO self-consistent: engine=${c6.rso.toFixed(6)} formula=${rsoC6Expected.toFixed(6)}`);
  if (rsoC6Ok) pass++; else { issues.push(`  RSO C6 Eq.57 mismatch`); fail++; }

  // Active crown: C7 extreme wind
  const c7ex = FWI.calculateFBP('C7', 91, 100, 500, 45, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
  const c7Active = c7ex.cfb >= 0.9 && c7ex.fireType === 'Active Crown';
  console.log(`  ${c7Active ? 'PASS' : 'FAIL'}  C7 extreme wind → Active Crown (cfb=${c7ex.cfb.toFixed(4)})`);
  if (c7Active) pass++; else { issues.push(`  C7 extreme should be Active Crown, got cfb=${c7ex.cfb} fireType=${c7ex.fireType}`); fail++; }

  // C7 Eq.56 CSI, Eq.57 RSO, and Eq.58 CFB self-consistency (cbh=10)
  // For non-C6 fuels ros=rss (line 810 fwi.js), so c7ex.ros IS the surface spread rate for Eq.58
  const cbh_c7 = 10;
  const csiC7Expected = 0.001 * Math.pow(cbh_c7, 1.5) * Math.pow(460 + 25.9 * c7ex.fmc, 1.5);
  const rsoC7Expected = c7ex.csi / (300 * c7ex.sfc);
  const cfbC7Expected = 1 - Math.exp(-0.23 * (c7ex.ros - c7ex.rso));
  const csiC7Ok = Math.abs(c7ex.csi - csiC7Expected) < TOL;
  const rsoC7Ok = Math.abs(c7ex.rso - rsoC7Expected) < 0.000001;
  const cfbC7Ok = Math.abs(c7ex.cfb - cfbC7Expected) < TOL;
  console.log(`  ${csiC7Ok ? 'PASS' : 'FAIL'}  C7 Eq.56 CSI self-consistent: engine=${c7ex.csi.toFixed(3)} formula=${csiC7Expected.toFixed(3)}`);
  if (csiC7Ok) pass++; else { issues.push(`  CSI C7 Eq.56 mismatch: engine ${c7ex.csi} vs formula ${csiC7Expected}`); fail++; }
  console.log(`  ${rsoC7Ok ? 'PASS' : 'FAIL'}  C7 Eq.57 RSO self-consistent: engine=${c7ex.rso.toFixed(6)} formula=${rsoC7Expected.toFixed(6)}`);
  if (rsoC7Ok) pass++; else { issues.push(`  RSO C7 Eq.57 mismatch`); fail++; }
  console.log(`  ${cfbC7Ok ? 'PASS' : 'FAIL'}  C7 Eq.58 CFB self-consistent: engine=${c7ex.cfb.toFixed(6)} formula=${cfbC7Expected.toFixed(6)}`);
  if (cfbC7Ok) pass++; else { issues.push(`  CFB C7 Eq.58 mismatch: engine ${c7ex.cfb} vs formula ${cfbC7Expected}`); fail++; }

  // Surface fire: C7 low conditions (RSS < RSO)
  const c7lo = FWI.calculateFBP('C7', 75, 15, 80, 5, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
  const c7Surf = c7lo.cfb === 0 && c7lo.fireType === 'Surface';
  console.log(`  ${c7Surf ? 'PASS' : 'FAIL'}  C7 low → Surface (cfb=${c7lo.cfb.toFixed(4)} rso=${c7lo.rso.toFixed(3)})`);
  if (c7Surf) pass++; else { issues.push(`  C7 low should be Surface, got cfb=${c7lo.cfb} fireType=${c7lo.fireType}`); fail++; }

  // cbh=0 fuels: no crown fire possible — CSI=Infinity, CFB=0, fireType='Surface'
  for (const [fuel, desc] of [['D1', 'Leafless Aspen'], ['O1a', 'Matted Grass'], ['S1', 'Pine Slash']]) {
    const r = FWI.calculateFBP(fuel, 85, 40, 200, 20, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
    const ok = r.csi === Infinity && r.cfb === 0 && r.fireType === 'Surface';
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${fuel} (${desc}) cbh=0 → no crown: csi=${r.csi} cfb=${r.cfb} fireType=${r.fireType}`);
    if (ok) pass++; else { issues.push(`  ${fuel} cbh=0 should have csi=Infinity cfb=0 Surface, got csi=${r.csi} cfb=${r.cfb} fireType=${r.fireType}`); fail++; }
  }
}

// ─── TFC / HFI / flame length chain (ST-X-3 Eqs. 66-69, Byram 1959) ─────────
// TFC = SFC + CFB·CFL (Eq.66a/67), HFI = 300·TFC·ROS (Eq.69)
// Flame length: L = 0.0775·HFI^0.46 (Byram 1959, applied to total HFI)
console.log('\n── TFC / HFI / flame length chain ──');
{
  const TOL = 0.001;

  // C2 active crown — full crown contribution: TFC = SFC + 1.0*CFL
  const c2 = FWI.calculateFBP('C2', 92, 80, 400, 30, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
  const cfl_c2 = 0.80; // C2 CFL from FUEL_TYPES
  const tfc_c2 = c2.sfc + c2.cfb * cfl_c2;
  const hfi_c2 = 300 * c2.tfc * c2.ros;
  const fl_c2  = 0.0775 * Math.pow(c2.hfi, 0.46);
  const tfc_ok = Math.abs(c2.tfc - tfc_c2) < TOL;
  const hfi_ok = Math.abs(c2.hfi - hfi_c2) < 0.1;
  const fl_ok  = Math.abs(c2.flameLength - fl_c2) < TOL;
  console.log(`  ${tfc_ok ? 'PASS' : 'FAIL'}  C2 TFC=SFC+CFB·CFL: ${c2.tfc.toFixed(4)} (Eq.66a/67)`);
  if (tfc_ok) pass++; else { issues.push(`  C2 TFC mismatch: got ${c2.tfc} expected ${tfc_c2}`); fail++; }
  console.log(`  ${hfi_ok ? 'PASS' : 'FAIL'}  C2 HFI=300·TFC·ROS: ${c2.hfi.toFixed(1)} kW/m (Eq.69)`);
  if (hfi_ok) pass++; else { issues.push(`  C2 HFI mismatch: got ${c2.hfi} expected ${hfi_c2}`); fail++; }
  console.log(`  ${fl_ok  ? 'PASS' : 'FAIL'}  C2 FL=0.0775·HFI^0.46: ${c2.flameLength.toFixed(4)} m (Byram 1959)`);
  if (fl_ok)  pass++; else { issues.push(`  C2 FL mismatch: got ${c2.flameLength} expected ${fl_c2}`); fail++; }

  // D1 surface fire — cfb=0 so CFC=0, TFC=SFC
  const d1 = FWI.calculateFBP('D1', 85, 40, 200, 20, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
  const d1_tfc_ok = Math.abs(d1.tfc - d1.sfc) < TOL;
  console.log(`  ${d1_tfc_ok ? 'PASS' : 'FAIL'}  D1 TFC=SFC (no crown, cfb=0): tfc=${d1.tfc.toFixed(4)} sfc=${d1.sfc.toFixed(4)}`);
  if (d1_tfc_ok) pass++; else { issues.push(`  D1 TFC should equal SFC, got tfc=${d1.tfc} sfc=${d1.sfc}`); fail++; }

  // C6 passive crown — TFC = SFC + CFB·1.80
  const c6 = FWI.calculateFBP('C6', 90, 60, 300, 25, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
  const cfl_c6 = 1.80;
  const tfc_c6exp = c6.sfc + c6.cfb * cfl_c6;
  const c6_ok = Math.abs(c6.tfc - tfc_c6exp) < TOL;
  console.log(`  ${c6_ok ? 'PASS' : 'FAIL'}  C6 TFC=SFC+CFB·1.80: ${c6.tfc.toFixed(4)} (cfb=${c6.cfb.toFixed(4)})`);
  if (c6_ok) pass++; else { issues.push(`  C6 TFC mismatch: got ${c6.tfc} expected ${tfc_c6exp}`); fail++; }

  // C6 SFI = 300·SFC·RSS (surface-only intensity, uses RSS not blended ROS — Eq.63+54)
  // RSS is not exposed; reconstruct from returned ISI/BUI using Eq.62 + Eq.54
  {
    const rsi_c6 = 30 * Math.pow(1 - Math.exp(-0.08 * c6.isi), 3);  // C6 Eq.62
    const BE_c6  = Math.exp(50 * Math.log(0.80) * (1 / c6.bui - 1 / 62));  // Eq.54 q=0.80 bui0=62
    const rss_c6 = rsi_c6 * BE_c6;
    const sfi_c6_exp = 300 * c6.sfc * rss_c6;
    const sfi_c6_ok  = Math.abs(c6.sfi - sfi_c6_exp) < TOL;
    console.log(`  ${sfi_c6_ok ? 'PASS' : 'FAIL'}  C6 SFI=300·SFC·RSS (passive, cfb=${c6.cfb.toFixed(4)}): ${c6.sfi.toFixed(4)} vs ${sfi_c6_exp.toFixed(4)}`);
    if (sfi_c6_ok) pass++; else { issues.push(`  C6 SFI mismatch: got ${c6.sfi} expected ${sfi_c6_exp}`); fail++; }
    // SFI < HFI when crown is burning — blended ROS (Eq.65) > RSS
    const sfi_lt_hfi_ok = c6.sfi < c6.hfi;
    console.log(`  ${sfi_lt_hfi_ok ? 'PASS' : 'FAIL'}  C6 passive: SFI=${c6.sfi.toFixed(1)} < HFI=${c6.hfi.toFixed(1)} (crown contribution raises total intensity)`);
    if (sfi_lt_hfi_ok) pass++; else { issues.push(`  C6 SFI should be < HFI when crown burning`); fail++; }
  }

  // C7 active crown — TFC / HFI / FL chain (CFL=0.50 for C7)
  {
    const c7 = FWI.calculateFBP('C7', 91, 100, 500, 45, 0, 100, 50, { lat: 53.5, lng: -113.5, doy: 184 });
    const cfl_c7 = 0.50;
    const tfc_c7exp = c7.sfc + c7.cfb * cfl_c7;
    const hfi_c7exp = 300 * c7.tfc * c7.ros;
    const fl_c7exp  = 0.0775 * Math.pow(c7.hfi, 0.46);
    const tfc_c7_ok = Math.abs(c7.tfc - tfc_c7exp) < TOL;
    const hfi_c7_ok = Math.abs(c7.hfi - hfi_c7exp) < 0.1;
    const fl_c7_ok  = Math.abs(c7.flameLength - fl_c7exp) < TOL;
    console.log(`  ${tfc_c7_ok ? 'PASS' : 'FAIL'}  C7 TFC=SFC+CFB·0.50: ${c7.tfc.toFixed(6)} (cfb=${c7.cfb.toFixed(4)})`);
    if (tfc_c7_ok) pass++; else { issues.push(`  C7 TFC mismatch: got ${c7.tfc} expected ${tfc_c7exp}`); fail++; }
    console.log(`  ${hfi_c7_ok ? 'PASS' : 'FAIL'}  C7 HFI=300·TFC·ROS: ${c7.hfi.toFixed(1)} kW/m`);
    if (hfi_c7_ok) pass++; else { issues.push(`  C7 HFI mismatch: got ${c7.hfi} expected ${hfi_c7exp}`); fail++; }
    console.log(`  ${fl_c7_ok  ? 'PASS' : 'FAIL'}  C7 FL=0.0775·HFI^0.46: ${c7.flameLength.toFixed(6)} m`);
    if (fl_c7_ok)  pass++; else { issues.push(`  C7 FL mismatch: got ${c7.flameLength} expected ${fl_c7exp}`); fail++; }
  }

  // Byram formula standalone spot-checks (formula: 0.0775 * HFI^0.46)
  const BYRAM_CASES = [
    [100,   0.6446,  'Low intensity (100 kW/m)'],
    [500,   1.3515,  'Moderate intensity (500 kW/m)'],
    [2000,  2.5573,  'High intensity (2000 kW/m)'],
    [10000, 5.3617,  'Extreme intensity (10000 kW/m)'],
  ];
  for (const [hfi, expected, note] of BYRAM_CASES) {
    const got = 0.0775 * Math.pow(hfi, 0.46);
    const ok  = Math.abs(got - expected) < TOL;
    const tag = ok ? 'PASS' : 'FAIL';
    console.log(`  ${tag}  Byram HFI=${hfi.toString().padStart(6)} → FL=${got.toFixed(4)} m  (${note})`);
    if (ok) pass++; else { issues.push(`  Byram FAIL: HFI=${hfi} got ${got.toFixed(4)} expected ${expected}`); fail++; }
  }

  // HFI=0 guard — engine should return 0 (no division by zero, no NaN)
  const o1a_calm = FWI.calculateFBP('O1a', 65, 10, 50, 0, 0, 50, 50, { lat: 53.5, lng: -113.5, doy: 184 });
  const fl_zero_ok = !isNaN(o1a_calm.flameLength) && o1a_calm.flameLength >= 0;
  console.log(`  ${fl_zero_ok ? 'PASS' : 'FAIL'}  HFI near-zero → FL=${o1a_calm.flameLength.toFixed(4)} (no NaN)`);
  if (fl_zero_ok) pass++; else { issues.push(`  FL near-zero guard: got NaN/negative ${o1a_calm.flameLength}`); fail++; }
}

// ─── Slope effect, mixedwood blending, grass curing, D2 aspen ───────────────
// Slope (ST-X-3 Eq.39 approx): rsi *= min(exp(3.533*(slope/100)^1.2), 10)
// M1/M2 (Eq.27/28, GLC-X-10): RSI = pc/100*C2_RSI + hwFactor*(100-pc)/100*D1_RSI
// O1a/b curing (GLC-X-10 Eq.35b): CF breakpoint at cc=58.8
// D2 (GLC-X-10): ros=0 below BUI 80, ros=0.2*D1 above
console.log('\n── Slope / mixedwood / curing / D2 ──');
{
  const TOL = 0.0001;
  const _isi = sandbox._isi;
  const rsiB  = sandbox._rsiBasic;
  const _be   = sandbox._buildupEffect;

  // ── Slope ──────────────────────────────────────────────────────────────────
  const s0  = FWI.calculateFBP('C2', 88, 60, 300, 20, 0,   100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const s30 = FWI.calculateFBP('C2', 88, 60, 300, 20, 30,  100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const s70 = FWI.calculateFBP('C2', 88, 60, 300, 20, 70,  100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const s100= FWI.calculateFBP('C2', 88, 60, 300, 20, 100, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const sf30  = Math.exp(3.533 * Math.pow(0.30, 1.2));        // ~2.3004
  const sf70c = 10;                                            // capped
  const ratio30 = s30.ros / s0.ros;
  const ratio70 = s70.ros / s0.ros;
  const ratio100= s100.ros / s0.ros;
  let ok;
  ok = Math.abs(ratio30 - sf30) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  slope=30: ROS factor=${ratio30.toFixed(6)} (expected ${sf30.toFixed(6)})`);
  if (ok) pass++; else { issues.push(`  slope=30 factor wrong: got ${ratio30} expected ${sf30}`); fail++; }
  ok = Math.abs(ratio70 - sf70c) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  slope=70: factor=${ratio70.toFixed(4)} (capped at 10.0)`);
  if (ok) pass++; else { issues.push(`  slope=70 cap wrong: got ${ratio70} expected 10`); fail++; }
  ok = Math.abs(ratio100 - sf70c) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  slope=100: factor=${ratio100.toFixed(4)} (still capped at 10.0)`);
  if (ok) pass++; else { issues.push(`  slope=100 cap wrong: got ${ratio100} expected 10`); fail++; }

  // ── M1/M2 blending ────────────────────────────────────────────────────────
  const isi20 = _isi(88, 20);
  const bui80 = s0.bui;                                 // bui from dmc=60,dc=300 → 80
  const rC2 = rsiB('C2', isi20);
  const rD1 = rsiB('D1', isi20);
  const beM1 = _be('M1', bui80);
  const m1 = FWI.calculateFBP('M1', 88, 60, 300, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const m2 = FWI.calculateFBP('M2', 88, 60, 300, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const m2_0 = FWI.calculateFBP('M2', 88, 60, 300, 20, 0, 100, 0,  { lat:53.5, lng:-113.5, doy:184 });
  const m1_0 = FWI.calculateFBP('M1', 88, 60, 300, 20, 0, 100, 0,  { lat:53.5, lng:-113.5, doy:184 });
  // Eq.27/28: M1 RSI = pc/100*C2 + 1.0*(100-pc)/100*D1; M2: hwFactor=0.2
  const m1_ros_exp = (0.5*rC2 + 0.5*rD1) * beM1;
  const m2_ros_exp = (0.5*rC2 + 0.2*0.5*rD1) * _be('M2', bui80);
  ok = Math.abs(m1.ros - m1_ros_exp) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  M1 pc=50 blend: ros=${m1.ros.toFixed(6)} (expected ${m1_ros_exp.toFixed(6)})`);
  if (ok) pass++; else { issues.push(`  M1 pc=50 blend mismatch: got ${m1.ros} exp ${m1_ros_exp}`); fail++; }
  ok = Math.abs(m2.ros - m2_ros_exp) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  M2 pc=50 blend (hwFactor=0.2): ros=${m2.ros.toFixed(6)} (expected ${m2_ros_exp.toFixed(6)})`);
  if (ok) pass++; else { issues.push(`  M2 pc=50 blend mismatch: got ${m2.ros} exp ${m2_ros_exp}`); fail++; }
  // M2/M1 at pc=0: ratio should be exactly 0.2 (pure hardwood, M2 green suppression)
  ok = Math.abs(m2_0.ros / m1_0.ros - 0.2) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  M2/M1 ratio at pc=0 = ${(m2_0.ros/m1_0.ros).toFixed(4)} (expect 0.2)`);
  if (ok) pass++; else { issues.push(`  M2/M1 pc=0 ratio: got ${m2_0.ros/m1_0.ros} expected 0.2`); fail++; }

  // ── Grass curing O1a (GLC-X-10 Eq.35b) ──────────────────────────────────
  const isi15 = _isi(88, 15);
  const rsiO1a = rsiB('O1a', isi15);
  const o1a_0   = FWI.calculateFBP('O1a', 88, 50, 250, 15, 0, 0,   50, { lat:53.5, lng:-113.5, doy:184 });
  const o1a_50  = FWI.calculateFBP('O1a', 88, 50, 250, 15, 0, 50,  50, { lat:53.5, lng:-113.5, doy:184 });
  const o1a_100 = FWI.calculateFBP('O1a', 88, 50, 250, 15, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const cf50  = 0.005 * (Math.exp(0.061 * 50) - 1);  // below breakpoint 58.8
  ok = o1a_0.ros < 0.001;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  O1a curing=0: ros≈0 (got ${o1a_0.ros.toFixed(6)})`);
  if (ok) pass++; else { issues.push(`  O1a curing=0 should be ~0, got ${o1a_0.ros}`); fail++; }
  ok = Math.abs(o1a_50.ros - rsiO1a * cf50) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  O1a curing=50: ros=${o1a_50.ros.toFixed(6)} (CF=${cf50.toFixed(6)}·RSI)`);
  if (ok) pass++; else { issues.push(`  O1a curing=50: got ${o1a_50.ros} expected ${rsiO1a*cf50}`); fail++; }
  ok = Math.abs(o1a_100.ros - rsiO1a) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  O1a curing=100: CF=1.0, ros=rsiBasic=${o1a_100.ros.toFixed(6)}`);
  if (ok) pass++; else { issues.push(`  O1a curing=100: got ${o1a_100.ros} expected ${rsiO1a}`); fail++; }

  // ── Grass curing O1b (same CF formula; O1b q=1.00 bui0=1 → BE=1, ros=RSI·CF) ──
  // Verifies the GLC-X-10 curing branch covers both O1a and O1b, and that the
  // upper branch (cc≥58.8 → CF=0.176+0.02·(cc−58.8)) is reached through O1b.
  {
    const rsiO1b_15 = rsiB('O1b', isi15);  // wind=15, same ISI as O1a tests
    const o1b_0   = FWI.calculateFBP('O1b', 88, 50, 250, 15, 0, 0,    50, { lat:53.5, lng:-113.5, doy:184 });
    const o1b_58  = FWI.calculateFBP('O1b', 88, 50, 250, 15, 0, 58.8, 50, { lat:53.5, lng:-113.5, doy:184 });
    const o1b_100 = FWI.calculateFBP('O1b', 88, 50, 250, 15, 0, 100,  50, { lat:53.5, lng:-113.5, doy:184 });
    // CF at breakpoint 58.8 (upper branch): 0.176 + 0.02*(58.8−58.8) = 0.176
    const cf_58 = 0.176;
    // CF at 100% (upper branch): 0.176 + 0.02*(100−58.8) = 1.0 exactly
    const cf_100 = 0.176 + 0.02 * (100 - 58.8);

    ok = o1b_0.ros < 0.001;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  O1b curing=0: ros≈0 (got ${o1b_0.ros.toFixed(6)})`);
    if (ok) pass++; else { issues.push(`  O1b curing=0 should be ~0, got ${o1b_0.ros}`); fail++; }

    ok = Math.abs(o1b_58.ros - rsiO1b_15 * cf_58) < TOL;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  O1b curing=58.8 (upper branch CF=0.176): ros=${o1b_58.ros.toFixed(6)} (exp ${(rsiO1b_15*cf_58).toFixed(6)})`);
    if (ok) pass++; else { issues.push(`  O1b curing=58.8: got ${o1b_58.ros} expected ${rsiO1b_15*cf_58}`); fail++; }

    ok = Math.abs(o1b_100.ros - rsiO1b_15 * cf_100) < TOL;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  O1b curing=100: CF=1.0 (${cf_100.toFixed(4)}), ros=${o1b_100.ros.toFixed(6)} vs rsiBasic=${rsiO1b_15.toFixed(6)}`);
    if (ok) pass++; else { issues.push(`  O1b curing=100: got ${o1b_100.ros} expected ${rsiO1b_15*cf_100}`); fail++; }
  }

  // ── D2 green aspen (GLC-X-10) ────────────────────────────────────────────
  const d2_lo = FWI.calculateFBP('D2', 85, 20, 100, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const d2_hi = FWI.calculateFBP('D2', 92, 80, 400, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const d1_hi = FWI.calculateFBP('D1', 92, 80, 400, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  ok = d2_lo.ros < 0.001;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  D2 BUI=${d2_lo.bui.toFixed(1)}<80: ros≈0 (got ${d2_lo.ros.toFixed(6)})`);
  if (ok) pass++; else { issues.push(`  D2 below BUI80 should be ~0, got ${d2_lo.ros}`); fail++; }
  ok = Math.abs(d2_hi.ros / d1_hi.ros - 0.2) < TOL;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  D2/D1 ratio at BUI=${d2_hi.bui.toFixed(1)}>80 = ${(d2_hi.ros/d1_hi.ros).toFixed(4)} (expect 0.2)`);
  if (ok) pass++; else { issues.push(`  D2/D1 ratio: got ${d2_hi.ros/d1_hi.ros} expected 0.2`); fail++; }
}

// ─── M3/M4 dead balsam fir blend + C6 two-equation system ───────────────────
// M3/M4 (GLC-X-10 Eqs.29-33): RSI = pdf/100*rsiSelf + hwFactor*(1-pdf/100)*rsiD1
//   hwFactor=1.0 for M3 (leafless), 0.2 for M4 (green)
// C6 (ST-X-3 Eqs.61-65): rsi=30*(1−e^{−0.08·ISI})^3; ros blends RSS and RSC
console.log('\n── M3/M4 blend + C6 two-equation ──');
{
  const TOL    = 0.0001;
  const isi20  = sandbox._isi(88, 20);
  const isi40  = sandbox._isi(92, 40);
  const rsiB   = sandbox._rsiBasic;
  const _be    = sandbox._buildupEffect;
  const bui80  = FWI.calculateFBP('C2', 88, 60, 300, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 }).bui;
  const fmc    = FWI.calcFMC(53.5, -113.5, 184);

  // ── M3 (pdf=35 default): RSI = 35%*M3 + 65%*D1 ──────────────────────────
  const pdf  = 35;
  const rM3  = rsiB('M3', isi20), rD1 = rsiB('D1', isi20);
  const m3_rsi_exp = pdf/100 * rM3 + 1.0 * (1 - pdf/100) * rD1;
  const m3_ros_exp = m3_rsi_exp * _be('M3', bui80);
  const m3 = FWI.calculateFBP('M3', 88, 60, 300, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  let ok = Math.abs(m3.ros - m3_ros_exp) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  M3 pdf=35 blend: ros=${m3.ros.toFixed(6)} (expected ${m3_ros_exp.toFixed(6)})`);
  if (ok) pass++; else { issues.push(`  M3 pdf=35 mismatch: got ${m3.ros} exp ${m3_ros_exp}`); fail++; }

  // ── M4 (pdf=35): hwFactor=0.2 for D1 share ────────────────────────────────
  const m4_rsi_exp = pdf/100 * rsiB('M4', isi20) + 0.2 * (1 - pdf/100) * rD1;
  const m4_ros_exp = m4_rsi_exp * _be('M4', bui80);
  const m4 = FWI.calculateFBP('M4', 88, 60, 300, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  ok = Math.abs(m4.ros - m4_ros_exp) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  M4 pdf=35 blend (hwFactor=0.2): ros=${m4.ros.toFixed(6)} (expected ${m4_ros_exp.toFixed(6)})`);
  if (ok) pass++; else { issues.push(`  M4 pdf=35 mismatch: got ${m4.ros} exp ${m4_ros_exp}`); fail++; }

  // ── M4/M3 ratio at pdf=0 (pure hardwood D1): must be 0.2 ─────────────────
  const m3_p0 = FWI.calculateFBP('M3', 88, 60, 300, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184, pdf:0 });
  const m4_p0 = FWI.calculateFBP('M4', 88, 60, 300, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184, pdf:0 });
  ok = Math.abs(m4_p0.ros / m3_p0.ros - 0.2) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  M4/M3 ratio at pdf=0 = ${(m4_p0.ros/m3_p0.ros).toFixed(4)} (expect 0.2)`);
  if (ok) pass++; else { issues.push(`  M4/M3 pdf=0 ratio: got ${m4_p0.ros/m3_p0.ros} expected 0.2`); fail++; }

  // ── C6 Eq.62: RSI = 30·(1−e^{−0.08·ISI})^3 ──────────────────────────────
  const c6_rsi_exp = 30 * Math.pow(1 - Math.exp(-0.08 * isi20), 3);
  const be_c6 = _be('C6', bui80);
  const c6_mod = FWI.calculateFBP('C6', 88, 60, 300, 20, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  // At moderate conditions RSS < RSO → cfb=0, ros=rss=rsi*BE
  ok = Math.abs(c6_mod.ros - c6_rsi_exp * be_c6) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  C6 Eq.62 RSS surface: ros=${c6_mod.ros.toFixed(6)} (Eq.62·BE=${(c6_rsi_exp*be_c6).toFixed(6)})`);
  if (ok) pass++; else { issues.push(`  C6 Eq.62 surface mismatch: got ${c6_mod.ros} exp ${c6_rsi_exp*be_c6}`); fail++; }
  ok = c6_mod.cfb === 0 && c6_mod.fireType === 'Surface';
  console.log(`  ${ok?'PASS':'FAIL'}  C6 moderate: RSS<RSO → cfb=0 Surface (cfb=${c6_mod.cfb} rso=${c6_mod.rso.toFixed(3)})`);
  if (ok) pass++; else { issues.push(`  C6 moderate should be Surface cfb=0, got cfb=${c6_mod.cfb} ${c6_mod.fireType}`); fail++; }

  // ── C6 Eq.65: ros = rss + cfb·(rsc−rss) under active crown ──────────────
  const c6_ex = FWI.calculateFBP('C6', 92, 80, 400, 40, 0, 100, 50, { lat:53.5, lng:-113.5, doy:184 });
  const rsi_c6_ex = 30 * Math.pow(1 - Math.exp(-0.08 * isi40), 3);
  const rss_ex = rsi_c6_ex * _be('C6', c6_ex.bui);
  const fme_ex = Math.pow(1.5 - 0.00275 * fmc, 4) / (460 + 25.9 * fmc) * 1000;
  const rsc_ex = 60 * (1 - Math.exp(-0.0497 * isi40)) * fme_ex / 0.778;
  const ros_exp_ex = rss_ex + c6_ex.cfb * (rsc_ex - rss_ex);
  ok = Math.abs(c6_ex.ros - ros_exp_ex) < 0.001;
  console.log(`  ${ok?'PASS':'FAIL'}  C6 Eq.65 active crown blend: ros=${c6_ex.ros.toFixed(4)} (rss+cfb·Δrsc=${ros_exp_ex.toFixed(4)}) cfb=${c6_ex.cfb.toFixed(4)}`);
  if (ok) pass++; else { issues.push(`  C6 Eq.65 mismatch: got ${c6_ex.ros} exp ${ros_exp_ex}`); fail++; }
  ok = c6_ex.cfb >= 0.9 && c6_ex.fireType === 'Active Crown';
  console.log(`  ${ok?'PASS':'FAIL'}  C6 extreme: RSC>RSS>RSO → Active Crown (cfb=${c6_ex.cfb.toFixed(4)})`);
  if (ok) pass++; else { issues.push(`  C6 extreme should be Active Crown, got cfb=${c6_ex.cfb} ${c6_ex.fireType}`); fail++; }
}

// ─── _calcFireArea60 (elliptical fire growth) ────────────────────────────────
// LB = 1 + 8.729·(1−e^{−0.030·W})^{2.155}  (length-to-breadth ratio)
// A60 = π·(ROS·60·1.05)² / (4·LB·10000)    (hectares)
// Guard: ros≤0 or null → 0. W=0 → LB=1 (circular). A ∝ ROS².
console.log('\n── _calcFireArea60 (elliptical fire growth) ──');
{
  const TOL = 0.001;
  const calcArea = sandbox._calcFireArea60;

  // Guard cases
  for (const [ros, w, note] of [[0, 20, 'ros=0'], [-1, 20, 'ros<0'], [null, 20, 'ros=null']]) {
    const got = calcArea(ros, w);
    const ok  = got === 0;
    console.log(`  ${ok?'PASS':'FAIL'}  ${note} → ${got} (expect 0)`);
    if (ok) pass++; else { issues.push(`  _calcFireArea60 guard: ${note} got ${got}`); fail++; }
  }

  // W=0: LB=1 (circular fire), formula self-check
  const ros10_w0 = calcArea(10, 0);
  const d0 = 10 * 60 * 1.05;
  const a0_exp = Math.PI * d0 * d0 / (4 * 1 * 10000);
  let ok = Math.abs(ros10_w0 - a0_exp) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  W=0 LB=1 (circular): A60=${ros10_w0.toFixed(4)} ha (π·d²/40000=${a0_exp.toFixed(4)})`);
  if (ok) pass++; else { issues.push(`  _calcFireArea60 W=0: got ${ros10_w0} exp ${a0_exp}`); fail++; }

  // Reference case: C2 ROS=28 m/min, W=20 → ~95.07 ha (Alberta FSB reference ~96 ha)
  const a_ref = calcArea(28, 20);
  const lb20  = 1 + 8.729 * Math.pow(1 - Math.exp(-0.030 * 20), 2.155);
  const d20   = 28 * 60 * 1.05;
  const a20_exp = Math.PI * d20 * d20 / (4 * lb20 * 10000);
  ok = Math.abs(a_ref - a20_exp) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  C2 ref ROS=28 W=20: A60=${a_ref.toFixed(4)} ha (formula=${a20_exp.toFixed(4)}, LB=${lb20.toFixed(4)})`);
  if (ok) pass++; else { issues.push(`  _calcFireArea60 ref case: got ${a_ref} exp ${a20_exp}`); fail++; }

  // Area ∝ ROS² — at fixed W=20, doubling ROS should quadruple area
  const a10 = calcArea(10, 20);
  const a20 = calcArea(20, 20);
  const a40 = calcArea(40, 20);
  const r1 = a20 / a10;
  const r2 = a40 / a20;
  ok = Math.abs(r1 - 4.0) < 0.001 && Math.abs(r2 - 4.0) < 0.001;
  console.log(`  ${ok?'PASS':'FAIL'}  A ∝ ROS²: (ROS20/ROS10)=${r1.toFixed(4)} (ROS40/ROS20)=${r2.toFixed(4)} (both ~4.0)`);
  if (ok) pass++; else { issues.push(`  _calcFireArea60 ROS² scaling: r1=${r1} r2=${r2}`); fail++; }

  // Higher wind → smaller area (elongated ellipse, same ROS=28)
  const a_w0  = calcArea(28, 0);
  const a_w40 = calcArea(28, 40);
  const lb40  = 1 + 8.729 * Math.pow(1 - Math.exp(-0.030 * 40), 2.155);
  const ratio_exp = 1 / lb40;   // A ∝ 1/LB at fixed ROS
  const ratio_got = a_w40 / a_w0;
  ok = Math.abs(ratio_got - ratio_exp) < 0.0001;
  console.log(`  ${ok?'PASS':'FAIL'}  W=40 elongation: A_w40/A_w0=${ratio_got.toFixed(4)} (=1/LB40=${ratio_exp.toFixed(4)})`);
  if (ok) pass++; else { issues.push(`  _calcFireArea60 W=40 elongation: got ${ratio_got} exp ${ratio_exp}`); fail++; }

  // LB spot-check at W=60 — verifies formula coefficients
  const a_w60 = calcArea(28, 60);
  const lb60  = 1 + 8.729 * Math.pow(1 - Math.exp(-0.030 * 60), 2.155);
  const a_w60_exp = Math.PI * d20 * d20 / (4 * lb60 * 10000);
  ok = Math.abs(a_w60 - a_w60_exp) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  W=60 LB=${lb60.toFixed(4)}: A60=${a_w60.toFixed(4)} ha (expected ${a_w60_exp.toFixed(4)})`);
  if (ok) pass++; else { issues.push(`  _calcFireArea60 W=60: got ${a_w60} exp ${a_w60_exp}`); fail++; }
}

// ─── Utility functions ────────────────────────────────────────────────────────
// windCompass, compassDir, dangerRating, dangerClassNum, hfiClassInfo,
// _hfiClass, _stationSector, trendLabel, applyDCFloor
{
  console.log('\n── Utility functions ──');

  // windCompass — 16-pt compass with Unicode arrow + degrees
  const wc = sandbox.windCompass;
  const wcCases = [
    [0,     '↓ N (0°)'],
    [22.5,  '↓ NNE (23°)'],
    [45,    '↙ NE (45°)'],
    [90,    '← E (90°)'],
    [135,   '↖ SE (135°)'],
    [180,   '↑ S (180°)'],
    [270,   '→ W (270°)'],
    [315,   '↘ NW (315°)'],
    [337.5, '↓ NNW (338°)'],
    [null,  ''],
  ];
  for (const [deg, exp] of wcCases) {
    const got = wc(deg);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  windCompass(${deg}) → "${got}" (exp "${exp}")`);
    if (ok) pass++; else { issues.push(`windCompass(${deg}): got "${got}" exp "${exp}"`); fail++; }
  }

  // compassDir — 16-pt compass label only
  const cd = sandbox.compassDir;
  const cdCases = [
    [0,   'N'],
    [45,  'NE'],
    [90,  'E'],
    [135, 'SE'],
    [180, 'S'],
    [225, 'SW'],
    [270, 'W'],
    [315, 'NW'],
    [null, '—'],
  ];
  for (const [deg, exp] of cdCases) {
    const got = cd(deg);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  compassDir(${deg}) → "${got}" (exp "${exp}")`);
    if (ok) pass++; else { issues.push(`compassDir(${deg}): got "${got}" exp "${exp}"`); fail++; }
  }

  // dangerRating — CWFIS FWI map thresholds 5.5 / 15.5 / 22.5 / 29.5
  const dr = sandbox.dangerRating;
  const drCases = [
    [0,    'Low'],
    [5,    'Low'],
    [5.5,  'Moderate'],
    [15,   'Moderate'],
    [15.5, 'High'],
    [22,   'High'],
    [22.5, 'Very High'],
    [29,   'Very High'],
    [29.5, 'Extreme'],
    [100,  'Extreme'],
  ];
  for (const [fwi, exp] of drCases) {
    const got = dr(fwi);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  dangerRating(${fwi}) → "${got}" (exp "${exp}")`);
    if (ok) pass++; else { issues.push(`dangerRating(${fwi}): got "${got}" exp "${exp}"`); fail++; }
  }

  // dangerClassNum — same thresholds, returns {num, label}
  const dcn = sandbox.dangerClassNum;
  const dcnCases = [
    [0,    {num:1, label:'Low'}],
    [5.5,  {num:2, label:'Moderate'}],
    [15.5, {num:3, label:'High'}],
    [22.5, {num:4, label:'Very High'}],
    [29.5, {num:5, label:'Extreme'}],
  ];
  for (const [fwi, exp] of dcnCases) {
    const got = dcn(fwi);
    const ok = got.num === exp.num && got.label === exp.label;
    console.log(`  ${ok?'PASS':'FAIL'}  dangerClassNum(${fwi}) → {num:${got.num}, label:"${got.label}"}`);
    if (ok) pass++; else { issues.push(`dangerClassNum(${fwi}): got num=${got.num} label="${got.label}"`); fail++; }
  }

  // hfiClassInfo — Byram HFI intensity class thresholds 10 / 500 / 2000 / 4000 / 10000
  const hci = sandbox.hfiClassInfo;
  const hciCases = [
    [0,     {num:1, label:'Low'}],
    [9.9,   {num:1, label:'Low'}],
    [10,    {num:2, label:'Moderate'}],
    [499,   {num:2, label:'Moderate'}],
    [500,   {num:3, label:'High'}],
    [1999,  {num:3, label:'High'}],
    [2000,  {num:4, label:'Very High'}],
    [3999,  {num:4, label:'Very High'}],
    [4000,  {num:5, label:'Extreme'}],
    [9999,  {num:5, label:'Extreme'}],
    [10000, {num:6, label:'Catastrophic'}],
    [50000, {num:6, label:'Catastrophic'}],
  ];
  for (const [hfi, exp] of hciCases) {
    const got = hci(hfi);
    const ok = got.num === exp.num && got.label === exp.label;
    console.log(`  ${ok?'PASS':'FAIL'}  hfiClassInfo(${hfi}) → num=${got.num} "${got.label}"`);
    if (ok) pass++; else { issues.push(`hfiClassInfo(${hfi}): got num=${got.num} label="${got.label}"`); fail++; }
  }

  // _hfiClass — short string label (used in station table)
  const hfcl = sandbox._hfiClass;
  const hfclCases = [
    [null,  '—'],
    [NaN,   '—'],
    [5,     '1-Low'],
    [10,    '2-Mod'],
    [500,   '3-High'],
    [2000,  '4-VH'],
    [4000,  '5-Ext'],
    [10000, '6-Cat'],
  ];
  for (const [hfi, exp] of hfclCases) {
    const got = hfcl(hfi);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  _hfiClass(${hfi}) → "${got}" (exp "${exp}")`);
    if (ok) pass++; else { issues.push(`_hfiClass(${hfi}): got "${got}" exp "${exp}"`); fail++; }
  }

  // _stationSector — latitude-based Alberta fire sector assignment
  const ss = sandbox._stationSector;
  const ssCases = [
    [57.0, 'Far North'],
    [56.5, 'Far North'],
    [55.0, 'North'],
    [54.5, 'North'],
    [53.5, 'Central'],
    [53.0, 'Central'],
    [52.0, 'Central-South'],
    [51.5, 'Central-South'],
    [50.0, 'South'],
  ];
  for (const [lat, exp] of ssCases) {
    const got = ss(lat);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  _stationSector(${lat}) → "${got}" (exp "${exp}")`);
    if (ok) pass++; else { issues.push(`_stationSector(${lat}): got "${got}" exp "${exp}"`); fail++; }
  }

  // trendLabel — FWI delta thresholds ±5
  const tl = sandbox.trendLabel;
  const tlCases = [
    [30, 20, 'ESCALATING'],   // Δ=+10
    [20, 14, 'ESCALATING'],   // Δ=+6
    [10, 20, 'IMPROVING'],    // Δ=−10
    [20, 26, 'IMPROVING'],    // Δ=−6
    [20, 15, 'STABLE'],       // Δ=+5 (not > 5)
    [20, 25, 'STABLE'],       // Δ=−5 (not < −5)
    [20, 20, 'STABLE'],       // Δ=0
  ];
  for (const [fwi, prev, exp] of tlCases) {
    const got = tl(fwi, prev);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  trendLabel(${fwi}, ${prev}) → "${got}"  Δ=${fwi-prev}`);
    if (ok) pass++; else { issues.push(`trendLabel(${fwi}, ${prev}): got "${got}" exp "${exp}"`); fail++; }
  }

  // applyDCFloor — always-safe cases (month-independent)
  const adf = sandbox.applyDCFloor;
  {
    // Outside AB bounds — never corrected
    const r = adf(30, 49.0, -124.0);
    const ok = r.dc === 30 && r.corrected === false;
    console.log(`  ${ok?'PASS':'FAIL'}  applyDCFloor: BC coast DC=30 → dc=${r.dc} corrected=${r.corrected} (exp 30, false)`);
    if (ok) pass++; else { issues.push(`applyDCFloor BC coast: dc=${r.dc} corrected=${r.corrected}`); fail++; }
  }
  {
    // DC above cold-start ceiling (60) — never corrected even in AB
    const r = adf(200, 53.5, -113.5);
    const ok = r.dc === 200 && r.corrected === false;
    console.log(`  ${ok?'PASS':'FAIL'}  applyDCFloor: Edmonton DC=200 (>ceiling) → dc=${r.dc} corrected=${r.corrected} (exp 200, false)`);
    if (ok) pass++; else { issues.push(`applyDCFloor Edmonton DC=200: dc=${r.dc}`); fail++; }
  }
  // Spring-window AB correction (months 3–6 MST)
  const mo = new Date(Date.now() - 7 * 3600000).getUTCMonth() + 1;
  if (mo >= 3 && mo <= 6) {
    {
      // Edmonton (lat=53.5, lon=−113.5) floor=300 in spring
      const r = adf(30, 53.5, -113.5);
      const ok = r.dc === 300 && r.corrected === true;
      console.log(`  ${ok?'PASS':'FAIL'}  applyDCFloor: Edmonton DC=30 spring(mo=${mo}) → dc=${r.dc} corrected=${r.corrected} (exp 300, true)`);
      if (ok) pass++; else { issues.push(`applyDCFloor Edmonton DC=30: dc=${r.dc} corrected=${r.corrected}`); fail++; }
    }
    {
      // SE prairies / Lethbridge (lat=49.5, lon=−112.8) floor=450
      const r = adf(50, 49.5, -112.8);
      const ok = r.dc === 450 && r.corrected === true;
      console.log(`  ${ok?'PASS':'FAIL'}  applyDCFloor: Lethbridge DC=50 spring(mo=${mo}) → dc=${r.dc} corrected=${r.corrected} (exp 450, true)`);
      if (ok) pass++; else { issues.push(`applyDCFloor Lethbridge DC=50: dc=${r.dc} corrected=${r.corrected}`); fail++; }
    }
  } else {
    console.log(`  SKIP  applyDCFloor spring correction (mo=${mo} outside spring window Mar–Jun)`);
  }
}

// ─── _hffmc — hourly FFMC reference values (Van Wagner 1977) ─────────────────
// The hourly FFMC feeds the 24-hour trend chart. These reference values anchor
// the Van Wagner (1977) coefficients (0.0579 drying rate, specific equilibria).
// Computed from the engine; any coefficient change breaks these tests.
{
  console.log('\n── _hffmc hourly FFMC reference values ──');
  const h = FWI._hffmc;
  const TOL = 0.0001;
  const HFFMC_CASES = [
    // [temp, rh, wind, rain, prevF, expected, label]
    // Drying branch (mo > ed): hot/dry/windy
    [30,  20, 25, 0,    70,   75.64134, 'drying: hot/dry/windy, low initial F'],
    [30,  20, 25, 0,    90,   91.28906, 'drying: hot/dry, high initial F'],
    // Wetting branch (mo < ew): cool/humid
    [10,  90,  5, 0,    85,   84.34614, 'wetting: cool/humid, high initial F'],
    [10,  90,  5, 0,    70,   70.23808, 'wetting: cool/humid, low initial (tiny change)'],
    // Rain correction path
    [18,  70, 10, 10,   88,   22.95715, 'rain 10mm: major suppression'],
    [18,  70, 10, 0.5,  88,   76.90560, 'trace rain 0.5mm: moderate drop'],
    // Near-equilibrium (small change expected)
    [20,  50, 15, 0,    82,   82.79151, 'near equilibrium: slight drying'],
    [25,  25, 20, 0,    85,   86.62542, 'Van Wagner conditions: slight drying'],
  ];

  for (const [temp, rh, wind, rain, prevF, expected, label] of HFFMC_CASES) {
    const got = h(temp, rh, wind, rain, prevF);
    const ok  = Math.abs(got - expected) <= TOL;
    console.log(`  ${ok?'PASS':'FAIL'}  ${label}`);
    console.log(`         prevF=${prevF} → F=${got.toFixed(5)} (expected ${expected.toFixed(5)})`);
    if (ok) pass++;
    else { fail++; issues.push(`_hffmc FAIL: ${label} got ${got.toFixed(5)} expected ${expected.toFixed(5)}`); }
  }

  // Property: 24 hourly steps under constant hot/dry conditions should give
  // a higher FFMC than one daily step (hourly integrates the drying curve more
  // finely; they're close but not identical).
  let f24 = 70;
  for (let i = 0; i < 24; i++) f24 = h(30, 20, 25, 0, f24);
  const daily70 = FWI.calculateFWI({ temp: 30, rh: 20, wind: 25, rain: 0, month: 6 },
                                    { ffmc: 70, dmc: 20, dc: 200 }).ffmc;
  const ok24 = f24 > 90 && f24 <= 101;
  console.log(`  ${ok24?'PASS':'FAIL'}  24 hourly steps from F=70: final=${f24.toFixed(2)} (daily step=${daily70.toFixed(2)}, expect >90)`);
  if (ok24) pass++; else { fail++; issues.push(`24 hourly steps: F=${f24.toFixed(2)} expected >90`); }
}

// ─── _normalizeFuelCode — user input parsing ─────────────────────────────────
{
  console.log('\n── _normalizeFuelCode ──');
  const nfc = sandbox._normalizeFuelCode;

  const nfcCases = [
    // Exact codes pass through
    ['C2',        'C2'],
    ['O1a',       'O1a'],
    ['O1b',       'O1b'],
    ['M1',        'M1'],
    ['S3',        'S3'],
    // Case-insensitive
    ['c2',        'C2'],
    ['o1A',       'O1a'],
    ['m3',        'M3'],
    // Hyphen stripping
    ['C-2',       'C2'],
    ['D-1',       'D1'],
    ['O-1a',      'O1a'],
    // Trailing /N suffix (WMS labels)
    ['O1a/100',   'O1a'],
    ['C2/50',     'C2'],
    // First token only (WMS label includes description)
    ['C2 Boreal Spruce',          'C2'],
    ['O1a Matted Grass',          'O1a'],
    ['D-1/D-2 Aspen',             'D1'],
    // Invalid / null / empty
    ['',          null],
    [null,        null],
    ['BOGUS',     null],
    ['X9',        null],
  ];

  for (const [raw, exp] of nfcCases) {
    const got = nfc(raw);
    const ok = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  _normalizeFuelCode("${raw}") → ${JSON.stringify(got)} (exp ${JSON.stringify(exp)})`);
    if (ok) pass++; else { issues.push(`_normalizeFuelCode("${raw}"): got ${got} exp ${exp}`); fail++; }
  }
}

// ─── _haversineKm — geographic distance ──────────────────────────────────────
{
  console.log('\n── _haversineKm ──');
  const hav = sandbox._haversineKm;

  // Same point → 0
  {
    const d = hav(53.5344, -113.4903, 53.5344, -113.4903);
    const ok = d < 0.001;
    console.log(`  ${ok?'PASS':'FAIL'}  same point → ${d.toFixed(6)} km (exp 0)`);
    if (ok) pass++; else { issues.push(`_haversineKm same point: ${d}`); fail++; }
  }

  const HAV_TOL = 0.001; // km — tighter than WGS-84 rounding
  // Edmonton (53.5344, -113.4903) to Calgary (51.0447, -114.0719)
  {
    const d = hav(53.5344, -113.4903, 51.0447, -114.0719);
    const ok = Math.abs(d - 279.6512) < HAV_TOL;
    console.log(`  ${ok?'PASS':'FAIL'}  Edmonton→Calgary → ${d.toFixed(4)} km (exp 279.6512)`);
    if (ok) pass++; else { issues.push(`_haversineKm Edm→Calgary: ${d.toFixed(4)} km`); fail++; }
  }

  // Symmetry: A→B == B→A
  {
    const d1 = hav(53.5344, -113.4903, 56.7264, -111.3803);  // Edmonton→Fort Mac
    const d2 = hav(56.7264, -111.3803, 53.5344, -113.4903);
    const symOk = Math.abs(d1 - d2) < 0.001;
    const expOk = Math.abs(d1 - 379.3888) < HAV_TOL;
    const ok = symOk && expOk;
    console.log(`  ${ok?'PASS':'FAIL'}  symmetry + Edm→FtMac=${d1.toFixed(4)} km (exp 379.3888, diff ${Math.abs(d1-d2).toFixed(6)})`);
    if (ok) pass++; else { issues.push(`_haversineKm Edm→FtMac: ${d1.toFixed(4)} km, symmetry diff ${Math.abs(d1-d2)}`); fail++; }
  }

  // Edmonton to Vancouver (long-haul cross-province check)
  {
    const d = hav(53.5344, -113.4903, 49.2827, -123.1207);
    const ok = Math.abs(d - 817.2304) < HAV_TOL;
    console.log(`  ${ok?'PASS':'FAIL'}  Edmonton→Vancouver → ${d.toFixed(4)} km (exp 817.2304)`);
    if (ok) pass++; else { issues.push(`_haversineKm Edm→Vancouver: ${d.toFixed(4)} km`); fail++; }
  }
}

// ─── calcMultiDay — FWI-only chain over multiple days ────────────────────────
{
  console.log('\n── calcMultiDay (FWI chain) ──');
  const cmd = sandbox.calcMultiDay;

  // 3-day chain: hot→rain→hot; verify state carries forward
  const DAYS = [
    { temp: 30, rh: 20, wind: 20, rain: 0,  month: 7, label: 'Day1-hot' },
    { temp: 14, rh: 90, wind: 5,  rain: 20, month: 7, label: 'Day2-rain' },
    { temp: 32, rh: 18, wind: 25, rain: 0,  month: 7, label: 'Day3-hot' },
  ];
  const startState = { ffmc: 85, dmc: 40, dc: 200 };
  let ok, r;

  try {
    const chain = cmd(DAYS, 300, startState);

    // Correct length
    ok = chain.length === 3;
    console.log(`  ${ok?'PASS':'FAIL'}  length=3: got ${chain.length}`);
    if (ok) pass++; else { issues.push(`calcMultiDay length: ${chain.length}`); fail++; }

    // Labels pass through
    ok = chain[0].label === 'Day1-hot' && chain[2].label === 'Day3-hot';
    console.log(`  ${ok?'PASS':'FAIL'}  labels pass-through: ["${chain[0].label}", "${chain[2].label}"]`);
    if (ok) pass++; else { issues.push(`calcMultiDay labels: ${chain[0].label}, ${chain[2].label}`); fail++; }

    // Hot day → FFMC rises from 85
    ok = chain[0].ffmc > startState.ffmc;
    console.log(`  ${ok?'PASS':'FAIL'}  Day1 FFMC rises on hot/dry: ${chain[0].ffmc?.toFixed(2)} (prev 85)`);
    if (ok) pass++; else { issues.push(`calcMultiDay Day1 FFMC: ${chain[0].ffmc}`); fail++; }

    // Rain day → FFMC drops from Day1
    ok = chain[1].ffmc < chain[0].ffmc;
    console.log(`  ${ok?'PASS':'FAIL'}  Day2 FFMC drops after rain: ${chain[1].ffmc?.toFixed(2)} (prev ${chain[0].ffmc?.toFixed(2)})`);
    if (ok) pass++; else { issues.push(`calcMultiDay Day2 FFMC rain: ${chain[1].ffmc}`); fail++; }

    // Day3 FFMC recovers above Day2
    ok = chain[2].ffmc > chain[1].ffmc;
    console.log(`  ${ok?'PASS':'FAIL'}  Day3 FFMC recovers after rain: ${chain[2].ffmc?.toFixed(2)} (prev ${chain[1].ffmc?.toFixed(2)})`);
    if (ok) pass++; else { issues.push(`calcMultiDay Day3 FFMC recover: ${chain[2].ffmc}`); fail++; }

    // All outputs have FWI/ISI/BUI
    ok = chain.every(d => typeof d.fwi === 'number' && !isNaN(d.fwi));
    console.log(`  ${ok?'PASS':'FAIL'}  all days have valid FWI: [${chain.map(d=>d.fwi?.toFixed(1)).join(', ')}]`);
    if (ok) pass++; else { issues.push(`calcMultiDay: NaN in FWI chain`); fail++; }

    // Exact reference values — pin the full chain state.
    // startState: {ffmc:85, dmc:40, dc:200} + weather above.
    // These values lock the Van Wagner equations — a coefficient change would break these.
    const CHAIN_REF = [
      { ffmc: 94.37535, dmc: 45.84322, dc: 209.10400, fwi: 40.84280, isi: 21.76507, bui: 59.22548 },
      { ffmc: 26.44158, dmc: 19.14689, dc: 167.41646, fwi:  0.00184, isi:  0.00157, bui: 29.77936 },
      { ffmc: 90.92878, dmc: 25.52135, dc: 176.88046, fwi: 28.25579, isi: 17.25580, bui: 37.51169 },
    ];
    const CHAIN_TOL = 0.001;
    for (const [i, ref] of CHAIN_REF.entries()) {
      const d = chain[i];
      const keys = Object.keys(ref);
      const allOk = keys.every(k => Math.abs((d[k] ?? NaN) - ref[k]) < CHAIN_TOL);
      const worst = keys.reduce((a, k) => Math.max(a, Math.abs((d[k] ?? NaN) - ref[k])), 0);
      console.log(`  ${allOk?'PASS':'FAIL'}  Day${i+1} exact: ffmc=${d.ffmc?.toFixed(3)} dmc=${d.dmc?.toFixed(3)} fwi=${d.fwi?.toFixed(3)} (worst Δ=${worst.toFixed(6)})`);
      if (allOk) pass++; else { issues.push(`calcMultiDay Day${i+1} exact mismatch: worst Δ=${worst}`); fail++; }
    }

    // Null-safe defaults — pass a day with all nulls
    const nullDay = [{ temp: null, rh: null, wind: null, rain: null, month: null }];
    const nullChain = cmd(nullDay, 300, { ffmc: 85, dmc: 10, dc: 100 });
    ok = nullChain.length === 1 && typeof nullChain[0].fwi === 'number' && !isNaN(nullChain[0].fwi);
    console.log(`  ${ok?'PASS':'FAIL'}  null weather defaults: FWI=${nullChain[0]?.fwi?.toFixed(2)}`);
    if (ok) pass++; else { issues.push(`calcMultiDay null weather: ${nullChain[0]?.fwi}`); fail++; }

  } catch (e) {
    console.log(`  FAIL  calcMultiDay threw: ${e.message}`);
    issues.push(`calcMultiDay threw: ${e.message}`); fail++;
  }
}

// ─── AB getStartupDC — station-specific spring DC initialisation ──────────────
{
  console.log('\n── AB getStartupDC ──');
  const gsd = sandbox.getStartupDC;

  // One representative per distinct DC tier + fallback.
  // Southern AB carries higher overwinter DC; boreal refreshes more.
  const cases = [
    // tier 100 — far northern boreal
    ['Fort Chipewyan', 100],
    ['Fort Vermilion', 100],
    ['High Level',     100],
    // tier 130 — transition boreal
    ['Wabasca',        130],
    // tier 150 — central boreal / foothills
    ['Fort McMurray',  150],
    ['Athabasca',      150],
    ['Slave Lake',     150],
    ['Hinton',         150],
    ['Cold Lake',      150],
    // tier 175 — mountain/foothills
    ['Banff',          175],
    ['Jasper',         175],
    ['Grande Prairie', 175],
    // tier 200
    ['Peace River',    200],
    // tier 250
    ['Lloydminster',   250],
    // tier 275 — central AB
    ['Red Deer',       275],
    ['Camrose',        275],
    ['Elk Island Nat Park', 275],
    // tier 290 — Edmonton metro fringe
    ['Edmonton Stony Plain CS', 290],
    ['Edmonton Villeneuve',     290],
    // tier 300 — Edmonton core + fallback
    ['Edmonton',              300],
    ["Edmonton Int'l A",      300],
    ['Edmonton Blatchford',   300],
    // tier 375 — Calgary zone + foothills
    ['Calgary',        375],
    ['Claresholm',     375],
    ['Pincher Creek',  375],
    // tier 400
    ['Cardston',       400],
    // tier 425 — southern plains
    ['Lethbridge',     425],
    ['Brooks',         425],
    ['Drumheller',     425],
    // tier 450 — driest SE corner
    ['Medicine Hat',   450],
    // Unknown station falls back to 300
    ['UnknownStation', 300],
  ];
  for (const [name, exp] of cases) {
    const got = gsd(name);
    const ok  = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  getStartupDC("${name}") → ${got} (exp ${exp})`);
    if (ok) pass++; else { issues.push(`getStartupDC("${name}"): got ${got} exp ${exp}`); fail++; }
  }
}

// ─── _defaultFuelFor — latitude-based fuel type assignment ───────────────────
{
  console.log('\n── _defaultFuelFor ──');
  const dff = sandbox._defaultFuelFor;

  const cases = [
    // lat > 54.5 → boreal spruce
    [55.0, 'C2'],
    [58.0, 'C2'],
    [54.6, 'C2'],
    // lat > 52, ≤ 54.5 → deciduous aspen
    [53.5, 'D1'],
    [54.5, 'D1'],
    [52.1, 'D1'],
    // lat ≤ 52 → grass/matted
    [52.0, 'O1a'],
    [50.0, 'O1a'],
    [49.0, 'O1a'],
  ];
  for (const [lat, exp] of cases) {
    const got = dff(lat);
    const ok  = got === exp;
    console.log(`  ${ok?'PASS':'FAIL'}  _defaultFuelFor(${lat}) → "${got}" (exp "${exp}")`);
    if (ok) pass++; else { issues.push(`_defaultFuelFor(${lat}): got "${got}" exp "${exp}"`); fail++; }
  }
}

// ─── findNearestNAEFS — closest NAEFS station within 150 km ──────────────────
{
  console.log('\n── findNearestNAEFS ──');
  const fnn = sandbox.findNearestNAEFS;

  // Edmonton city centre → Edmonton Municipal A (≈3 km)
  {
    const st = fnn(53.5344, -113.4903);
    const ok = st !== null && st.name === 'Edmonton Municipal A';
    console.log(`  ${ok?'PASS':'FAIL'}  Edmonton → ${st?.name ?? 'null'} (exp "Edmonton Municipal A")`);
    if (ok) pass++; else { issues.push(`findNearestNAEFS Edmonton: ${st?.name}`); fail++; }
  }

  // Lethbridge → Lethbridge station (exact coords match)
  {
    const st = fnn(49.63, -112.80);
    const ok = st !== null && st.name === 'Lethbridge';
    console.log(`  ${ok?'PASS':'FAIL'}  Lethbridge → ${st?.name ?? 'null'} (exp "Lethbridge")`);
    if (ok) pass++; else { issues.push(`findNearestNAEFS Lethbridge: ${st?.name}`); fail++; }
  }

  // Fort McMurray → Fort McMurray station
  {
    const st = fnn(56.65, -111.22);
    const ok = st !== null && st.name === 'Fort McMurray';
    console.log(`  ${ok?'PASS':'FAIL'}  Fort McMurray → ${st?.name ?? 'null'} (exp "Fort McMurray")`);
    if (ok) pass++; else { issues.push(`findNearestNAEFS FtMac: ${st?.name}`); fail++; }
  }

  // Far outside Alberta (Toronto) → null (>150 km from all stations)
  {
    const st = fnn(43.65, -79.38);
    const ok = st === null;
    console.log(`  ${ok?'PASS':'FAIL'}  Toronto → ${st?.name ?? 'null'} (exp null — >150 km away)`);
    if (ok) pass++; else { issues.push(`findNearestNAEFS Toronto: expected null, got ${st?.name}`); fail++; }
  }

  // SE Saskatchewan (Regina) → check if within range; nearest should be Medicine Hat or null
  {
    const st = fnn(50.45, -104.62);
    // Regina is ~430 km from Medicine Hat → should be null
    const ok = st === null;
    console.log(`  ${ok?'PASS':'FAIL'}  Regina SK → ${st?.name ?? 'null'} (exp null — >150 km from AB)`);
    if (ok) pass++; else { issues.push(`findNearestNAEFS Regina: expected null, got ${st?.name}`); fail++; }
  }
}

// ─── ?stn= URL deep-link matching logic ──────────────────────────────────────
// Tests the station-name normalization used by buildStationPicker's URL param
// handler: case-insensitive, strips non-alphanumeric, priority exact>prefix>sub.
{
  console.log('\n── ?stn= URL deep-link station matching ──');

  // Replicate the matching logic from buildStationPicker
  function matchStn(query, stations = FWI.ALBERTA_STATIONS) {
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

  const stCases = [
    // Exact and prefix matches (AB)
    ['Lethbridge',    name => name.startsWith('Lethbridge')],
    ['McMurray',      name => name.includes('McMurray')],
    ['Calgary',       name => name.includes('Calgary')],
    ['Banff',         name => name.includes('Banff')],
    // Case-insensitive
    ['lethbridge',    name => name.toLowerCase().includes('lethbridge')],
    ['MCMURRAY',      name => name.toLowerCase().includes('mcmurray')],
    // Substring match
    ['blatchford',    name => name.toLowerCase().includes('blatchford')],
    // No match → null
    ['XYZ_NOMATCH',   null],
    ['',              null],
  ];

  for (const [query, predOrNull] of stCases) {
    const got = matchStn(query);
    let ok;
    if (predOrNull === null) {
      ok = got === null;
      console.log(`  ${ok?'PASS':'FAIL'}  matchStn("${query}") → ${got?.name ?? 'null'} (exp null)`);
    } else {
      ok = got !== null && predOrNull(got.name);
      console.log(`  ${ok?'PASS':'FAIL'}  matchStn("${query}") → "${got?.name ?? 'null'}"`);
    }
    if (ok) pass++; else { issues.push(`matchStn("${query}"): got "${got?.name}"`); fail++; }
  }
}

// ─── FUEL_PAIR_COMPLEMENT completeness ───────────────────────────────────────
{
  console.log('\n── FUEL_PAIR_COMPLEMENT completeness ──');
  const fpc = FWI.FUEL_PAIR_COMPLEMENT;
  const ft  = FWI.FUEL_TYPES;

  // Every key in FUEL_TYPES must have a complement entry
  for (const code of Object.keys(ft)) {
    const comp = fpc[code];
    const ok   = comp !== undefined;
    console.log(`  ${ok?'PASS':'FAIL'}  ${code} has complement → ${comp ?? '(missing)'}`);
    if (ok) pass++; else { issues.push(`FUEL_PAIR_COMPLEMENT missing ${code}`); fail++; }
  }

  // Every complement value must itself be a valid fuel type
  for (const [code, comp] of Object.entries(fpc)) {
    const ok = ft[comp] !== undefined;
    console.log(`  ${ok?'PASS':'FAIL'}  ${code}→${comp} is a valid fuel type`);
    if (ok) pass++; else { issues.push(`FUEL_PAIR_COMPLEMENT[${code}]="${comp}" not in FUEL_TYPES`); fail++; }
  }

  // M3↔M4 are dead-fir slash — must be each other's complement (not D1 default)
  const m3ok = fpc['M3'] === 'M4';
  const m4ok = fpc['M4'] === 'M3';
  console.log(`  ${m3ok?'PASS':'FAIL'}  M3 complement is M4 (got ${fpc['M3']})`);
  console.log(`  ${m4ok?'PASS':'FAIL'}  M4 complement is M3 (got ${fpc['M4']})`);
  if (m3ok) pass++; else { issues.push(`M3 complement wrong: ${fpc['M3']}`); fail++; }
  if (m4ok) pass++; else { issues.push(`M4 complement wrong: ${fpc['M4']}`); fail++; }

  // O1a↔O1b reciprocity
  const o1aok = fpc['O1a'] === 'O1b';
  const o1bok = fpc['O1b'] === 'O1a';
  console.log(`  ${o1aok?'PASS':'FAIL'}  O1a complement is O1b`);
  console.log(`  ${o1bok?'PASS':'FAIL'}  O1b complement is O1a`);
  if (o1aok) pass++; else { issues.push(`O1a complement wrong: ${fpc['O1a']}`); fail++; }
  if (o1bok) pass++; else { issues.push(`O1b complement wrong: ${fpc['O1b']}`); fail++; }

  // D1↔D2 reciprocity
  const d1ok = fpc['D1'] === 'D2';
  const d2ok = fpc['D2'] === 'D1';
  console.log(`  ${d1ok?'PASS':'FAIL'}  D1 complement is D2`);
  console.log(`  ${d2ok?'PASS':'FAIL'}  D2 complement is D1`);
  if (d1ok) pass++; else { issues.push(`D1 complement wrong: ${fpc['D1']}`); fail++; }
  if (d2ok) pass++; else { issues.push(`D2 complement wrong: ${fpc['D2']}`); fail++; }
}

// ─── calculateFBP BUI edge cases ─────────────────────────────────────────────
// When dmc=0 and dc=0, the inline BUI formula (0.8*0*0/(0+0)) = 0/0 = NaN
// before the guard was added. Regression test: results must be finite.
console.log('\n── calculateFBP BUI edge cases (dmc=dc=0 → non-NaN, BUI=500 → finite) ──');
{
  const OPT = { lat: 53.5, lng: -113.5, doy: 180 };

  // dmc=0, dc=0: degenerate spring startup — BUI must resolve to 0, not NaN
  for (const [fuel, label] of [['C2','Boreal Spruce'],['D1','Deciduous'],['C6','C6 two-eq'],['M1','Mixedwood']]) {
    const r = FWI.calculateFBP(fuel, 85, 0, 0, 20, 0, 100, 50, OPT);
    const ok = r !== null && isFinite(r.hfi) && isFinite(r.ros) && r.hfi >= 0 && r.ros >= 0;
    const lbl = `${fuel} ${label} dmc=0 dc=0`;
    console.log(`  ${ok?'PASS':'FAIL'}  ${lbl.padEnd(32)}  bui=${r?.bui?.toFixed(2)} hfi=${r?.hfi?.toFixed(3)}`);
    if (ok) pass++; else { issues.push(`calculateFBP ${fuel} dmc=dc=0: got hfi=${r?.hfi}`); fail++; }
  }

  // dmc=0, dc=200: partial zero — should also be safe (BUI formula uses only dmc)
  {
    const r = FWI.calculateFBP('C2', 85, 0, 200, 20, 0, 100, 50, OPT);
    const ok = r !== null && isFinite(r.hfi) && r.bui >= 0;
    console.log(`  ${ok?'PASS':'FAIL'}  C2 dmc=0 dc=200                  bui=${r?.bui?.toFixed(2)} hfi=${r?.hfi?.toFixed(3)}`);
    if (ok) pass++; else { issues.push(`calculateFBP C2 dmc=0 dc=200: got hfi=${r?.hfi}`); fail++; }
  }

  // BUI=500 extreme drought: all fields finite, HFI positive
  {
    const r = FWI.calculateFBP('C2', 92, 300, 800, 30, 0, 100, 50, OPT);
    const ok = r !== null && isFinite(r.hfi) && r.hfi > 0 && isFinite(r.ros) && r.bui < 800;
    console.log(`  ${ok?'PASS':'FAIL'}  C2 dmc=300 dc=800 (high drought)  bui=${r?.bui?.toFixed(2)} hfi=${r?.hfi?.toFixed(0)}`);
    if (ok) pass++; else { issues.push(`calculateFBP C2 high BUI: got hfi=${r?.hfi}`); fail++; }
  }
}

// ─── D2 BUI gate and M3/M4 pdf boundaries ────────────────────────────────────
// GLC-X-10 rules: D2 (green aspen) carries fire only at BUI ≥ 80 at 0.2×D1 rate;
// M4's D1 share is scaled by hwFactor=0.2 so M4_pdf=0 ≈ 0.2 × M3_pdf=0.
console.log('\n── D2 BUI gate and M3/M4 pdf boundaries ──');
{
  const OPT = { lat: 53.5, lng: -113.5, doy: 180 };
  const FBP_TOL = 0.001;

  // D2 BUI gate: GLC-X-10 — fire only at BUI ≥ 80
  // Use dc=500, dmc=200*target/(400-target) to hit exact target BUI
  for (const [targetBUI, expectFire] of [[79, false], [80, true]]) {
    const dmc = 200 * targetBUI / (400 - targetBUI);
    const r = FWI.calculateFBP('D2', 85, dmc, 500, 20, 0, 100, 50, OPT);
    const atFloor = r.ros <= 0.000002;
    const ok = expectFire ? !atFloor : atFloor;
    const lbl = `D2 BUI=${String(targetBUI).padEnd(2)} (actual=${r.bui?.toFixed(2)}) ${expectFire ? 'should carry' : 'should NOT carry'}`;
    console.log(`  ${ok?'PASS':'FAIL'}  ${lbl.padEnd(52)}  ros=${r.ros?.toFixed(6)} hfi=${r.hfi?.toFixed(4)}`);
    if (ok) pass++; else { issues.push(`D2 BUI=${targetBUI}: ros=${r.ros} expectFire=${expectFire}`); fail++; }
  }

  // D2 vs D1 at BUI=80: D2 should be ~0.2 × D1 (rsi branch only; SFC differs)
  {
    const d1 = FWI.calculateFBP('D1', 85, 50, 500, 20, 0, 100, 50, OPT);
    const d2 = FWI.calculateFBP('D2', 85, 50, 500, 20, 0, 100, 50, OPT);
    // bui≈80: D2 ros should be ~0.2×D1 ros (same SFC, hwFactor=0.2 on RSI)
    const ratio = d2.ros / d1.ros;
    const ok = Math.abs(ratio - 0.2) < 0.005;
    console.log(`  ${ok?'PASS':'FAIL'}  D2/D1 ROS ratio at BUI=80 → ${ratio.toFixed(4)} (expected ~0.2000)`);
    if (ok) pass++; else { issues.push(`D2/D1 ros ratio ${ratio.toFixed(4)} != 0.2`); fail++; }
  }

  // M3/M4 pdf boundaries: pdf=0 → pure D1 (M3) or 0.2×D1 (M4); pdf=100 → pure dead-fir
  const M3_PDF_CASES = [
    // [fuelCode, pdf, expectedROS, expectedHFI]
    ['M3', 0,    1.176177, 1061.172],
    ['M3', 35,   8.496309, 8192.524],
    ['M3', 100, 22.090839, 25171.793],
    ['M4', 0,    0.235235,   212.234],
    ['M4', 35,   3.878795,  3578.812],
    ['M4', 100, 10.645405, 11751.672],
  ];
  for (const [fuel, pdf, expROS, expHFI] of M3_PDF_CASES) {
    const r = FWI.calculateFBP(fuel, 85, 50, 500, 20, 0, 100, 50, {...OPT, pdf});
    const rosOk = Math.abs(r.ros - expROS) <= FBP_TOL;
    const hfiOk = Math.abs(r.hfi - expHFI) <= FBP_TOL;
    const ok = rosOk && hfiOk;
    console.log(`  ${ok?'PASS':'FAIL'}  ${fuel} pdf=${String(pdf).padEnd(3)}  ros=${r.ros?.toFixed(6)} (exp ${expROS})  hfi=${r.hfi?.toFixed(3)} (exp ${expHFI})`);
    if (ok) pass++;
    else {
      if (!rosOk) issues.push(`${fuel} pdf=${pdf}: ros=${r.ros?.toFixed(4)} exp ${expROS}`);
      if (!hfiOk) issues.push(`${fuel} pdf=${pdf}: hfi=${r.hfi?.toFixed(3)} exp ${expHFI}`);
      fail++;
    }
  }

  // Structural: M3 pdf=0 / M4 pdf=0 ROS ratio must be ~5.0 (hwFactor 1.0 vs 0.2)
  {
    const m3 = FWI.calculateFBP('M3', 85, 50, 500, 20, 0, 100, 50, {...OPT, pdf: 0});
    const m4 = FWI.calculateFBP('M4', 85, 50, 500, 20, 0, 100, 50, {...OPT, pdf: 0});
    const ratio = m3.ros / m4.ros;
    const ok = Math.abs(ratio - 5.0) < 0.01;
    console.log(`  ${ok?'PASS':'FAIL'}  M3/M4 ROS ratio at pdf=0 → ${ratio.toFixed(4)} (expected ~5.0000  hwFactor 1.0 vs 0.2)`);
    if (ok) pass++; else { issues.push(`M3/M4 pdf=0 ros ratio ${ratio.toFixed(4)} != 5.0`); fail++; }
  }
}

// ─── Van Wagner rain threshold boundary tests ────────────────────────────────
// FFMC threshold: rain > 0.5  (strictly greater)
// DMC  threshold: rain > 1.5  (strictly greater)
// DC   threshold: rain > 2.8  (strictly greater)
//
// Key invariant: at-threshold rain must NOT trigger the correction — it must
// equal the no-rain result. Just-above-threshold must produce a different
// (lower) value. These tests would catch an accidental >= change.
{
  console.log('\n── Van Wagner rain threshold boundaries (_ffmc/_dmc/_dc) ──');
  const ffmcFn = sandbox._ffmc;
  const dmcFn  = sandbox._dmc;
  const dcFn   = sandbox._dc;

  const TOL = 0.00001;

  // _ffmc: baseline temp=20, rh=50, wind=15, prev=88
  // rain=0.5 (at threshold) must equal rain=0 (no correction)
  const ffmcBase    = ffmcFn(20, 50, 15, 0,     88);
  const ffmcAt05    = ffmcFn(20, 50, 15, 0.5,   88);
  const ffmcAbove05 = ffmcFn(20, 50, 15, 0.501, 88);
  const ffmcAbove06 = ffmcFn(20, 50, 15, 0.6,   88);

  let ok = Math.abs(ffmcAt05 - ffmcBase) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _ffmc rain=0.5 (at threshold) → ${ffmcAt05.toFixed(5)} == no-rain ${ffmcBase.toFixed(5)}`);
  if (ok) pass++; else { issues.push(`_ffmc rain=0.5 should equal no-rain: got ${ffmcAt05} vs ${ffmcBase}`); fail++; }

  ok = ffmcAbove05 < ffmcBase - 0.01;
  console.log(`  ${ok?'PASS':'FAIL'}  _ffmc rain=0.501 (just above) → ${ffmcAbove05.toFixed(5)} < no-rain (correction triggered)`);
  if (ok) pass++; else { issues.push(`_ffmc rain=0.501 should trigger correction: ${ffmcAbove05} vs ${ffmcBase}`); fail++; }

  ok = ffmcAbove06 < ffmcBase - 0.5;
  console.log(`  ${ok?'PASS':'FAIL'}  _ffmc rain=0.6 → ${ffmcAbove06.toFixed(5)} (expected notably lower than ${ffmcBase.toFixed(5)})`);
  if (ok) pass++; else { issues.push(`_ffmc rain=0.6 should suppress: ${ffmcAbove06} vs ${ffmcBase}`); fail++; }

  // _dmc: baseline temp=20, rh=50, rain varies, month=6, prev=30
  const dmcBase    = dmcFn(20, 50, 0,   6, 30);
  const dmcAt15    = dmcFn(20, 50, 1.5, 6, 30);
  const dmcAbove15 = dmcFn(20, 50, 1.6, 6, 30);

  ok = Math.abs(dmcAt15 - dmcBase) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _dmc  rain=1.5 (at threshold) → ${dmcAt15.toFixed(5)} == no-rain ${dmcBase.toFixed(5)}`);
  if (ok) pass++; else { issues.push(`_dmc rain=1.5 should equal no-rain: got ${dmcAt15} vs ${dmcBase}`); fail++; }

  ok = dmcAbove15 < dmcBase - 0.5;
  console.log(`  ${ok?'PASS':'FAIL'}  _dmc  rain=1.6 (just above) → ${dmcAbove15.toFixed(5)} < no-rain (correction triggered)`);
  if (ok) pass++; else { issues.push(`_dmc rain=1.6 should trigger correction: ${dmcAbove15} vs ${dmcBase}`); fail++; }

  // _dc: baseline temp=20, rain varies, month=6, prev=200
  const dcBase    = dcFn(20, 0,   6, 200);
  const dcAt28    = dcFn(20, 2.8, 6, 200);
  const dcAbove28 = dcFn(20, 2.9, 6, 200);

  ok = Math.abs(dcAt28 - dcBase) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _dc   rain=2.8 (at threshold) → ${dcAt28.toFixed(5)} == no-rain ${dcBase.toFixed(5)}`);
  if (ok) pass++; else { issues.push(`_dc rain=2.8 should equal no-rain: got ${dcAt28} vs ${dcBase}`); fail++; }

  ok = dcAbove28 < dcBase - 1.0;
  console.log(`  ${ok?'PASS':'FAIL'}  _dc   rain=2.9 (just above) → ${dcAbove28.toFixed(5)} < no-rain (correction triggered)`);
  if (ok) pass++; else { issues.push(`_dc rain=2.9 should trigger correction: ${dcAbove28} vs ${dcBase}`); fail++; }
}

// ─── Van Wagner temperature gate boundary tests ──────────────────────────────
// _dmc: drying only when temp > -1.1°C (strictly greater)
// _dc:  drying only when temp > -2.8°C (strictly greater)
// _dc:  inner clamp Math.max(0, 0.36*(temp+2.8) + DC_LL[month]) prevents
//       negative drying in winter months where DC_LL is negative (Jan–Mar,
//       DC_LL[1..3] = -1.6).
//
// At-threshold temps must leave the index unchanged (equal to prev). These
// tests catch an accidental >= change and verify winter-month cold-day behaviour.
{
  console.log('\n── Van Wagner temperature gate boundaries (_dmc/_dc) ──');
  const dmcFn = sandbox._dmc;
  const dcFn  = sandbox._dc;
  const TOL   = 0.000001;

  // _dmc: prev=30, month=7 (summer), rh=70, no rain
  const dmcPrev = 30;
  const dmcBase = dmcFn(20.0, 70, 0, 7, dmcPrev); // normal summer reference
  const dmcAtGate   = dmcFn(-1.1, 70, 0, 7, dmcPrev); // at gate — NOT triggered
  const dmcJustAbove = dmcFn(-1.0, 70, 0, 7, dmcPrev); // just above — triggered

  let ok = Math.abs(dmcAtGate - dmcPrev) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _dmc temp=-1.1 (at gate) → ${dmcAtGate.toFixed(6)} == prev ${dmcPrev} (no drying)`);
  if (ok) pass++; else { issues.push(`_dmc temp=-1.1 should equal prev: got ${dmcAtGate}`); fail++; }

  ok = dmcJustAbove > dmcPrev + 0.001;
  console.log(`  ${ok?'PASS':'FAIL'}  _dmc temp=-1.0 (just above gate) → ${dmcJustAbove.toFixed(6)} > prev (drying begins)`);
  if (ok) pass++; else { issues.push(`_dmc temp=-1.0 should exceed prev: got ${dmcJustAbove}`); fail++; }

  // _dc: prev=200, month=7, no rain
  const dcPrev = 200;
  const dcAtGate    = dcFn(-2.8, 0, 7, dcPrev); // at gate — NOT triggered
  const dcJustAbove = dcFn(-2.7, 0, 7, dcPrev); // just above — triggered

  ok = Math.abs(dcAtGate - dcPrev) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _dc  temp=-2.8 (at gate) → ${dcAtGate.toFixed(6)} == prev ${dcPrev} (no drying)`);
  if (ok) pass++; else { issues.push(`_dc temp=-2.8 should equal prev: got ${dcAtGate}`); fail++; }

  ok = dcJustAbove > dcPrev + 1.0; // 3.2 per DCLL for month 7
  console.log(`  ${ok?'PASS':'FAIL'}  _dc  temp=-2.7 (just above gate) → ${dcJustAbove.toFixed(6)} > prev (drying begins)`);
  if (ok) pass++; else { issues.push(`_dc temp=-2.7 should exceed prev: got ${dcJustAbove}`); fail++; }

  // _dc winter clamp: month=1, DC_LL[1]=-1.6
  // Inner term = 0.36*(temp+2.8) + (-1.6) = 0 at temp ≈ 1.64°C
  // Below ~1.64°C: Math.max clamps to 0 → DC unchanged despite temp > -2.8
  const dcWinterBelow = dcFn(1.0, 0, 1, dcPrev); // temp > -2.8 but inner clamp = 0
  const dcWinterAbove = dcFn(2.0, 0, 1, dcPrev); // above inner threshold → drying

  ok = Math.abs(dcWinterBelow - dcPrev) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _dc  winter month=1 temp=1.0°C → ${dcWinterBelow.toFixed(6)} == prev (inner clamp, DC_LL=-1.6)`);
  if (ok) pass++; else { issues.push(`_dc winter temp=1.0 should be clamped to prev: got ${dcWinterBelow}`); fail++; }

  ok = dcWinterAbove > dcPrev;
  console.log(`  ${ok?'PASS':'FAIL'}  _dc  winter month=1 temp=2.0°C → ${dcWinterAbove.toFixed(6)} > prev (inner clamp lifted)`);
  if (ok) pass++; else { issues.push(`_dc winter temp=2.0 should exceed prev: got ${dcWinterAbove}`); fail++; }
}

// ─── DMC_LL / DC_LL monthly lookup table coverage ────────────────────────────
// Both drying tables are used in the Van Wagner daily equations (FTR-33 Table 1).
// Testing only summer months leaves the table vulnerable to silent corruption.
// These reference values lock all 12 entries of DMC_LL and DC_LL — a wrong
// value in any month changes the drying increment and breaks the pinned value.
//
// Fixed inputs: temp=20°C, rh=50%, rain=0, DMC_prev=30, DC_prev=200.
// (temp=20 is well above both -1.1°C and -2.8°C gates, so monthly variation
// is purely from the lookup table. Same condition across all months.)
{
  console.log('\n── DMC_LL / DC_LL monthly table coverage (all 12 months) ──');
  const dmcFn = sandbox._dmc;
  const dcFn  = sandbox._dc;
  const TOL   = 0.00001;

  // Reference: computed from engine; locking the full table
  // Columns: month, expected_dmc, expected_dc
  const MONTHLY_REF = [
    //  mo    dmc           dc
    [  1,  31.29881,  203.30400 ],  // DMC_LL=6.5,   DC_LL=-1.6
    [  2,  31.49863,  203.30400 ],  // DMC_LL=7.5,   DC_LL=-1.6
    [  3,  31.79835,  203.30400 ],  // DMC_LL=9.0,   DC_LL=-1.6
    [  4,  32.55766,  204.55400 ],  // DMC_LL=12.8,  DC_LL=0.9
    [  5,  32.77746,  206.00400 ],  // DMC_LL=13.9,  DC_LL=3.8
    [  6,  32.77746,  207.00400 ],  // DMC_LL=13.9,  DC_LL=5.8
    [  7,  32.47773,  207.30400 ],  // DMC_LL=12.4,  DC_LL=6.4  ← peak DC drying
    [  8,  32.17801,  206.60400 ],  // DMC_LL=10.9,  DC_LL=5.0
    [  9,  31.87828,  205.30400 ],  // DMC_LL=9.4,   DC_LL=2.4
    [ 10,  31.59854,  204.30400 ],  // DMC_LL=8.0,   DC_LL=0.4
    [ 11,  31.39872,  203.30400 ],  // DMC_LL=7.0,   DC_LL=-1.6
    [ 12,  31.19890,  203.30400 ],  // DMC_LL=6.0,   DC_LL=-1.6
  ];

  for (const [mo, expDMC, expDC] of MONTHLY_REF) {
    const gotDMC = dmcFn(20, 50, 0, mo, 30);
    const gotDC  = dcFn(20, 0, mo, 200);
    const dmcOk  = Math.abs(gotDMC - expDMC) < TOL;
    const dcOk   = Math.abs(gotDC  - expDC)  < TOL;
    const ok     = dmcOk && dcOk;
    const label  = `month=${String(mo).padStart(2)}`;
    console.log(`  ${ok?'PASS':'FAIL'}  ${label}  DMC=${gotDMC.toFixed(5)} (exp ${expDMC})  DC=${gotDC.toFixed(5)} (exp ${expDC})`);
    if (ok) pass++;
    else {
      if (!dmcOk) issues.push(`DMC_LL table month=${mo}: got ${gotDMC.toFixed(5)} exp ${expDMC}`);
      if (!dcOk)  issues.push(`DC_LL  table month=${mo}: got ${gotDC.toFixed(5)} exp ${expDC}`);
      fail++;
    }
  }
}

// ─── _fwi BUI formula branch and _bui dmc/dc branch boundaries ───────────────
// _fwi uses fd = 0.626*bui^0.809+2 when bui≤80, else 1000/(25+108.64*e^(-0.023*bui))
// _bui uses 0.8*dmc*dc/(dmc+0.4*dc) when dmc≤0.4*dc, else the complementary formula.
// Pinning values at BUI=79/80/81 catches any change to the threshold or formula.
{
  console.log('\n── _fwi BUI=80 branch switch + _bui dmc=0.4*dc branch ──');
  const fwiFn = sandbox._fwi;
  const buiFn = sandbox._bui;
  const TOL   = 0.00001;

  // _fwi: ISI=15, BUI spanning the ≤80 / >80 boundary
  // BUI=80 uses formula 1; BUI=81 jumps to formula 2 → small upward step
  const FWI_BUI_REF = [
    [15,  79, 36.77818],  // formula 1
    [15,  80, 37.00310],  // formula 1 (inclusive ≤80)
    [15,  81, 37.20972],  // formula 2 — step at this boundary
    [15, 200, 50.34245],  // deep formula 2
  ];
  for (const [isi, b, exp] of FWI_BUI_REF) {
    const got = fwiFn(isi, b);
    const ok  = Math.abs(got - exp) < TOL;
    console.log(`  ${ok?'PASS':'FAIL'}  _fwi(isi=${isi},bui=${b}) → ${got.toFixed(5)} (exp ${exp})`);
    if (ok) pass++; else { issues.push(`_fwi isi=${isi} bui=${b}: got ${got.toFixed(5)} exp ${exp}`); fail++; }
  }

  // _bui: at dmc=0.4*dc (exactly at branch point, ≤ uses first formula)
  // dmc=40, dc=100: 0.8*40*100/(40+40) = 3200/80 = 40.0 exactly
  const BUI_BRANCH_REF = [
    [39, 100, 39.49367],  // dmc < 0.4*dc → formula 1
    [40, 100, 40.00000],  // dmc = 0.4*dc → formula 1 (≤ is inclusive)
    [41, 100, 40.98525],  // dmc > 0.4*dc → formula 2
  ];
  for (const [dmc, dc, exp] of BUI_BRANCH_REF) {
    const got = buiFn(dmc, dc);
    const ok  = Math.abs(got - exp) < TOL;
    console.log(`  ${ok?'PASS':'FAIL'}  _bui(dmc=${dmc},dc=${dc}) → ${got.toFixed(5)} (exp ${exp})`);
    if (ok) pass++; else { issues.push(`_bui dmc=${dmc} dc=${dc}: got ${got.toFixed(5)} exp ${exp}`); fail++; }
  }
}

// ─── calculateFWI fwiFromCWFIS passthrough paths ──────────────────────────────
// Path A: fwiFromCWFIS=true + ffmc!=null + isi/bui/fwi all provided → pass through exactly
// Path B: fwiFromCWFIS=true + ffmc=null → falls through to Van Wagner (ignores flag)
// Both paths are tested; a broken ?? chain or changed condition would fail these.
{
  console.log('\n── calculateFWI fwiFromCWFIS passthrough paths ──');
  const TOL = 0.00001;

  // Path A: all CWFIS values provided — must come back unchanged
  const wA = { temp:20, rh:50, wind:15, rain:0, month:6, fwiFromCWFIS:true,
               ffmc:85.0, dmc:30.0, dc:200.0, isi:12.5, bui:44.3, fwi:28.7 };
  const rA = FWI.calculateFWI(wA, null);
  const isiOk = Math.abs(rA.isi - 12.5) < TOL;
  const buiOk = Math.abs(rA.bui - 44.3) < TOL;
  const fwiOk = Math.abs(rA.fwi - 28.7) < TOL;
  const okA = isiOk && buiOk && fwiOk;
  console.log(`  ${okA?'PASS':'FAIL'}  fwiFromCWFIS all-provided: isi=${rA.isi} bui=${rA.bui} fwi=${rA.fwi} (expect 12.5/44.3/28.7)`);
  if (okA) pass++;
  else { issues.push(`calculateFWI CWFIS passthrough broken: isi=${rA.isi} bui=${rA.bui} fwi=${rA.fwi}`); fail++; }

  // Path B: fwiFromCWFIS=true but ffmc=null → condition fails → Van Wagner runs
  const wB = { temp:20, rh:50, wind:15, rain:0, month:6, fwiFromCWFIS:true, ffmc:null, dmc:30, dc:200 };
  const prevB = { ffmc:82, dmc:25, dc:180 };
  const rB = FWI.calculateFWI(wB, prevB);
  const vanWagnerRan = rB.ffmc !== null && typeof rB.ffmc === 'number' && rB.ffmc > 80;
  console.log(`  ${vanWagnerRan?'PASS':'FAIL'}  fwiFromCWFIS + ffmc=null → Van Wagner ran: ffmc=${rB.ffmc?.toFixed(3)} (expect ~86.234)`);
  if (vanWagnerRan) pass++; else { issues.push(`calculateFWI CWFIS ffmc=null should fall through to Van Wagner: ffmc=${rB.ffmc}`); fail++; }
}

// ─── _isi extremes and _fwi b=1 inner boundary ───────────────────────────────
// _isi(ffmc, wind): at FFMC=0, moisture m≈249.9 → ISI≈0 (finite but near-zero).
//                  at FFMC=101, m=0 → ISI = 0.208 * exp(0.05039*wind) * 91.9.
// _fwi(isi, bui):  b = 0.1*isi*fd; returns b when b≤1 (linear), else exponential.
//                  With BUI=1, fd=2.626 → threshold isi = 10/2.626 ≈ 3.808.
{
  console.log('\n── _isi extremes + _fwi b=1 inner boundary ──');
  const isiFn = sandbox._isi;
  const fwiFn = sandbox._fwi;
  const TOL   = 0.0001;

  // _isi: FFMC=0 should give a near-zero but finite, non-NaN value
  const isi0 = isiFn(0, 0);
  let ok = isFinite(isi0) && !isNaN(isi0) && isi0 >= 0 && isi0 < 1e-6;
  console.log(`  ${ok?'PASS':'FAIL'}  _isi(0,0) = ${isi0.toExponential(3)} (finite, ≥0, ≈0 — extreme low moisture)`);
  if (ok) pass++; else { issues.push(`_isi(0,0) not finite near-zero: ${isi0}`); fail++; }

  // _isi: FFMC=101 (max), wind=0 → m=0 → ISI = 0.208 * 1 * 91.9 * 1 * 1 = 19.1152
  const isi101w0 = isiFn(101, 0);
  ok = Math.abs(isi101w0 - 19.1152) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _isi(101,0) = ${isi101w0.toFixed(4)} (expected 19.1152 — max FFMC, calm)`);
  if (ok) pass++; else { issues.push(`_isi(101,0): got ${isi101w0} exp 19.1152`); fail++; }

  // _isi: FFMC=101, wind=20 → pinned reference
  const isi101w20 = isiFn(101, 20);
  ok = Math.abs(isi101w20 - 52.3674) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _isi(101,20) = ${isi101w20.toFixed(4)} (expected 52.3674)`);
  if (ok) pass++; else { issues.push(`_isi(101,20): got ${isi101w20} exp 52.3674`); fail++; }

  // _fwi: ISI=0 → b=0 → return 0 regardless of BUI
  ok = fwiFn(0, 0) === 0 && fwiFn(0, 80) === 0;
  console.log(`  ${ok?'PASS':'FAIL'}  _fwi(isi=0,bui=0/80) = 0 (b=0 → linear branch returns 0)`);
  if (ok) pass++; else { issues.push(`_fwi isi=0 should return 0: got ${fwiFn(0,0)}, ${fwiFn(0,80)}`); fail++; }

  // _fwi b=1 inner branch: BUI=1, fd=2.626, threshold isi≈3.808
  // ISI=3.5 → b=0.9191 ≤ 1 → linear branch; ISI=3.81 → b≈1.012 > 1 → exponential
  const fwi_linear = fwiFn(3.5,  1);
  const fwi_exp    = fwiFn(3.81, 1);
  ok = Math.abs(fwi_linear - 0.91910) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _fwi(3.5,1) = ${fwi_linear.toFixed(5)} (linear branch b<1, exp 0.91910)`);
  if (ok) pass++; else { issues.push(`_fwi(3.5,1) linear branch: got ${fwi_linear} exp 0.91910`); fail++; }

  ok = Math.abs(fwi_exp - 1.01175) < TOL;
  console.log(`  ${ok?'PASS':'FAIL'}  _fwi(3.81,1) = ${fwi_exp.toFixed(5)} (exponential branch b>1, exp 1.01175)`);
  if (ok) pass++; else { issues.push(`_fwi(3.81,1) exp branch: got ${fwi_exp} exp 1.01175`); fail++; }
}

// ─── _selectCWFIS station selection + DC divergence detection ────────────────
// Tests the non-trivial logic in _selectCWFIS:
//   1. Empty/null features → null
//   2. Feature missing temp/rh/ws → skipped, does not crash
//   3. fwiFromCWFIS: true when ffmc+dmc+dc present, false otherwise
//   4. DC divergence: ≥2 stations within 75 km, spread ≥75 → flagged
//   5. FWI-station preferred over weather-only if within 200 km of nearest wx
{
  console.log('\n── _selectCWFIS station selection + DC divergence ──');
  const sel = sandbox._selectCWFIS;
  if (typeof sel !== 'function') {
    console.log('  SKIP  _selectCWFIS not exported from sandbox — skipping section');
  } else {
    // helper: build a synthetic CWFIS feature
    const mkFeat = (name, lat, lon, temp=20, rh=50, ws=10, ffmc=null, dmc=null, dc=null, fwi=null, isi=null, bui=null) => ({
      type: 'Feature',
      properties: { name, lat: String(lat), lon: String(lon), temp, rh, ws, precip:0,
                    ffmc, dmc, dc, isi, bui, fwi, rep_date:'2026-06-16T12:00:00Z' }
    });

    // 1. empty array → null
    let ok = sel([], 53.5, -113.5) === null;
    console.log(`  ${ok?'PASS':'FAIL'}  empty features → null`);
    if (ok) pass++; else { issues.push(`_selectCWFIS([]) should be null`); fail++; }

    // 2. null arg → null
    ok = sel(null, 53.5, -113.5) === null;
    console.log(`  ${ok?'PASS':'FAIL'}  null features → null`);
    if (ok) pass++; else { issues.push(`_selectCWFIS(null) should be null`); fail++; }

    // 3. single station, weather only (no ffmc) → result with fwiFromCWFIS=false
    const wxOnly = [mkFeat('Wx_Only', 53.5, -113.5)];
    const r3 = sel(wxOnly, 53.5, -113.5);
    ok = r3 !== null && r3.fwiFromCWFIS === false;
    console.log(`  ${ok?'PASS':'FAIL'}  wx-only station → fwiFromCWFIS=false (got ${r3?.fwiFromCWFIS})`);
    if (ok) pass++; else { issues.push(`_selectCWFIS wx-only: fwiFromCWFIS=${r3?.fwiFromCWFIS}`); fail++; }

    // 4. single station with full FWI → fwiFromCWFIS=true
    const fwiStn = [mkFeat('FWI_Stn', 53.5, -113.5, 20, 50, 10, 85.0, 30.0, 200.0, 12.5, 8.0, 44.0)];
    const r4 = sel(fwiStn, 53.5, -113.5);
    ok = r4 !== null && r4.fwiFromCWFIS === true && Math.abs(r4.ffmc - 85.0) < 0.01;
    console.log(`  ${ok?'PASS':'FAIL'}  FWI station → fwiFromCWFIS=true ffmc=${r4?.ffmc}`);
    if (ok) pass++; else { issues.push(`_selectCWFIS FWI station: fwiFromCWFIS=${r4?.fwiFromCWFIS} ffmc=${r4?.ffmc}`); fail++; }

    // 5. feature with missing temp → skipped; result comes from valid neighbour
    const badFeat = mkFeat('Bad_Stn', 53.5, -113.5);
    badFeat.properties.temp = null;   // missing required field
    const goodFeat = mkFeat('Good_Stn', 54.0, -113.5, 22, 45, 12, 87.0, 35.0, 220.0, 15.0, 10.0, 50.0);
    const r5 = sel([badFeat, goodFeat], 53.5, -113.5);
    ok = r5 !== null && r5.stationName === 'Good_Stn';
    console.log(`  ${ok?'PASS':'FAIL'}  incomplete station skipped → selects Good_Stn (got "${r5?.stationName}")`);
    if (ok) pass++; else { issues.push(`_selectCWFIS bad station skip: stationName=${r5?.stationName}`); fail++; }

    // 6. DC divergence: 2 nearby stations (≤75 km) with spread ≥75 → dcDivergence set
    // Edmonton ~53.5,-113.5 and a station 50 km north, DC difference = 100
    const stn_lowDC  = mkFeat('LowDC',  53.5,  -113.5, 20, 50, 10, 85, 30, 100, 10, 7, 40);
    const stn_highDC = mkFeat('HighDC', 54.0,  -113.5, 20, 50, 10, 85, 30, 200, 10, 7, 40);
    const r6 = sel([stn_lowDC, stn_highDC], 53.75, -113.5);
    ok = r6 !== null && r6.dcDivergence !== null && r6.dcDivergence.spread >= 75;
    console.log(`  ${ok?'PASS':'FAIL'}  DC divergence (spread 100) → flagged spread=${r6?.dcDivergence?.spread} (exp ≥75)`);
    if (ok) pass++; else { issues.push(`_selectCWFIS DC divergence: dcDivergence=${JSON.stringify(r6?.dcDivergence)}`); fail++; }

    // 7. No DC divergence when stations beyond 75 km or spread < 75
    const stn_far = mkFeat('FarDC', 54.7, -113.5, 20, 50, 10, 85, 30, 200, 10, 7, 40);
    const r7 = sel([stn_lowDC, stn_far], 53.5, -113.5);
    ok = r7 !== null && r7.dcDivergence === null;
    console.log(`  ${ok?'PASS':'FAIL'}  DC divergence: far station (>75 km) → dcDivergence=null (got ${r7?.dcDivergence})`);
    if (ok) pass++; else { issues.push(`_selectCWFIS far DC station should not flag divergence: ${JSON.stringify(r7?.dcDivergence)}`); fail++; }
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
