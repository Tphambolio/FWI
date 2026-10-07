/**
 * Loads a browser engine (province module fwi.js / bc/fwi.js + the shared
 * core/fwi-core.js) into a Node vm sandbox with minimal DOM shims, returning
 * the window.FWI export object.
 *
 * The engine is two classic scripts sharing one global scope, run in page
 * order: province module first (defines PROVINCE), then the core.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

export const CORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'fwi-core.js');

/** Run [province module, core] into an existing vm context, in page order. */
export function runEngine(ctx, provincePath) {
  vm.runInContext(readFileSync(provincePath, 'utf8'), ctx, { filename: provincePath });
  vm.runInContext(readFileSync(CORE_PATH, 'utf8'), ctx, { filename: CORE_PATH });
}

export function loadEngine(path) {
  const noopEl = null;
  const storage = new Map();
  const sandbox = {
    window: {},
    document: {
      getElementById: () => noopEl,
      querySelectorAll: () => [],
      querySelector: () => noopEl,
      addEventListener: () => {},
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
      body: { appendChild() {} },
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    navigator: { geolocation: { getCurrentPosition: () => {} }, userAgent: 'node-test' },
    location: { search: '', href: 'http://localhost/test', pathname: '/' },
    fetch: async () => { throw new Error('network disabled in tests'); },
    AbortController,
    URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, Date, Math, JSON, Promise,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  runEngine(sandbox, path);
  if (!sandbox.window.FWI) throw new Error(`window.FWI not exported by ${path}`);
  return sandbox.window.FWI;
}

/**
 * Extracts the shared science core region (between BEGIN/END markers) from an
 * engine file, for the AB↔BC sync check.
 */
export function extractScienceCore(path) {
  const src = readFileSync(path, 'utf8');
  const regions = [...src.matchAll(/SCIENCE CORE BEGIN[\s\S]*?SCIENCE CORE END/g)];
  if (!regions.length) return null;
  return regions.map((m) => m[0]).join('\n');
}

/** Functions that make up the science core — must be defined only in the core. */
export const SCIENCE_CORE_FNS = ['_ffmc', '_dmc', '_dc', '_isi', '_bui', '_fwi', 'calculateFBP', 'calcFMC'];

/**
 * Single-source check for the science core (replaces the old AB↔BC
 * byte-identity check): the SCIENCE CORE regions exist in core/fwi-core.js,
 * every science-core function is defined there exactly once, and neither
 * province module carries a science-core marker or (re)defines one of them.
 * Returns a list of problems (empty = pass) plus the core region size.
 */
export function checkScienceCoreSingleSource(provincePaths) {
  const problems = [];
  const core = readFileSync(CORE_PATH, 'utf8');
  const region = extractScienceCore(CORE_PATH);
  if (!region) problems.push('core/fwi-core.js has no SCIENCE CORE BEGIN/END markers');
  const defRe = name => new RegExp(`(?:\\bfunction\\s+${name}\\s*\\(|\\b(?:const|let|var)\\s+${name}\\b)`, 'g');
  for (const name of SCIENCE_CORE_FNS) {
    const n = (core.match(defRe(name)) || []).length;
    if (n !== 1) problems.push(`core/fwi-core.js defines ${name} ${n} times (expected 1)`);
    else if (region && !defRe(name).test(region)) problems.push(`${name} is defined outside the core's SCIENCE CORE regions`);
  }
  for (const p of provincePaths) {
    const src = readFileSync(p, 'utf8');
    if (/SCIENCE CORE (BEGIN|END)/.test(src)) problems.push(`${p} carries a SCIENCE CORE marker`);
    for (const name of SCIENCE_CORE_FNS) {
      if (defRe(name).test(src)) problems.push(`${p} defines science-core function ${name}`);
    }
  }
  return { problems, coreChars: region ? region.length : 0 };
}
