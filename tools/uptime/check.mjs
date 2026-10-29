#!/usr/bin/env node
/**
 * Pyra + FireSim uptime and data-freshness check (no dependencies, Node 22).
 *
 * Run by .github/workflows/uptime.yml every 30 minutes, or by hand:
 *   node tools/uptime/check.mjs            # human-readable, exit 1 on any FAIL
 *   node tools/uptime/check.mjs --json     # JSON report on stdout
 *
 * Checks (FAIL = page the owner; WARN = note in the report only):
 *   Pyra pages        AB + BC station pages and the index return 200 and contain the engine script tag.
 *   Pyra data mirror  data/cwfis_prev.json, bcws_noon.json, aef_pmwx.csv regenerated within 36 h
 *                     (the cwfis-daily workflow runs at 20:15 UTC). ab_redflag.json within 36 h
 *                     (ab-redflag runs 17:30 and 22:30 UTC). Content is not judged, only freshness:
 *                     off-season the files still regenerate daily, with few or no active stations.
 *   FireSim API       /api/v1/health returns status "healthy"; /api/v1/version returns a git_sha.
 *   FireSim frontend  https://wildfire-simulator.vercel.app returns 200 with the app root.
 *   Upstreams (WARN)  CWFIS WFS, ECCC SWOB, Open-Meteo answer at all — Pyra degrades through its
 *                     tiers when one is down, so these never page on their own.
 */
const PYRA = 'https://tphambolio.github.io/FWI';
const FIRESIM_API = 'https://firesim-api.fly.dev';
const FIRESIM_APP = 'https://wildfire-simulator.vercel.app';
const FRESH_H = 36;

const results = [];
const now = Date.now();
const json = process.argv.includes('--json');

async function get(url, { timeout = 20000, headers = {} } = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'pyra-uptime/1 (+https://github.com/Tphambolio/FWI)', ...headers }, cache: 'no-store' });
  const text = await res.text();
  return { status: res.status, text, ms: Date.now() - t0 };
}

async function check(name, level, fn) {
  try {
    const detail = await fn();
    results.push({ name, level, ok: true, detail });
  } catch (err) {
    results.push({ name, level, ok: false, detail: String(err?.message || err) });
  }
}

const ageH = iso => (now - Date.parse(iso)) / 3600000;
/** Latest completed run of a GitHub Actions workflow in the public repo succeeded within `maxH` hours. */
async function workflowRan(file, maxH) {
  const r = await get(`https://api.github.com/repos/Tphambolio/FWI/actions/workflows/${file}/runs?per_page=1&status=completed`, { headers: { accept: 'application/vnd.github+json' } });
  if (r.status !== 200) throw new Error(`GitHub API HTTP ${r.status}`);
  const run = JSON.parse(r.text).workflow_runs?.[0];
  if (!run) throw new Error('no completed runs');
  const h = ageH(run.run_started_at);
  if (run.conclusion !== 'success') throw new Error(`last run ${run.conclusion} at ${run.run_started_at} (${run.html_url})`);
  if (h > maxH) throw new Error(`last success ${h.toFixed(1)} h ago (> ${maxH} h)`);
  return `success ${h.toFixed(1)} h ago`;
}
const fresh = (label, iso) => {
  if (!iso || Number.isNaN(Date.parse(iso))) throw new Error(`${label}: no timestamp`);
  const h = ageH(iso);
  if (h > FRESH_H) throw new Error(`${label}: ${h.toFixed(1)} h old (> ${FRESH_H} h), generated ${iso}`);
  return `${label}: ${h.toFixed(1)} h old`;
};

