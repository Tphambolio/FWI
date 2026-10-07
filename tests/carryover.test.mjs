/**
 * Carry-over fallback regression tests (AB + BC engines).
 *
 * When the CWFIS firewx_stns_current layer has no FWI codes (pre-noon, the
 * ~19 UTC refresh window, end of season) the station page must fall back to
 * the newest real carry-over — browser holding cache or data/cwfis_prev.json —
 * instead of PENDING / STARTUP defaults. 2026-10-06: a fresh browser showed
 * "Season start pending" for Edmonton Blatchford while the daily cache held
 * FWI 17.9 / BUI 92.5, and the D+1 card fell to STARTUP (C2 HFI 5 kW/m).
 *
 * Runs each engine in a Node vm context with a pinned clock and mocked fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { root, makeContext as baseContext, openMeteoFor, fc } from './_harness.mjs';

// 2026-10-06 19:00 UTC = 13:00 MDT = 12:00 MST — the CWFIS layer-refresh window
const NOW = Date.UTC(2026, 9, 6, 19, 0);

// Dry warm autumn day (Open-Meteo hourly, shaped from the request URL)
const makeContext = (enginePath, { prev, cwfisFeatures = [] } = {}) => baseContext(enginePath, {
  now: NOW,
  mocks: {
    prev: prev ?? { $status: 404 },
    cwfis: fc(cwfisFeatures),
    openmeteo: url => openMeteoFor(url, NOW, { temp: () => 19, rh: () => 41, wind: () => 11 }),
  },
});

const prevFor = repDate => ({
  generated: new Date(NOW - 18 * 3600000).toISOString(),
  stations: {
    'EDMONTON BLATCHFORD': { ffmc: 88.8, dmc: 71.4, dc: 327.8, isi: 4.7, bui: 92.5, fwi: 17.9, lat: 53.567, lon: -113.517, repDate },
  },
  bcStations: {
    'KAMLOOPS A': { ffmc: 87.0, dmc: 40.0, dc: 450.0, isi: 3.5, bui: 65.0, fwi: 11.0, lat: 50.70, lon: -120.45, repDate },
  },
});

for (const [prov, path, lat, lng, name] of [
  ['AB', 'fwi.js',    53.567, -113.517, 'Edmonton Blatchford'],
  ['BC', 'bc/fwi.js', 50.70,  -120.45,  'Kamloops A'],
]) {
  const enginePath = join(root, path);

  test(`${prov}: CWFIS empty → initFWI steps yesterday's cwfis_prev chain (not PENDING)`, async () => {
    const { run } = makeContext(enginePath, { prev: prevFor('2026-10-05T12:00:00Z') });
    await run(`initFWI(${lat}, ${lng}, '${name}')`);
    const r = run('_lastFWI');
    assert.ok(r && !r._inactive, 'result must not be _inactive');
    assert.ok(r.ffmc != null && r.dc != null, 'codes populated');
    const start = prov === 'AB' ? 327.8 : 450.0;
    assert.ok(r.dc > start, `DC stepped forward from ${start} (got ${r.dc})`);
    assert.equal(r._cachedFWI.final, false);
    assert.equal(r._obsDate, '2026-10-06');
  });

  test(`${prov}: today's carry-over is used as-is, not stepped again`, async () => {
    const { run } = makeContext(enginePath, { prev: prevFor('2026-10-06T12:00:00Z') });
    await run(`initFWI(${lat}, ${lng}, '${name}')`);
    const r = run('_lastFWI');
    assert.equal(r._cachedFWI.final, true);
    assert.equal(r.dc, prov === 'AB' ? 327.8 : 450.0);
  });

  test(`${prov}: carry-over older than 2 days is rejected → PENDING`, async () => {
    const { run } = makeContext(enginePath, { prev: prevFor('2026-10-02T12:00:00Z') });
    await run(`initFWI(${lat}, ${lng}, '${name}')`);
    assert.equal(run('_lastFWI')._inactive, true);
  });

  test(`${prov}: newer holding cache wins over older daily cache`, async () => {
    const { run, storage } = makeContext(enginePath, { prev: prevFor('2026-10-05T12:00:00Z') });
    storage.set(run(`_holdKey(${lat}, ${lng})`), JSON.stringify({
      ffmc: 90.1, dmc: 80, dc: 400, repDate: '2026-10-06T12:00:00Z', stationName: 'HOLD',
    }));
    const co = run(`_carryOverFor(${lat}, ${lng}, '${name}')`);
    assert.equal(co.src, 'holding');
    assert.equal(co.final, true);
  });

  test(`${prov}: calcMultiDay does not re-step days already in the start state`, () => {
    const { run } = makeContext(enginePath);
    const mk = (d, h) => ({ temp: 19, rh: 41, wind: 11, rain: 0, month: 10, _ts: Date.UTC(2026, 9, d, h), label: `d${d}` });
    const days = [mk(6, 19), mk(7, 19)];
    const out = run(`calcMultiDay(${JSON.stringify(days)}, 15, { ffmc: 88.8, dmc: 71.4, dc: 327.8, obsDate: '2026-10-06' })`);
    assert.equal(out[0].dc, 327.8, 'today not stepped twice');
    assert.equal(out[0].ffmc, 88.8);
    assert.ok(out[1].dc > 327.8, 'tomorrow stepped');
  });
}
