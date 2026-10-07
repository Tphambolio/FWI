/**
 * Carry-over chain dating (briefing helpers) and DC-floor / IDW recompute
 * (AB + BC). DC/BUI/FWI expectations come from the independent oracle in
 * tests/reference.mjs, not from the engine's own equations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINES, makeContext, lstClock, fc, stationFeature, cwfisFeature, prevPayload, TODAY, YDAY, rep, lit,
} from './_harness.mjs';
import { refDC, refBUI, refFWI } from './reference.mjs';

const [AB, BC] = ENGINES;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≉ ${b}`);
const stn = e => `({ name: '${e.name}', lat: ${e.lat}, lng: ${e.lng} })`;

for (const e of ENGINES) {
  const post = lstClock(e, 7, 15, 13);

  // ─── fetchStationData (briefing, observed) ─────────────────────────────────
  test(`${e.prov}: fetchStationData with today's cwfis_prev entry uses the codes as-is`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { prev: prevPayload(post, rep(TODAY)) } });
    const { fwi } = await h.run(`fetchStationData(${stn(e)})`);
    assert.equal(fwi.dc, e.prevDC);
    assert.equal(fwi.ffmc, e.prevFFMC);
  });

  test(`${e.prov}: fetchStationData with yesterday's cwfis_prev entry steps it once with today's weather`, async () => {
    const h = makeContext(e.path, { now: post, mocks: { prev: prevPayload(post, rep(YDAY)) } });
    const { fwi, weather } = await h.run(`fetchStationData(${stn(e)})`);
    assert.match(weather.source, /^Open-Meteo NWP \(noon LST\)/);
    close(fwi.dc, refDC(weather.temp, weather.rain, 7, e.prevDC), 'one Van Wagner day');
    assert.notEqual(fwi.ffmc, e.prevFFMC);
  });

  // ─── fetchStationDataForecast (briefing, D+1) ──────────────────────────────
  // 17:00 local daylight time: peak burn passed, target = tomorrow, and the UTC
  // day has not rolled for AB (23 UTC); for BC use 16:30 PDT (23:30 UTC).
  const afterPeak = e.prov === 'AB' ? Date.UTC(2026, 6, 15, 23) : Date.UTC(2026, 6, 15, 23, 30);

  test(`${e.prov}: fetchStationDataForecast after peak burn steps D−1 carry-over through today, then tomorrow`, async () => {
    const h = makeContext(e.path, { now: afterPeak, mocks: { prev: prevPayload(afterPeak, rep(YDAY)) } });
    const r = await h.run(`fetchStationDataForecast(${stn(e)})`);
    const days = await h.run(`fetchForecast(${e.lat}, ${e.lng})`);
    assert.equal(new Date(r.forecastDay._ts).toISOString().slice(0, 10), '2026-07-16', 'target is tomorrow');
    const today = days.find(d => new Date(d._ts).toISOString().startsWith(TODAY));
    const dcToday = refDC(today.temp, today.rain, 7, e.prevDC);
    const twoStep = refDC(r.weather.temp, r.weather.rain, 7, dcToday);
    const oneStep = refDC(r.weather.temp, r.weather.rain, 7, e.prevDC);
    close(r.fwi.dc, twoStep, 'D−1 → D → D+1');
    assert.ok(Math.abs(r.fwi.dc - oneStep) > 1, 'must not jump D−1 → D+1');
  });

  test(`${e.prov}: fetchStationDataForecast with today's carry-over steps only tomorrow`, async () => {
    const h = makeContext(e.path, { now: afterPeak, mocks: { prev: prevPayload(afterPeak, rep(TODAY)) } });
    const r = await h.run(`fetchStationDataForecast(${stn(e)})`);
    close(r.fwi.dc, refDC(r.weather.temp, r.weather.rain, 7, e.prevDC));
  });

  test(`${e.prov}: fetchStationDataForecast before peak burn targets today and steps D−1 once`, async () => {
    const now = lstClock(e, 7, 15, 9);
    const h = makeContext(e.path, { now, mocks: { prev: prevPayload(now, rep(YDAY)) } });
    const r = await h.run(`fetchStationDataForecast(${stn(e)})`);
    assert.equal(new Date(r.forecastDay._ts).toISOString().slice(0, 10), TODAY);
    close(r.fwi.dc, refDC(r.weather.temp, r.weather.rain, 7, e.prevDC));
  });

  // Regression: once the UTC day rolled (AB ≥18:00 MDT, BC ≥17:00 PDT)
  // fetchForecast's days[0] used to be tomorrow, so a D−1 carry-over was
  // stepped straight to D+1, skipping today.
  test(`${e.prov}: fetchStationDataForecast late evening (after UTC midnight) still steps through today`, async () => {
    const now = Date.UTC(2026, 6, 16, 3); // 21:00 MDT / 20:00 PDT on the 15th
    const h = makeContext(e.path, { now, mocks: { prev: prevPayload(now, rep(YDAY)) } });
    const r = await h.run(`fetchStationDataForecast(${stn(e)})`);
    const oneStep = refDC(r.weather.temp, r.weather.rain, 7, e.prevDC);
    assert.ok(Math.abs(r.fwi.dc - oneStep) > 1, `stepped once only (dc ${r.fwi.dc})`);
  });

  // ─── DC floor + BUI/FWI recompute (single station) ─────────────────────────
  const june = lstClock(e, 6, 15, 13);
  const coldStart = props => stationFeature(e, { dc: 15, dmc: 30, isi: 5, bui: 20, fwi: 8, rep_date: rep('2026-06-15'), ...props });

  test(`${e.prov}: fetchCWFIS raises a June cold-start DC=15 to the regional floor and recomputes BUI/FWI (VW 1987 eq 27a/b)`, async () => {
    const h = makeContext(e.path, { now: june, mocks: { cwfis: fc([coldStart()]) } });
    const w = await h.run(`fetchCWFIS(${e.lat}, ${e.lng}, false)`);
    const floor = e.prov === 'AB' ? 300 : 75; // Edmonton metro / Thompson
    assert.equal(w.dc, floor);
    close(w.bui, refBUI(30, floor), 'BUI from floored DC');
    close(w.fwi, refFWI(5, w.bui), 'FWI from recomputed BUI');
    assert.notEqual(w.bui, 20, 'published BUI (from DC=15) discarded');
  });

  test(`${e.prov}: outside the spring window DC=15 is left alone and published BUI/FWI are kept`, async () => {
    const aug = lstClock(e, 8, 15, 13);
    const h = makeContext(e.path, { now: aug, mocks: { cwfis: fc([coldStart({ rep_date: rep('2026-08-15') })]) } });
    const w = await h.run(`fetchCWFIS(${e.lat}, ${e.lng}, false)`);
    assert.equal(w.dc, 15);
    assert.equal(w.bui, 20);
    assert.equal(w.fwi, 8);
  });

  // ─── IDW blend: BUI/FWI derived from blended codes ─────────────────────────
  test(`${e.prov}: IDW blend derives BUI/FWI from the blended DMC/DC/ISI, ignoring station BUI/FWI`, () => {
    const h = makeContext(e.path, { now: lstClock(e, 8, 15, 13) });
    const feats = [
      stationFeature(e, { dmc: 40, dc: 300, isi: 5, bui: 999, fwi: 999 }),
      cwfisFeature({ name: 'N2', lat: e.lat + 0.3, lon: e.lng, dmc: 50, dc: 340, isi: 7, bui: 999, fwi: 999 }),
    ];
    const r = h.run(`_computeIDWBlend(${lit(feats)}, ${e.lat}, ${e.lng})`);
    assert.ok(r.dmc > 40 && r.dmc < 50 && r.dc > 300 && r.dc < 340, 'codes are blended');
    close(r.bui, refBUI(r.dmc, r.dc));
    close(r.fwi, refFWI(r.isi, r.bui));
  });
}

// ─── Province-specific floor behaviour ───────────────────────────────────────

test('AB: _selectCWFIS floors June DC=15 at Edmonton to 300 and recomputes BUI/FWI', () => {
  const h = makeContext(AB.path, { now: lstClock(AB, 6, 15, 13) });
  const f = stationFeature(AB, { dc: 15, dmc: 30, isi: 5, bui: 20, fwi: 8 });
  const w = h.run(`_selectCWFIS(${lit([f])}, ${AB.lat}, ${AB.lng})`);
  assert.equal(w.dc, 300);
  assert.equal(w.dcUnderinit, true);
  close(w.bui, refBUI(30, 300));
  close(w.fwi, refFWI(5, refBUI(30, 300)));
});

test('AB: IDW blend floors a June cold-start station before blending, BUI/FWI follow the floored DC', () => {
  const h = makeContext(AB.path, { now: lstClock(AB, 6, 15, 13) });
  const feats = [
    stationFeature(AB, { dmc: 30, dc: 15, isi: 5 }),
    cwfisFeature({ name: 'N2', lat: AB.lat + 0.3, lon: AB.lng, dmc: 30, dc: 310, isi: 5 }),
  ];
  const r = h.run(`_computeIDWBlend(${lit(feats)}, ${AB.lat}, ${AB.lng})`);
  assert.ok(r.dc >= 300 && r.dc <= 310, `blended floored DC (got ${r.dc})`);
  assert.equal(r.dcDivergence, null);
  close(r.bui, refBUI(r.dmc, r.dc));
  close(r.fwi, refFWI(r.isi, r.bui));
});

// Regression: bc/fwi.js _computeIDWBlend used to blend a cold-start DC=15
// station raw while fetchCWFIS floored the same station to 75.
test('BC: IDW blend applies the June DC floor like the single-station path', () => {
  const h = makeContext(BC.path, { now: lstClock(BC, 6, 15, 13) });
  const feats = [
    stationFeature(BC, { dmc: 30, dc: 15, isi: 5 }),
    cwfisFeature({ name: 'N2', lat: BC.lat + 0.3, lon: BC.lng, dmc: 30, dc: 80, isi: 5 }),
  ];
  const r = h.run(`_computeIDWBlend(${lit(feats)}, ${BC.lat}, ${BC.lng})`);
  assert.ok(r.dc >= 75, `DC floored (got ${r.dc})`);
});

// Regression: fwi.js _selectCWFIS reported the chain station's distance even
// when it fell back to a nearer weather-only station.
test('AB: _selectCWFIS distKm reports the distance of the station actually used', () => {
  const h = makeContext(AB.path, { now: lstClock(AB, 8, 15, 13) });
  const feats = [
    cwfisFeature({ name: 'NEAR WX', lat: AB.lat, lon: AB.lng, ffmc: null, dmc: null, dc: null }),
    cwfisFeature({ name: 'FAR CHAIN', lat: AB.lat + 3, lon: AB.lng }), // ~334 km > wxDist + 200
  ];
  const w = h.run(`_selectCWFIS(${lit(feats)}, ${AB.lat}, ${AB.lng})`);
  assert.equal(w.stationName, 'NEAR WX');
  assert.equal(w.distKm, 0);
});
