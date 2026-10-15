import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecordTrend, trendCountAxis } from '../src/lib/record-trend.mjs';
import { readFile } from 'node:fs/promises';
import { prepareChunk, queryCJIC, standardizeOffense } from '../public/cjic-engine.mjs';
import { buildTimingGrid, rankCrimeMix, trailingAverage } from '../src/lib/chart-analysis.mjs';

const now = Date.parse('2026-10-14T15:30:00-04:00');
test('major crime groups preserve every category count while limiting the chart', () => {
  const counts = { Homicide: 2, Robbery: 8, Assault: 10, Theft: 30, Burglary: 12, Arson: 3, Weapons: 6, Drugs: 9, Other: 20 };
  const mix = rankCrimeMix(counts);
  assert.equal(mix.total, 100);
  assert.equal(mix.rows.length, 7);
  assert.equal(mix.rows[0].name, 'Theft');
  assert.equal(mix.rows.at(-1).name, 'Other offenses');
  assert.equal(mix.rows.at(-1).count, 29);
  assert.equal(mix.rows.find((row) => row.name === 'Homicide').count, 2);
  assert.equal(mix.rows.reduce((sum, row) => sum + row.count, 0), 100);
  assert.ok(Math.abs(mix.rows.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-12);
});
test('homicide remains visible at zero without changing totals or category limit', () => {
  const counts = { Theft: 100, Assault: 90, Burglary: 80, Robbery: 70, Weapons: 60, Drugs: 50, Arson: 40, Other: 10 };
  const mix = rankCrimeMix(counts);
  assert.equal(mix.rows.find((row) => row.name === 'Homicide').count, 0);
  assert.equal(mix.rows.length, 7);
  assert.equal(mix.rows.reduce((sum, row) => sum + row.count, 0), mix.total);
  assert.equal(mix.rows.at(-1).count, 100);
});
test('timing heatmap uses Eastern hour and excludes date-only/undated rows', () => {
  const grid = buildTimingGrid([{ occurredAt: Date.parse('2026-10-14T02:00:00Z'), count: 3 }, { occurredAt: now, datePrecision: 'date', count: 9 }, { occurredAt: null, count: 4 }]);
  assert.equal(grid.cells[1 * 24 + 22], 3); // Tuesday, 10pm Eastern.
  assert.equal(grid.total, 3);
  assert.equal(grid.excluded, 13);
  assert.equal(grid.cells.reduce((sum, count) => sum + count, 0), 3);
});
test('moving average requires a full trailing window and never uses future buckets', () => {
  assert.deepEqual(trailingAverage([3, 6, 9, 30].map((count) => ({ count }))), [null, null, 6, 15]);
});

test('race analysis counts victim rows only and retains unknown values', async () => {
  const root = new URL('../public/data/michigan-cjic/prepared/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const chunks = await Promise.all(['cjic-crime', 'cjic-victim'].map(async (source) => {
    const descriptor = manifest.sources[source].chunks.find((chunk) => chunk.year === 2026);
    return prepareChunk(source, 2026, JSON.parse(await readFile(new URL(descriptor.file, root), 'utf8')));
  }));
  const query = (sources) => queryCJIC(manifest, chunks, { sources, period: '2026', analysisOnly: true, limit: 0 });
  const combined = query(['cjic-crime', 'cjic-victim']);
  const victims = query(['cjic-victim']);
  assert.deepEqual(combined.analysis.victimRaces, victims.analysis.victimRaces);
  assert.equal(Object.values(victims.analysis.victimRaces).reduce((sum, count) => sum + count, 0), victims.total);
  assert.ok(victims.analysis.victimRaces.Unknown > 0);
  assert.deepEqual(query(['cjic-crime']).analysis.victimRaces, {});
});
test('count axes use round, evenly spaced integer ticks across different totals', () => {
  assert.deepEqual(trendCountAxis(248), { ceiling: 250, ticks: [0, 50, 100, 150, 200, 250] });
  assert.deepEqual(trendCountAxis(11), { ceiling: 12, ticks: [0, 2, 4, 6, 8, 10, 12] });
  for (const maximum of [0, 1, 3, 11, 17, 124, 1003, 42016]) {
    const { ceiling, ticks } = trendCountAxis(maximum);
    assert.ok(ceiling >= maximum);
    assert.equal(ticks[0], 0);
    assert.ok(ticks.length <= 7);
    assert.ok(ticks.every(Number.isInteger));
    assert.ok(ticks.every((tick, index) => !index || tick - ticks[index - 1] === ticks[1]));
  }
});
test('24-hour trend fills empty hours and preserves every record', () => {
  const trend = buildRecordTrend([{ occurredAt: now }, { occurredAt: now - 1000 }, { occurredAt: now - 86_400_000 }], '24h', [], now);
  assert.equal(trend.unit, 'hour');
  assert.equal(trend.points.length, 25);
  assert.equal(trend.points.at(-1).count, 2);
  assert.equal(trend.points[0].count, 1);
  assert.equal(trend.total, 3);
});
test('Detroit midnight and date-only reports use calendar days', () => {
  const trend = buildRecordTrend([{ occurredAt: Date.parse('2026-10-14T02:00:00Z'), datePrecision: 'date' }, { occurredAt: now }], '24h', [], now);
  assert.equal(trend.unit, 'day');
  assert.deepEqual(trend.points.map(({ key, count }) => [key, count]), [['2026-10-13', 1], ['2026-10-14', 1]]);
});
test('daily zero buckets include the spring daylight-saving transition', () => {
  const trend = buildRecordTrend([], '7d', [], Date.parse('2026-03-10T00:30:00-04:00'));
  assert.ok(trend.points.some((point) => point.key === '2026-03-08'));
  assert.deepEqual(trend.points.map((point) => point.key), ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
});
test('compact paginated counts retain dated and undated totals', () => {
  const trend = buildRecordTrend([{ occurredAt: now, count: 1003 }, { occurredAt: null, count: 7 }], '24h', [], now);
  assert.equal(trend.total, 1010);
  assert.equal(trend.points.at(-1).count, 1003);
  assert.equal(trend.undated, 7);
});
test('mixed agency and complete CJIC totals share honest annual buckets', () => {
  const trend = buildRecordTrend([{ occurredAt: now }, { occurredAt: null }], 'all', [{ key: '2024', crime: 1200, victims: 300 }, { key: '2026', crime: 7, victims: 2 }], now);
  assert.equal(trend.unit, 'year');
  assert.deepEqual(trend.points.map(({ key, count }) => [key, count]), [['2024', 1500], ['2025', 0], ['2026', 10]]);
  assert.equal(trend.undated, 1);
  assert.equal(trend.total, 1511);
});
test('field-filtered annual rows retain source year without invented dates', () => {
  const trend = buildRecordTrend([{ occurredAt: null, year: 2025 }, { occurredAt: null, year: 2025 }], '2025', [], now);
  assert.equal(trend.unit, 'year');
  assert.deepEqual(trend.points, [{ key: '2025', label: '2025', count: 2 }]);
});
test('year filters include empty months and source changes rebuild the series', () => {
  const trend = buildRecordTrend([{ occurredAt: Date.parse('2025-05-01T12:00:00-04:00') }], '2025', [], now);
  assert.equal(trend.points.length, 12);
  assert.equal(trend.points[4].count, 1);
  const switched = buildRecordTrend([], '7d', [], now);
  assert.equal(switched.total, 0);
  assert.equal(switched.points.length, 8);
  assert.ok(switched.points.every((point) => point.count === 0));
});

test('CJIC trend filters count the entire snapshot rather than the loaded page', async () => {
  const root = new URL('../public/data/michigan-cjic/prepared/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const descriptor = manifest.sources['cjic-crime'].chunks.find((chunk) => chunk.year === 2026);
  const chunk = prepareChunk('cjic-crime', 2026, JSON.parse(await readFile(new URL(descriptor.file, root), 'utf8')));
  const filters = { sources: ['cjic-crime'], period: '2026', limit: 1_000_000 };
  const full = queryCJIC(manifest, [chunk], filters);
  assert.ok(full.total > 300);
  const first = full.incidents[0];
  for (const [field, value, matches] of [
    ['source', 'CJIC crime', () => true],
    ['location', `${first.neighborhood}, ${first.county}`, (row) => row.neighborhood === first.neighborhood && row.county === first.county],
    ['offense', standardizeOffense(first.category), (row) => standardizeOffense(row.category) === standardizeOffense(first.category)],
    ['field:MICR_OFFENSE', first.category, (row) => row.category === first.category],
    ['any', first.category, (row) => Object.values(row.fields).some((entry) => String(entry).trim().toLowerCase() === first.category.toLowerCase())],
  ]) {
    const result = queryCJIC(manifest, [chunk], { ...filters, analysisOnly: true, limit: 0, recordFilterField: field, recordFilterValue: value });
    const expected = full.incidents.filter(matches).length;
    assert.equal(result.total, expected, field);
    assert.equal(result.analysis.byYear.reduce((sum, row) => sum + row.crime + row.victims, 0), expected, field);
    assert.equal(result.incidents.length, 0);
  }
});
