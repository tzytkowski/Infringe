import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { prepareChunk, queryCJIC } from '../public/cjic-engine.mjs';

test('shipped snapshot is complete and its aggregates reconcile without source CSVs', async () => {
  const root = new URL('../public/data/michigan-cjic/prepared/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const chunks = [];
  for (const [source, definition] of Object.entries(manifest.sources)) {
    let count = 0;
    for (const descriptor of definition.chunks) {
      const data = JSON.parse(await readFile(new URL(descriptor.file, root), 'utf8'));
      assert.equal(data.masks.length, descriptor.count);
      assert.equal(data.values.length, descriptor.count * data.fields.length);
      assert.deepEqual(data.fields, definition.fields);
      chunks.push(prepareChunk(source, descriptor.year, data));
      count += descriptor.count;
    }
    assert.equal(count, definition.total);
  }
  const result = queryCJIC(manifest, chunks, { sources: Object.keys(manifest.sources), period: 'all', analysisOnly: true, limit: 0 });
  const expected = Object.values(manifest.sources).reduce((sum, source) => sum + source.total, 0);
  assert.equal(result.total, expected);
  for (const breakdown of [result.analysis.byYear, result.analysis.byOffense]) assert.equal(breakdown.reduce((sum, row) => sum + row.crime + row.victims, 0), expected);
  assert.equal(Object.values(result.analysis.victimRaces).reduce((sum, count) => sum + count, 0), manifest.sources['cjic-victim'].total);
});
