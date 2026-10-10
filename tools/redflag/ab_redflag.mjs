/**
 * Alberta Wildfire Red Flag Watch / Warning — parsed from the AWCC fire weather
 * forecasts (wildfire.alberta.ca/files/amfcst.pdf, pmfcst.pdf).
 *
 * When a Red Flag product is in effect the forecast leads with a banner such as
 *   RED FLAG WARNING IN EFFECT FOR
 *   OJ/FV/MA/RE/GP/MM/PY/LB ZONES FOR TOMORROW'S BURNING PERIOD
 * (Alberta Wildfire, "Red Flag" fact sheet, May 2019; zone codes from the Fire
 * Weather Forecast Zones map). Only Alberta Wildfire's meteorologists issue these;
 * Pyra copies them and never computes its own.
 *
 * CLI (GitHub Actions, needs pdftotext):  node tools/redflag/ab_redflag.mjs data/ab_redflag.json
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const AB_ZONES = ['OJ', 'FV', 'PY', 'MA', 'MM', 'RE', 'GP', 'SH', 'LB', 'ED', 'JP', 'RM', 'AG', 'BP', 'BO', 'CR', 'WP', 'CH'];
const ALIAS = { JA: 'JP', BA: 'BP', WA: 'WP' };   // codes used before the 2024 zone map
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Parse one forecast's text (pdftotext -layout). Returns null if it is not a usable forecast. */
export function parseForecastText(text) {
  const flat = text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (!/FIRE WEATHER FORECAST/i.test(flat)) return null;
  if (/PRODUCT IS DISCONTINUED/i.test(flat)) return { discontinued: true };
  const iss = flat.match(/ISSUED:\s*(\d{3,4})\s+\w+\s+(\w+)\s+(\d{1,2})\s+(\d{4})/i);
  let issuedDate = null, issuedTime = null;
  if (iss) {
    const m = MONTHS.indexOf(iss[2].toLowerCase());
    if (m >= 0) issuedDate = `${iss[4]}-${String(m + 1).padStart(2, '0')}-${String(+iss[3]).padStart(2, '0')}`;
    issuedTime = iss[1].padStart(4, '0');
  }
  const products = [];
  const re = /RED FLAG (WARNING|WATCH) IN EFFECT FOR (.+?)(?:BURNING PERIODS?|(?=RED FLAG)|$)/gi;
  let m;
  while ((m = re.exec(flat))) {
    const kind = m[1].toLowerCase();
    const body = m[2];
    const zonePart = body.split(/\bZONES?\b/i)[0];
    let zones = /\bALL\b/i.test(zonePart) ? [...AB_ZONES]
      : [...new Set((zonePart.match(/\b[A-Z]{2}\b/g) || []).map(z => ALIAS[z] || z).filter(z => AB_ZONES.includes(z)))];
    const period = /TOMORROW/i.test(body) ? 'tomorrow' : /TODAY|THIS AFTERNOON/i.test(body) ? 'today' : 'unspecified';
    products.push({ kind, zones, period, text: `RED FLAG ${m[1].toUpperCase()} IN EFFECT FOR ${body.trim()}${/BURNING PERIOD/i.test(m[0]) ? ' BURNING PERIOD' : ''}`.replace(/\s+/g, ' ') });
  }
  return { issuedDate, issuedTime, products };
}

/** Date the product applies to (YYYY-MM-DD), from the issue date and its period. */
export function validDate(issuedDate, period) {
  if (!issuedDate) return null;
  const d = new Date(`${issuedDate}T12:00:00Z`);
  if (period === 'tomorrow') d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Combine AM and PM forecasts: the most recently issued usable forecast wins. */
export function combine(parsed) {
  const ok = parsed.filter(p => p && !p.discontinued && p.f?.issuedDate)
    .sort((a, b) => (a.f.issuedDate + a.f.issuedTime).localeCompare(b.f.issuedDate + b.f.issuedTime));
  const last = ok.pop();
  if (!last) return { generated: new Date().toISOString(), source: null, issued: null, products: [] };
  return {
    generated: new Date().toISOString(),
    source: last.url,
    issued: `${last.f.issuedDate} ${last.f.issuedTime}`,
    products: last.f.products.map(p => ({ ...p, validDate: validDate(last.f.issuedDate, p.period) })),
  };
}

async function main(outPath) {
  const dir = mkdtempSync(join(tmpdir(), 'abrf-'));
  const parsed = [];
  for (const name of ['amfcst', 'pmfcst']) {
    const url = `https://wildfire.alberta.ca/files/${name}.pdf`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pdf = join(dir, `${name}.pdf`);
      writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
      const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
      parsed.push({ url, f: parseForecastText(text) });
    } catch (e) { console.log(`::warning::${name}: ${e.message}`); }
  }
  if (!parsed.some(p => p.f)) { console.log('::warning::no usable forecast — keeping previous ab_redflag.json'); return; }
  const out = combine(parsed);
  let prev = null; try { prev = JSON.parse(readFileSync(outPath, 'utf8')); } catch {}
  if (prev && prev.issued === out.issued && JSON.stringify(prev.products) === JSON.stringify(out.products)) { console.log('unchanged'); return; }
  writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
  console.log(`ab_redflag.json: issued ${out.issued}, ${out.products.length} product(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2] || 'data/ab_redflag.json');
