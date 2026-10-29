/**
 * Guards the shipped model-weather config (config/weather.js): Open-Meteo's free tier is
 * non-commercial, so the fallback must stay 'none' and the GEM file must be the source.
 * tests/load-engine.mjs re-enables the fallback for the engine suites only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { WEATHER_CONFIG_PATH } from './load-engine.mjs';

test('config/weather.js ships with fallback none and the GEM file as the source', () => {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(WEATHER_CONFIG_PATH, 'utf8'), ctx);
  const c = ctx.window.PYRA_WEATHER;
  assert.equal(c.source, 'gem-file');
  assert.equal(c.fallback, 'none', "Open-Meteo fallback must be off in the shipped config (non-commercial free tier)");
  assert.equal(c.elevation, 'file');
  assert.ok(c.max_age_h >= 6 && c.max_age_h <= 12, 'max_age_h covers one missed 6-h cycle');
});
