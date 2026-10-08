/**
 * Foliar moisture content with elevation — FCFDG 1992 Eqs. 1-8 as implemented
 * by cffdrs foliar_moisture_content() (reference oracle: tests/reference.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext } from './_harness.mjs';
import { refFMC } from './reference.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

for (const e of ENGINES) {
  const h = makeContext(e.path);
  const fmc = (lat, lng, doy, elev) => h.run(`calcFMC(${lat}, ${lng}, ${doy}, ${elev})`);

  test(`${e.prov}: calcFMC matches cffdrs with and without elevation`, () => {
    for (const [lat, lng] of [[53.57, -113.52], [51.18, -115.57], [58.6, -117.2], [50.7, -120.45], [49.3, -123.1]])
      for (const elev of [0, 250, 700, 1388, 2100])
        for (const doy of [100, 130, 150, 160, 175, 190, 210, 240])
          close(fmc(lat, lng, doy, elev), refFMC(lat, lng, doy, elev), 1e-9, `lat ${lat} elev ${elev} doy ${doy}`);
  });

  test(`${e.prov}: elevation delays minimum FMC — Banff (1388 m) early June`, () => {
    // No-elevation D0 ≈ 146, elevation D0 ≈ 161: on DOY 160 FMC is near its
    // minimum with elevation but already recovering without it.
    const noElev = fmc(51.18, -115.57, 160, 0);
    const withElev = fmc(51.18, -115.57, 160, 1388);
    assert.ok(withElev < noElev, `${withElev} < ${noElev}`);
    close(withElev, 85.0, 0.1, 'Banff DOY 160 with elevation ≈ minimum');
  });

  test(`${e.prov}: calculateFBP passes opts.elev to the FMC calculation`, () => {
    const a = h.run(`calculateFBP('C2', 92, 60, 400, 20, 0, 100, 50, { lat: 51.18, lng: -115.57, doy: 160, elev: 0 })`);
    const b = h.run(`calculateFBP('C2', 92, 60, 400, 20, 0, 100, 50, { lat: 51.18, lng: -115.57, doy: 160, elev: 1388 })`);
    close(a.fmc, refFMC(51.18, -115.57, 160, 0), 1e-9, 'no elev');
    close(b.fmc, refFMC(51.18, -115.57, 160, 1388), 1e-9, 'elev');
    assert.ok(b.cfb >= a.cfb, 'lower FMC → crown fire at least as likely');
  });
}
