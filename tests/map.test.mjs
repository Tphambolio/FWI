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
import { ENGINES, makeContext, cwfisFeature, lstClock, fc, stationFeature, TODAY, YDAY, rep } from './_harness.mjs';

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

// Bulk path is capped at MAP_CWFIS_MAX_KM (2026-10-08): markers far from the one
// mocked CWFIS station fall back to the per-station chain instead of borrowing it.
test('AB: pre-noon CWFIS features with yesterday\'s rep_date → flagged "CWFIS D-1", never shown as current', async () => {
  const b = await badges(AB, lstClock(AB, 7, 15, 9), YDAY);
  assert.ok(b.has('CWFIS D-1'));
  assert.ok(!b.has('CWFIS'), "yesterday's chain is never badged as current");
  for (const x of b) assert.ok(['CWFIS D-1', 'NWP', 'SWOB'].includes(x), `unexpected badge ${x}`);
});

test('AB: CWFIS features with today\'s rep_date → markers badged "CWFIS"', async () => {
  assert.deepEqual([...await badges(AB, lstClock(AB, 7, 15, 13), TODAY)], ['CWFIS']);
});

test('BC: CWFIS chain with today\'s rep_date → markers badged "CWFIS"', async () => {
  assert.deepEqual([...await badges(BC, lstClock(BC, 7, 15, 13), TODAY)], ['CWFIS']);
});

// Since the BC map uses the province-wide bulk query (2026-10-08), yesterday's
// chain is shown flagged as the previous day — same as the AB map — instead of
// each station running the slow per-station tier chain (which gave "NWP").
test('BC: pre-noon CWFIS chain dated yesterday is flagged, not shown as current → "CWFIS D-1"', async () => {
  const b = await badges(BC, lstClock(BC, 7, 15, 9), YDAY);
  assert.ok(b.has('CWFIS D-1'), 'stations near a CWFIS station show the flagged chain');
  assert.ok(!b.has('CWFIS'), "yesterday's chain is never badged as current");
  // stations > 100 km from any CWFIS station fall back to the per-station chain
  for (const x of b) assert.ok(['CWFIS D-1', 'NWP', 'SWOB'].includes(x), `unexpected badge ${x}`);
});

test('BC: map resolves stations from one bulk CWFIS query, not per-station requests', async () => {
  const now = lstClock(BC, 7, 15, 13);
  // a CWFIS station at every map station's coordinates, dated today
  const stations = makeContext(BC.path, { now }).run('JSON.stringify(PROVINCE.stations)');
  const feats = JSON.parse(stations).map((st, i) =>
    cwfisFeature({ name: `S${i}`, lat: st.lat, lon: st.lng, rep_date: rep(TODAY) }));
  const h = makeContext(BC.path, { now, leaflet: true, ids: ['fwi-map'], mocks: { cwfis: fc(feats) } });
  await h.run(`buildStationMap('fwi-map')`);
  assert.equal(h.run('_mapStationCache').length, JSON.parse(stations).length, 'every station resolved');
  const cwfisCalls = h.calls.filter(c => c.url.includes('cwfis.cfs.nrcan.gc.ca') && c.url.includes('firewx_stns_current'));
  assert.ok(cwfisCalls.length <= 3, `expected ~1 bulk CWFIS query, got ${cwfisCalls.length}`);
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
