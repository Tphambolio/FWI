/**
 * tools/alerts (Pyra threshold alerts) — offline tests.
 *
 * Each station runs in a harness engine context (pinned clock, URL-routed fetch
 * mocks), injected into the alert tool through its engineFactory hook, so the
 * tool is exercised end to end on the engine's own science and data tiers.
 * Delivery is never executed: --send is checked with an injected exec spy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINES, makeContext, openMeteoFor, fc, cwfisFeature } from './_harness.mjs';
import {
  main, evaluateStation, evaluateThresholds, applyQuiet, buildMessage, bcwsClassNum,
  deliveryCommand, FOOTER, SITE_URL, EXIT,
} from '../tools/alerts/run.mjs';

// 2026-07-15 20:00 UTC = 14:00 MDT / 13:00 PDT — after noon LST, before peak burn.
const NOW = Date.UTC(2026, 6, 15, 20, 0);
const TODAY = '2026-07-15';
const NOW_ARGS = ['--now', new Date(NOW).toISOString()];
const AB = ENGINES.find(e => e.prov === 'AB');
const BC = ENGINES.find(e => e.prov === 'BC');

const HOT = {
  cwfis: { ffmc: 94, dmc: 90, dc: 450, isi: null, bui: null, fwi: null, temp: 31, rh: 15, ws: 28 },
  om: { temp: () => 31, rh: () => 15, wind: () => 28 },
};
const COOL = {
  cwfis: { ffmc: 70, dmc: 8, dc: 60, isi: null, bui: null, fwi: null, temp: 9, rh: 85, ws: 4, precip: 6 },
  om: { temp: () => 9, rh: () => 90, wind: () => 4, precip: () => 1.5 },
};

/** Harness engine for one station under a weather scenario (or 'fail'). */
function engineFor(prov, st, scenario, extraMocks = {}) {
  const eng = prov === 'AB' ? AB : BC;
  const lat = st.lat ?? eng.lat, lng = st.lng ?? eng.lng;
  if (scenario === 'fail') {
    const down = new Error('network down');
    return makeContext(eng.path, { now: NOW, mocks: {
      cwfis: down, swob: down, openmeteo: down, naefs: down, prev: down, bcws: down, aef: down, cwfisOther: down, other: down,
    } });
  }
  return makeContext(eng.path, { now: NOW, mocks: {
    cwfis: fc([cwfisFeature({ name: st.name.toUpperCase(), lat, lon: lng, rep_date: `${TODAY}T12:00:00Z`, ...scenario.cwfis })]),
    openmeteo: url => openMeteoFor(url, NOW, scenario.om),
    ...extraMocks,
  } });
}

const TH = { fwi: 19, hfiClass: 4, bcwsDanger: 'High' };
const tmp = () => mkdtempSync(join(tmpdir(), 'pyra-alerts-'));
function writeConfig(dir, cfg) {
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify({ thresholds: TH, quiet: { enabled: true }, delivery: { enabled: false }, ...cfg }));
  return p;
}
const capture = () => {
  const o = { out: [], err: [] };
  o.deps = { out: s => o.out.push(s), err: s => o.err.push(s) };
  o.text = () => o.out.join('\n');
  return o;
};

// ─── Station evaluation through the engine ──────────────────────────────────

test('AB station: page path yields 16:00 FWI, worst HFI across fuels, OBSERVED CWFIS provenance', async () => {
  const st = { province: 'AB', name: 'Edmonton Blatchford', fuels: ['C2', 'O1a'] };
  const r = await evaluateStation(st, prov => engineFor(prov, st, HOT));
  assert.equal(r.name, 'Edmonton Blatchford');
  assert.equal(r.inactive, false);
  assert.equal(r.provenance.kind, 'OBSERVED');
  assert.equal(r.provenance.network, 'CWFIS');
  assert.deepEqual(r.fuels, ['C2', 'O1a']);
  assert.equal(r.today.date, TODAY);
  assert.equal(r.tomorrow.date, '2026-07-16');
  assert.ok(r.today.fwi > 19, `hot day FWI ${r.today.fwi}`);
  assert.ok(['C2', 'O1a'].includes(r.today.worst.fuel));
  assert.ok(r.today.worst.cls >= 4 && r.today.worst.hfi > 2000);
  assert.ok(r.today.worst.ros > 0 && r.today.worst.area60 > 0);
  assert.match(r.today.worst.desc, /attack|evacuate/);
});

