/**
 * Date / timezone helpers (AB + BC).
 * AB: LST = UTC−7 (noon 19 UTC), daylight = MDT UTC−6, peak burn 16:00 MDT = 22 UTC.
 * BC: LST = UTC−8 (noon 20 UTC), daylight = PDT UTC−7, peak burn 16:00 PDT = 23 UTC.
 * The vm runs with TZ=America/Edmonton (see _harness.mjs) so viewer-clock
 * leaks (getMonth vs getUTCMonth etc.) reproduce on CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext, lstClock, HOUR, lit, openMeteoFor } from './_harness.mjs';

const [AB, BC] = ENGINES;
const at = (h, m = 0) => Date.UTC(2026, 6, 15, h, m); // 2026-07-15 hh:mm UTC

for (const e of ENGINES) {
  test(`${e.prov}: _lstDateStr rolls to the new CFFDRS day exactly at local-standard midnight (${e.lstOffset}:00 UTC)`, () => {
    const { run } = makeContext(e.path, { now: at(12) });
    assert.equal(run(`_lstDateStr(${at(e.lstOffset - 1, 59)})`), '2026-07-14');
    assert.equal(run(`_lstDateStr(${at(e.lstOffset, 0)})`), '2026-07-15');
    assert.equal(run('_lstDateStr()'), '2026-07-15', 'defaults to the pinned clock');
  });

  test(`${e.prov}: _lstDateStr default follows the pinned clock across UTC midnight`, () => {
    const { run } = makeContext(e.path, { now: Date.UTC(2026, 6, 16, 2) }); // evening of the 15th locally
    assert.equal(run('_lstDateStr()'), '2026-07-15');
  });

  test(`${e.prov}: ${e.localDateFn} rolls over at daylight-time midnight (${e.localOffset}:00 UTC)`, () => {
    const { run } = makeContext(e.path, { now: at(12) });
    assert.equal(run(`${e.localDateFn}(${at(e.localOffset - 1, 59)})`), '2026-07-14');
    assert.equal(run(`${e.localDateFn}(${at(e.localOffset, 0)})`), '2026-07-15');
    assert.equal(run(`${e.localDateFn}()`), '2026-07-15');
  });

  // Forecast days at the province's noon-UTC slot, Jul 14..18
  const days = [14, 15, 16, 17, 18].map(d => ({ _ts: Date.UTC(2026, 6, d, e.noonUTC), label: `d${d}` }));
  const peakPick = now => {
    const { run } = makeContext(e.path, { now });
    const i = run(`_nextPeakDayIdx(${lit(days)})`);
    return days[i].label;
  };

  test(`${e.prov}: _nextPeakDayIdx picks today before 16:00 local daylight time`, () => {
    assert.equal(peakPick(at(15 + e.localOffset)), 'd15');          // 15:00 local
    assert.equal(peakPick(at(15 + e.localOffset, 59)), 'd15');      // 15:59 local
  });

  test(`${e.prov}: _nextPeakDayIdx picks tomorrow from 16:00 local through late evening`, () => {
    assert.equal(peakPick(at(16 + e.localOffset)), 'd16');          // 16:00 local
    assert.equal(peakPick(at(17 + e.localOffset)), 'd16');          // 17:00 local (UTC day rolled for AB)
    assert.equal(peakPick(at(23 + e.localOffset, 30)), 'd16');      // 23:30 local, next UTC day
  });

  test(`${e.prov}: fetchWeather after 17:00 local still targets today's noon (${e.noonUTC} UTC), not tomorrow's`, async () => {
    const eve = lstClock(e, 7, 15, 18); // 18:00 LST, next UTC day
    const { run } = makeContext(e.path, { now: eve });
    const w = await run(`fetchWeather(${e.lat}, ${e.lng})`);
    assert.equal(w.temp, e.noonUTC + 0.15, `slot 2026-07-15T${e.noonUTC}:00`);
    assert.equal(w.source, 'Open-Meteo NWP (noon LST)');
  });

  test(`${e.prov}: fetchWeather post-noon targets ${e.noonUTC} UTC`, async () => {
    const { run } = makeContext(e.path, { now: lstClock(e, 7, 15, 13) });
    const w = await run(`fetchWeather(${e.lat}, ${e.lng})`);
    assert.equal(w.temp, e.noonUTC + 0.15);
  });

  test(`${e.prov}: fetchWeather rain is the 24-h sum ending at the target hour (inclusive)`, async () => {
    const target = Date.UTC(2026, 6, 15, e.noonUTC);
    const precip = t => ({ [target - 24 * HOUR]: 5, [target - 23 * HOUR]: 1, [target]: 2, [target + HOUR]: 7 })[t] ?? 0;
    const now = lstClock(e, 7, 15, 13);
    const { run } = makeContext(e.path, { now, mocks: { openmeteo: url => openMeteoFor(url, now, { precip }) } });
    const w = await run(`fetchWeather(${e.lat}, ${e.lng})`);
    assert.equal(w.rain, 3, 'includes T−23h and T; excludes T−24h and T+1h');
  });

  test(`${e.prov}: fetchForecastNAEFS takes the month from the UTC date (1st of month stays in that month)`, async () => {
    const naefs = { features: [
      { properties: { date_time: '2026-11-01T00:00:00Z', max_temp: 5, min_rh: 50, median_ws: 10, median_pcp: 0 } },
      { properties: { date_time: '2026-10-31T00:00:00Z', max_temp: 6, min_rh: 50, median_ws: 10, median_pcp: 0 } },
    ] };
    const { run } = makeContext(e.path, { now: Date.UTC(2026, 9, 30, 20), mocks: { naefs } });
    const days = await run('fetchForecastNAEFS(10164)');
    assert.equal(days[0].month, 10);
    assert.equal(days[1].month, 11, 'Nov 1 00:00 UTC is month 11, not the viewer-local Oct 31');
    assert.equal(run(`${e.localDateFn}(${days[1]._ts})`), '2026-11-01', 'same calendar date locally');
  });

  test(`${e.prov}: calculateFBP day-of-year is 1 on Jan 1 when opts.doy is not given`, () => {
    for (const [now, want] of [[Date.UTC(2026, 0, 1, 19), 1], [Date.UTC(2026, 0, 2, 19), 2], [Date.UTC(2025, 11, 31, 19), 365]]) {
      const { run } = makeContext(e.path, { now });
      run(`{ const orig = calcFMC; calcFMC = (lat, lng, doy) => { globalThis.__doy = doy; return orig(lat, lng, doy); }; }`);
      const r = run(`calculateFBP('C2', 90, 50, 300, 15, 0, 100, 50, { doy: undefined })`);
      assert.ok(r, 'FBP result');
      assert.equal(run('globalThis.__doy'), want, new Date(now).toISOString());
    }
  });
}

// ─── Province-specific target-hour behaviour ──────────────────────────────────

test('AB: fetchWeather pre-noon MST targets the 22 UTC peak-burn hour of today', async () => {
  const { run } = makeContext(AB.path, { now: lstClock(AB, 7, 15, 9) });
  const w = await run(`fetchWeather(${AB.lat}, ${AB.lng})`);
  assert.equal(w.temp, 22.15);
  assert.equal(w.source, 'Open-Meteo NWP (peak burn forecast · 16:00 MDT)');
});

// Headline policy (2026-10-07): before noon both provinces show today's 16:00
// peak-burn forecast (BC previously used the current hour).
test('BC: fetchWeather pre-noon PST targets the 23 UTC peak-burn hour of today', async () => {
  const { run } = makeContext(BC.path, { now: lstClock(BC, 7, 15, 9) }); // 17 UTC
  const w = await run(`fetchWeather(${BC.lat}, ${BC.lng})`);
  assert.equal(w.temp, 23.15);
  assert.equal(w.source, 'Open-Meteo NWP (peak burn forecast · 16:00 PDT)');
});


// ─── Forecast composition (2026-10-08) ───────────────────────────────────────
// GEM (exact noon-LST/16:00 hours) first; NAEFS only beyond its horizon, using
// ensemble medians (max_temp/min_rh biased the chain dry).
for (const e of ENGINES) {
  test(`${e.prov}: fetchForecastDays — GEM days first, NAEFS medians only beyond the GEM horizon`, async () => {
    const now = lstClock(e, 7, 15, 9);
    const naefsDay = (d, extra = {}) => ({ type: 'Feature', geometry: null, properties: {
      date_time: `2026-07-${String(d).padStart(2, '0')}Z`, max_temp: 30, median_temp: 20, min_temp: 8,
      max_rh: 90, median_rh: 45, min_rh: 20, median_ws: 12, median_pcp: 0, ...extra } });
    const feats = Array.from({ length: 16 }, (_, i) => naefsDay(15 + i));
    const h = makeContext(e.path, { now, mocks: { naefs: { type: 'FeatureCollection', features: feats } } });
    const st = h.run(`JSON.stringify(PROVINCE.defaultStation)`);
    const { lat, lng } = JSON.parse(st);
    const out = await h.run(`fetchForecastDays(${lat}, ${lng})`);
    const ec = out.days.filter(d => !d.ensembleTail), tail = out.days.filter(d => d.ensembleTail);
    assert.ok(ec.length >= 6, `GEM days ${ec.length}`);
    const lastEc = new Date(ec[ec.length - 1]._ts).toISOString().slice(0, 10);
    for (const d of tail) {
      assert.ok(new Date(d._ts).toISOString().slice(0, 10) > lastEc, 'NAEFS only after GEM');
      assert.equal(d.temp, 20, 'median_temp, not max_temp');
      assert.equal(d.rh, 45, 'median_rh, not min_rh');
    }
    if (h.run('findNearestNAEFS(' + lat + ',' + lng + ')')) assert.ok(tail.length > 0, 'tail present when NAEFS station exists');
  });
}
