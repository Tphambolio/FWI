/**
 * Source-tier selection (fetchWeatherPrimary → initFWI) for AB and BC.
 *
 * AB: pre-noon MST (UTC−7) the CWFIS layer still holds yesterday's chain →
 *     cache it as the holding carry-over and use the 22 UTC peak-burn forecast;
 *     post-noon → CWFIS (cross-checked against SWOB) → SWOB → Open-Meteo.
 * BC: BCWS noon mirror + CWFIS + SWOB fetched together; a chain is primary only
 *     if dated today in PST (UTC−8); the nearer of BCWS/CWFIS wins; otherwise
 *     SWOB → today's CWFIS weather-only → Open-Meteo, with initFWI stepping
 *     the cwfis_prev carry-over.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINES, makeContext, lstClock, fc, stationFeature, cwfisWxOnly, swobNear,
  prevPayload, cwfisFeature, TODAY, YDAY, rep,
} from './_harness.mjs';

const [AB, BC] = ENGINES;
const primary = (h, e) => h.run(`fetchWeatherPrimary(${e.lat}, ${e.lng})`);
const init = async (h, e) => { await h.run(`initFWI(${e.lat}, ${e.lng}, '${e.name}')`); return h.run('_lastFWI'); };
const swobCalls = h => h.calls.filter(c => c.route === 'swob').length;

for (const e of ENGINES) {
  const post = lstClock(e, 7, 15, 13); // 13:00 LST — after the noon obs

  test(`${e.prov}: post-noon, CWFIS has today's chain → CWFIS chain is used as-is`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { cwfis: fc([stationFeature(e, { rep_date: rep(TODAY) })]) } });
    const w = await primary(h, e);
    assert.equal(w.fwiFromCWFIS, true);
    assert.equal(w.source, `CWFIS · ${e.cwfisName}`);
    assert.equal(w.ffmc, 89);
    const r = await init(h, e);
    assert.equal(r.ffmc, 89);
    assert.equal(r.dc, 350);
    assert.equal(r._obsDate, TODAY);
    assert.equal(r._cachedFWI, undefined, 'no carry-over involved');
  });

  test(`${e.prov}: post-noon, CWFIS returns 0 features → yesterday's cwfis_prev chain is stepped forward`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { prev: prevPayload(post, rep(YDAY)) } });
    const w = await primary(h, e);
    assert.equal(w.fwiFromCWFIS, false);
    assert.match(w.source, /^Open-Meteo NWP/);
    const r = await init(h, e);
    assert.equal(r._cachedFWI.src, 'daily');
    assert.equal(r._cachedFWI.final, false);
    assert.ok(r.dc > e.prevDC, `DC stepped from ${e.prevDC} (got ${r.dc})`);
    assert.equal(r._obsDate, TODAY);
  });

  test(`${e.prov}: post-noon, CWFIS weather-only (no codes) today and no SWOB → CWFIS weather with FWI calc, no codes`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { cwfis: fc([cwfisWxOnly({ name: e.cwfisName, lat: e.lat, lon: e.lng, rep_date: rep(TODAY) })]) } });
    const w = await primary(h, e);
    assert.equal(w.fwiFromCWFIS, false);
    assert.equal(w.source, `CWFIS · ${e.cwfisName} · FWI calc`);
    assert.equal(w.ffmc, null);
    assert.equal(w.temp, 24);
    const r = await init(h, e);
    assert.equal(r._inactive, true, 'no carry-over available → PENDING');
  });

  test(`${e.prov}: post-noon, CWFIS temp differs by >8 °C from SWOB within 25 km → SWOB weather + CWFIS chain`, async () => {
    const h = makeContext(e.path, { now: post, mocks: {
      cwfis: fc([stationFeature(e, { temp: 24, rep_date: rep(TODAY) })]),
      swob: fc([swobNear(e, post, { temp: 10 })]),
    } });
    const w = await primary(h, e);
    assert.equal(w.temp, 10, 'SWOB weather');
    assert.match(w.source, /^MSC SWOB · MSC AIRPORT/);
    assert.equal(w.fwiFromCWFIS, true, 'chain kept');
    assert.equal(w.ffmc, 89);
    assert.equal(w.dc, 350);
    assert.equal(w.stationName, e.cwfisName, 'chain station name kept');
    assert.equal(w.repDate, rep(TODAY));
  });

  test(`${e.prov}: post-noon, CWFIS/SWOB temps within 8 °C → CWFIS weather is kept`, async () => {
    const h = makeContext(e.path, { now: post, mocks: {
      cwfis: fc([stationFeature(e, { temp: 24, rep_date: rep(TODAY) })]),
      swob: fc([swobNear(e, post, { temp: 17 })]),
    } });
    const w = await primary(h, e);
    assert.equal(w.temp, 24);
    assert.equal(w.source, `CWFIS · ${e.cwfisName}`);
  });

  test(`${e.prov}: post-noon, a disagreeing SWOB station farther than 25 km does not override CWFIS`, async () => {
    const h = makeContext(e.path, { now: post, mocks: {
      cwfis: fc([stationFeature(e, { temp: 24, rep_date: rep(TODAY) })]),
      swob: fc([swobNear(e, post, { temp: 10, lat: e.lat + 0.4 })]), // ~44 km
    } });
    const w = await primary(h, e);
    assert.equal(w.temp, 24);
    assert.match(w.source, /^CWFIS/);
  });

  test(`${e.prov}: post-noon, only SWOB has data → SWOB obs labelled noon LST`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { swob: fc([swobNear(e, post, { temp: 21 })]) } });
    const w = await primary(h, e);
    assert.equal(w.source, 'MSC SWOB · MSC AIRPORT (noon LST)');
    assert.equal(w.temp, 21);
    assert.equal(w.fwiFromCWFIS, false);
    assert.equal(w.distKm, 1);
  });

  test(`${e.prov}: CWFIS, SWOB, BCWS and cwfis_prev all fail → Open-Meteo NWP noon LST`, async () => {
    const boom = new TypeError('Failed to fetch');
    const h = makeContext(e.path, { now: post, mocks: { cwfis: boom, swob: boom, bcws: boom, prev: boom } });
    const w = await primary(h, e);
    assert.equal(w.source, 'Open-Meteo NWP (noon LST)');
    assert.equal(w.temp, e.noonUTC + 0.15, `${e.noonUTC} UTC slot selected`);
    const r = await init(h, e);
    assert.equal(r._inactive, true);
  });

  test(`${e.prov}: when Open-Meteo also fails, initFWI shows "Data unavailable"`, async () => {
    const boom = new TypeError('Failed to fetch');
    const h = makeContext(e.path, { now: post, mocks: { cwfis: boom, swob: boom, bcws: boom, prev: boom, openmeteo: boom } });
    await h.run(`initFWI(${e.lat}, ${e.lng}, '${e.name}')`);
    assert.equal(h.dom.text('updated'), 'Data unavailable');
  });
}

// ─── Alberta-specific clock windows (UTC−7, noon = 19 UTC) ───────────────────

test('AB: pre-noon MST with CWFIS chain present → holding cache written, weather from 22 UTC peak-burn forecast', async () => {
  const pre = lstClock(AB, 7, 15, 9); // 09:00 MST = 16 UTC
  const h = makeContext(AB.path, { now: pre, mocks: {
    cwfis: fc([stationFeature(AB, { rep_date: rep(YDAY) })]),
    swob: fc([swobNear(AB, pre, { temp: 5 })]),
  } });
  const w = await primary(h, AB);
  assert.equal(w.fwiFromCWFIS, false, 'yesterday chain not presented as today');
  assert.equal(w.source, 'Open-Meteo NWP (peak burn forecast · 16:00 MDT)');
  assert.equal(w.temp, 22.15, 'Open-Meteo slot 2026-07-15T22:00');
  assert.equal(swobCalls(h), 0, 'SWOB is not consulted before noon');
  const hold = JSON.parse(h.storage.get(h.run(`_holdKey(${AB.lat}, ${AB.lng})`)));
  assert.equal(hold.ffmc, 89);
  assert.equal(hold.dc, 350);
  assert.equal(hold.repDate, rep(YDAY));
  assert.equal(hold.stationName, AB.cwfisName);

  const r = await init(h, AB);
  assert.equal(r._cachedFWI.src, 'holding');
  assert.equal(r._cachedFWI.final, false);
  assert.ok(r.dc > 350, 'holding chain stepped one day forward');
  assert.equal(r._obsDate, TODAY);
});

test('AB: pre-noon MST with only SWOB → SWOB skipped, peak-burn NWP used', async () => {
  const pre = lstClock(AB, 7, 15, 9);
  const h = makeContext(AB.path, { now: pre, mocks: { swob: fc([swobNear(AB, pre)]) } });
  const w = await primary(h, AB);
  assert.equal(w.source, 'Open-Meteo NWP (peak burn forecast · 16:00 MDT)');
  assert.equal(swobCalls(h), 0);
});

test('AB: 18:00 MST is post-noon (not pre-noon wrapped past UTC midnight) → today\'s CWFIS chain used', async () => {
  const eve = lstClock(AB, 7, 15, 18); // 01:00 UTC on the 16th
  const h = makeContext(AB.path, { now: eve, mocks: { cwfis: fc([stationFeature(AB, { rep_date: rep(TODAY) })]) } });
  const w = await primary(h, AB);
  assert.equal(w.fwiFromCWFIS, true);
  assert.match(w.source, /^CWFIS/);
});

test('AB: post-noon, CWFIS weather-only is preferred over a SWOB station (AB order differs from BC)', async () => {
  const post = lstClock(AB, 7, 15, 13);
  const h = makeContext(AB.path, { now: post, mocks: {
    cwfis: fc([cwfisWxOnly({ name: AB.cwfisName, lat: AB.lat, lon: AB.lng, temp: 24, rep_date: rep(TODAY) })]),
    swob: fc([swobNear(AB, post, { temp: 22 })]),
  } });
  const w = await primary(h, AB);
  assert.equal(w.source, `CWFIS · ${AB.cwfisName} · FWI calc`);
});

// ─── BC-specific (UTC−8, noon = 20 UTC, BCWS tier) ───────────────────────────

const bcwsMirror = (date, extra = {}) => ({
  date, generated: `${date}T21:00:00Z`,
  stations: { 322: { name: 'Kamloops BCWS', temp: 26, rh: 25, wind: 10, wdir: 200, rain: 0, ffmc: 91, dmc: 60, dc: 400, isi: 8, bui: 90, fwi: 25, ...extra } },
});

test('BC: today\'s BCWS mirror wins over a farther CWFIS chain (nearer station wins)', async () => {
  const post = lstClock(BC, 7, 15, 13);
  const h = makeContext(BC.path, { now: post, mocks: {
    bcws: bcwsMirror(TODAY),
    cwfis: fc([cwfisFeature({ name: 'FAR CWFIS', lat: BC.lat + 0.2, lon: BC.lng, rep_date: rep(TODAY) })]), // ~22 km
  } });
  const w = await primary(h, BC);
  assert.match(w.source, /^BCWS Datamart · Kamloops BCWS \(\d+ km\)$/);
  assert.equal(w.ffmc, 91);
  assert.equal(w.fwiFromCWFIS, true);
  assert.equal(w.repDate, TODAY);
  assert.ok(w.distKm < 22);
});

test('BC: a co-located CWFIS chain dated today beats a farther BCWS station', async () => {
  const post = lstClock(BC, 7, 15, 13);
  const h = makeContext(BC.path, { now: post, mocks: {
    bcws: bcwsMirror(TODAY), cwfis: fc([stationFeature(BC, { rep_date: rep(TODAY) })]),
  } });
  const w = await primary(h, BC);
  assert.equal(w.source, `CWFIS · ${BC.cwfisName}`);
  assert.equal(w.ffmc, 89);
});

test('BC: a BCWS mirror dated yesterday (PST) is ignored', async () => {
  const post = lstClock(BC, 7, 15, 13);
  const h = makeContext(BC.path, { now: post, mocks: { bcws: bcwsMirror(YDAY) } });
  const w = await primary(h, BC);
  assert.match(w.source, /^Open-Meteo NWP/);
});

test('BC: BCWS chain + disagreeing SWOB → SWOB weather, BCWS chain, chainSource records BCWS', async () => {
  const post = lstClock(BC, 7, 15, 13);
  const h = makeContext(BC.path, { now: post, mocks: {
    bcws: bcwsMirror(TODAY, { temp: 30 }),
    swob: fc([swobFeature322(post)]),
  } });
  const w = await primary(h, BC);
  assert.equal(w.temp, 12);
  assert.equal(w.ffmc, 91);
  assert.match(w.chainSource, /^BCWS/);
});
function swobFeature322(now) {
  // SWOB co-located with the reference point, so distKm ≤ 25
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [BC.lng, BC.lat] },
    properties: { air_temp: 12, rel_hum: 60, avg_wnd_spd_10m_pst1hr: 8, 'date_tm-value': new Date(now).toISOString(), 'stn_nam-value': 'KAMLOOPS AUT' } };
}

for (const [label, hour] of [['pre-noon (09:00 PST)', 9], ['post-noon (13:00 PST)', 13]]) {
  test(`BC: ${label}, CWFIS chain dated yesterday is not primary → SWOB used`, async () => {
    const now = lstClock(BC, 7, 15, hour);
    const h = makeContext(BC.path, { now, mocks: {
      cwfis: fc([stationFeature(BC, { rep_date: rep(YDAY) })]), swob: fc([swobNear(BC, now, { temp: 19 })]),
    } });
    const w = await primary(h, BC);
    assert.match(w.source, /^MSC SWOB · MSC AIRPORT/);
    assert.equal(w.fwiFromCWFIS, false);
  });
}

test('BC: pre-noon, yesterday\'s CWFIS chain and no SWOB → NWP + initFWI steps the cwfis_prev carry-over', async () => {
  const pre = lstClock(BC, 7, 15, 9); // 17 UTC
  const h = makeContext(BC.path, { now: pre, mocks: {
    cwfis: fc([stationFeature(BC, { rep_date: rep(YDAY) })]), prev: prevPayload(pre, rep(YDAY)),
  } });
  const w = await primary(h, BC);
  assert.equal(w.source, 'Open-Meteo NWP (pre-noon — best available)');
  assert.equal(w.temp, 17.15, 'current-hour slot 2026-07-15T17:00');
  const r = await init(h, BC);
  assert.equal(r._cachedFWI.src, 'daily');
  assert.equal(r._cachedFWI.final, false);
  assert.ok(r.dc > BC.prevDC);
  assert.equal(r._obsDate, TODAY);
});

test('BC: post-noon, CWFIS weather-only today + SWOB → SWOB preferred (BC order differs from AB)', async () => {
  const post = lstClock(BC, 7, 15, 13);
  const h = makeContext(BC.path, { now: post, mocks: {
    cwfis: fc([cwfisWxOnly({ name: BC.cwfisName, lat: BC.lat, lon: BC.lng, rep_date: rep(TODAY) })]),
    swob: fc([swobNear(BC, post, { temp: 22 })]),
  } });
  const w = await primary(h, BC);
  assert.match(w.source, /^MSC SWOB/);
});

test('BC: CWFIS weather-only dated yesterday is not used → NWP', async () => {
  const post = lstClock(BC, 7, 15, 13);
  const h = makeContext(BC.path, { now: post, mocks: {
    cwfis: fc([cwfisWxOnly({ name: BC.cwfisName, lat: BC.lat, lon: BC.lng, rep_date: rep(YDAY) })]),
  } });
  const w = await primary(h, BC);
  assert.match(w.source, /^Open-Meteo NWP/);
});
