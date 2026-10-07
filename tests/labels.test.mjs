/**
 * Provenance labels rendered by wireDOM via initFWI (AB + BC):
 *   [data-fwi="source-station"], #fwi-dc-source badge, [data-fwi="updated"].
 * Uses the DOM stub from _harness.mjs, which records textContent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINES, makeContext, lstClock, fc, stationFeature, cwfisFeature, swobNear,
  prevPayload, TODAY, YDAY, rep,
} from './_harness.mjs';

const [AB, BC] = ENGINES;
const IDS = ['fwi-dc-source', 'fwi-dc-divergence'];
const render = async (e, opts) => {
  const h = makeContext(e.path, { ids: IDS, ...opts });
  await h.run(`initFWI(${e.lat}, ${e.lng}, '${e.name}')`);
  return { h, src: h.dom.text('source-station'), badge: h.dom.el('fwi-dc-source').textContent, updated: h.dom.text('updated') };
};

for (const e of ENGINES) {
  const post = lstClock(e, 7, 15, 13);

  test(`${e.prov}: CWFIS chain → source "CWFIS · <station> · <km>" and DC badge "CWFIS · …"`, async () => {
    const { src, badge } = await render(e, { now: post, mocks: { cwfis: fc([stationFeature(e, { rep_date: rep(TODAY) })]) } });
    assert.equal(src, `CWFIS · ${e.cwfisName} · 0 km`);
    assert.equal(badge, `CWFIS · ${e.cwfisName} · 0 km`);
  });

  test(`${e.prov}: SWOB obs → source starts "MSC SWOB", never "CWFIS"`, async () => {
    const { src } = await render(e, { now: post, mocks: { swob: fc([swobNear(e, post)]) } });
    assert.equal(src, 'MSC SWOB · MSC AIRPORT (noon LST) · 1 km');
    assert.ok(!src.startsWith('CWFIS'));
  });

  test(`${e.prov}: SWOB weather over a CWFIS chain (temp cross-check) → source is SWOB, badge is the chain`, async () => {
    const { src, badge } = await render(e, { now: post, mocks: {
      cwfis: fc([stationFeature(e, { temp: 24, rep_date: rep(TODAY) })]), swob: fc([swobNear(e, post, { temp: 10 })]),
    } });
    assert.ok(src.startsWith('MSC SWOB · MSC AIRPORT'), src);
    assert.ok(!src.startsWith('CWFIS'));
    assert.equal(badge, `CWFIS · ${e.cwfisName} · 0 km`);
  });

  test(`${e.prov}: NWP fallback → source is the Open-Meteo label with no distance`, async () => {
    const { src } = await render(e, { now: post });
    assert.equal(src, 'Open-Meteo NWP (noon LST)');
  });

  test(`${e.prov}: IDW mode → source "IDW · N stations · avg X km" and badge "IDW blend · …"`, async () => {
    const { src, badge } = await render(e, {
      now: post, storage: { fwi_idw_mode: '1' },
      mocks: { cwfis: fc([
        stationFeature(e, { rep_date: rep(TODAY) }),
        cwfisFeature({ name: 'NEIGHBOUR', lat: e.lat + 0.3, lon: e.lng, dc: 360, rep_date: rep(TODAY) }),
      ]) },
    });
    assert.match(src, /^IDW · 2 stations · avg \d+ km$/);
    assert.match(badge, /^IDW blend · 2 stations · avg \d+ km$/);
  });

  test(`${e.prov}: holding cache with today's codes → badge "CWFIS (holding) · <stn> · <km> · <date>"`, async () => {
    const h0 = makeContext(e.path, { now: post });
    const key = h0.run(`_holdKey(${e.lat}, ${e.lng})`);
    const { badge, h } = await render(e, { now: post, storage: {
      [key]: JSON.stringify({ ffmc: 90, dmc: 50, dc: 380, repDate: rep(TODAY), stationName: 'HOLD STN', distKm: 3 }),
    } });
    assert.equal(badge, 'CWFIS (holding) · HOLD STN · 3 km · Jul 15');
    assert.equal(h.run('_lastFWI').dc, 380, 'final codes not stepped');
  });

  test(`${e.prov}: yesterday's daily carry-over → badge "Calc from CWFIS <date> chain · <station> · <km>"`, async () => {
    const { badge } = await render(e, { now: post, mocks: { prev: prevPayload(post, rep(YDAY)) } });
    assert.equal(badge, `Calc from CWFIS Jul 14 chain · ${e.name} · 0 km`);
  });

  test(`${e.prov}: no chain and no carry-over → badge "Season start pending · CWFIS inactive"`, async () => {
    const { badge, h } = await render(e, { now: post });
    assert.equal(badge, 'Season start pending · CWFIS inactive');
    assert.equal(h.dom.text('ffmc'), '—');
  });
}

// ─── 'updated' label ─────────────────────────────────────────────────────────

test('AB: CWFIS chain dated today → updated "Noon LST · today"', async () => {
  const { updated } = await render(AB, { now: lstClock(AB, 7, 15, 13), mocks: { cwfis: fc([stationFeature(AB, { rep_date: rep(TODAY) })]) } });
  assert.equal(updated, 'Noon LST · today');
});

test('AB: 20:00 MST (next UTC day) with today\'s chain is still "Noon LST · today"', async () => {
  const { updated } = await render(AB, { now: lstClock(AB, 7, 15, 20), mocks: { cwfis: fc([stationFeature(AB, { rep_date: rep(TODAY) })]) } });
  assert.equal(updated, 'Noon LST · today');
});

test('AB: post-noon CWFIS chain dated yesterday → updated "Noon LST · Jul 14 (not today)"', async () => {
  const { updated } = await render(AB, { now: lstClock(AB, 7, 15, 13), mocks: { cwfis: fc([stationFeature(AB, { rep_date: rep(YDAY) })]) } });
  assert.equal(updated, 'Noon LST · Jul 14 (not today)');
});

test('AB: pre-noon peak-burn forecast → updated "Peak Burn Forecast · 16:00 MDT"', async () => {
  const { updated } = await render(AB, { now: lstClock(AB, 7, 15, 9), mocks: { cwfis: fc([stationFeature(AB, { rep_date: rep(YDAY) })]) } });
  assert.equal(updated, 'Peak Burn Forecast · 16:00 MDT');
});

test('BC: updated label is always "Live · <time>" (BC has no Noon-LST label — current divergence from AB)', async () => {
  const { updated } = await render(BC, { now: lstClock(BC, 7, 15, 13), mocks: { cwfis: fc([stationFeature(BC, { rep_date: rep(TODAY) })]) } });
  assert.match(updated, /^Live · /);
});

// ─── BCWS provenance ─────────────────────────────────────────────────────────

test('BC: BCWS chain → source keeps its own "(N km)" without a duplicate distance; badge says BCWS', async () => {
  const { src, badge } = await render(BC, { now: lstClock(BC, 7, 15, 13), mocks: {
    bcws: { date: TODAY, stations: { 322: { name: 'Kamloops BCWS', temp: 26, rh: 25, wind: 10, rain: 0, ffmc: 91, dmc: 60, dc: 400, isi: 8, bui: 90, fwi: 25 } } },
  } });
  assert.match(src, /^BCWS Datamart · Kamloops BCWS \(\d+ km\)$/);
  assert.match(badge, /^BCWS · Kamloops BCWS · \d+ km$/);
});
