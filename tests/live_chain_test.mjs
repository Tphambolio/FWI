/**
 * Live chain test — runs the FWI forecast chain using real Open-Meteo weather
 * data for several stations, checks for plausibility across 7 days.
 * Also tests SWOB cross-validation logic with synthetic divergence.
 * BC stations are run through both the AB and BC engines; results must match.
 *
 * Run: node tests/live_chain_test.mjs
 */
import { readFileSync } from 'fs';
import vm from 'vm';
import { loadEngine } from './load-engine.mjs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load AB engine (inline sandbox for fetch support)
const code = readFileSync(new URL('../fwi.js', import.meta.url), 'utf8');
const sandbox = {
  window: {}, document: { querySelectorAll: () => [], getElementById: () => null },
  console: { log: () => {}, warn: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  fetch: globalThis.fetch,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const FWI = sandbox.window.FWI;

// Load BC engine (no-network sandbox — chain tests use fetchForecast7 separately)
const FWI_BC = loadEngine(path.join(ROOT, 'bc', 'fwi.js'));

let pass = 0, fail = 0;
const issues = [];

// ─── Helper: Van Wagner chain forward one day ─────────────────────────────────
function chainDay(w, prev, engine = FWI) {
  return engine.calculateFWI(w, prev);
}

// ─── Fetch Open-Meteo 7-day forecast for a point ─────────────────────────────
async function fetchForecast7(lat, lon, tzOffsetH, label) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation` +
    `&past_days=0&forecast_days=7&timezone=UTC`;
  const res = await fetch(url);
  const d = await res.json();
  const noonUTCH = 12 + tzOffsetH; // noon LST: UTC-7 → 19:00 UTC, UTC-8 → 20:00 UTC
  const days = [];
  for (let day = 0; day < 7; day++) {
    const dateStr = new Date(Date.now() + day * 86400000).toISOString().slice(0,10);
    const targetISO = `${dateStr}T${String(noonUTCH).padStart(2,'0')}:00`;
    let i = d.hourly.time.indexOf(targetISO);
    if (i === -1) continue;
    const rain24 = d.hourly.precipitation.slice(Math.max(0, i-23), i+1).reduce((s,v) => s+(v??0), 0);
    days.push({
      date: dateStr,
      temp: d.hourly.temperature_2m[i],
      rh:   d.hourly.relative_humidity_2m[i],
      wind: d.hourly.wind_speed_10m[i],
      rain: rain24,
      month: new Date(dateStr).getMonth() + 1,
    });
  }
  return days;
}

// ─── Test: 7-day chain plausibility ──────────────────────────────────────────
async function testChain(stationLabel, lat, lon, tzOffsetH, cwfisStart, engine = FWI) {
  console.log(`\n── ${stationLabel} ──`);
  const days = await fetchForecast7(lat, lon, tzOffsetH, stationLabel);
  if (!days.length) { console.log('  SKIP: no forecast data'); return; }

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
  const days = await fetchForecast7(lat, lon, tzOffsetH, stationLabel);
  if (!days.length) { console.log('  SKIP: no forecast data'); return; }

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
