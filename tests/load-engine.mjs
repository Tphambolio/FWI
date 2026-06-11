/**
 * Loads a browser engine file (fwi.js / bc/fwi.js) into a Node vm sandbox
 * with minimal DOM shims, returning the window.FWI export object.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadEngine(path) {
  const src = readFileSync(path, 'utf8');
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
  vm.runInContext(src, sandbox, { filename: path });
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
