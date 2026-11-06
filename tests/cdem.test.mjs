/**
 * Live ground elevation / pin-drop slope from NRCan's CDEM (Geogratis point service).
 *
 * Since 2026-10-29 no page may call Open-Meteo, so the slope of a dropped map pin and the
 * elevation of an off-file point come from
 * https://geogratis.gc.ca/services/elevation/cdem/altitude (OGL – Canada, CORS open, no key).
 * Offline: the service is a URL-routed mock (tests/_harness.mjs `nrcan`). The live service is
 * checked in tests/live_api_test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINES, makeContext, nrcanDem, root } from './_harness.mjs';

const calls = (h, route) => h.calls.filter(c => c.route === route);
const LAT = 53.4606, LNG = -113.6596;
const ids = ['fwi-terrain-slope', 'fwi-terrain-aspect', 'fwi-terrain-status'];

for (const e of ENGINES) {
  test(`${e.prov}: the CDEM request carries only lat/lon — no cookies, no referrer`, async () => {
    const h = makeContext(e.path, { mocks: { nrcan: { altitude: 688 } } });
    assert.equal(await h.run(`_cdemAltitude(${LAT}, ${LNG})`), 688);
    const [c] = calls(h, 'nrcan');
    const u = new URL(c.url);
    assert.equal(u.origin + u.pathname, 'https://geogratis.gc.ca/services/elevation/cdem/altitude');
    assert.deepEqual([...u.searchParams.keys()].sort(), ['lat', 'lon']);
    assert.equal(c.opts.credentials, 'omit');
    assert.equal(c.opts.referrerPolicy, 'no-referrer');
  });

  test(`${e.prov}: no answer is null, never a throw — outside the CDEM, HTTP error, network error, garbage`, async () => {
    for (const mock of [{ altitude: null }, { $status: 500 }, new TypeError('Failed to fetch'), { altitude: 'x' }, { altitude: 99999 }, {}]) {
      const h = makeContext(e.path, { mocks: { nrcan: mock } });
      assert.equal(await h.run(`_cdemAltitude(${LAT}, ${LNG})`), null, JSON.stringify(mock));
      assert.equal(await h.run(`_terrainAt(${LAT}, ${LNG})`), null);
      assert.equal(await h.run(`_elevationFor(${LAT}, ${LNG})`), null);
    }
    const h = makeContext(e.path, { mocks: { nrcan: { altitude: 5 } } });
    assert.equal(await h.run(`_cdemAltitude(NaN, 1)`), null);
    assert.equal(calls(h, 'nrcan').length, 0, 'no request for a non-finite point');
  });

  test(`${e.prov}: successful reads are cached per point; a failure is retried next time`, async () => {
    let n = 0;
    const h = makeContext(e.path, { mocks: { nrcan: () => (n++ === 0 ? new TypeError('offline') : { altitude: 700 }) } });
    assert.equal(await h.run(`_cdemAltitude(${LAT}, ${LNG})`), null);
    assert.equal(await h.run(`_cdemAltitude(${LAT}, ${LNG})`), 700);
    assert.equal(await h.run(`_cdemAltitude(${LAT}, ${LNG})`), 700);
    assert.equal(calls(h, 'nrcan').length, 2, 'the third read is served from the cache');
  });

  test(`${e.prov}: a shoreline pin (service reports water as 0 m) reads no slope; open water is flat`, async () => {
    const shore = makeContext(e.path, { mocks: { nrcan: nrcanDem(49.2, -123.9, [0, 0, 0, 60, 80]) } });
    assert.equal(await shore.run('_terrainAt(49.2, -123.9)'), null, 'a 0 m / land mix is not a gradient');
    const water = makeContext(e.path, { mocks: { nrcan: nrcanDem(49.2, -123.9, [0, 0, 0, 0, 0]) } });
    const t = await water.run('_terrainAt(49.2, -123.9)');
    assert.equal(t.slope, 0);
    assert.equal(t.aspect, null);
  });

  test(`${e.prov}: steep CDEM terrain gives slope and facing (East BC check: ~19 % from 5 live samples)`, async () => {
    // Live CDEM at 49.5 N 117.3 W, ±100 m: centre 529, N 569, S 533, E 533, W 543
    const h = makeContext(e.path, { mocks: { nrcan: nrcanDem(49.5, -117.3, [529, 569, 533, 533, 543]) } });
    const t = await h.run('_terrainAt(49.5, -117.3)');
    assert.equal(t.slope, 19);
    assert.equal(t.elev, 529);
    assert.ok(t.aspect != null && t.aspect > 150 && t.aspect < 210, `faces roughly south: ${t.aspect}`);
  });

  test(`${e.prov}: a failed pin read resets an earlier pin's slope to flat and says so; manual entries are kept`, async () => {
    const h = makeContext(e.path, { ids, mocks: { nrcan: nrcanDem(53.5, -113.5, [100, 110, 90, 100, 100]) } });
    let t = await h.run('_applyPinTerrain(53.5, -113.5)');
    assert.equal(t.slope, 10);
    assert.equal(h.run('_siteTerrain.src'), 'pin');
    assert.equal(h.run('_siteTerrain.slope'), 10);

    const down = makeContext(e.path, { ids, mocks: { nrcan: new TypeError('offline') } });
    down.run(`_setSiteTerrain({ slope: 10, aspect: 180, src: 'pin' }, { refresh: false })`);
    assert.equal(await down.run('_applyPinTerrain(54.5, -114.5)'), null);
    assert.equal(down.run('_siteTerrain.slope'), 0, "the earlier pin's 10 % is not applied to the new location");
    assert.equal(down.run('_siteTerrain.src'), 'flat');
    assert.match(down.dom.el('fwi-terrain-status').textContent ?? '', /Slope not available for this pin/);

    const manual = makeContext(e.path, { ids, mocks: { nrcan: new TypeError('offline') } });
    manual.run(`_setSiteTerrain({ slope: 25, aspect: 90, src: 'manual' }, { refresh: false })`);
    await manual.run('_applyPinTerrain(54.5, -114.5)');
    assert.equal(manual.run('_siteTerrain.slope'), 25, 'a value the crew typed is theirs to change');
    assert.equal(manual.run('_siteTerrain.src'), 'manual');
  });
}

// ─── Source guards ───────────────────────────────────────────────────────────

test('no shipped script calls the Open-Meteo elevation API; the pin slope is labelled NRCan CDEM', () => {
  const skip = new Set(['node_modules', '.git', 'tests', 'docs', 'data']);
  const hits = [];
  (function walk(dir) {
    for (const n of readdirSync(dir)) {
      if (skip.has(n)) continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|html)$/.test(n) && /open-meteo\.com\/v1\/elevation/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length + 1));
    }
  })(root);
  assert.deepEqual(hits, [], 'Open-Meteo is non-commercial: elevation comes from NRCan CDEM');
  const core = readFileSync(join(root, 'core', 'fwi-core.js'), 'utf8');
  assert.doesNotMatch(core, /90 m DEM/);
  assert.match(core, /NRCan CDEM/);
});
