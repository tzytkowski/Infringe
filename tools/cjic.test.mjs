import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse';
import { prepareChunk, queryCJIC } from '../public/cjic-engine.mjs';
import { arcgisToGeoJSON } from '@terraformer/arcgis';
import { area } from '@turf/area';
import { intersect } from '@turf/intersect';
import { featureCollection } from '@turf/helpers';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { agencyHeatWeight, reportingDensity, reportingDensityMaximum, reportingHeatValue, densityScaleMidpoint } from '../src/lib/map-density.ts';

const root = 'public/data/michigan-cjic';
const manifest = JSON.parse(await readFile(`${root}/prepared/manifest.json`, 'utf8'));
const chunks = [];
const modulus = 2n ** 128n;
function rowHash(values) { return BigInt(`0x${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)}`); }
const defaults = { sources: ['cjic-crime', 'cjic-victim'], period: 'all', category: '', races: [], search: '' };

test('every named field and every CSV row survives preparation, including duplicate rows', async () => {
  for (const source of ['cjic-crime', 'cjic-victim']) {
    const definition = manifest.sources[source];
    let preparedHash = 0n;
    let preparedCount = 0;
    for (const descriptor of definition.chunks) {
      const data = JSON.parse(await readFile(`${root}/prepared/${descriptor.file}`, 'utf8'));
      assert.deepEqual(data.fields, definition.fields);
      assert.equal(data.values.length, descriptor.count * data.fields.length);
      assert.equal(data.masks.length, descriptor.count);
      for (let row = 0; row < descriptor.count; row++) {
        const values = data.fields.map((field, column) => data.dictionaries[column][data.values[row * data.fields.length + column]]);
        assert.ok(['Macomb', 'Oakland'].includes(values[data.fields.indexOf('COUNTY_DESCRIPTION')]));
        preparedHash = (preparedHash + rowHash(values)) % modulus;
      }
      preparedCount += descriptor.count;
      chunks.push(prepareChunk(source, descriptor.year, data));
    }
    let originalHash = 0n;
    let originalCount = 0;
    const file = `${root}/${source === 'cjic-crime' ? 'crime' : 'victim'}-live.csv`;
    const parser = createReadStream(file, { encoding: 'utf16le' }).pipe(parse({ bom: true, delimiter: '\t', columns: true, skip_empty_lines: true }));
    for await (const record of parser) {
      assert.deepEqual(Object.keys(record).filter(Boolean), definition.fields);
      originalHash = (originalHash + rowHash(definition.fields.map((field) => record[field]))) % modulus;
      originalCount++;
    }
    assert.equal(preparedCount, originalCount);
    assert.equal(preparedCount, definition.total);
    assert.equal(preparedHash, originalHash, `${source}: original field values changed`);
  }
});

test('all years and both sources contribute to complete map totals independently of the displayed page', () => {
  const result = queryCJIC(manifest, chunks, defaults);
  assert.equal(result.total, 821454);
  assert.equal(result.sourceCounts['cjic-crime'], 500937);
  assert.equal(result.sourceCounts['cjic-victim'], 320517);
  assert.equal(result.incidents.length, 300);
  assert.equal(result.areas.reduce((total, area) => total + area.crime + area.victims, 0), result.total);
  assert.equal(Object.values(result.groups).reduce((a, b) => a + b, 0), result.total);
  const second = queryCJIC(manifest, chunks, { ...defaults, offset: 300 });
  assert.equal(second.total, result.total);
  assert.deepEqual(second.areas, result.areas);
  assert.equal(new Set([...result.incidents, ...second.incidents].map((record) => record.id)).size, 600);
});

test('source selections, archived years, recent periods, category and all-field search stay scoped', () => {
  const archived = queryCJIC(manifest, chunks, { ...defaults, sources: ['cjic-victim'], period: '2021' });
  assert.equal(archived.total, 55178);
  assert.ok(archived.incidents.every((record) => record.source === 'cjic-victim' && record.year === 2021));
  assert.equal(queryCJIC(manifest, chunks, { ...defaults, period: '7d' }).total, 0);
  assert.equal(queryCJIC(manifest, chunks, { ...defaults, sources: [] }).total, 0);
  const filtered = queryCJIC(manifest, chunks, { ...defaults, sources: ['cjic-victim'], category: archived.incidents[0].category, search: 'Black' });
  assert.ok(filtered.total > 0);
  assert.ok(filtered.incidents.every((record) => Object.values(record.fields).some((value) => value.toLowerCase().includes('black')) && record.category === archived.incidents[0].category));
});

test('single and multiple victim races filter all map rows, and never invent race for unlinked crimes', () => {
  const black = queryCJIC(manifest, chunks, { ...defaults, sources: ['cjic-victim'], races: ['Black'] });
  assert.equal(black.total, 111570);
  assert.ok(black.incidents.every((record) => record.race === 'Black'));
  const multiple = queryCJIC(manifest, chunks, { ...defaults, sources: ['cjic-victim'], races: ['Black', 'Asian'] });
  assert.equal(multiple.total, 111570 + 4073);
  assert.equal(multiple.areas.reduce((total, area) => total + area.victims, 0), multiple.total);
  const crimes = queryCJIC(manifest, chunks, { ...defaults, sources: ['cjic-crime'], races: ['Black'] });
  assert.ok(crimes.total > 0 && crimes.total < 500937);
  assert.ok(crimes.incidents.every((record) => record.victimRaces.includes('Black') && record.race === undefined));
  assert.equal(queryCJIC(manifest, chunks, { ...defaults, races: ['__none__'] }).total, 0);
  console.log(`Black victim filter: ${black.total.toLocaleString()} victim rows; ${crimes.total.toLocaleString()} crime rows with matching linked victims.`);
});

