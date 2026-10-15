import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichAndLinkIncidents } from '../src/lib/incident-links.mjs';
import { offenseColor, offenseSeverity, standardCategoryTerms, standardizeOffense } from '../src/lib/offense-taxonomy.mjs';
import { parseViewParams, serializeViewParams } from '../src/lib/view-state.mjs';

test('standard offense taxonomy preserves useful cross-source distinctions', () => {
  assert.equal(standardizeOffense('Murder and non-negligent manslaughter'), 'Homicide');
  assert.equal(standardizeOffense('Motor vehicle theft'), 'Motor vehicle theft');
  assert.equal(standardizeOffense('Aggravated assault with a firearm'), 'Aggravated assault');
  assert.equal(standardizeOffense('Fraud Identity Theft'), 'Fraud / forgery');
  assert.equal(standardizeOffense('Violation of Controlled Substance'), 'Drug / narcotic offense');
  assert.equal(standardizeOffense('ASSAULT', 'Attempted murder'), 'Simple assault / intimidation');
  assert.deepEqual(standardCategoryTerms('standard:Homicide'), ['HOMICIDE', 'MURDER', 'MANSLAUGHTER']);
});

test('offense colors use a continuous severity scale with red reserved for homicide', () => {
  assert.equal(offenseColor('HOMICIDE', 'Murder / non-negligent manslaughter'), '#e5484d');
  assert.ok(offenseSeverity('ROBBERY') > offenseSeverity('LARCENY'));
  assert.ok(offenseSeverity('SEXUAL ASSAULT') > offenseSeverity('AGGRAVATED ASSAULT'));
  assert.notEqual(offenseColor('ROBBERY'), offenseColor('AGGRAVATED ASSAULT'));
  assert.notEqual(offenseColor('LARCENY'), offenseColor('FRAUD'));
  assert.notEqual(offenseColor('SEXUAL ASSAULT'), '#e5484d');
});

test('news and agency entries link only with matching date and location evidence', () => {
  const at = Date.parse('2026-09-27T16:00:00-04:00');
  const base = { category: 'Homicide / Murder', description: 'Fatal shooting', occurredAt: at, longitude: null, latitude: null, fields: {} };
  const records = enrichAndLinkIncidents([
    { ...base, id: 'news-one', source: 'news', neighborhood: 'Detroit', intersection: 'Prest Street and Eaton Avenue' },
    { ...base, id: 'detroit-one', source: 'detroit', neighborhood: 'Detroit', intersection: 'PREST & EATON' },
    { ...base, id: 'detroit-other', source: 'detroit', neighborhood: 'Detroit', intersection: 'Woodward and Congress', occurredAt: at + 86_400_000 },
  ]);
  assert.deepEqual(records.find((record) => record.id === 'news-one').relatedIncidentIds, ['detroit-one']);
  assert.deepEqual(records.find((record) => record.id === 'detroit-one').relatedIncidentIds, ['news-one']);
  assert.deepEqual(records.find((record) => record.id === 'detroit-other').relatedIncidentIds, []);
});

test('shareable view parameters round-trip filters', () => {
  const view = { sources: ['detroit', 'news'], period: '2024', category: 'standard:Homicide', races: [], search: 'Woodward', regionalFocus: 'both', recordSort: 'oldest', recordFilterField: 'location', recordFilter: 'Detroit' };
  const parsed = parseViewParams(serializeViewParams(view), ['detroit', 'news', 'clemis']);
  assert.deepEqual(parsed, view);
});
test('all-years, empty-source and field-filter links survive reloads', () => {
  const allowed = ['detroit', 'news', 'clemis', 'cjic-crime', 'cjic-victim'];
  for (const sources of [[], ['cjic-crime'], ['detroit', 'news']]) {
    const view = { sources, period: 'all', category: '', races: [], search: '', regionalFocus: 'both', recordSort: 'newest', recordFilterField: 'field:MICR_OFFENSE', recordFilter: '09001 - Murder' };
    assert.deepEqual(parseViewParams(serializeViewParams(view), allowed), view);
  }
  assert.equal(parseViewParams(new URLSearchParams('sources=cjic-crime'), allowed).period, 'all');
  assert.equal(parseViewParams(new URLSearchParams('sources=cjic-crime&period=24h'), allowed).period, 'all');
  assert.equal(parseViewParams(new URLSearchParams('sources=clemis&period=24h'), allowed).sources[0], 'clemis');
});
