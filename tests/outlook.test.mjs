/**
 * Operational-period outlook (hourly): calcHourlyOutlook + summariseOperationalPeriods.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext } from './_harness.mjs';
import * as ref from './reference.mjs';

for (const e of ENGINES) {
  const noonUTC = e.prov === 'AB' ? 19 : 20;
  const T0 = Date.UTC(2026, 6, 15, noonUTC);           // obs noon LST, Jul 15
  // 48 h of a dry diurnal cycle: hottest/driest/windiest mid-afternoon local
  const hours = Array.from({ length: 48 }, (_, i) => {
    const t = T0 + (i + 1) * 3600000;
    const lh = (new Date(t - (noonUTC - 12) * 3600000).getUTCHours());   // LST hour
    const k = Math.max(0, Math.cos((lh - 15) / 24 * 2 * Math.PI));        // peaks 15:00 LST
    return { t, temp: 12 + 16 * k, rh: 80 - 55 * k, wind: 5 + 20 * k, wdir: 270, rain: 0 };
  });
  const start = { ffmc: 88, dmc: 60, dc: 350, obsDate: '2026-07-15' };
  const dayCodes = { '2026-07-16': { dmc: 64, dc: 357 } };

  test(`${e.prov}: hourly FFMC chains from the noon-LST daily FFMC (Van Wagner 1977)`, () => {
    const h = makeContext(e.path);
    const rows = h.run(`calcHourlyOutlook(${JSON.stringify(hours)}, ${JSON.stringify(start)}, ${JSON.stringify(dayCodes)}, ['C2'], { lat: 53.5, lng: -113.5 })`);
    assert.equal(rows.length, 48);
    let f = start.ffmc;
    for (let i = 0; i < 3; i++) {
      const w = hours[i];
      f = ref.refHFFMC(w.temp, w.rh, w.wind, w.rain, f);
      assert.ok(Math.abs(rows[i].ffmc - f) < 1e-6, `hour ${i}: ${rows[i].ffmc} vs ${f}`);
    }
  });

  test(`${e.prov}: DMC/DC switch to the next day's chain value at noon LST`, () => {
    const h = makeContext(e.path);
    const rows = h.run(`calcHourlyOutlook(${JSON.stringify(hours)}, ${JSON.stringify(start)}, ${JSON.stringify(dayCodes)}, ['C2'], {})`);
    const before = rows.find(r => r.t === T0 + 23 * 3600000);   // 11:00 LST next day
    const after  = rows.find(r => r.t === T0 + 24 * 3600000);   // 12:00 LST next day
    assert.ok(Math.abs(before.bui - ref.refBUI(60, 350)) < 1e-9);
    assert.ok(Math.abs(after.bui - ref.refBUI(64, 357)) < 1e-9);
  });

  test(`${e.prov}: fire behaviour peaks mid-afternoon; shifts summarise peak + class windows`, () => {
    const h = makeContext(e.path);
    const rows = h.run(`calcHourlyOutlook(${JSON.stringify(hours)}, ${JSON.stringify(start)}, ${JSON.stringify(dayCodes)}, ['C2', 'D1'], {})`);
    const peak = rows.reduce((a, b) => (b.worst.hfi > a.worst.hfi ? b : a));
    const lh = new Date(peak.t - (noonUTC - 12) * 3600000).getUTCHours();
    assert.ok(lh >= 13 && lh <= 17, `peak at ${lh}:00 LST`);
    assert.equal(peak.worst.fuel, 'C2');
    const periods = h.run(`summariseOperationalPeriods(calcHourlyOutlook(${JSON.stringify(hours)}, ${JSON.stringify(start)}, ${JSON.stringify(dayCodes)}, ['C2','D1'], {}))`);
    assert.ok(periods.length >= 3);
    for (const p of periods) {
      assert.ok(['Day', 'Night'].includes(p.shift));
      assert.ok(p.hours > 0 && p.hours <= 12);
      if (p.cls4) assert.ok(p.cls3, 'a class-4 window implies a class-3 window');
    }
    const dayP = periods.filter(p => p.shift === 'Day');
    const nightP = periods.filter(p => p.shift === 'Night');
    assert.ok(Math.max(...dayP.map(p => p.peak.cls)) >= Math.max(...nightP.map(p => p.peak.cls)), 'day shift peaks higher');
  });

  test(`${e.prov}: site terrain and hourly wind direction reach the hourly FBP`, () => {
    const h = makeContext(e.path);
    const flat = h.run(`calcHourlyOutlook(${JSON.stringify(hours)}, ${JSON.stringify(start)}, {}, ['C2'], {})`);
    const sl = h.run(`calcHourlyOutlook(${JSON.stringify(hours)}, ${JSON.stringify(start)}, {}, ['C2'], { slope: 40, aspect: 270 })`);
    const i = 2;
    assert.ok(sl[i].fbp.C2.ros > flat[i].fbp.C2.ros);
    assert.ok(Math.abs(sl[i].fbp.C2.raz - 90) < 1e-6, 'W wind + W-facing slope → head toward E');
  });
}
