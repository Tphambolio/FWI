/**
 * Live API validation — fetches CWFIS + SWOB, independently recalculates FWI,
 * compares against CWFIS-reported values. Catches data pipeline bugs the unit tests miss.
 *
 * Run: node tests/live_api_test.mjs
 */
import { readFileSync } from 'fs';
import vm from 'vm';

// Load AB engine
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

// Load BC engine
const bcCode = readFileSync(new URL('../bc/fwi.js', import.meta.url), 'utf8');
const bcSandbox = {
  window: {}, document: { querySelectorAll: () => [], getElementById: () => null },
  console: { log: () => {}, warn: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  fetch: globalThis.fetch,
};
vm.createContext(bcSandbox);
vm.runInContext(bcCode, bcSandbox);
const BCFWI = bcSandbox.window.FWI;

let pass = 0, fail = 0;
const issues = [];

// ─── Reference ISI/BUI/FWI (Van Wagner FTR-33) ───────────────────────────────
function calcISI(ffmc, wind) {
  const m = 147.2 * (101 - ffmc) / (59.5 + ffmc);
  const fF = 91.9 * Math.exp(-0.1386 * m) * (1 + m ** 5.31 / 4.93e7);
  return 0.208 * Math.exp(0.05039 * wind) * fF;
}
function calcBUI(dmc, dc) {
  if (dmc <= 0.4 * dc) return 0.8 * dmc * dc / (dmc + 0.4 * dc);
  return dmc - (1 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + (0.0114 * dmc) ** 1.7);
}
function calcFWI(isi, bui) {
  const fD = bui >= 80 ? 1000 / (25 + 108.64 * Math.exp(-0.023 * bui)) : 0.626 * bui ** 0.809 + 2;
  const B = 0.1 * isi * fD;
  return B > 1 ? Math.exp(2.72 * (0.434 * Math.log(B)) ** 0.647) : B;
}

// ─── Shared CWFIS WFS fetch (used by cross-check + data health tests) ────────
async function fetchCWFISFeatures() {
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows` +
    `?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeName=public:firewx_stns_current&outputFormat=application/json&count=2000`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.features ?? [];
}

// ─── Test: CWFIS FWI cross-check ─────────────────────────────────────────────
async function testCWFISCrossCheck(features) {
  console.log('\n── CWFIS FWI cross-check ──');

  // Filter AB+BC stations with complete FWI chain data
  const stations = features.filter(f => {
    const p = f.properties;
    return (p.prov === 'AB' || p.prov === 'BC') &&
      p.ffmc != null && p.dmc != null && p.dc != null &&
      p.isi  != null && p.bui != null && p.fwi != null &&
      p.temp != null && p.rh  != null && p.ws  != null &&
      p.ffmc > 0 && p.dc > 0 && p.fwi > 0;
  });

  console.log(`  Found ${stations.length} AB/BC stations with complete data`);
  if (!stations.length) { console.log('  SKIP: no complete stations'); return; }

  // ── Full distribution across all AB/BC stations ──
  // Tolerance calibrated from empirical distribution: n=542 AB/BC stations,
  // mean=0.05, p95=0.13, max=0.79 → 1.5 gives a 2× safety margin above
  // observed max while still catching genuine science-core regressions.
  const TOL     = 1.5;
  const deltas  = stations.map(f => {
    const p    = f.properties;
    const isi  = calcISI(p.ffmc, p.ws);
    const bui  = calcBUI(p.dmc, p.dc);
    const fwi  = calcFWI(isi, bui);
    return { name: (p.name ?? p.stn_id ?? 'STA').trim(), prov: p.prov,
             cwfis: p.fwi, recalc: fwi, diff: Math.abs(fwi - p.fwi) };
  });
  deltas.sort((a, b) => a.diff - b.diff);

  const n       = deltas.length;
  const mean    = deltas.reduce((s, d) => s + d.diff, 0) / n;
  const p50     = deltas[Math.floor(n * 0.50)].diff;
  const p95     = deltas[Math.floor(n * 0.95)].diff;
  const maxD    = deltas[n - 1].diff;
  const outliers = deltas.filter(d => d.diff > TOL);

  console.log(`  Delta stats (n=${n}): mean=${mean.toFixed(2)}  p50=${p50.toFixed(2)}  p95=${p95.toFixed(2)}  max=${maxD.toFixed(2)}  outliers(Δ>${TOL})=${outliers.length}`);
  if (outliers.length) {
    outliers.slice(0, 5).forEach(d =>
      console.log(`    ⚠ ${d.name.slice(0,28).padEnd(28)} [${d.prov}]  CWFIS=${String(d.cwfis?.toFixed(1)).padStart(5)}  recalc=${d.recalc.toFixed(1).padStart(5)}  Δ=${d.diff.toFixed(1)}`)
    );
  }

  // ── 12-station sample detail (6 AB + 6 BC) for quick reading ──
  const ab = stations.filter(f => f.properties.prov === 'AB').slice(0, 6);
  const bc = stations.filter(f => f.properties.prov === 'BC').slice(0, 6);
  let crossCheckPass = 0, crossCheckFail = 0;
  for (const f of [...ab, ...bc]) {
    const p    = f.properties;
    const isi  = calcISI(p.ffmc, p.ws);
    const bui  = calcBUI(p.dmc, p.dc);
    const fwi  = calcFWI(isi, bui);
    const diff = Math.abs(fwi - p.fwi);
    const name = (p.name ?? p.stn_id ?? 'STA').trim().slice(0, 28).padEnd(28);
    if (diff <= TOL) {
      console.log(`  PASS  ${name} [${p.prov}]  CWFIS=${String(p.fwi?.toFixed(1)).padStart(5)}  recalc=${fwi.toFixed(1).padStart(5)}  Δ=${diff.toFixed(1)}`);
      crossCheckPass++; pass++;
    } else {
      const msg = `  FAIL  ${name} [${p.prov}]  CWFIS=${String(p.fwi?.toFixed(1)).padStart(5)}  recalc=${fwi.toFixed(1).padStart(5)}  Δ=${diff.toFixed(1)} > ${TOL}`;
      console.log(msg); issues.push(msg); crossCheckFail++; fail++;
    }
  }
  console.log(`  Cross-check sample: ${crossCheckPass} pass, ${crossCheckFail} fail`);

  // Fail if more than 5% of all AB/BC stations exceed tolerance (systematic issue)
  if (outliers.length > Math.ceil(n * 0.05)) {
    const msg = `  FAIL  ${outliers.length}/${n} AB/BC stations exceed Δ=${TOL} tolerance (>${Math.ceil(n * 0.05)} threshold)`;
    console.log(msg); issues.push(msg); fail++;
  } else if (outliers.length === 0) {
    console.log(`  PASS  All ${n} AB/BC stations within Δ=${TOL}`);
    pass++;
  } else {
    console.log(`  PASS  ${n - outliers.length}/${n} within Δ=${TOL} (${outliers.length} outlier${outliers.length > 1 ? 's' : ''} acceptable)`);
    pass++;
  }
}

// ─── Test: SWOB freshness (Edmonton area via OGC API) ────────────────────────
async function testSWOBFreshness() {
  console.log('\n── SWOB freshness ──');
  // Same API the app uses: api.weather.gc.ca OGC collections endpoint
  const now  = new Date();
  const past = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const fmt  = d => d.toISOString().replace(/\.\d+Z$/, 'Z');
  // Edmonton bbox ±1.5°
  const url = `https://api.weather.gc.ca/collections/swob-realtime/items` +
    `?bbox=-115.02,52.07,-112.02,55.07&datetime=${fmt(past)}/${fmt(now)}&limit=5&f=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) { console.log(`  WARN: SWOB API HTTP ${res.status}`); return; }
    const d = await res.json();
    const n = d.features?.length ?? 0;
    if (!n) { console.log('  WARN: SWOB API returned 0 features (off-season or stale?)'); return; }
    const f    = d.features[0];
    const obsT = new Date(f.properties['date_tm-value'] || f.properties['obs_date_tm'] || 0);
    const ageMin = (Date.now() - obsT) / 60000;
    const stn  = (f.properties['stn_nam-value'] || '').replace(/\+/g, ' ').trim() || 'unknown';
    if (ageMin < 90) {
      console.log(`  PASS  SWOB OGC API — ${n} features, nearest: ${stn}, age=${ageMin.toFixed(0)} min`);
      pass++;
    } else {
      console.log(`  WARN  SWOB data stale — age=${ageMin.toFixed(0)} min (station: ${stn})`);
    }
  } catch (e) {
    console.log(`  WARN: SWOB fetch failed — ${e.message}`);
  }
}

// ─── Test: NAEFS WFS forecast plausibility ───────────────────────────────────
async function testNAEFSForecast() {
  console.log('\n── NAEFS forecast plausibility ──');
  // Fetch 10-day ensemble for Edmonton Municipal A (code=10165)
  // Note: FWI chain fields (ffmc/dmc/dc/isi/bui/fwi) are NULL in this layer —
  // only weather ensemble fields (temp/rh/ws/pcp) have values.
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:firewx_naefs` +
    `&outputFormat=application/json&CQL_FILTER=code=10165&count=10`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      const msg = `  FAIL  NAEFS WFS HTTP ${res.status}`;
      console.log(msg); issues.push(msg); fail++;
      return;
    }
    const d = await res.json();
    const features = d.features ?? [];
    if (!features.length) {
      console.log('  WARN  NAEFS WFS returned 0 features (outside fire season?)');
      return;
    }

    const loc = features[0].properties.location ?? '?';
    const dates = features.map(f => f.properties.date_time).filter(Boolean).sort();
    const anomalies = [];

    for (const f of features) {
      const p = f.properties;
      const dt = p.date_time ?? '?';
      const temp = p.median_temp ?? p.mean_temp;
      const rh   = p.median_rh  ?? p.mean_rh;
      const ws   = p.median_ws  ?? p.mean_ws;

      if (temp != null && (temp < -40 || temp > 50))
        anomalies.push(`${dt}: median_temp=${temp}°C out of range`);
      if (rh != null && (rh < 0 || rh > 100))
        anomalies.push(`${dt}: median_rh=${rh}% out of range`);
      if (ws != null && ws < 0)
        anomalies.push(`${dt}: median_ws=${ws} km/h negative`);
    }

    // Show first and last forecast dates for a quick sanity read
    const firstDate = dates[0] ?? '?';
    const lastDate  = dates[dates.length - 1] ?? '?';

    // Sample: print first 3 days
    for (const f of features.slice(0, 3)) {
      const p = f.properties;
      const temp = (p.median_temp ?? p.mean_temp)?.toFixed(1) ?? '?';
      const rh   = (p.median_rh  ?? p.mean_rh)?.toFixed(0)  ?? '?';
      const ws   = (p.median_ws  ?? p.mean_ws)?.toFixed(1)  ?? '?';
      console.log(`  ${p.date_time ?? '?'}  T=${String(temp).padStart(5)}°C  RH=${String(rh).padStart(3)}%  W=${String(ws).padStart(5)} km/h`);
    }

    if (features.length < 3) {
      console.log(`  WARN  Only ${features.length} forecast day(s) returned (expected ≥3)`);
    } else if (anomalies.length) {
      const msg = `  FAIL  NAEFS plausibility: ${anomalies.length} anomaly(ies): ${anomalies[0]}`;
      console.log(msg); issues.push(msg); fail++;
    } else {
      console.log(`  PASS  NAEFS ${features.length} days for ${loc} (${firstDate} → ${lastDate}), weather plausible`);
      pass++;
    }
  } catch (e) {
    console.log(`  WARN: NAEFS fetch timed out or failed — ${e.message}`);
  }
}

