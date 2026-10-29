/**
 * Tier 3 model weather from the ECCC GEM point series (core/gem.js +
 * core/fwi-core.js _nwpHourly), and the flagged Open-Meteo fallback.
 *
 *   - the file is read once per page and serves fetchWeather / fetchForecast /
 *     fetchHourly / fetchHourlyOutlook with the GeoMet labels and no third-party call;
 *   - windowing: days mode from 00 UTC `pastDays` ago, hours mode ending at the
 *     current hour, nulls outside the file's span, noon-LST slot and 24-h rain
 *     window unchanged (science rules live in the core and are not touched here);
 *   - staleness (> max_age_h), a missing file, or a station with no point within
 *     1 km → Open-Meteo only while config/weather.js says fallback: 'open-meteo';
 *     with 'none' a stale file is still used (labelled) and a missing one fails
 *     the tier like a dead network did before;
 *   - station elevation from data/station_elevation.json; the pin-slope DEM call
 *     is gated by the same flag; provenance names the network "ECCC GEM".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext, lstClock, openMeteoFor, gemFileFor, prevPayload, rep, YDAY, HOUR, lit } from './_harness.mjs';

const pts = e => [{ name: e.name, lat: e.lat, lng: e.lng }];
const probe = 'https://api.open-meteo.com/v1/forecast?past_days=2&forecast_days=10&timezone=UTC';
const calls = (h, route) => h.calls.filter(c => c.route === route);
const boom = () => new TypeError('Failed to fetch');

for (const e of ENGINES) {
  const post = lstClock(e, 7, 15, 13);   // 13:00 LST, mid-season
  const prov = e.prov.toLowerCase();

  test(`${e.prov}: Tier 3 reads data/gem/${prov}.json — noon-LST slot, GeoMet label, no Open-Meteo call`, async () => {
    const h = makeContext(e.path, { now: post });
    const w = await h.run(`fetchWeather(${e.lat}, ${e.lng})`);
    assert.equal(w.source, 'ECCC GEM (GeoMet) · noon LST');
    assert.equal(w.nwpSource, 'gem');
    assert.equal(w.temp, e.noonUTC + 0.15, `${e.noonUTC} UTC slot selected from the file`);
    assert.equal(w.thunderstormProb, null, 'no thunderstorm layer in GEM → null');
    assert.equal(calls(h, 'openmeteo').length, 0, 'no third-party weather call');
    const g = calls(h, 'gem');
    assert.equal(g.length, 1);
    assert.match(g[0].url, new RegExp(`data/gem/${prov}\\.json$`), 'province file, relative to the repo root');
  });

  test(`${e.prov}: one file fetch serves weather, forecast, hourly chart and outlook`, async () => {
    const h = makeContext(e.path, { now: post });
    const [w, days, hours, outlook] = await h.run(`Promise.all([fetchWeather(${e.lat}, ${e.lng}), fetchForecast(${e.lat}, ${e.lng}), fetchHourly(${e.lat}, ${e.lng}), fetchHourlyOutlook(${e.lat}, ${e.lng})])`);
    assert.equal(calls(h, 'gem').length, 1, 'cached in memory after the first read');
    assert.equal(calls(h, 'openmeteo').length, 0);
    assert.equal(w.nwpSource, 'gem');
    assert.equal(days.nwpSource, 'gem');
    assert.equal(days.length, 7, '7 forecast days from a 10-day window');
    assert.equal(hours.length, 23, '23 chart hours');
    assert.equal(hours[22].time.getTime(), Math.floor(post / HOUR) * HOUR, 'hours mode ends at the current hour');
    assert.equal(hours[0].time.getTime(), hours[22].time.getTime() - 22 * HOUR);
    assert.equal(outlook.nwpSource, 'gem');
    assert.ok(outlook.length >= 72, `outlook has ≥ 72 hourly rows (${outlook.length})`);
  });

  test(`${e.prov}: 24-h rain to noon LST sums 24 GEM hours (fetchWeather and fetchForecast)`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { openmeteo: url => openMeteoFor(url, post, { precip: () => 0.5 }) } });
    const w = await h.run(`fetchWeather(${e.lat}, ${e.lng})`);
    assert.equal(+w.rain.toFixed(3), 12, '24 × 0.5 mm');
    const days = await h.run(`fetchForecast(${e.lat}, ${e.lng})`);
    assert.equal(+days[0].rain.toFixed(3), 12);
    assert.equal(calls(h, 'openmeteo').length, 0);
  });

  test(`${e.prov}: forecast stops at the file horizon instead of inventing the \`?? 15\` defaults`, async () => {
    // File covers 00 UTC two days ago → 00 UTC four days ahead: noon hours for today … +3 only
    const h = makeContext(e.path, { now: post, mocks: { gem: () => gemFileFor(openMeteoFor('https://x/?past_days=2&forecast_days=4', post), post, pts(e)) } });
    const days = await h.run(`fetchForecast(${e.lat}, ${e.lng})`);
    assert.equal(days.length, 4);
    assert.ok(days.every(d => d.temp !== 15 && d.rh !== 40), 'no default placeholders');
    const fd = await h.run(`fetchForecastDays(${e.lat}, ${e.lng})`);
    assert.equal(fd.source, 'ECCC GEM (GeoMet) · noon LST');
  });

  test(`${e.prov}: file older than max_age_h → Open-Meteo fallback with the Open-Meteo label`, async () => {
    const stale = gemFileFor(openMeteoFor(probe, post), post, pts(e), { generated: new Date(post - 10 * HOUR).toISOString() });
    const h = makeContext(e.path, { now: post, mocks: { gem: stale } });
    const w = await h.run(`fetchWeather(${e.lat}, ${e.lng})`);
    assert.equal(w.source, 'Open-Meteo NWP (noon LST)');
    assert.equal(w.nwpSource, 'open-meteo');
    assert.equal(w.temp, e.noonUTC + 0.15, 'same slot rule on the fallback path');
    assert.ok(calls(h, 'openmeteo').length >= 1);
    assert.equal(h.run(`PyraGEM.status('${prov}').state`), 'stale');
  });

  test(`${e.prov}: file missing (404) → Open-Meteo fallback; forecast labels say so`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { gem: { $status: 404 } } });
    const w = await h.run(`fetchWeather(${e.lat}, ${e.lng})`);
    assert.equal(w.source, 'Open-Meteo NWP (noon LST)');
    const fd = await h.run(`fetchForecastDays(${e.lat}, ${e.lng})`);
    assert.equal(fd.source, 'ECCC GEM (Open-Meteo fallback) · noon LST');
    assert.equal(h.run(`PyraGEM.status('${prov}').state`), 'missing');
  });

  test(`${e.prov}: station with no GEM point within 1 km → fallback`, async () => {
    const h = makeContext(e.path, { now: post });
    const w = await h.run(`fetchWeather(${e.lat + 0.05}, ${e.lng})`);   // ~5.5 km north
    assert.equal(w.source, 'Open-Meteo NWP (noon LST)');
    const near = await h.run(`fetchWeather(${e.lat + 0.004}, ${e.lng})`); // ~0.45 km
    assert.equal(near.source, 'ECCC GEM (GeoMet) · noon LST');
  });

  test(`${e.prov}: fallback 'none' + stale file → the stale GEM file is used and labelled; no Open-Meteo call`, async () => {
    const stale = gemFileFor(openMeteoFor(probe, post), post, pts(e), { generated: new Date(post - 10 * HOUR).toISOString() });
    const h = makeContext(e.path, { now: post, mocks: { gem: stale } });
    h.run(`window.PYRA_WEATHER.fallback = 'none'`);
    const w = await h.run(`fetchWeather(${e.lat}, ${e.lng})`);
    assert.equal(w.source, 'ECCC GEM (GeoMet, file 10 h old) · noon LST');
    assert.equal(w.nwpSource, 'gem-stale');
    assert.equal(w.temp, e.noonUTC + 0.15);
    assert.equal(calls(h, 'openmeteo').length, 0);
  });

  test(`${e.prov}: fallback 'none' + missing file → the tier fails like a dead network; initFWI shows "Data unavailable"`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { gem: { $status: 404 }, cwfis: boom(), swob: boom(), bcws: boom(), prev: boom() } });
    h.run(`window.PYRA_WEATHER.fallback = 'none'`);
    await assert.rejects(h.run(`fetchWeather(${e.lat}, ${e.lng})`), /fallback disabled/);
    assert.equal(calls(h, 'openmeteo').length, 0, 'Open-Meteo never contacted');
    await h.run(`initFWI(${e.lat}, ${e.lng}, '${e.name}')`);
    assert.equal(h.dom.text('updated'), 'Data unavailable');
  });

  test(`${e.prov}: fetchStationData steps yesterday's carry-over with GEM noon weather; D+1 names GeoMet`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { prev: prevPayload(post, rep(YDAY)) } });
    const { weather } = await h.run(`fetchStationData(${lit({ name: e.name, lat: e.lat, lng: e.lng })})`);
    assert.equal(weather.source, 'ECCC GEM (GeoMet) · noon LST');
    const d1 = await h.run(`fetchStationDataForecast(${lit({ name: e.name, lat: e.lat, lng: e.lng })})`);
    assert.match(d1.weather.source, /^ECCC GEM \(GeoMet\) · .+ · Peak ~16:00 /);
    assert.equal(d1.weather.nwpSource, 'gem');
  });

  test(`${e.prov}: provenance names the network "ECCC GEM" (model forecast, neutral); "Open-Meteo" only on the fallback label`, () => {
    const h = makeContext(e.path, { now: post });
    const p = h.run(`_provenance(${lit({ source: 'ECCC GEM (GeoMet) · noon LST' })}, null, ${post})`);
    assert.equal(p.network, 'ECCC GEM');
    assert.equal(p.kind, 'MODEL FORECAST');
    assert.equal(p.level, 'neutral');
    const q = h.run(`_provenance(${lit({ source: 'Open-Meteo NWP (noon LST)' })}, null, ${post})`);
    assert.equal(q.network, 'Open-Meteo');
    assert.equal(q.kind, 'MODEL FORECAST');
  });

  test(`${e.prov}: station elevation comes from data/station_elevation.json; the DEM API only via the fallback flag`, async () => {
    const elev = { stations: { X: { lat: e.lat, lon: e.lng, elev: 777 } } };
    const h = makeContext(e.path, { now: post, mocks: { elev } });
    assert.equal(await h.run(`_elevationFor(${e.lat}, ${e.lng})`), 777);
    assert.equal(calls(h, 'openmeteo').filter(c => /elevation/.test(c.url)).length, 0);

    const h2 = makeContext(e.path, { now: post, mocks: { elev: { $status: 404 } } });
    await h2.run(`_elevationFor(${e.lat}, ${e.lng})`);
    assert.equal(calls(h2, 'openmeteo').filter(c => /elevation/.test(c.url)).length, 1, 'fallback allowed → one DEM API call');

    const h3 = makeContext(e.path, { now: post, mocks: { elev: { $status: 404 } } });
    h3.run(`window.PYRA_WEATHER.fallback = 'none'`);
    assert.equal(await h3.run(`_elevationFor(${e.lat}, ${e.lng})`), null);
    assert.equal(calls(h3, 'openmeteo').length, 0, 'no DEM API call with fallback none');
    assert.equal(await h3.run(`_terrainAt(${e.lat}, ${e.lng})`), null, 'pin slope not read without the fallback');
    assert.equal(calls(h3, 'openmeteo').length, 0);
  });
}

// ─── core/gem.js windowing (pure) ────────────────────────────────────────────

test('core/gem.js _window: days mode starts at 00 UTC pastDays ago; hours outside the file are null; src summarised', () => {
  const e = ENGINES[0];
  const now = Date.UTC(2026, 6, 15, 20, 30);                       // 20:30 UTC
  const file = gemFileFor(openMeteoFor('https://x/?past_days=1&forecast_days=2', now), now, pts(e));   // 00Z Jul 14 → 00Z Jul 17 (72 h)
  const h = makeContext(e.path, { now });
  const w = h.run(`PyraGEM._window(${lit(file)}, { name: ${lit(e.name)}, lat: ${e.lat}, lon: ${e.lng}, s: (${lit(file)}).stations[${lit(e.name)}] }, { pastDays: 2, forecastDays: 3 }, ${now})`);
  assert.equal(w.time.length, 120);                                 // 00Z Jul 13 → 00Z Jul 18
  assert.equal(w.time[0], '2026-07-13T00:00');
  assert.equal(w.temperature_2m[0], null, 'before the file span');
  assert.equal(w.temperature_2m[24], 0 + 14 / 100, 'first stored hour (Jul 14 00Z: temp = hour + day/100)');
  assert.equal(w.temperature_2m[24 + 47], 23.15);
  assert.equal(w.temperature_2m[24 + 71], 23.16, 'last stored hour (Jul 16 23Z)');
  assert.equal(w.temperature_2m[24 + 72], null, 'after the file span');
  assert.equal(w._covered, 72);
  assert.equal(w._gem.src, '-24H72-24');
  assert.equal(w._gem.station, e.name);
});

test('core/gem.js _window: hours mode = pastHours ending at the current hour, plus forecastHours', () => {
  const e = ENGINES[0];
  const now = Date.UTC(2026, 6, 15, 20, 30);
  const file = gemFileFor(openMeteoFor('https://x/?past_days=1&forecast_days=2', now), now, pts(e));
  const h = makeContext(e.path, { now });
  const w = h.run(`PyraGEM._window(${lit(file)}, { lat: ${e.lat}, lon: ${e.lng}, s: (${lit(file)}).stations[${lit(e.name)}] }, { pastHours: 23, forecastHours: 2 }, ${now})`);
  assert.equal(w.time.length, 25);
  assert.equal(w.time[22], '2026-07-15T20:00', 'current hour is the last "past" entry');
  assert.equal(w.time[0], '2026-07-14T22:00');
  assert.equal(w.time[24], '2026-07-15T22:00');
  assert.equal(w.temperature_2m[22], 20.15);
});

test('core/gem.js _nearest honours max_point_km and skips alias entries; _isStale uses max_age_h', () => {
  const e = ENGINES[0];
  const now = Date.UTC(2026, 6, 15, 20);
  const file = gemFileFor(openMeteoFor('https://x/?past_days=1&forecast_days=1', now), now, pts(e));
  file.stations['Twin'] = { alias: e.name };
  const h = makeContext(e.path, { now });
  assert.equal(h.run(`PyraGEM._nearest(${lit(file)}, ${e.lat + 0.004}, ${e.lng}, 1).name`), e.name);
  assert.equal(h.run(`PyraGEM._nearest(${lit(file)}, ${e.lat + 0.02}, ${e.lng}, 1)`), null);
  assert.equal(h.run(`PyraGEM._nearest(${lit(file)}, ${e.lat + 0.02}, ${e.lng}, 5).name`), e.name);
  assert.equal(h.run(`PyraGEM._isStale(${lit(file)}, ${now})`), false, '1 h old');
  assert.equal(h.run(`PyraGEM._isStale(${lit(file)}, ${now + 9 * HOUR})`), true, '10 h old > 9 h');
  assert.equal(h.run(`PyraGEM.config().fallback`), 'open-meteo', 'shipped default keeps the fallback on during rollout');
  assert.equal(h.run(`PyraGEM.config().max_age_h`), 9);
});
