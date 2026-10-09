/**
 * Station page ops view: before today's 16:00 peak burn the primary card and the
 * headline show today; once it has passed they move to tomorrow's peak (the next
 * operational period) and the right card to the day after.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, makeContext, lstClock, fc, stationFeature, TODAY, rep } from './_harness.mjs';

const IDS = ['fwi-d1-preview-section', 'fwi-today-peak-label', 'fwi-today-desc', 'fwi-tomorrow-toggle-label',
  'fwi-d1-peak-label', 'fwi-d1-preview-date', 'fwi-today-prov', 'fwi-summary-row', 'fwi-summary-fwi',
  'fwi-summary-danger', 'fwi-summary-hfi', 'fwi-summary-live'];

const view = async (e, hourLST) => {
  const h = makeContext(e.path, { ids: IDS, now: lstClock(e, 7, 15, hourLST),
    mocks: { cwfis: fc([stationFeature(e, { rep_date: rep(TODAY) })]) } });
  await h.run(`initFWI(${e.lat}, ${e.lng}, '${e.name}')`);
  await h.run('buildD1Card()');
  h.run('clearInterval(_summaryTimer)');             // the page's 1-min chip refresh keeps node alive
  const t = id => h.dom.el(id).textContent;
  return { primary: t('fwi-today-peak-label'), desc: t('fwi-today-desc'), toggle: t('fwi-tomorrow-toggle-label'),
    right: t('fwi-d1-peak-label'), rightDate: t('fwi-d1-preview-date'),
    headline: h.dom.el('fwi-summary-fwi').innerHTML, prov: h.dom.el('fwi-today-prov').innerHTML };
};

for (const e of ENGINES) {
  test(`${e.prov}: before 16:00 local → primary card is today, right card is tomorrow`, async () => {
    const v = await view(e, 13);                       // 14:00 local daylight time
    assert.match(v.primary, /^Today · Peak Burn/);
    assert.match(v.right, /^Tomorrow · Peak Burn/);
    assert.equal(v.toggle, 'Tomorrow');
    assert.match(v.rightDate, /Jul 16/);
    assert.doesNotMatch(v.headline, /tomorrow/);
  });

  test(`${e.prov}: after 16:00 local → primary card and headline are tomorrow's peak, right card the day after`, async () => {
    const v = await view(e, 18);                       // 19:00 local daylight time
    assert.match(v.primary, /^Next Peak Burn · Tomorrow Thu, Jul 16/);
    assert.match(v.desc, /^Today's 16:00 peak has passed \(FWI \d/);
    assert.match(v.right, /^Day After · Peak Burn/);
    assert.match(v.rightDate, /Jul 17/);
    assert.equal(v.toggle, 'Day after');
    assert.match(v.headline, /tomorrow \(Thu, Jul 16\) 16:00/);
    assert.match(v.prov, /FORECAST/);
  });
}
