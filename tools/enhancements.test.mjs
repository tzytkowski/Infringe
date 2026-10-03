import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichAndLinkIncidents } from '../src/lib/incident-links.mjs';
import { standardCategoryTerms, standardizeOffense } from '../src/lib/offense-taxonomy.mjs';
import { parseViewParams, serializeViewParams } from '../src/lib/view-state.mjs';

test('standard offense taxonomy preserves useful cross-source distinctions', () => {
  assert.equal(standardizeOffense('Murder and non-negligent manslaughter'), 'Homicide');
  assert.equal(standardizeOffense('Motor vehicle theft'), 'Motor vehicle theft');
  assert.equal(standardizeOffense('Aggravated assault with a firearm'), 'Aggravated assault');
  assert.deepEqual(standardCategoryTerms('standard:Homicide'), ['HOMICIDE', 'MURDER', 'MANSLAUGHTER']);
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
  const view = { sources: ['detroit', 'news'], period: '2024', category: 'standard:Homicide', races: [], search: 'Woodward', regionalFocus: 'both', recordSort: 'oldest' };
  const parsed = parseViewParams(serializeViewParams(view), ['detroit', 'news', 'clemis']);
  assert.deepEqual(parsed, view);
});
