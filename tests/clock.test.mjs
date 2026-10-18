/**
 * Alberta's permanent UTC−6 clock (Official Time Act; IANA tzdata 2026c: no
 * fall-back on 2026-11-01) and the fire-weather observation hour.
 *
 * - Wall clock: MDT before 2026-11-01 02:00 MDT (08:00 UTC), "MT" after
 *   (owner's label). _wallFmt shows UTC−6 even where the runtime's tz data
 *   predates 2026c (Node 22's ICU still falls back; this test then guards it).
 * - Fire-weather day: noon LST stays 19 UTC (CWFIS tz_correct −7 for Alberta)
 *   before and after the change by default; AB_FWI_LST_OFFSET_FROM_2026_11_01
 *   = 6 would move days from 2026-11-01 on to 18 UTC.
 * - BC: permanent UTC−7 from 2026-11-01 (label PT), noon LST stays 20 UTC.
 * - Before the change labels follow the instant's offset (MST/MDT, PST/PDT).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext } from './_harness.mjs';

const [AB, BC] = ENGINES;
const U = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

test('AB: wall-clock label MDT before 2026-11-01 02:00 MDT, MT from then (incl. 2027-03-15, no spring-forward)', () => {
  for (const [now, label] of [
    [U(2011, 5, 15, 20), 'MDT'],          // Slave Lake 2011 replay keeps its label
    [U(2026, 10, 31, 18), 'MDT'],
    [U(2026, 11, 1, 7, 59), 'MDT'],
    [U(2026, 11, 1, 8), 'MT'],
    [U(2026, 11, 2, 18), 'MT'],
    [U(2027, 3, 15, 18), 'MT'],
  ]) {
    const { run } = makeContext(AB.path, { now });
    assert.equal(run('PROVINCE.tzLabel'), label, new Date(now).toISOString());
    assert.equal(run(`_clockAt(${now}).tzLabel`), label);
  }
});

test('AB: noon LST stays 19 UTC across the change (default AB_FWI_LST_OFFSET_FROM_2026_11_01 = 7)', () => {
  const { run } = makeContext(AB.path, { now: U(2026, 11, 2, 20) });
  assert.equal(run('AB_FWI_LST_OFFSET_FROM_2026_11_01'), 7);
  for (const d of ['2011-05-15', '2026-10-31', '2026-11-01', '2026-11-02', '2027-03-15']) {
    assert.equal(run(`_noonMsOn('${d}')`), Date.parse(`${d}T19:00:00Z`), d);
  }
  assert.equal(run('PROVINCE.noonUTC'), 19);
  assert.equal(run('PROVINCE.lstOffset'), 7);
  // CFFDRS day boundary at 07 UTC on both sides of the change
  assert.equal(run(`_lstDateStr(${U(2026, 11, 2, 6, 59)})`), '2026-11-01');
  assert.equal(run(`_lstDateStr(${U(2026, 11, 2, 7)})`), '2026-11-02');
});

test('AB: the wall clock after the change is UTC−6 whatever the runtime tz data says', () => {
  const { run } = makeContext(AB.path, { now: U(2026, 11, 2, 20) });
  const f = ms => run(`_wallFmt(${ms}, { hour: '2-digit', minute: '2-digit', hour12: false }, 'toLocaleTimeString')`);
  assert.equal(f(U(2026, 11, 2, 18)), '12:00');
  assert.equal(f(U(2027, 3, 15, 18)), '12:00');
  assert.equal(f(U(2026, 10, 31, 18)), '12:00');   // MDT, from the tz data
  assert.equal(f(U(2011, 5, 15, 20)), '14:00');    // MDT 2011
  // Today/Tomorrow (UTC−6 date) rolls at 06 UTC after the change
  assert.equal(run(`_mdtDateStr(${U(2026, 11, 2, 5, 59)})`), '2026-11-01');
  assert.equal(run(`_mdtDateStr(${U(2026, 11, 2, 6)})`), '2026-11-02');
});

test('AB: operational periods after the change use 06–18 on the UTC−6 clock', () => {
  const { run } = makeContext(AB.path, { now: U(2026, 11, 2, 12) });
  const rows = [U(2026, 11, 2, 11), U(2026, 11, 2, 12), U(2026, 11, 2, 23), U(2026, 11, 3, 0)]
    .map(t => ({ t, worst: { cls: 1, hfi: 10, fuel: 'C2' }, fwi: 1 }));
  const p = JSON.parse(run(`JSON.stringify(summariseOperationalPeriods(${JSON.stringify(rows)}))`));
  // 11 UTC = 05:00 (night), 12 UTC = 06:00 (day) … 23 UTC = 17:00 (day), 00 UTC = 18:00 (night)
  assert.deepEqual(p.map(x => [x.shift, x.hours]), [['Night', 1], ['Day', 2], ['Night', 1]]);
  assert.equal(p[1].peak.at, '06:00');
});

test('AB: fetchWeather after the change takes the 19 UTC noon-LST hour and the 22 UTC (16:00 MT) peak', async () => {
  const { run } = makeContext(AB.path, { now: U(2026, 11, 2, 20) });
  const w = await run(`fetchWeather(${AB.lat}, ${AB.lng})`);
  assert.equal(w.temp, 19.02, 'slot 2026-11-02T19:00');
  assert.equal(w.peak.temp, 22.02, 'slot 2026-11-02T22:00');
});

test('AB: a forecast across 2026-11-01 keeps every day on 19 UTC', async () => {
  const { run } = makeContext(AB.path, { now: U(2026, 10, 29, 20) });
  const days = await run(`fetchForecast(${AB.lat}, ${AB.lng})`);
  assert.ok(days.length >= 6);
  for (const d of days) {
    assert.equal(new Date(d._ts).getUTCHours(), 19, new Date(d._ts).toISOString());
    assert.equal(d.peak.temp - d.temp, 3, 'peak = noon + 3 h (22 UTC)');
  }
});

test('AB: setting the post-change offset to 6 moves days from 2026-11-01 to 18 UTC only', async () => {
  const { run } = makeContext(AB.path, { now: U(2026, 10, 30, 20) });
  run('AB_CLOCK_RULES[1].lstOffset = 6; AB_CLOCK_RULES[1].noonUTC = 18;');
  assert.equal(run(`_noonMsOn('2026-10-31')`), Date.parse('2026-10-31T19:00:00Z'));
  assert.equal(run(`_noonMsOn('2026-11-01')`), Date.parse('2026-11-01T18:00:00Z'));
  assert.equal(run(`_noonMsOn('2027-03-15')`), Date.parse('2027-03-15T18:00:00Z'));
  const days = await run(`fetchForecast(${AB.lat}, ${AB.lng})`);
  const hours = days.map(d => [new Date(d._ts).toISOString().slice(0, 10), new Date(d._ts).getUTCHours()]);
  for (const [date, h] of hours) assert.equal(h, date >= '2026-11-01' ? 18 : 19, date);
  assert.ok(hours.some(([d]) => d < '2026-11-01') && hours.some(([d]) => d >= '2026-11-01'));
});

test('AB: before the change an instant\'s timestamp label follows its own offset (winter MST); the peak-burn clock label stays MDT', () => {
  for (const [ms, label] of [
    [U(2011, 1, 15, 19), 'MST'], [U(2011, 5, 15, 20), 'MDT'],
    [U(2026, 1, 15, 19), 'MST'], [U(2026, 3, 8, 8, 59), 'MST'], [U(2026, 3, 8, 9), 'MDT'],
    [U(2026, 10, 31, 18), 'MDT'], [U(2026, 11, 2, 18), 'MT'], [U(2027, 1, 15, 18), 'MT'],
  ]) {
    const { run } = makeContext(AB.path, { now: ms });
    assert.equal(run(`_tzLabelAt(${ms})`), label, new Date(ms).toISOString());
    assert.equal(run('PROVINCE.tzLabel'), ms >= U(2026, 11, 1, 8) ? 'MT' : 'MDT', '16:00 peak clock = 22 UTC');
  }
});

test('BC: permanent UTC−7 from 2026-11-01 09:00 UTC — PDT/PST before, PT after; noon LST stays 20 UTC', () => {
  for (const [ms, label] of [
    [U(2026, 1, 15, 20), 'PST'], [U(2026, 7, 15, 20), 'PDT'], [U(2026, 11, 1, 8, 59), 'PDT'],
    [U(2026, 11, 1, 9), 'PT'], [U(2026, 11, 2, 21), 'PT'], [U(2027, 3, 15, 21), 'PT'],
  ]) {
    const { run } = makeContext(BC.path, { now: ms });
    assert.equal(run(`_tzLabelAt(${ms})`), label, new Date(ms).toISOString());
    assert.equal(run('PROVINCE.tzLabel'), ms >= U(2026, 11, 1, 9) ? 'PT' : 'PDT', '16:00 peak clock = 23 UTC');
  }
  const { run } = makeContext(BC.path, { now: U(2026, 11, 2, 21) });
  assert.equal(run('BC_FWI_LST_OFFSET_FROM_2026_11_01'), 8);
  for (const d of ['2026-07-15', '2026-10-31', '2026-11-01', '2026-11-02', '2027-03-15']) {
    assert.equal(run(`_noonMsOn('${d}')`), Date.parse(`${d}T20:00:00Z`), d);
  }
  const f = ms => run(`_wallFmt(${ms}, { hour: '2-digit', minute: '2-digit', hour12: false }, 'toLocaleTimeString')`);
  assert.equal(f(U(2026, 11, 2, 20)), '13:00');   // UTC−7 after the change, whatever the tz data
  assert.equal(f(U(2027, 1, 15, 20)), '13:00');
  assert.equal(f(U(2026, 1, 15, 20)), '12:00');   // PST before it
  assert.equal(run(`_pdtDateStr(${U(2026, 11, 2, 6, 59)})`), '2026-11-01');
  assert.equal(run(`_pdtDateStr(${U(2026, 11, 2, 7)})`), '2026-11-02');
});

test('BC: fetchWeather after the change takes 20 UTC (noon PST) and 23 UTC (16:00 PT) peak', async () => {
  const { run } = makeContext(BC.path, { now: U(2026, 11, 2, 22) });
  const w = await run(`fetchWeather(${BC.lat}, ${BC.lng})`);
  assert.equal(w.temp, 20.02);
  assert.equal(w.peak.temp, 23.02);
});