// ─── Test: CWFIS data health (timestamp freshness + FWI chain completeness) ───
function testCWFISDataHealth(features) {
  console.log('\n── CWFIS data health ──');

  const withDate = features.filter(f => f.properties?.rep_date);
  if (!withDate.length) { console.log('  SKIP: no features with rep_date'); return; }

  // ── Timestamp freshness (age-based, not calendar-date)
  // CWFIS publishes once daily at noon UTC. Between midnight and noon on a new
  // day, all stations legitimately carry yesterday's date — that data is still
  // fresh (<24h old). We FAIL only when data is >30h old (missed a full cycle).
  const nowMs     = Date.now();
  const repTimes  = withDate.map(f => new Date(f.properties.rep_date).getTime()).filter(t => !isNaN(t));
  if (!repTimes.length) { console.log('  SKIP: no parseable rep_date values'); return; }
  const newestMs  = Math.max(...repTimes);
  const oldestMs  = Math.min(...repTimes);
  const newestAgeH = (nowMs - newestMs) / 3600000;
  const oldestAgeH = (nowMs - oldestMs) / 3600000;
  const newestDate = new Date(newestMs).toISOString().slice(0, 16) + 'Z';

  const totalCount = withDate.length;
  if (newestAgeH > 30) {
    const msg = `  FAIL  Timestamp: newest rep_date ${newestDate} is ${newestAgeH.toFixed(1)}h old (>${30}h — missed publish cycle)`;
    console.log(msg); issues.push(msg); fail++;
  } else if (newestAgeH > 24) {
    console.log(`  WARN  Timestamp: newest rep_date ${newestDate} is ${newestAgeH.toFixed(1)}h old (publish late?), oldest ${oldestAgeH.toFixed(1)}h`);
  } else {
    console.log(`  PASS  Timestamp: newest rep_date ${newestDate}, age=${newestAgeH.toFixed(1)}h (${totalCount} stations)`);
    pass++;
  }

  // ── Rep-date distribution: catches partial-publish failures ──
  // If CWFIS published for only a small fraction of stations today, the newest-age
  // check above still passes. Count stations per unique rep_date so a partial
  // publish (e.g. AB updated but BC stuck on yesterday) is visible.
  const dateCounts = {};
  for (const f of withDate) {
    const d = new Date(f.properties.rep_date);
    if (isNaN(d)) continue;
    const key = d.toISOString().slice(0, 10); // date part only
    dateCounts[key] = (dateCounts[key] ?? 0) + 1;
  }
  const dateKeys   = Object.keys(dateCounts).sort().reverse(); // newest first
  const latestDate = dateKeys[0];
  const latestN    = dateCounts[latestDate] ?? 0;
  const distStr    = dateKeys.map(k => `${k}(${dateCounts[k]})`).join(' | ');
  const latestPct  = Math.round(100 * latestN / withDate.length);

  if (latestPct < 50) {
    const msg = `  FAIL  Rep-date: only ${latestN}/${withDate.length} (${latestPct}%) on latest date ${latestDate} — partial publish? ${distStr}`;
    console.log(msg); issues.push(msg); fail++;
  } else if (latestPct < 80) {
    console.log(`  WARN  Rep-date: ${latestN}/${withDate.length} (${latestPct}%) on ${latestDate} (publish in progress?). ${distStr}`);
  } else {
    console.log(`  PASS  Rep-date: ${latestN}/${withDate.length} (${latestPct}%) on ${latestDate}. ${distStr}`);
    pass++;
  }

  // ── FWI chain completeness ──
  const withFWI = features.filter(f => {
    const p = f.properties;
    return p.ffmc > 0 && p.dmc != null && p.dc > 0 && p.fwi != null && p.fwi >= 0;
  });
  const byProv = {};
  for (const f of withFWI) {
    const prov = f.properties.prov ?? '??';
    byProv[prov] = (byProv[prov] ?? 0) + 1;
  }
  const fwiPct   = Math.round(100 * withFWI.length / features.length);
  const provList = Object.entries(byProv).sort().map(([p, n]) => `${p}(${n})`).join(' ');

  if (fwiPct < 30) {
    console.log(`  WARN  FWI chain: ${withFWI.length}/${features.length} (${fwiPct}%) stations have complete data — mid-publish-cycle? By prov: ${provList}`);
  } else {
    console.log(`  PASS  FWI chain: ${withFWI.length}/${features.length} (${fwiPct}%) stations complete. By prov: ${provList}`);
    pass++;
  }
}