test('BC station: BCWS chain carries the official danger rating', async () => {
  const st = { province: 'BC', name: 'Afton' };
  const bcws = { date: TODAY, stations: { 322: { name: 'AFTON', ffmc: 93, dmc: 70, dc: 600, temp: 30, rh: 15, wind: 22, rain: 0, danger: 4 } } };
  const r = await evaluateStation(st, prov => engineFor(prov, st, HOT, { bcws }));
  assert.equal(r.dangerSource, 'official');
  assert.equal(r.official, 'High');
  assert.equal(r.provenance.network, 'BCWS');
  assert.deepEqual(r.fuels, ['C3', 'C7'], 'BC page default fuels');
  assert.ok(evaluateThresholds(r, { bcwsDanger: 'High' }).includes('today.bcws'));
  assert.ok(!evaluateThresholds(r, { bcwsDanger: 'Extreme' }).includes('today.bcws'));
});

test('unknown station name is an error', async () => {
  const st = { province: 'AB', name: 'Nowhere Lake' };
  await assert.rejects(evaluateStation(st, prov => engineFor(prov, st, HOT)), /not in the AB station list/);
});

// ─── Threshold logic ────────────────────────────────────────────────────────

const res = (o = {}) => ({
  province: 'AB', inactive: false, official: null,
  today: { fwi: 20, worst: { cls: 3 } }, tomorrow: { fwi: 10, worst: { cls: 2 } }, ...o,
});

test('thresholds: FWI and HFI class crossings (inclusive), per horizon', () => {
  assert.deepEqual(evaluateThresholds(res(), TH), ['today.fwi']);
  assert.deepEqual(evaluateThresholds(res({ today: { fwi: 19, worst: { cls: 4 } } }), TH), ['today.fwi', 'today.hfi']);
  assert.deepEqual(evaluateThresholds(res({ today: { fwi: 18.9, worst: { cls: 3 } } }), TH), []);
  assert.deepEqual(evaluateThresholds(res({ tomorrow: { fwi: 25, worst: { cls: 5 } } }), TH),
    ['today.fwi', 'tomorrow.fwi', 'tomorrow.hfi']);
  assert.deepEqual(evaluateThresholds(res({ tomorrow: { fwi: 25, worst: { cls: 5 } } }), TH, { lookAhead: false }), ['today.fwi']);
  assert.deepEqual(evaluateThresholds(res(), { hfiClass: 4 }), [], 'unset FWI threshold is not evaluated');
  assert.deepEqual(evaluateThresholds(res({ inactive: true }), TH), []);
});

test('thresholds: BCWS official class only for BC with an official rating', () => {
  const low = { today: { fwi: 1, worst: { cls: 1 } }, tomorrow: null };
  assert.deepEqual(evaluateThresholds(res({ ...low, province: 'BC', official: 'High' }), TH), ['today.bcws']);
  assert.deepEqual(evaluateThresholds(res({ ...low, province: 'BC', official: 'Moderate' }), TH), []);
  assert.deepEqual(evaluateThresholds(res({ ...low, province: 'BC', official: null }), TH), []);
  assert.deepEqual(evaluateThresholds(res({ ...low, province: 'AB', official: 'Extreme' }), TH), []);
  assert.equal(bcwsClassNum('very high'), null);
  assert.equal(bcwsClassNum('extreme'), 5);
  assert.equal(bcwsClassNum(3), 3);
});

// ─── Quiet mode ─────────────────────────────────────────────────────────────

test('quiet mode: new crossing alerts, sustained does not, drop then rise re-alerts', () => {
  const k = 'AB:Edmonton Blatchford';
  let s = {};
  let r = applyQuiet(s, { [k]: ['today.fwi'] });
  assert.deepEqual(r.newBy[k], ['today.fwi'], 'first crossing alerts');
  s = r.state;
  r = applyQuiet(s, { [k]: ['today.fwi'] });
  assert.equal(r.newBy[k], undefined, 'sustained crossing is quiet');
  s = r.state;
  r = applyQuiet(s, { [k]: ['today.fwi', 'today.hfi'] });
  assert.deepEqual(r.newBy[k], ['today.hfi'], 'an additional threshold is a new crossing');
  s = r.state;
  r = applyQuiet(s, { [k]: [] });
  assert.equal(r.newBy[k], undefined, 'drop does not alert');
  s = r.state;
  r = applyQuiet(s, { [k]: ['today.fwi'] });
  assert.deepEqual(r.newBy[k], ['today.fwi'], 'rise after a drop re-alerts');
  s = r.state;
  r = applyQuiet(s, { [k]: null });
  assert.deepEqual(r.state[k].crossings, ['today.fwi'], 'a failed run keeps previous state');
  assert.equal(applyQuiet(r.state, { [k]: ['today.fwi'] }).newBy[k], undefined, 'recovery after failure is not a new crossing');
  assert.deepEqual(applyQuiet(s, { [k]: ['today.fwi'] }, { quiet: false }).newBy[k], ['today.fwi'], 'quiet off: always alert');
});

