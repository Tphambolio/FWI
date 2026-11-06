/**
 * Guard: no test, tool or workflow may reach api.open-meteo.com (or any open-meteo.com host).
 *
 * Why: Open-Meteo's free tier is non-commercial, and the product no longer uses it
 * (config/weather.js ships fallback 'none'; tests/weather_config.test.mjs, tests/cdem.test.mjs).
 * Tests should exercise the sources production actually uses (ECCC GEM via data/gem, CWFIS, SWOB,
 * NRCan CDEM), so a test run by the company must not call a non-commercial service either.
 * Mirrors FireSim's api/tests/test_no_open_meteo.py. Until 2026-11-06 tests/live_chain_test.mjs
 * fetched live Open-Meteo forecasts; it is now tests/gem_chain_test.mjs on data/gem.
 *
 * Rule: a file may contain the host name only if it is listed below with its reason. Adding a
 * new mention fails this test, so it has to be reviewed on purpose. The allowed files only
 * MOCK the host (so the opt-in fallback code path can be tested offline); none of them
 * opens a network connection to it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['tests', 'tools', '.github'];
const EXT = /\.(mjs|js|cjs|py|sh|yml|yaml|json|html)$/;
const HOST = /open-meteo\.com/i;

const ALLOWED = {
  'tests/_harness.mjs': 'classifies and answers the mocked Open-Meteo URL for the opt-in fallback tests (no network)',
  'tests/gem.test.mjs': 'mock probe URL for the opt-in fallback test (no network)',
  'tests/cdem.test.mjs': 'the guard that no shipped script calls the Open-Meteo elevation API (regex only)',
  'tests/no_open_meteo_in_tests.test.mjs': 'this guard',
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

test('no test, tool or workflow file mentions an open-meteo.com host except the listed mocks and guards', () => {
  const offenders = [];
  for (const top of SCAN) {
    let files;
    try { files = walk(path.join(ROOT, top)); } catch { continue; }
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (ALLOWED[rel]) continue;
      if (HOST.test(readFileSync(f, 'utf8'))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [],
    'Open-Meteo free tier is non-commercial: use data/gem (ECCC GeoMet) in tests, or add the file to ALLOWED with a reason if it only mocks the host');
});

test('every allowed file still exists (remove stale entries)', () => {
  for (const rel of Object.keys(ALLOWED)) {
    assert.ok(statSync(path.join(ROOT, rel)).isFile(), `${rel} is listed in ALLOWED but missing`);
  }
});

test('the chain test reads the repo GEM files and makes no network request', () => {
  const src = readFileSync(path.join(ROOT, 'tests/gem_chain_test.mjs'), 'utf8');
  assert.match(src, /data['"],\s*'gem'|data\/gem/, 'tests/gem_chain_test.mjs must read data/gem');
  assert.doesNotMatch(src, /fetch\(\s*`?https?:/, 'tests/gem_chain_test.mjs must not fetch over the network');
});
