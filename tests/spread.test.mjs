/**
 * FBP high-wind ISI (ST-X-3 Eq. 53a) and 60-min fire size from a point ignition
 * (ST-X-3 Eqs. 70-72, 79-81) — checked against the cffdrs-ported oracle in
 * tests/reference.mjs (initial_spread_index fbpMod, back_rate_of_spread,
 * distance_at_time, length_to_breadth[_at_time]).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext } from './_harness.mjs';
import * as ref from './reference.mjs';

const OPTS = { lat: 53.5, lng: -113.5, doy: 160, gfl: 0.35, pdf: 35 };
const FUELS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'D1', 'M1', 'M2', 'M3', 'M4', 'S1', 'S2', 'S3', 'O1a', 'O1b'];
const CONDS = [
  { ffmc: 86, dmc: 30, dc: 250, wind: 12 },
  { ffmc: 90, dmc: 45, dc: 350, wind: 25 },
  { ffmc: 93, dmc: 70, dc: 450, wind: 45 },
  { ffmc: 95, dmc: 110, dc: 650, wind: 65 },
];
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);

/** Reference ROS (no crown for non-C6, as cffdrs rate_of_spread) at a given ISI. */
function refRosAt(fuel, isi, c) {
  const bui = ref.refBUI(c.dmc, c.dc);
  const fmc = ref.refFMC(OPTS.lat, OPTS.lng, OPTS.doy);
  const sfc = ref.refSFC(fuel, c.ffmc, bui, 50, OPTS.gfl);
  return ref.refROS(fuel, isi, bui, fmc, sfc, { pc: 50, pdf: OPTS.pdf, cc: 100 });
}

for (const e of ENGINES) {
  const h = makeContext(e.path);
  const fbp = (fuel, c) => h.run(`calculateFBP('${fuel}', ${c.ffmc}, ${c.dmc}, ${c.dc}, ${c.wind}, 0, 100, 50, ${JSON.stringify(OPTS)})`);

  test(`${e.prov}: FBP ISI applies ST-X-3 Eq. 53a at wind ≥ 40 km/h (not the FWI exponential)`, () => {
    for (const w of [0, 20, 39.9, 40, 50, 60, 80]) {
      const r = h.run(`calculateFBP('C2', 92, 60, 400, ${w}, 0, 100, 50, ${JSON.stringify(OPTS)})`);
      assert.ok(rel(r.isi, ref.refISIfbp(92, w)) < 1e-12, `W=${w}: ${r.isi} vs ${ref.refISIfbp(92, w)}`);
    }
    // At 60 km/h the exponential would be ~1.85x the Eq. 53a value
    const isiExp = ref.refISI(92, 60), isi53 = ref.refISIfbp(92, 60);
    assert.ok(isiExp / isi53 > 1.8);
  });

  test(`${e.prov}: back-fire ROS, LB and 60-min distances/area match cffdrs`, () => {
    for (const fuel of FUELS) for (const c of CONDS) {
      const r = fbp(fuel, c);
      const bros = refRosAt(fuel, ref.refBISI(c.ffmc, c.wind), c).ros;
      assert.ok(rel(r.bros, bros) < 1e-9 || Math.abs(r.bros - bros) < 1e-9, `${fuel} W${c.wind} BROS ${r.bros} vs ${bros}`);
      const lb = ref.refLB(fuel, c.wind);
      assert.ok(rel(r.lb, lb) < 1e-12, `${fuel} LB`);
      const dh = ref.refDistAt(fuel, r.ros, 60, r.cfb);
      const db = ref.refDistAt(fuel, r.bros, 60, r.cfb);
      assert.ok(rel(r.dh, dh) < 1e-12 && rel(r.db, db) < 1e-12, `${fuel} distances`);
      const lbt = ref.refLBt(fuel, lb, 60, r.cfb);
      const area = Math.PI / (4 * lbt) * (dh + db) ** 2 / 10000;
      assert.ok(rel(r.area60, area) < 1e-12, `${fuel} W${c.wind} area ${r.area60} vs ${area}`);
    }
  });

  test(`${e.prov}: point-ignition acceleration makes the 60-min run shorter than ROS × 60`, () => {
    const r = fbp('C2', { ffmc: 92, dmc: 60, dc: 400, wind: 25 });
    assert.ok(r.dh < r.ros * 60 && r.dh > 0.5 * r.ros * 60, `${r.dh} vs ${r.ros * 60}`);
    assert.ok(r.bros < r.ros && r.bros > 0);
  });

  test(`${e.prov}: green aspen below BUI 80 has ~zero 60-min area`, () => {
    const r = fbp('D2', { ffmc: 90, dmc: 30, dc: 200, wind: 20 });
    assert.ok(r.area60 < 0.001, `${r.area60}`);
  });
}

for (const e of ENGINES) {
  const h = makeContext(e.path);
  test(`${e.prov}: flame length — Byram for surface fires, Thomas (1963) when crowning`, () => {
    const O = JSON.stringify(OPTS);
    const surf = h.run(`calculateFBP('D1', 90, 40, 300, 15, 0, 100, 50, ${O})`);
    assert.equal(surf.cfb, 0);
    assert.ok(Math.abs(surf.flameLength - 0.0775 * surf.hfi ** 0.46) < 1e-12);
    assert.equal(surf.flameModel, 'Byram 1959 (surface)');
    const crown = h.run(`calculateFBP('C2', 94, 90, 450, 25, 0, 100, 50, ${O})`);
    assert.ok(crown.cfb >= 0.1);
    assert.ok(Math.abs(crown.flameLength - 0.0266 * crown.hfi ** (2 / 3)) < 1e-12);
    assert.ok(crown.flameLength > 0.0775 * crown.hfi ** 0.46, 'crown flames exceed the surface relation');
  });
}
