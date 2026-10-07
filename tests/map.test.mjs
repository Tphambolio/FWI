/**
 * Station-map freshness badge (buildStationMap, AB + BC), run against a
 * minimal Leaflet stub. Badges are read back from _mapStationCache.
 *   AB: one province-wide CWFIS query; a chain whose rep_date is before today's
 *       LST date is badged 'CWFIS D-1', today's 'CWFIS'.
 *   BC: per-station tier chain; yesterday's CWFIS chain is never primary, so
 *       pre-noon stations fall to NWP (with the dated carry-over).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext, lstClock, fc, stationFeature, TODAY, YDAY, rep } from './_harness.mjs';

const [AB, BC] = ENGINES;
const badges = async (e, now, repDate) => {
  const h = makeContext(e.path, {
    now, leaflet: true, ids: ['fwi-map'],
    mocks: { cwfis: fc([stationFeature(e, { rep_date: rep(repDate) })]) },
  });
  await h.run(`buildStationMap('fwi-map')`);
  const cache = h.run('_mapStationCache');
  assert.ok(cache.length > 50, `map processed stations (${cache.length})`);
  return new Set(cache.map(c => c.srcBadge));
};

test('AB: pre-noon CWFIS features with yesterday\'s rep_date → every marker badged "CWFIS D-1"', async () => {
  assert.deepEqual([...await badges(AB, lstClock(AB, 7, 15, 9), YDAY)], ['CWFIS D-1']);
});

test('AB: CWFIS features with today\'s rep_date → markers badged "CWFIS"', async () => {
  assert.deepEqual([...await badges(AB, lstClock(AB, 7, 15, 13), TODAY)], ['CWFIS']);
});

test('BC: CWFIS chain with today\'s rep_date → markers badged "CWFIS"', async () => {
  assert.deepEqual([...await badges(BC, lstClock(BC, 7, 15, 13), TODAY)], ['CWFIS']);
});

test('BC: pre-noon CWFIS chain dated yesterday is not shown as current → markers badged "NWP"', async () => {
  assert.deepEqual([...await badges(BC, lstClock(BC, 7, 15, 9), YDAY)], ['NWP']);
});

test('BC: stations served by today\'s BCWS mirror are badged "BCWS"', async () => {
  const now = lstClock(BC, 7, 15, 13);
  const h = makeContext(BC.path, { now, leaflet: true, ids: ['fwi-map'], mocks: {
    bcws: { date: TODAY, stations: { 322: { name: 'Kamloops BCWS', temp: 26, rh: 25, wind: 10, rain: 0, ffmc: 91, dmc: 60, dc: 400, isi: 8, bui: 90, fwi: 25 } } },
  } });
  await h.run(`buildStationMap('fwi-map')`);
  const kam = h.run('_mapStationCache').find(c => c.result?.ffmc === 91);
  assert.ok(kam, 'a station used the BCWS chain');
  assert.equal(kam.srcBadge, 'BCWS');
});
