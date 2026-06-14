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

// ─── Test: CWFIS FWI cross-check ─────────────────────────────────────────────
async function testCWFISCrossCheck() {
  console.log('\n── CWFIS FWI cross-check ──');

  let data;
  try {
    // Same WFS endpoint used by the app (firewx_stns_current, up to 2000 features)
    const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows` +
      `?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeName=public:firewx_stns_current&outputFormat=application/json&count=2000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) { console.log(`  SKIP: CWFIS WFS returned HTTP ${res.status}`); return; }
    data = await res.json();
  } catch (e) {
    console.log(`  SKIP: CWFIS fetch failed — ${e.message}`);
    return;
  }

  const features = data.features ?? [];
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

  // Sample up to 12 stations spread across both provinces
  const ab = stations.filter(f => f.properties.prov === 'AB').slice(0, 6);
  const bc = stations.filter(f => f.properties.prov === 'BC').slice(0, 6);
  const sample = [...ab, ...bc];

  let crossCheckPass = 0, crossCheckFail = 0;

  for (const f of sample) {
    const p = f.properties;
    const isi  = calcISI(p.ffmc, p.ws);
    const bui  = calcBUI(p.dmc, p.dc);
    const fwi  = calcFWI(isi, bui);
    const diff = Math.abs(fwi - p.fwi);
    const tol  = 2.5; // Van Wagner rounding + float tolerance

    const name = (p.name ?? p.display_name ?? p.stn_id ?? 'STA').trim().slice(0, 28).padEnd(28);
    if (diff <= tol) {
      console.log(`  PASS  ${name} [${p.prov}]  CWFIS=${String(p.fwi?.toFixed(1)).padStart(5)}  recalc=${fwi.toFixed(1).padStart(5)}  Δ=${diff.toFixed(1)}`);
      crossCheckPass++; pass++;
    } else {
      const msg = `  FAIL  ${name} [${p.prov}]  CWFIS=${String(p.fwi?.toFixed(1)).padStart(5)}  recalc=${fwi.toFixed(1).padStart(5)}  Δ=${diff.toFixed(1)} > ${tol}`;
      console.log(msg);
      issues.push(msg);
      crossCheckFail++; fail++;
    }
  }
  console.log(`  Cross-check: ${crossCheckPass} pass, ${crossCheckFail} fail`);
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

// ─── Test: NAEFS WFS endpoint reachable ──────────────────────────────────────
async function testNAEFSEndpoint() {
  console.log('\n── NAEFS endpoint ──');
  // Use numeric code 10165 (Edmonton Municipal A) — codes are integers in this layer
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:firewx_naefs` +
    `&outputFormat=application/json&CQL_FILTER=code=10165&count=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const d = await res.json();
      const n = d.features?.length ?? 0;
      if (n > 0) {
        const loc = d.features[0].properties.location ?? '?';
        console.log(`  PASS  NAEFS WFS reachable — ${n} feature(s) for ${loc}`);
        pass++;
      } else {
        console.log(`  WARN  NAEFS WFS reachable but 0 features for code=10165 (outside season?)`);
      }
    } else {
      const msg = `  FAIL  NAEFS WFS HTTP ${res.status}`;
      console.log(msg);
      issues.push(msg);
      fail++;
    }
  } catch (e) {
    console.log(`  WARN: NAEFS fetch timed out or failed — ${e.message}`);
  }
}

// ─── Run all ─────────────────────────────────────────────────────────────────
await testCWFISCrossCheck();
await testSWOBFreshness();
await testNAEFSEndpoint();

console.log(`\n${'─'.repeat(60)}`);
console.log(`PASS ${pass}  FAIL ${fail}`);
if (issues.length) { console.log('\nIssues:'); issues.forEach(i => console.log(i)); }
process.exit(fail > 0 ? 1 : 0);
