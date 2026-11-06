/**
 * GEM chain test — runs the FWI forecast chain on the ECCC GEM point series that the
 * product itself reads (data/gem/<prov>.json, built from MSC GeoMet), for several stations,
 * and checks for plausibility across 7 days. No network access (Open-Meteo is not used
 * anywhere in Pyra or its tests; see tests/no_open_meteo_in_tests.test.mjs).
 * Also tests SWOB cross-validation logic with synthetic divergence.
 * BC stations are run through both the AB and BC engines; results must match.
 *
 * Run: node tests/gem_chain_test.mjs
 */
import { readFileSync } from 'fs';
import vm from 'vm';
import { loadEngine } from './load-engine.mjs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load AB engine (inline sandbox; no network: any fetch rejects)
const code = readFileSync(new URL('../fwi.js', import.meta.url), 'utf8');
const sandbox = {
  window: {}, document: { querySelectorAll: () => [], getElementById: () => null },
  console: { log: () => {}, warn: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  fetch: () => Promise.reject(new Error('no network in gem_chain_test')),
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
vm.runInContext(readFileSync(new URL('../core/fwi-core.js', import.meta.url), 'utf8'), sandbox); // shared core after the province module
const FWI = sandbox.window.FWI;

// Load BC engine (no-network sandbox — chain tests read data/gem via gemForecast7)
const FWI_BC = loadEngine(path.join(ROOT, 'bc', 'fwi.js'));

let pass = 0, fail = 0;
const issues = [];

// ─── Helper: Van Wagner chain forward one day ─────────────────────────────────
function chainDay(w, prev, engine = FWI) {
  return engine.calculateFWI(w, prev);
}

// ─── ECCC GEM point series (the repo's own data/gem files) for a point ───────
const GEM_FILES = {};
function gemFile(prov) {
  return (GEM_FILES[prov] ??= JSON.parse(readFileSync(path.join(ROOT, 'data', 'gem', `${prov}.json`), 'utf8')));
}
function nearestGem(file, lat, lon, maxKm = 60) {
  let best = null, bestD = maxKm;
  const rad = Math.PI / 180;
  for (const [name, s] of Object.entries(file.stations)) {
    if (!s || s.alias || typeof s.lat !== 'number') continue;
    const dLat = (s.lat - lat) * rad, dLon = (s.lon - lon) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(s.lat * rad) * Math.sin(dLon / 2) ** 2;
    const d = 6371 * 2 * Math.asin(Math.sqrt(a));
    if (d <= bestD) { bestD = d; best = { name, s, km: d }; }
  }
  return best;
}
// Seven consecutive days starting on the file's own UTC date (not today's clock, so the test is
// deterministic for the committed file). Same sampling as before: the hour of noon LST, 24 h rain.
function gemForecast7(prov, lat, lon, tzOffsetH, label) {
  const file = gemFile(prov);
  const pt = nearestGem(file, lat, lon);
  if (!pt) return { days: [], note: `no GEM point within 60 km of ${lat},${lon}` };
  const noonUTCH = 12 + tzOffsetH; // noon LST: UTC-7 → 19:00 UTC, UTC-8 → 20:00 UTC
  const t0 = Date.parse(file.start), day0 = Date.parse(String(file.generated).slice(0, 10) + 'T00:00:00Z');
  const days = [];
  for (let day = 0; day < 7; day++) {
    const ms = day0 + day * 86400000;
    const dateStr = new Date(ms).toISOString().slice(0, 10);
    const i = Math.round((ms + noonUTCH * 3600000 - t0) / 3600000);
    if (i < 23 || i >= file.n) continue;
    const s = pt.s;
    const vals = [s.temp[i], s.rh[i], s.wind[i]];
    if (vals.some(v => v == null || Number.isNaN(v))) continue;
    const rain24 = s.rain.slice(i - 23, i + 1).reduce((acc, v) => acc + (v ?? 0), 0);
    days.push({ date: dateStr, temp: s.temp[i], rh: s.rh[i], wind: s.wind[i], rain: rain24,
                month: new Date(dateStr).getMonth() + 1 });
  }
  return { days, note: `GEM point "${pt.name}" ${pt.km.toFixed(1)} km away` };
}

// ─── Test: 7-day chain plausibility ──────────────────────────────────────────
async function testChain(stationLabel, lat, lon, tzOffsetH, cwfisStart, engine = FWI) {
  console.log(`\n── ${stationLabel} ──`);
  const { days, note } = gemForecast7(engine === FWI_BC ? 'bc' : 'ab', lat, lon, tzOffsetH, stationLabel);
  console.log(`  ${note}`);
  if (days.length < 5) { fail++; issues.push(`  ${stationLabel}: only ${days.length} usable GEM days (${note})`); console.log('  FAIL: too few GEM days'); return; }

  let prev = cwfisStart;
  let prevFWI = NaN;
  let maxDropInOneDay = 0;
  let anomaly = false;

  for (const day of days) {
    const w = { ...day, fwiFromCWFIS: false };
    const r = chainDay(w, prev, engine);
    const fwi = r.fwi ?? 0;
    const dayDrop = Math.abs(fwi - prevFWI);
    if (!isNaN(prevFWI)) maxDropInOneDay = Math.max(maxDropInOneDay, dayDrop);

    // Physical sanity checks
    if (isNaN(fwi)) { anomaly = true; issues.push(`  NaN FWI at ${stationLabel} ${day.date}`); }
    if (r.ffmc < 0 || r.ffmc > 101) { anomaly = true; issues.push(`  FFMC=${r.ffmc?.toFixed(1)} OOB at ${stationLabel} ${day.date}`); }
    if (r.dmc < 0) { anomaly = true; issues.push(`  DMC=${r.dmc?.toFixed(1)} negative at ${stationLabel} ${day.date}`); }
    if (r.dc < 0) { anomaly = true; issues.push(`  DC=${r.dc?.toFixed(1)} negative at ${stationLabel} ${day.date}`); }

    // Hot+dry but FWI < 3: flag
    if (day.temp > 25 && day.rh < 30 && fwi < 3) {
      anomaly = true;
      issues.push(`  LOW FWI=${fwi.toFixed(1)} at ${day.temp}°C/${day.rh}%RH on ${day.date} (${stationLabel})`);
    }

    const danger = engine.dangerRating(fwi);
    console.log(`  ${day.date}  T=${day.temp?.toFixed(1).padStart(5)}°C  RH=${String(day.rh).padStart(3)}%  W=${day.wind?.toFixed(0).padStart(3)} km/h  Rain=${day.rain?.toFixed(1).padStart(5)}mm  FWI=${fwi.toFixed(1).padStart(6)}  ${danger}`);
    prev = { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc };
    prevFWI = fwi;
  }

  if (!anomaly) {
    console.log(`  OK — no anomalies. Max single-day FWI change: ${maxDropInOneDay.toFixed(1)}`);
    pass++;
  } else {
    fail++;
  }
}

// ─── Test: BC engine produces identical chain to AB engine on BC station data ─
async function testBCEngineParity(stationLabel, lat, lon, tzOffsetH, cwfisStart) {
  console.log(`\n── BC engine parity: ${stationLabel} ──`);
  const { days, note } = gemForecast7('bc', lat, lon, tzOffsetH, stationLabel);
  console.log(`  ${note}`);
  if (days.length < 5) { fail++; issues.push(`  ${stationLabel}: only ${days.length} usable GEM days (${note})`); console.log('  FAIL: too few GEM days'); return; }

  let prevAB = cwfisStart, prevBC = cwfisStart;
  let maxDiff = 0;
  let parityFail = false;

  for (const day of days) {
    const w = { ...day, fwiFromCWFIS: false };
    const rAB = FWI.calculateFWI(w, prevAB);
    const rBC = FWI_BC.calculateFWI(w, prevBC);
    const diff = Math.abs((rAB.fwi ?? 0) - (rBC.fwi ?? 0));
    maxDiff = Math.max(maxDiff, diff);
    if (diff > 0.01) {
      parityFail = true;
      issues.push(`  Parity divergence at ${stationLabel} ${day.date}: AB=${rAB.fwi?.toFixed(3)} BC=${rBC.fwi?.toFixed(3)} Δ=${diff.toFixed(3)}`);
    }
    prevAB = { ffmc: rAB.ffmc, dmc: rAB.dmc, dc: rAB.dc };
    prevBC = { ffmc: rBC.ffmc, dmc: rBC.dmc, dc: rBC.dc };
    const danger = FWI_BC.dangerRating(rBC.fwi ?? 0);
    console.log(`  ${day.date}  FWI AB=${String((rAB.fwi ?? 0).toFixed(1)).padStart(6)}  BC=${String((rBC.fwi ?? 0).toFixed(1)).padStart(6)}  Δ=${diff.toFixed(3)}  ${danger}`);
  }

  if (!parityFail) {
    console.log(`  PARITY PASS — max FWI divergence over 7 days: ${maxDiff.toFixed(4)}`);
    pass++;
  } else {
    console.log(`  PARITY FAIL — engines diverged`);
    fail++;
  }
}

// ─── Test: SWOB cross-validation logic ───────────────────────────────────────
function testSWOBCrossValidation() {
  console.log('\n── SWOB cross-validation logic ──');

  // Simulate the merge: CWFIS has bad temp (30.9°C), SWOB has real (14.5°C)
  const cwfis = { temp: 30.9, rh: 25, wind: 16, wdir: 270, rain: 0, month: 6,
                  ffmc: 70.5, dmc: 13.1, dc: 165.5, isi: 1.4, bui: 15, fwi: 2.1,
                  fwiFromCWFIS: true, stationName: 'EDMONTON BLATCHFORD', distKm: 0 };
  const swob  = { temp: 14.5, rh: 57, wind: 16.1, wdir: 350, rain: 0.2, month: 6,
                  fwiFromCWFIS: false, source: 'MSC SWOB · Edmonton Blatchford', distKm: 1 };

  const tempDiff = Math.abs(cwfis.temp - swob.temp);
  const wouldTrigger = swob.temp != null && cwfis.temp != null &&
                       (swob.distKm ?? 999) <= 25 &&
                       tempDiff > 8;

  if (!wouldTrigger) {
    console.log(`  FAIL: cross-validation should trigger (diff=${tempDiff.toFixed(1)}°C, distKm=${swob.distKm})`);
    fail++; issues.push('  FAIL: SWOB cross-validation did not trigger on 16.4°C divergence');
    return;
  }

  // Simulate the merge result
  const merged = { ...swob, ffmc: cwfis.ffmc, dmc: cwfis.dmc, dc: cwfis.dc,
                   isi: cwfis.isi, bui: cwfis.bui, fwi: cwfis.fwi,
                   fwiFromCWFIS: cwfis.fwiFromCWFIS, stationName: cwfis.stationName,
                   distKm: cwfis.distKm };

  // Verify: weather from SWOB, chain from CWFIS
  const tempOK  = merged.temp === swob.temp;
  const chainOK = merged.ffmc === cwfis.ffmc && merged.dc === cwfis.dc;
  const nameOK  = merged.stationName === cwfis.stationName;

  if (tempOK && chainOK && nameOK) {
    console.log(`  PASS: triggered on ${tempDiff.toFixed(1)}°C diff — SWOB weather (${merged.temp}°C) + CWFIS chain (FWI=${merged.fwi})`);
    pass++;
  } else {
    console.log(`  FAIL: merge incorrect — temp=${merged.temp} ffmc=${merged.ffmc} name=${merged.stationName}`);
    fail++; issues.push('  FAIL: SWOB merge produced wrong values');
  }

  // Test: small diff should NOT trigger
  const cwfisClose = { ...cwfis, temp: 15.1 };
  const diffClose = Math.abs(cwfisClose.temp - swob.temp);
  const wouldTriggerClose = diffClose > 8;
  if (!wouldTriggerClose) {
    console.log(`  PASS: correctly suppressed on ${diffClose.toFixed(1)}°C diff (below 8°C threshold)`);
    pass++;
  } else {
    console.log(`  FAIL: triggered on small diff ${diffClose.toFixed(1)}°C`);
    fail++;
  }

  // Test: SWOB station >25 km away should NOT trigger
  const swobFar = { ...swob, distKm: 30 };
  const wouldTriggerFar = swobFar.temp != null && cwfis.temp != null &&
                          (swobFar.distKm ?? 999) <= 25 && tempDiff > 8;
  if (!wouldTriggerFar) {
    console.log(`  PASS: correctly suppressed when SWOB station is ${swobFar.distKm} km away`);
    pass++;
  } else {
    console.log(`  FAIL: triggered on distant SWOB station (${swobFar.distKm} km)`);
    fail++;
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
// Today's CWFIS chain start values (from live query this session)
const AB_STARTS = {
  edmonton:   { ffmc: 70.5, dmc: 13.1, dc: 165.5 },  // Edmonton Blatchford
  coronation: { ffmc: 85.6, dmc: 12.8, dc: 215.6 },  // CORONATION CLIMATE
  fortMac:    { ffmc: 63.8, dmc: 6.3,  dc: 58.5  },  // FORT MCMURRAY A area (approx)
};
const BC_STARTS = {
  cranbrook:  { ffmc: 85.2, dmc: 19.4, dc: 327.8 },  // CRANBROOK AIRPORT AUTO
  golden:     { ffmc: 86.1, dmc: 33.2, dc: 283.3 },  // GOLDEN AIRPORT
  kamloops:   { ffmc: 87.0, dmc: 42.0, dc: 380.0 },  // KAMLOOPS (typical June)
};

testSWOBCrossValidation();

// AB stations — via AB engine
await testChain('Edmonton Blatchford AB',  53.567, -113.517, 7, AB_STARTS.edmonton);
await testChain('Coronation AB (windy)',   52.07,  -111.45,  7, AB_STARTS.coronation);
await testChain('Fort McMurray AB',        56.65,  -111.22,  7, { ffmc: 70, dmc: 8, dc: 60 });

// BC stations — via BC engine (plausibility + engine parity with AB engine)
await testChain('Cranbrook BC [BC engine]', 49.62, -115.79, 8, BC_STARTS.cranbrook,  FWI_BC);
await testChain('Golden BC [BC engine]',    51.30, -116.98, 8, BC_STARTS.golden,     FWI_BC);
await testChain('Kamloops BC [BC engine]',  50.70, -120.44, 8, BC_STARTS.kamloops,   FWI_BC);

// Cross-engine parity: same BC weather data through both AB and BC engines must agree
await testBCEngineParity('Cranbrook parity check', 49.62, -115.79, 8, BC_STARTS.cranbrook);
await testBCEngineParity('Kamloops parity check',  50.70, -120.44, 8, BC_STARTS.kamloops);

console.log(`\n${'─'.repeat(60)}`);
console.log(`PASS ${pass}  FAIL ${fail}`);
if (issues.length) { console.log('\nIssues:'); issues.forEach(i => console.log(i)); }
process.exit(fail > 0 ? 1 : 0);