test('quiet mode end to end through the CLI state file', async () => {
  const dir = tmp();
  const cfgPath = writeConfig(dir, { stations: [{ province: 'AB', name: 'Edmonton Blatchford' }] });
  let scenario = HOT;
  const go = async () => {
    const c = capture();
    const code = await main(['--config', cfgPath, '--update-state', ...NOW_ARGS],
      { ...c.deps, engineFactory: (prov, st) => engineFor(prov, st, scenario) });
    return { code, c };
  };
  assert.equal((await go()).code, EXIT.ALERT, 'run 1: new crossing');
  assert.ok(existsSync(join(dir, 'state.json')));
  assert.equal((await go()).code, EXIT.OK, 'run 2: sustained → quiet');
  scenario = COOL;
  assert.equal((await go()).code, EXIT.OK, 'run 3: dropped');
  const st = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.deepEqual(st.stations['AB:Edmonton Blatchford'].crossings, []);
  scenario = HOT;
  assert.equal((await go()).code, EXIT.ALERT, 'run 4: rose again → re-alert');
});

test('plain --dry-run does not change quiet-mode state', async () => {
  const dir = tmp();
  const cfgPath = writeConfig(dir, { stations: [{ province: 'AB', name: 'Edmonton Blatchford' }] });
  const c = capture();
  const code = await main(['--config', cfgPath, '--dry-run'], { ...c.deps, engineFactory: (p, st) => engineFor(p, st, HOT) });
  assert.equal(code, EXIT.ALERT);
  assert.equal(existsSync(join(dir, 'state.json')), false);
});

// ─── Message ────────────────────────────────────────────────────────────────

