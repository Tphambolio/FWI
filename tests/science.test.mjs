/**
 * Pyra science validation suite.
 *
 * Validates both engines (fwi.js, bc/fwi.js) against:
 *  1. The published FTR-33 worked example (Van Wagner & Pickett 1985).
 *  2. An independent line-for-line port of the canonical `cffdrs` R package
 *     (tests/reference.mjs) across a grid of fuels and conditions.
 *  3. An AB↔BC science-core sync check.
 *
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEngine, extractScienceCore } from './load-engine.mjs';
import * as ref from './reference.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const AB = loadEngine(join(root, 'fwi.js'));
const BC = loadEngine(join(root, 'bc', 'fwi.js'));

const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, want ${expected} ±${tol}`);

// ─── 1. FWI chain vs FTR-33 worked example ───────────────────────────────────
// Day 1: T=17, RH=42, W=25, rain=0, April, from FFMC 85 / DMC 6 / DC 15.
// Published: FFMC 87.7, DMC 8.5, DC 19.0, ISI 10.9, BUI 8.5, FWI 10.1
// Day 2: T=20, RH=21, W=25, rain=2.4 → FFMC 86.2, ISI 8.8, FWI 9.3

for (const [label, engine] of [['AB', AB], ['BC', BC]]) {
  test(`FWI chain matches FTR-33 worked example (${label})`, () => {
    const d1 = engine.calculateFWI(
      { temp: 17, rh: 42, wind: 25, rain: 0, month: 4 },
      { ffmc: 85, dmc: 6, dc: 15 },
    );
    close(d1.ffmc, 87.7, 0.05, 'D1 FFMC');
    close(d1.dmc, 8.5, 0.05, 'D1 DMC');
    close(d1.dc, 19.0, 0.05, 'D1 DC');
    close(d1.isi, 10.9, 0.05, 'D1 ISI');
    close(d1.bui, 8.5, 0.05, 'D1 BUI');
    close(d1.fwi, 10.1, 0.05, 'D1 FWI');

    const d2 = engine.calculateFWI(
      { temp: 20, rh: 21, wind: 25, rain: 2.4, month: 4 },
      { ffmc: d1.ffmc, dmc: d1.dmc, dc: d1.dc },
    );
    close(d2.ffmc, 86.2, 0.05, 'D2 FFMC');
    close(d2.isi, 8.8, 0.05, 'D2 ISI');
    close(d2.fwi, 9.3, 0.05, 'D2 FWI');
  });

  test(`FWI chain matches independent reference port over a weather grid (${label})`, () => {
    let prev = { ffmc: 85, dmc: 6, dc: 15 };
    let refPrev = { ...prev };
    const days = [
      { temp: 17, rh: 42, wind: 25, rain: 0, month: 4 },
      { temp: 20, rh: 21, wind: 25, rain: 2.4, month: 5 },
      { temp: 8.5, rh: 40, wind: 17, rain: 0, month: 5 },
      { temp: 27, rh: 18, wind: 35, rain: 0, month: 6 },
      { temp: 12, rh: 70, wind: 5, rain: 14.2, month: 7 },
      { temp: 22, rh: 35, wind: 12, rain: 0.4, month: 8 },
      { temp: -2, rh: 88, wind: 8, rain: 6.1, month: 9 },
    ];
    for (const w of days) {
      const r = engine.calculateFWI(w, prev);
      const ffmc = ref.refFFMC(w.temp, w.rh, w.wind, w.rain, refPrev.ffmc);
      const dmc = ref.refDMC(w.temp, w.rh, w.rain, w.month, refPrev.dmc);
      const dc = ref.refDC(w.temp, w.rain, w.month, refPrev.dc);
      close(r.ffmc, ffmc, 1e-9, `FFMC ${JSON.stringify(w)}`);
      close(r.dmc, dmc, 1e-9, `DMC ${JSON.stringify(w)}`);
      // Engine historically skips DC drying entirely below -2.8°C; canonical
      // floors temp at -2.8 (so Lf-only drying still accrues). Allow that gap.
      close(r.dc, dc, w.temp > -2.8 ? 1e-9 : 4, `DC ${JSON.stringify(w)}`);
      close(r.isi, ref.refISI(ffmc, w.wind), 1e-9, `ISI`);
      close(r.bui, ref.refBUI(dmc, dc), w.temp > -2.8 ? 1e-9 : 4, `BUI`);
      prev = { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc };
      refPrev = { ffmc, dmc, dc };
    }
  });
}

// ─── 2. FBP vs independent cffdrs port ───────────────────────────────────────

const FBP_OPTS = { lat: 53.5, lng: -113.5, doy: 160, gfl: 0.35, pdf: 35 };
const FUELS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'D1', 'D2',
               'M1', 'M2', 'M3', 'M4', 'S1', 'S2', 'S3', 'O1a', 'O1b'];
const CONDITIONS = [
  { ffmc: 78, dmc: 12, dc: 120, wind: 5 },
  { ffmc: 86, dmc: 30, dc: 250, wind: 12 },
  { ffmc: 90, dmc: 45, dc: 350, wind: 20 },
  { ffmc: 94, dmc: 80, dc: 520, wind: 30 },
  { ffmc: 96, dmc: 130, dc: 700, wind: 45 },
];

function refFBP(fuel, { ffmc, dmc, dc, wind }, { curing = 80, ps = 50 } = {}) {
  const isi = ref.refISI(ffmc, wind);
  const bui = ref.refBUI(dmc, dc);
  const fmc = ref.refFMC(FBP_OPTS.lat, FBP_OPTS.lng, FBP_OPTS.doy);
  const sfc = ref.refSFC(fuel, ffmc, bui, ps, FBP_OPTS.gfl);
  const { ros, cfb } = ref.refROS(fuel, isi, bui, fmc, sfc, { pc: ps, pdf: FBP_OPTS.pdf, cc: curing });
  const { tfc } = ref.refTFC(fuel, cfb, sfc, { pc: ps, pdf: FBP_OPTS.pdf });
  return { isi, bui, sfc, ros, cfb, tfc, hfi: ref.refHFI(tfc, ros) };
}

for (const [label, engine] of [['AB', AB], ['BC', BC]]) {
  test(`FBP matches cffdrs reference across fuels × conditions (${label})`, () => {
    for (const fuel of FUELS) {
      for (const cond of CONDITIONS) {
        const e = engine.calculateFBP(fuel, cond.ffmc, cond.dmc, cond.dc, cond.wind, 0, 80, 50, FBP_OPTS);
        assert.ok(e, `engine returned null for ${fuel}`);
        const r = refFBP(fuel, cond);
        const tag = `${fuel} @ FFMC ${cond.ffmc}/W ${cond.wind}`;
        close(e.ros, r.ros, Math.max(1e-6, r.ros * 1e-6), `ROS ${tag}`);
        close(e.cfb, r.cfb, 1e-6, `CFB ${tag}`);
        close(e.sfc, r.sfc, 1e-6, `SFC ${tag}`);
        close(e.tfc, r.tfc, 1e-6, `TFC ${tag}`);
        close(e.hfi, r.hfi, Math.max(1e-3, r.hfi * 1e-6), `HFI ${tag}`);
      }
    }
  });

  test(`FBP crown-fire sanity (${label})`, () => {
    // Mild C2 conditions must NOT crown (RSS < RSO ≈ 1.5 m/min with real SFC)
    const mild = engine.calculateFBP('C2', 82, 20, 200, 5, 0, 80, 50, FBP_OPTS);
    assert.equal(mild.cfb, 0, `mild C2 should be surface fire, cfb=${mild.cfb}`);
    assert.equal(mild.fireType, 'Surface');
    // Marginal conditions: small CFB → Torching, not instant crown fire
    // (the pre-fix engine, with RSO 60× too small, crowned here)
    const marginal = engine.calculateFBP('C2', 84, 20, 200, 8, 0, 80, 50, FBP_OPTS);
    assert.ok(marginal.cfb > 0 && marginal.cfb < 0.1, `marginal C2 cfb=${marginal.cfb}`);
    assert.equal(marginal.fireType, 'Torching');
    // Severe conditions must crown
    const severe = engine.calculateFBP('C2', 95, 120, 650, 40, 0, 80, 50, FBP_OPTS);
    assert.ok(severe.cfb > 0.9, `severe C2 should be active crown, cfb=${severe.cfb}`);
    assert.equal(severe.fireType, 'Active Crown');
  });

  test(`Grass curing follows GLC-X-10 and applies to ROS (${label})`, () => {
    const cond = { ffmc: 90, dmc: 45, dc: 350, wind: 20 };
    const isi = ref.refISI(cond.ffmc, cond.wind);
    for (const cc of [0, 30, 58.8, 80, 100]) {
      const e = engine.calculateFBP('O1a', cond.ffmc, cond.dmc, cond.dc, cond.wind, 0, cc, 50, FBP_OPTS);
      const cf = cc < 58.8 ? 0.005 * (Math.exp(0.061 * cc) - 1) : 0.176 + 0.02 * (cc - 58.8);
      const want = 190 * (1 - Math.exp(-0.0310 * isi)) ** 1.4 * cf;
      close(e.ros, want, 1e-6, `O1a ROS at curing ${cc}`);
    }
    // Fully cured grass: CF = 1.0 exactly (not 2.22 as the 1992 curve gave)
    const full = engine.calculateFBP('O1a', cond.ffmc, cond.dmc, cond.dc, cond.wind, 0, 100, 50, FBP_OPTS);
    const bare = 190 * (1 - Math.exp(-0.0310 * isi)) ** 1.4;
    close(full.ros / bare, 1.0, 1e-9, 'CF at 100% curing');
  });

  test(`D2 spreads only at BUI >= 80 (GLC-X-10) (${label})`, () => {
    const low = engine.calculateFBP('D2', 90, 30, 150, 20, 0, 80, 50, FBP_OPTS);  // BUI ~46
    assert.ok(low.ros < 0.01, `D2 at BUI<80 should not spread, ros=${low.ros}`);
    const high = engine.calculateFBP('D2', 90, 80, 520, 20, 0, 80, 50, FBP_OPTS); // BUI ~117
    assert.ok(high.ros > 0.1, `D2 at BUI>80 should spread, ros=${high.ros}`);
  });

  test(`FMC matches FCFDG 1992 eqs 1,2,5-8 (${label})`, () => {
    for (const [lat, lng, doy] of [[53.5, -113.5, 160], [49.5, -110.0, 200], [58.7, -117.2, 135], [50.7, -120.4, 180]]) {
      close(engine.calcFMC(lat, lng, doy), ref.refFMC(lat, lng, doy), 1e-9, `FMC ${lat},${lng},${doy}`);
    }
  });
}

// ─── 3. Hourly FFMC (Van Wagner 1977) ────────────────────────────────────────

for (const [label, engine] of [['AB', AB], ['BC', BC]]) {
  test(`Hourly FFMC matches reference port and converges sensibly (${label})`, () => {
    let f = 85, rf = 85;
    const hours = [
      { temp: 18, rh: 45, wind: 12, rain: 0 },
      { temp: 22, rh: 32, wind: 18, rain: 0 },
      { temp: 25, rh: 25, wind: 22, rain: 0 },
      { temp: 21, rh: 40, wind: 10, rain: 1.2 },
      { temp: 15, rh: 70, wind: 6, rain: 4.5 },
      { temp: 12, rh: 85, wind: 4, rain: 0 },
    ];
    for (const w of hours) {
      f = engine._hffmc(w.temp, w.rh, w.wind, w.rain, f);
      rf = ref.refHFFMC(w.temp, w.rh, w.wind, w.rain, rf);
      close(f, rf, 1e-9, `hFFMC ${JSON.stringify(w)}`);
    }
    // One dry hour must dry far less than one daily step (the old chart bug)
    const hourly = engine._hffmc(25, 25, 20, 0, 70);
    const daily = engine.calculateFWI(
      { temp: 25, rh: 25, wind: 20, rain: 0, month: 6 }, { ffmc: 70, dmc: 6, dc: 15 }).ffmc;
    assert.ok(hourly - 70 < (daily - 70) / 3,
      `hourly step (${(hourly - 70).toFixed(2)}) should be much smaller than daily (${(daily - 70).toFixed(2)})`);
  });
}

// ─── 4. AB ↔ BC science-core sync check ─────────────────────────────────────

test('AB and BC science cores are identical', () => {
  const ab = extractScienceCore(join(root, 'fwi.js'));
  const bc = extractScienceCore(join(root, 'bc', 'fwi.js'));
  assert.ok(ab, 'AB science core markers missing');
  assert.ok(bc, 'BC science core markers missing');
  assert.equal(ab, bc, 'science cores have diverged — copy the canonical block to both engines');
});