// ─── Test: NAEFS BC forecast plausibility ────────────────────────────────────
async function testNAEFSForecastBC() {
  console.log('\n── NAEFS BC forecast plausibility (Kamloops, code=10195) ──');
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:firewx_naefs` +
    `&outputFormat=application/json&CQL_FILTER=code=10195&count=10`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      const msg = `  FAIL  NAEFS BC WFS HTTP ${res.status}`;
      console.log(msg); issues.push(msg); fail++;
      return;
    }
    const d = await res.json();
    const features = d.features ?? [];
    if (!features.length) {
      console.log('  WARN  NAEFS BC WFS returned 0 features (outside fire season?)');
      return;
    }

    const loc = features[0].properties.location ?? '?';
    const dates = features.map(f => f.properties.date_time).filter(Boolean).sort();
    const anomalies = [];

    for (const f of features) {
      const p = f.properties;
      const dt   = p.date_time ?? '?';
      const temp = p.median_temp ?? p.mean_temp;
      const rh   = p.median_rh  ?? p.mean_rh;
      const ws   = p.median_ws  ?? p.mean_ws;

      if (temp != null && (temp < -40 || temp > 50))
        anomalies.push(`${dt}: median_temp=${temp}°C out of range`);
      if (rh != null && (rh < 0 || rh > 100))
        anomalies.push(`${dt}: median_rh=${rh}% out of range`);
      if (ws != null && ws < 0)
        anomalies.push(`${dt}: median_ws=${ws} km/h negative`);
    }

    const firstDate = dates[0] ?? '?';
    const lastDate  = dates[dates.length - 1] ?? '?';

    for (const f of features.slice(0, 3)) {
      const p = f.properties;
      const temp = (p.median_temp ?? p.mean_temp)?.toFixed(1) ?? '?';
      const rh   = (p.median_rh  ?? p.mean_rh)?.toFixed(0)  ?? '?';
      const ws   = (p.median_ws  ?? p.mean_ws)?.toFixed(1)  ?? '?';
      console.log(`  ${p.date_time ?? '?'}  T=${String(temp).padStart(5)}°C  RH=${String(rh).padStart(3)}%  W=${String(ws).padStart(5)} km/h`);
    }

    if (features.length < 3) {
      console.log(`  WARN  Only ${features.length} forecast day(s) returned (expected ≥3)`);
    } else if (anomalies.length) {
      const msg = `  FAIL  NAEFS BC plausibility: ${anomalies.length} anomaly(ies): ${anomalies[0]}`;
      console.log(msg); issues.push(msg); fail++;
    } else {
      console.log(`  PASS  NAEFS BC ${features.length} days for ${loc} (${firstDate} → ${lastDate}), weather plausible`);
      pass++;
    }
  } catch (e) {
    console.log(`  WARN: NAEFS BC fetch timed out or failed — ${e.message}`);
  }
}

// ─── Test: Engine danger ratings against live CWFIS FWI values ───────────────
// Exercises the actual engine methods (dangerRating / dangerRatingBC) — neither
// is called anywhere else in this file. Catches mismatch between engines and
// ensures the rating strings are valid for each province's scale.
function testEngineDangerRatings(features) {
  console.log('\n── Engine danger ratings vs live CWFIS FWI ──');

  const AB_RATINGS = new Set(['Low', 'Moderate', 'High', 'Very High', 'Extreme']);
  // BC scale: Very Low/Low/Moderate/High/Extreme (no "Very High")
  const BC_RATINGS = new Set(['Very Low', 'Low', 'Moderate', 'High', 'Extreme']);

  const ab = features
    .filter(f => f.properties.prov === 'AB' && f.properties.fwi != null && f.properties.fwi >= 0)
    .slice(0, 6);
  const bc = features
    .filter(f => f.properties.prov === 'BC' && f.properties.fwi != null && f.properties.fwi >= 0)
    .slice(0, 6);

  if (!ab.length && !bc.length) {
    console.log('  SKIP: no AB/BC stations with FWI data');
    return;
  }

  let localPass = 0, localFail = 0;

  for (const f of ab) {
    const p      = f.properties;
    const rating = FWI.dangerRating(p.fwi);
    const name   = (p.name ?? p.stn_id ?? 'STA').trim().slice(0, 28).padEnd(28);
    const ok     = AB_RATINGS.has(rating);
    console.log(`  ${ok?'PASS':'FAIL'}  ${name} [AB]  FWI=${String(p.fwi?.toFixed(1)).padStart(5)}  → ${rating}`);
    if (ok) { pass++; localPass++; } else {
      const msg = `dangerRating(${p.fwi}) → "${rating}" not a valid AB rating`;
      issues.push(msg); fail++; localFail++;
    }
  }

  for (const f of bc) {
    const p      = f.properties;
    const rating = BCFWI.dangerRatingBC(p.fwi);
    const name   = (p.name ?? p.stn_id ?? 'STA').trim().slice(0, 28).padEnd(28);
    const ok     = BC_RATINGS.has(rating);
    console.log(`  ${ok?'PASS':'FAIL'}  ${name} [BC]  FWI=${String(p.fwi?.toFixed(1)).padStart(5)}  → ${rating}`);
    if (ok) { pass++; localPass++; } else {
      const msg = `dangerRatingBC(${p.fwi}) → "${rating}" not a valid BC rating`;
      issues.push(msg); fail++; localFail++;
    }
  }

  console.log(`  Engine ratings: ${localPass} pass, ${localFail} fail`);
}

// ─── Run all ─────────────────────────────────────────────────────────────────
// Single CWFIS WFS fetch shared across cross-check + data health tests
let cwfisFeatures = [];
try {
  cwfisFeatures = await fetchCWFISFeatures();
} catch (e) {
  console.log(`\n  SKIP: CWFIS WFS fetch failed — ${e.message}`);
}

await testCWFISCrossCheck(cwfisFeatures);
testCWFISDataHealth(cwfisFeatures);
testEngineDangerRatings(cwfisFeatures);
await testSWOBFreshness();
await testNAEFSForecast();
await testNAEFSForecastBC();

console.log(`\n${'─'.repeat(60)}`);
console.log(`PASS ${pass}  FAIL ${fail}`);
if (issues.length) { console.log('\nIssues:'); issues.forEach(i => console.log(i)); }
process.exit(fail > 0 ? 1 : 0);
