/**
 * Leaf phenology for auto-assigned deciduous/mixedwood fuels (AB + BC engines).
 * D1/M1 (leafless) before green-up and after leaf drop; D2/M2 (green) between.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const noon = (m, d) => Date.UTC(2026, m - 1, d, 19); // noon MST

function engine(path) {
  const ctx = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {}, location: { search: '', href: '', pathname: '/' },
    setTimeout, clearTimeout, AbortController, URLSearchParams,
  };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, path), 'utf8'), ctx);
  return src => vm.runInContext(src, ctx);
}

for (const [prov, path] of [['AB', 'fwi.js'], ['BC', 'bc/fwi.js']]) {
  const run = engine(path);
  const sf = (code, lat, ts) => run(`_seasonalFuel('${code}', ${lat}, ${ts})`);

  test(`${prov}: Edmonton aspen is leafless in October and April, green in July`, () => {
    assert.equal(sf('D2', 53.5, noon(10, 7)), 'D1');
    assert.equal(sf('D2', 53.5, noon(4, 20)), 'D1');
    assert.equal(sf('D1', 53.5, noon(7, 15)), 'D2');
    assert.equal(sf('M2', 53.5, noon(10, 7)), 'M1');
    assert.equal(sf('M1', 53.5, noon(7, 15)), 'M2');
  });

  test(`${prov}: non-deciduous fuels are never changed`, () => {
    for (const c of ['C2', 'C3', 'C7', 'O1a', 'O1b', 'M3', 'M4', 'S1'])
      assert.equal(sf(c, 53.5, noon(10, 7)), c);
  });

  test(`${prov}: green-up is later and leaf drop earlier further north`, () => {
    // May 22: past Edmonton green-up (May 20) but before Fort Vermilion's (~May 30)
    assert.equal(sf('D1', 53.5, noon(5, 22)), 'D2');
    assert.equal(sf('D1', 58.4, noon(5, 22)), 'D1');
    // Sep 22: Edmonton still green (drop ~Sep 27), Fort Vermilion already leafless (~Sep 17)
    assert.equal(sf('D1', 53.5, noon(9, 22)), 'D2');
    assert.equal(sf('D2', 58.4, noon(9, 22)), 'D1');
  });

  test(`${prov}: pin-drop pair never duplicates fuel A after the leaf adjustment`, () => {
    for (const a of ['D1', 'D2', 'M1', 'M2', 'C2', 'C7'])
      assert.notEqual(run(`_seasonalPair('${a}', 53.5)`), a);
  });
}