await Promise.all([
  check('Pyra AB station page', 'FAIL', async () => {
    const r = await get(`${PYRA}/station_detail/code.html`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (!/core\/fwi-core\.js/.test(r.text)) throw new Error('engine script tag missing');
    return `200 in ${r.ms} ms`;
  }),
  check('Pyra BC station page', 'FAIL', async () => {
    const r = await get(`${PYRA}/bc/station_detail/code.html`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (!/core\/fwi-core\.js/.test(r.text)) throw new Error('engine script tag missing');
    return `200 in ${r.ms} ms`;
  }),
  check('Pyra index', 'FAIL', async () => {
    const r = await get(`${PYRA}/`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return `200 in ${r.ms} ms`;
  }),
  check('Pyra CWFIS carry-over mirror fresh', 'FAIL', async () => {
    const r = await get(`${PYRA}/data/cwfis_prev.json`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.text);
    const n = Object.keys(j.stations || {}).length + Object.keys(j.bcStations || {}).length;
    return `${fresh('cwfis_prev.json', j.generated)}, ${n} stations`;
  }),
  check('Pyra BCWS noon mirror fresh', 'FAIL', async () => {
    const r = await get(`${PYRA}/data/bcws_noon.json`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.text);
    return `${fresh('bcws_noon.json', j.generated)}, ${Object.keys(j.stations || {}).length} stations, obs ${j.date}`;
  }),
  check('Pyra AEF pmwx mirror fresh', 'FAIL', async () => {
    const r = await get(`${PYRA}/data/aef_pmwx.csv`, { headers: { range: 'bytes=0-4000' } });
    if (r.status !== 200 && r.status !== 206) throw new Error(`HTTP ${r.status}`);
    const m = r.text.match(/\b(20\d\d-\d\d-\d\d) 12:00:00\b/);
    if (!m) throw new Error('no weather_date found in the first rows');
    return fresh('aef_pmwx.csv newest row', m[1] + 'T19:00:00Z');
  }),
  check('Pyra Red Flag relay file', 'FAIL', async () => {
    // The relay only commits when the Watch/Warning status changes, so the file's own
    // timestamp is not a freshness signal; the workflow run below is.
    const r = await get(`${PYRA}/data/ab_redflag.json`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.text);
    return `parses, issued ${j.issued || 'none'}, ${(j.products || []).length} products`;
  }),
  // Scheduled runs on GitHub start up to ~3 h late, so the 17:30 / 22:30 UTC slots land ~20 h apart at worst.
  // 14 h raised a false alarm every afternoon (issues #9–#12); 26 h still catches a whole missed day.
  check('Pyra ab-redflag workflow ran (26 h)', 'FAIL', () => workflowRan('ab-redflag.yml', 26)),
  check('Pyra cwfis-daily workflow ran (26 h)', 'FAIL', () => workflowRan('cwfis-daily.yml', 26)),
  check('FireSim API health', 'FAIL', async () => {
    const r = await get(`${FIRESIM_API}/api/v1/health`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.text);
    if (j.status !== 'healthy') throw new Error(`status ${j.status}`);
    return `healthy, up ${Math.round(j.uptime_seconds / 3600)} h, archive ${j.archive?.runs ?? '?'} runs durable=${j.archive?.durable}, ${r.ms} ms`;
  }),
  check('FireSim API version', 'FAIL', async () => {
    const r = await get(`${FIRESIM_API}/api/v1/version`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.text);
    if (!j.git_sha || j.git_sha === 'unknown') throw new Error('git_sha unknown');
    return `${j.version} @ ${j.git_sha.slice(0, 8)}`;
  }),
  check('FireSim frontend', 'FAIL', async () => {
    const r = await get(`${FIRESIM_APP}/`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (!/<div id="root"/.test(r.text) && !/FireSim/i.test(r.text)) throw new Error('app root missing');
    return `200 in ${r.ms} ms`;
  }),
  check('Upstream CWFIS WFS', 'WARN', async () => {
    const r = await get('https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=public:firewx_stns_current&outputFormat=application/json&count=1');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return `200 in ${r.ms} ms`;
  }),
  check('Upstream ECCC SWOB', 'WARN', async () => {
    const r = await get('https://api.weather.gc.ca/collections/swob-realtime/items?limit=1&f=json');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return `200 in ${r.ms} ms`;
  }),
  check('Upstream Open-Meteo GEM', 'WARN', async () => {
    const r = await get('https://api.open-meteo.com/v1/forecast?latitude=53.5&longitude=-113.5&hourly=temperature_2m&models=gem_seamless&forecast_days=1');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return `200 in ${r.ms} ms`;
  }),
]);

const fails = results.filter(r => !r.ok && r.level === 'FAIL');
const warns = results.filter(r => !r.ok && r.level === 'WARN');
const report = { checked_at: new Date(now).toISOString(), ok: fails.length === 0, fails: fails.length, warns: warns.length, results };

if (json) {
  console.log(JSON.stringify(report, null, 1));
} else {
  for (const r of results) console.log(`${r.ok ? 'ok  ' : r.level} ${r.name} — ${r.detail}`);
  console.log(`\n${fails.length} fail, ${warns.length} warn — ${report.checked_at}`);
}
process.exit(fails.length ? 1 : 0);
