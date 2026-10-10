/**
 * Alberta Red Flag Watch/Warning: parsing the AWCC fire weather forecast, the
 * forecast-zone lookup (zones vectorised from Alberta Wildfire's 2024 Fire Weather
 * Forecast Zones map), and which product applies to a station on a given day.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForecastText, validDate, combine } from '../tools/redflag/ab_redflag.mjs';
import { loadEngine } from './load-engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = f => readFileSync(join(ROOT, 'tests', 'fixtures', f), 'utf8');
const ZONES = JSON.parse(readFileSync(join(ROOT, 'data', 'ab_fire_weather_zones.json'), 'utf8'));
const AB = loadEngine(join(ROOT, 'fwi.js'));

test('parses a Red Flag Warning and Watch (PM forecast issued 2023-05-15)', () => {
  const f = parseForecastText(fx('ab_pmfcst_2023-05-15_redflag.txt'));
  assert.equal(f.issuedDate, '2023-05-15');
  assert.equal(f.issuedTime, '1500');
  assert.deepEqual(f.products.map(p => [p.kind, p.zones, p.period]), [
    ['warning', ['OJ', 'FV', 'MA', 'RE', 'GP', 'MM', 'PY', 'LB'], 'tomorrow'],
    ['watch', ['SH', 'ED'], 'tomorrow'],
  ]);
  assert.equal(validDate(f.issuedDate, 'tomorrow'), '2023-05-16');
});

test('a forecast with no Red Flag gives no products; a discontinued AM product is ignored', () => {
  const pm = parseForecastText(fx('ab_pmfcst_2026-10-09_none.txt'));
  assert.equal(pm.issuedDate, '2026-10-09');
  assert.deepEqual(pm.products, []);
  const am = parseForecastText(fx('ab_amfcst_2026_discontinued.txt'));
  assert.equal(am.discontinued, true);
  const c = combine([{ url: 'pm', f: pm }, { url: 'am', f: am }]);
  assert.equal(c.issued, '2026-10-09 1100');
  assert.equal(c.source, 'pm');
});

test('older zone codes (JA/BA/WA) map to JP/BP/WP; "ALL ZONES" covers every zone', () => {
  const t = 'PM FIRE WEATHER FORECAST ISSUED: 1500 Monday July 01 2024 RED FLAG WATCH IN EFFECT FOR JA/BA/WA ZONES FOR TOMORROW\'S BURNING PERIOD';
  assert.deepEqual(parseForecastText(t).products[0].zones, ['JP', 'BP', 'WP']);
  const all = parseForecastText(t.replace('JA/BA/WA ZONES', 'ALL ZONES'));
  assert.equal(all.products[0].zones.length, 18);
});

test('every town lands in its Alberta fire weather forecast zone', () => {
  const towns = [['High Level', 58.52, -117.14, 'OJ'], ['Fort Vermilion', 58.39, -116.0, 'FV'], ['Fort Chipewyan', 58.71, -111.15, 'PY'],
    ['Fort McMurray', 56.73, -111.38, 'MM'], ['Red Earth Creek', 56.55, -115.27, 'RE'], ['Grande Prairie', 55.17, -118.8, 'GP'],
    ['Swan Hills', 54.71, -115.4, 'SH'], ['Lac La Biche', 54.77, -111.96, 'LB'], ['Edson', 53.58, -116.44, 'ED'],
    ['Jasper', 52.88, -118.08, 'JP'], ['Rocky Mountain House', 52.37, -114.92, 'RM'], ['Banff', 51.18, -115.57, 'BP'],
    ['Canmore', 51.09, -115.36, 'BO'], ['Crowsnest Pass', 49.63, -114.48, 'CR'], ['Waterton', 49.05, -113.91, 'WP'],
    ['Elkwater', 49.66, -110.28, 'CH'], ['Lethbridge', 49.69, -112.84, 'AG'], ['Medicine Hat', 50.04, -110.68, 'AG'], ['Hussar', 51.05, -112.68, 'AG']];
  for (const [n, lat, lng, z] of towns) assert.equal(AB._rfZoneAt(lat, lng, ZONES)?.zone, z, n);
  assert.equal(AB._rfZoneAt(53.5, -105, ZONES), null, 'Saskatchewan is outside the zones');
});

test('status: warning beats watch, the product applies only through its burning period', () => {
  const rf = combine([{ url: 'pm', f: parseForecastText(fx('ab_pmfcst_2023-05-15_redflag.txt')) }]);
  const s = (lat, lng, today) => AB.redFlagStatus(lat, lng, rf, ZONES, today);
  assert.equal(s(56.73, -111.38, '2023-05-16').product.kind, 'warning');   // Fort McMurray, MM
  assert.equal(s(53.58, -116.44, '2023-05-16').product.kind, 'watch');     // Edson, ED
  assert.equal(s(51.05, -112.68, '2023-05-16').product, null);             // Hussar, AG — none
  assert.equal(s(56.73, -111.38, '2023-05-17').product, null);             // expired after its burning period
  assert.equal(s(56.73, -111.38, '2023-05-15').product.kind, 'warning');   // issued the day before: shown in advance
});