test('crime race linkage agrees with the victim file for the same year, county, incident and offense', () => {
  const victimMasks = new Map();
  for (const chunk of chunks.filter((chunk) => chunk.source === 'cjic-victim')) {
    const get = (row, field) => chunk.dictionaries[chunk.columns[field]][chunk.values[row * chunk.fields.length + chunk.columns[field]]];
    for (let row = 0; row < chunk.count; row++) {
      const key = [get(row, 'COUNTY_DESCRIPTION'), chunk.year, get(row, 'MICR_INCIDENTS_ID'), get(row, 'MICR_OFFENSE')].join('|');
      const mask = 2 ** manifest.races.indexOf(get(row, 'RACE') || 'Not reported');
      victimMasks.set(key, (victimMasks.get(key) || 0) | mask);
    }
  }
  for (const chunk of chunks.filter((chunk) => chunk.source === 'cjic-crime')) {
    const get = (row, field) => chunk.dictionaries[chunk.columns[field]][chunk.values[row * chunk.fields.length + chunk.columns[field]]];
    for (let row = 0; row < chunk.count; row++) {
      const key = [get(row, 'COUNTY_DESCRIPTION'), chunk.year, get(row, 'MICR_INCIDENTS_ID'), get(row, 'MICR_OFFENSE')].join('|');
      assert.equal(chunk.masks[row], victimMasks.get(key) || 0);
    }
  }
});

test('CJIC records never receive invented point coordinates, including unresolved locations', () => {
  const cases = [defaults, { ...defaults, search: 'Community College' },
    ...chunks.map((chunk) => ({ ...defaults, sources: [chunk.source], period: String(chunk.year) }))];
  for (const filters of cases) {
    const result = queryCJIC(manifest, chunks, filters);
    assert.ok(result.incidents.length);
    for (const record of result.incidents) {
      assert.equal(record.longitude, null);
      assert.equal(record.latitude, null);
      assert.notEqual(record.locationPrecision, 'point');
      assert.ok(record.areaKey);
    }
    assert.equal(result.areas.reduce((sum, item) => sum + item.crime + item.victims, 0), result.total);
  }
});

test('every reporting boundary is clipped to its county; Northville uses city, not township', async () => {
  const counties = JSON.parse(await readFile('src/lib/county-boundaries.json', 'utf8')).map(arcgisToGeoJSON);
  for (const reportingArea of manifest.areas) {
    const shape = { type: 'Feature', geometry: reportingArea.geometry, properties: {} };
    const county = counties.find((item) => item.properties.NAME === `${reportingArea.county} County`);
    const clipped = intersect(featureCollection([shape, county]));
    assert.ok(clipped, reportingArea.key);
    assert.ok(Math.abs(area(shape) - area(clipped)) < 1, `${reportingArea.key}: boundary outside county`);
    assert.ok(reportingArea.areaKm2 > 0);
    assert.ok(Math.abs(reportingArea.areaKm2 - area(shape) / 1_000_000) < 0.000001);
  }
  const northville = manifest.areas.find((item) => item.key === 'Oakland|Northville');
  assert.equal(northville.precision, 'reporting-area');
  assert.equal(northville.geographyLabel, 'City of Northville');
  assert.ok(northville.areaKm2 < 6);
  assert.equal(booleanPointInPolygon([-83.483, 42.4], northville.geometry), false, 'Northville Township must not be colored');
});

test('CJIC density reflects area size, has a truthful legend, and excludes county-only totals', () => {
  const base = { ...manifest.areas.find((item) => item.precision === 'reporting-area'), crime: 100, victims: 0, races: {}, reportingLabels: [] };
  const small = { ...base, areaKm2: 2 };
  const large = { ...base, areaKm2: 20 };
  const unresolved = { ...base, precision: 'county', crime: 1_000_000 };
  assert.equal(reportingDensity(small), 50);
  assert.equal(reportingDensity(large), 5);
  assert.equal(reportingDensity(unresolved), null);
  assert.equal(reportingDensityMaximum([small, large, unresolved]), 50);
  assert.equal(reportingHeatValue(unresolved, 50), 0);
  assert.equal(reportingHeatValue(small, 50), 1);
  assert.ok(reportingHeatValue(large, 50) < reportingHeatValue(small, 50));
  assert.ok(Math.abs(reportingHeatValue({ ...small, crime: densityScaleMidpoint(50) * 2 }, 50) - 0.5) < 0.000001);
  assert.equal(reportingDensityMaximum([]), 0);
  assert.equal(reportingHeatValue({ ...small, crime: 0 }, 0), 0);
  assert.equal(agencyHeatWeight(1000), 0.075);
});
