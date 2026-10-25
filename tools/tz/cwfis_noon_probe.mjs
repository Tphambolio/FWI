#!/usr/bin/env node
/**
 * CWFIS noon-LST refresh probe.
 *
 * Question: after Alberta fixed its clock at UTC−6 (2026-11-01), does CWFIS
 * keep publishing the Alberta daily FWI chain for "noon LST" at 19 UTC
 * (12:00 MST, the station standard time) or move it to 18 UTC? `rep_date` on
 * public:firewx_stns_current is a date stamp, not a clock time, so the hour
 * cannot be read off the layer; what can be observed is the UTC hour at which
 * today's rep_date first appears. Run hourly 17–22 UTC on active-season days
 * (cron, or `watch -n 1800 node tools/tz/cwfis_noon_probe.mjs`) and read the
 * first row where `with_today` > 0.
 *
 * Appends one CSV line per province per run to tools/tz/cwfis_noon_probe.csv:
 *   utc_now,prov,stations,with_today,with_yesterday,older,newest_rep_date
 *
 * Decision rule: today's chain first appearing before 19:00 UTC on several
 * days means CWFIS moved to 18 UTC → set AB_FWI_LST_OFFSET_FROM_2026_11_01 = 6
 * in fwi.js and FIRESIM_AB_FWI_LST_OFFSET_H=6 on FireSim. Otherwise leave 19.
 * BC is the control: its hour is expected to stay at 20 UTC.
 */
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'cwfis_noon_probe.csv');
const BOXES = {
  AB: { latMin: 48.9, latMax: 60.05, lonMin: -120.05, lonMax: -109.9 },
  BC: { latMin: 48.2, latMax: 60.05, lonMin: -139.1, lonMax: -114.0 },
};

async function fetchProvince(box) {
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows` +
    `?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeName=public:firewx_stns_current&outputFormat=application/json&count=2000` +
    `&CQL_FILTER=lat+BETWEEN+${box.latMin}+AND+${box.latMax}+AND+lon+BETWEEN+${box.lonMin}+AND+${box.lonMax}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!res.ok) throw new Error(`CWFIS WFS ${res.status}`);
  return (await res.json()).features ?? [];
}

const now = new Date();
const utcDay = now.toISOString().slice(0, 10);
const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
if (!existsSync(OUT)) writeFileSync(OUT, 'utc_now,prov,stations,with_today,with_yesterday,older,newest_rep_date\n');

for (const [prov, box] of Object.entries(BOXES)) {
  try {
    const feats = await fetchProvince(box);
    let today = 0, yday = 0, older = 0, newest = '';
    for (const f of feats) {
      const p = f.properties;
      if (p.ffmc == null) continue;
      const d = String(p.rep_date || '').slice(0, 10);
      if (d > newest) newest = d;
      if (d === utcDay) today++; else if (d === yesterday) yday++; else older++;
    }
    const line = `${now.toISOString()},${prov},${feats.length},${today},${yday},${older},${newest}`;
    appendFileSync(OUT, line + '\n');
    console.log(line);
  } catch (err) {
    console.error(`${prov}: ${err.message}`);
    appendFileSync(OUT, `${now.toISOString()},${prov},ERROR,,,,${err.message.replace(/,/g, ';')}\n`);
  }
}
