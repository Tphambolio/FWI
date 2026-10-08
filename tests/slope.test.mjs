/**
 * Slope via the wind–slope vector — engine vs the cffdrs slope_adjustment port
 * (tests/reference.mjs refSlopeAdjust). ST-X-3 Eqs. 39-51, Wotton 2009 Eqs. 41-44.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext } from './_harness.mjs';
import * as ref from './reference.mjs';

const OPTS = { lat: 53.5, lng: -113.5, doy: 200, gfl: 0.35, pdf: 35 };
const FUELS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'D1', 'D2', 'M1', 'M2', 'M3', 'M4', 'S1', 'S2', 'S3', 'O1a', 'O1b'];
const rad = d => d * Math.PI / 180;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

for (const e of ENGINES) {
  const h = makeContext(e.path);
  const fbp = (fuel, ffmc, ws, gs, windDir, aspect) => h.run(
    `calculateFBP('${fuel}', ${ffmc}, 60, 350, ${ws}, ${gs}, 100, 50, ${JSON.stringify({ ...OPTS, windDir, aspect })})`);

  test(`${e.prov}: WSV and head direction match cffdrs slope_adjustment`, () => {
    for (const fuel of FUELS) for (const ffmc of [86, 92]) for (const ws of [0, 12, 35])
      for (const gs of [10, 30, 60, 90]) for (const [wd, asp] of [[270, 270], [270, 90], [180, 315], [0, 45]]) {
        const r = fbp(fuel, ffmc, ws, gs, wd, asp);
        const o = ref.refSlopeAdjust(fuel, ffmc, ws, rad((wd + 180) % 360), gs, rad((asp + 180) % 360), { PC: 50, PDF: 35, CC: 100 });
        const tag = `${fuel} FFMC${ffmc} W${ws}@${wd} GS${gs} asp${asp}`;
        assert.ok(Math.abs(r.wsv - o.WSV) < 1e-9 * Math.max(1, o.WSV), `${tag}: WSV ${r.wsv} vs ${o.WSV}`);
        if (o.WSV > 1e-6) assert.ok(angDiff(r.raz, o.RAZ * 180 / Math.PI) < 1e-6, `${tag}: RAZ ${r.raz} vs ${o.RAZ * 180 / Math.PI}`);
      }
  });

  test(`${e.prov}: FBP with slope equals FBP on flat ground at wind = WSV`, () => {
    for (const fuel of ['C2', 'C3', 'D1', 'M1', 'O1a']) {
      const s = fbp(fuel, 91, 15, 40, 270, 270);
      const flat = h.run(`calculateFBP('${fuel}', 91, 60, 350, ${s.wsv}, 0, 100, 50, ${JSON.stringify(OPTS)})`);
      assert.ok(Math.abs(s.ros - flat.ros) < 1e-9 && Math.abs(s.isi - flat.isi) < 1e-12, `${fuel}`);
    }
  });

  test(`${e.prov}: zero slope leaves ROS unchanged; head direction = downwind`, () => {
    const a = fbp('C2', 90, 20, 0, 225, 90), b = h.run(`calculateFBP('C2', 90, 60, 350, 20, 0, 100, 50, ${JSON.stringify(OPTS)})`);
    assert.equal(a.ros, b.ros);
    assert.equal(a.raz, 45);
  });

  test(`${e.prov}: unknown wind direction on a slope assumes wind upslope (worst case) and flags it`, () => {
    const u = h.run(`calculateFBP('C2', 91, 60, 350, 15, 40, 100, 50, ${JSON.stringify({ ...OPTS, aspect: 180 })})`);
    const aligned = fbp('C2', 91, 15, 40, 180, 180);
    assert.equal(u.slopeAssumed, true);
    assert.ok(Math.abs(u.wsv - aligned.wsv) < 1e-9);
  });
}

// ─── Site terrain from the DEM + plumbing into the station-page chain ────────
for (const e of ENGINES) {
  test(`${e.prov}: _terrainAt derives slope % and the direction the slope faces from 5 DEM samples`, async () => {
    // order: centre, N, S, E, W (±100 m). N higher than S by 20 m over 200 m → 10 %, faces S
    const h = makeContext(e.path, { mocks: { openmeteo: { elevation: [100, 110, 90, 100, 100] } } });
    const t = await h.run('_terrainAt(53.5, -113.5)');
    assert.equal(t.slope, 10);
    assert.equal(t.aspect, 180);
    const h2 = makeContext(e.path, { mocks: { openmeteo: { elevation: [100, 100, 100, 92, 108] } } }); // W higher → faces E
    const t2 = await h2.run('_terrainAt(53.5, -113.5)');
    assert.equal(t2.slope, 8); assert.equal(t2.aspect, 90);
    const h3 = makeContext(e.path, { mocks: { openmeteo: { elevation: [100, 100.5, 100, 100, 100] } } }); // < 2 % → flat
    const t3 = await h3.run('_terrainAt(53.5, -113.5)');
    assert.equal(t3.slope, 0); assert.equal(t3.aspect, null);
  });

  test(`${e.prov}: site terrain feeds the forecast chain (calcMultiDayFBP) with each day's wind direction`, () => {
    const h = makeContext(e.path);
    const day = { temp: 25, rh: 25, wind: 15, rain: 0, month: 7, _ts: Date.UTC(2026, 6, 15, 19), label: 'd',
                  peak: { temp: 26, rh: 22, wind: 15, wdir: 225 } };
    const flat = h.run(`calcMultiDayFBP([${JSON.stringify(day)}], 300, { ffmc: 92, dmc: 60, dc: 350 }, 'C2', 100, 50, {})`)[0].fbp;
    h.run(`_setSiteTerrain({ slope: 40, aspect: 225, src: 'manual' }, { refresh: false })`);
    const s = h.run(`calcMultiDayFBP([${JSON.stringify(day)}], 300, { ffmc: 92, dmc: 60, dc: 350 }, 'C2', 100, 50, _terrainOpts())`)[0].fbp;
    assert.ok(s.ros > flat.ros, `${s.ros} > ${flat.ros}`);
    assert.ok(Math.abs(s.raz - 45) < 1e-6, 'SW wind + SW-facing slope → head toward NE');
    assert.equal(s.slopeAssumed, false);
  });
}