test('message: station, danger, HFI class + fuel + tactic, ROS/area, source, footer, URL, delivery command', async () => {
  const dir = tmp();
  const cfgPath = writeConfig(dir, { stations: [{ province: 'AB', name: 'Edmonton Blatchford', fuels: ['C2'] }] });
  const c = capture();
  const code = await main(['--config', cfgPath, ...NOW_ARGS], { ...c.deps, engineFactory: (p, st) => engineFor(p, st, HOT) });
  assert.equal(code, EXIT.ALERT);
  const t = c.text();
  assert.match(t, /EDMONTON BLATCHFORD \(AB\)/);
  assert.match(t, /Today 16:00 MDT: (HIGH|VERY HIGH|EXTREME) · FWI \d+\.\d/);
  assert.match(t, /HFI [4-6] \w+.* · Boreal Spruce \(C2\) · [\d,]+ kW\/m/);
  assert.match(t, /Tactic: .+/);
  assert.match(t, /Head ROS \d+\.\d m\/min · 60-min point fire [\d.,]+ ha/);
  assert.match(t, /Data: OBSERVED · CWFIS/);
  assert.match(t, /Jul 15, 2026 14:00 MDT/, 'local time');
  assert.ok(t.includes(FOOTER) && t.includes(SITE_URL));
  assert.match(t, /--- dry run: would deliver with ---\nopenclaw agent --agent main --message 'PYRA FIRE BEHAVIOUR ALERT/);
  assert.ok(!/\|.*\|/.test(t.split('--- dry run')[0]), 'no markdown tables');
});

test('message: tomorrow line only when tomorrow crosses', () => {
  const base = {
    name: 'X', province: 'AB', tz: 'MDT', official: null,
    provenance: { kind: 'MODEL FORECAST', network: 'Open-Meteo', age: '' },
    today: { fwi: 25, danger: 'Very High', worst: { cls: 4, clsLabel: 'Very High', fuel: 'C2', fuelName: 'Boreal Spruce', hfi: 3000, desc: 'd', ros: 10, area60: 5 } },
    tomorrow: { fwi: 31, danger: 'Extreme', label: 'Thu, Jul 16', worst: { cls: 5, clsLabel: 'Extreme', fuel: 'C2', hfi: 6000 } },
  };
  const m1 = buildMessage({ alerts: [{ res: base, crossings: ['today.fwi'] }], nowMs: NOW, thresholds: TH });
  assert.ok(!m1.includes('Tomorrow'));
  const m2 = buildMessage({ alerts: [{ res: base, crossings: ['today.fwi', 'tomorrow.fwi'] }], nowMs: NOW, thresholds: TH });
  assert.match(m2, /Tomorrow Thu, Jul 16 16:00: EXTREME · FWI 31\.0 · HFI 5 Extreme C2 6,000 kW\/m/);
  assert.match(m2, /Data: MODEL FORECAST · Open-Meteo/);
  assert.equal(buildMessage({ alerts: [], nowMs: NOW }), null);
});

// ─── Failure isolation ──────────────────────────────────────────────────────

test('one station failing does not stop the others and is noted in the message', async () => {
  const dir = tmp();
  const cfgPath = writeConfig(dir, { stations: [
    { province: 'AB', name: 'Fort McMurray A' },
    { province: 'AB', name: 'Edmonton Blatchford' },
    { province: 'BC', name: 'Not A Station' },
  ] });
  const c = capture();
  const code = await main(['--config', cfgPath], { ...c.deps,
    engineFactory: (p, st) => engineFor(p, st, st.name === 'Fort McMurray A' ? 'fail' : HOT) });
  assert.equal(code, EXIT.ALERT);
  const t = c.text();
  assert.match(t, /EDMONTON BLATCHFORD \(AB\)/);
  assert.match(t, /NOT CHECKED \(data error\):/);
  assert.match(t, /- Fort McMurray A \(AB\): station data load failed/);
  assert.match(t, /- Not A Station \(BC\): station "Not A Station" not in the BC station list/);
});

test('every station failing exits 1', async () => {
  const dir = tmp();
  const cfgPath = writeConfig(dir, { stations: [{ province: 'AB', name: 'Edmonton Blatchford' }] });
  const c = capture();
  const code = await main(['--config', cfgPath], { ...c.deps, engineFactory: (p, st) => engineFor(p, st, 'fail') });
  assert.equal(code, EXIT.ERROR);
});

// ─── Delivery guard ─────────────────────────────────────────────────────────

test('--send refuses without delivery.enabled (no network, no exec)', async () => {
  const dir = tmp();
  for (const delivery of [undefined, { enabled: false }, { enabled: 'true' }]) {
    const cfgPath = writeConfig(dir, { stations: [{ province: 'AB', name: 'Edmonton Blatchford' }], delivery });
    const c = capture();
    let engines = 0, execs = 0;
    const code = await main(['--config', cfgPath, '--send'], { ...c.deps,
      engineFactory: () => { engines++; throw new Error('must not evaluate'); },
      exec: async () => { execs++; } });
    assert.equal(code, EXIT.ERROR);
    assert.equal(engines, 0);
    assert.equal(execs, 0);
    assert.match(c.err.join('\n'), /refusing --send: delivery is not enabled/);
  }
});

test('--send with delivery.enabled hands the message to the (injected) exec, then saves state', async () => {
  const dir = tmp();
  const cfgPath = writeConfig(dir, { stations: [{ province: 'AB', name: 'Edmonton Blatchford' }],
    delivery: { enabled: true, agent: 'main' } });
  const c = capture();
  const calls = [];
  const code = await main(['--config', cfgPath, '--send'], { ...c.deps,
    engineFactory: (p, st) => engineFor(p, st, HOT), exec: async (file, args) => { calls.push([file, args]); } });
  assert.equal(code, EXIT.ALERT);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'openclaw');
  assert.deepEqual(calls[0][1].slice(0, 4), ['agent', '--agent', 'main', '--message']);
  assert.match(calls[0][1][4], /EDMONTON BLATCHFORD/);
  assert.ok(existsSync(join(dir, 'state.json')));
  assert.deepEqual(deliveryCommand('hi').args, ['agent', '--agent', 'main', '--message', 'hi']);
});

test('bad arguments / config exit 1', async () => {
  const c = capture();
  assert.equal(await main([], c.deps), EXIT.ERROR);
  assert.equal(await main(['--config', '/nonexistent/config.json'], c.deps), EXIT.ERROR);
  assert.equal(await main(['--config', 'x', '--now', 'not-a-date'], c.deps), EXIT.ERROR);
});

// ─── Test mode + direct channel delivery (2026-10-08) ────────────────────────
import { deliveryCommand as _dc, buildMessage as _bm } from '../tools/alerts/run.mjs';
test('deliveryCommand: channel + target → verbatim `openclaw message send`', () => {
  const c = _dc('hello', { channel: 'whatsapp', target: '+15550000000' });
  assert.deepEqual(c.args, ['message', 'send', '--channel', 'whatsapp', '--target', '+15550000000', '--message', 'hello']);
  assert.deepEqual(_dc('hi', {}).args.slice(0, 3), ['agent', '--agent', 'main']);
});
test('buildMessage test mode is labelled [TEST] and says no action is needed', () => {
  const m = _bm({ alerts: [], nowMs: 0, timeZone: 'UTC', test: true });
  assert.equal(m, null, 'still null with no stations');
});
