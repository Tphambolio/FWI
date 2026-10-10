/**
 * Noon chain (FireSim vs Pyra comparison 2026-10-10, mismatch M2).
 *
 * Van Wagner (1987, FTR-35, PDF p. 13 / printed p. 2): the daily codes are
 * computed "from noon weather readings" (noon LST) but "represent fire danger
 * at its midafternoon peak". Before noon, Pyra used to step yesterday's codes
 * with the 16:00 forecast hour, counting the afternoon drying twice.
 *
 * Report example: carry-over 88/40/300 in July; noon 24 °C / 30 % / 15 km/h;
 * 16:00 local 27 °C / 22 % / 20 km/h; no rain.
 *   stepped with noon weather   → FFMC 91.3, ISI 11.0, FWI 27.2 (daily)
 *   noon codes + 16:00 wind     → ISI 14.1, FWI 32.2            (peak burn)
 *   stepped with 16:00 weather  → FWI 39.9                      (old, wrong)
 * Expectations come from the independent oracle in tests/reference.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext, lstClock, openMeteoFor, prevPayload, rep, YDAY, TODAY } from './_harness.mjs';
import { refFFMC, refDMC, refDC, refISI, refBUI, refFWI } from './reference.mjs';

const PREV = { ffmc: 88, dmc: 40, dc: 300 };
const NOON = { temp: 24, rh: 30, wind: 15 };
const PEAK = { temp: 27, rh: 22, wind: 20 };
const OTHER = { temp: 10, rh: 80, wind: 5 }; // any other hour: must never be used

const ref = (w) => {
  const ffmc = refFFMC(w.temp, w.rh, w.wind, 0, PREV.ffmc);
  const dmc = refDMC(w.temp, w.rh, 0, 7, PREV.dmc);
  const dc = refDC(w.temp, 0, 7, PREV.dc);
  const bui = refBUI(dmc, dc);
  return { ffmc, dmc, dc, bui, isi: refISI(ffmc, w.wind), fwi: refFWI(refISI(ffmc, w.wind), bui) };
};
const daily = ref(NOON);
const peakFWI = refFWI(refISI(daily.ffmc, PEAK.wind), daily.bui);
const oldFWI = ref(PEAK).fwi;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

test('report example reproduces with the oracle (27.2 daily, 32.2 peak, 39.9 old)', () => {
  close(daily.ffmc, 91.3, 0.06, 'FFMC');
  close(daily.isi, 11.0, 0.06, 'ISI');
  close(daily.fwi, 27.2, 0.06, 'daily FWI');
  close(peakFWI, 32.2, 0.06, 'peak FWI');
  close(oldFWI, 39.9, 0.06, 'old FWI');
});

for (const e of ENGINES) {
  const peakUTC = e.noonUTC + 3; // 16:00 local daylight time (= 15:00 LST)
  const pick = k => t => {
    const h = new Date(t).getUTCHours();
    return (h === e.noonUTC ? NOON : h === peakUTC ? PEAK : OTHER)[k];
  };
  const mocks = now => ({
    openmeteo: url => openMeteoFor(url, now, { temp: pick('temp'), rh: pick('rh'), wind: pick('wind') }),
    prev: prevPayload(now, rep(YDAY), { ffmc: PREV.ffmc, dmc: PREV.dmc, dc: PREV.dc }),
  });

  test(`${e.prov}: pre-noon (09:00 LST) the carry-over is stepped with the noon-LST forecast, not 16:00`, async () => {
    const now = lstClock(e, 7, 15, 9);
    const h = makeContext(e.path, { now, mocks: mocks(now) });
    await h.run(`initFWI(${e.lat}, ${e.lng}, '${e.name}')`);
    const r = h.run('_lastFWI');
    assert.equal(r._cachedFWI.obsDate, YDAY);
    assert.equal(r._obsDate, TODAY);
    for (const k of ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi']) close(r[k], daily[k], 1e-6, k);
    // Peak burn: same codes, 16:00 wind only
    close(r.peak.wind, PEAK.wind, 1e-9, 'peak wind');
    close(r.peak.fwi, peakFWI, 1e-6, 'peak FWI');
    assert.ok(Math.abs(r.peak.fwi - oldFWI) > 5, `must not reproduce the double-counted ${oldFWI.toFixed(1)}`);
  });

  test(`${e.prov}: post-noon NWP fallback gives the same chain as pre-noon (one consistent definition)`, async () => {
    const now = lstClock(e, 7, 15, 14);
    const h = makeContext(e.path, { now, mocks: mocks(now) });
    await h.run(`initFWI(${e.lat}, ${e.lng}, '${e.name}')`);
    const r = h.run('_lastFWI');
    for (const k of ['ffmc', 'dmc', 'dc', 'fwi']) close(r[k], daily[k], 1e-6, k);
    close(r.peak.fwi, peakFWI, 1e-6, 'peak FWI');
  });

  test(`${e.prov}: briefing forecast (fetchStationDataForecast) steps with noon wind; ISI/FWI at the 16:00 wind`, async () => {
    const now = lstClock(e, 7, 15, 9);
    const h = makeContext(e.path, { now, mocks: mocks(now) });
    const r = await h.run(`fetchStationDataForecast({ name: '${e.name}', lat: ${e.lat}, lng: ${e.lng} })`);
    close(r.fwi.ffmc, daily.ffmc, 1e-6, 'FFMC stepped with noon wind');
    close(r.fwi.fwi, peakFWI, 1e-6, 'peak FWI');
    close(r.fwi.daily.fwi, daily.fwi, 1e-6, 'daily FWI');
    assert.equal(r.weather.wind, PEAK.wind, 'FBP wind = 16:00');
  });
}
