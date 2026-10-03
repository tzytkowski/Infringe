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
import { agencyHeatWeight, reportingCount, reportingDensity, reportingDensityMaximum, reportingHeatValue, densityScaleMidpoint } from '../src/lib/map-density.ts';
import { comparisonFeatures, comparisonValue, comparisonCSV, percentChange, mergeBreakdowns } from '../src/lib/cjic-comparison.ts';
import { buildReportingAreas } from './cjic-geography.mjs';

const root = 'public/data/michigan-cjic';
const manifest = JSON.parse(await readFile(`${root}/prepared/manifest.json`, 'utf8'));
const chunks = [];
const originalAreaCounts = new Map();
const originalOffenseCounts = new Map();
const originalDemographics = { race: {}, age: {}, sex: {} };
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
      const place = `${record.COUNTY_DESCRIPTION}|${record.CITY_DESCRIPTION}`;
      const year = record['Year of INCIDENT_DATE'];
      const areaKey = `${source}|${year}|${place}`;
      originalAreaCounts.set(areaKey, (originalAreaCounts.get(areaKey) || 0) + 1);
      const offenseKey = `${source}|${year}|${record.MICR_OFFENSE}`;
      originalOffenseCounts.set(offenseKey, (originalOffenseCounts.get(offenseKey) || 0) + 1);
      if (source === 'cjic-victim') for (const [name, field] of [['race', 'RACE'], ['age', 'VICTIM_AGE_GROUP'], ['sex', 'SEX']]) {
        const label = record[field] || 'Not reported';
        originalDemographics[name][label] = (originalDemographics[name][label] || 0) + 1;
      }
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

test('grouped homicide filter counts every matching original offense label', () => {
  const result = queryCJIC(manifest, chunks, { ...defaults, category: 'group:homicide' });
  const standardized = queryCJIC(manifest, chunks, { ...defaults, category: 'standard:Homicide' });
  const expected = [...originalOffenseCounts].reduce((count, [key, rows]) =>
    count + (/\b(HOMICIDE|MURDER|MANSLAUGHTER)\b/i.test(key.split('|').slice(2).join('|')) ? rows : 0), 0);
  assert.ok(expected > 0);
  assert.equal(result.total, expected);
  assert.equal(standardized.total, expected);
  assert.ok(result.incidents.every((record) => /\b(HOMICIDE|MURDER|MANSLAUGHTER)\b/i.test(record.category)));
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
    // Re-intersecting even the county with itself changes Turf's spherical
    // area slightly through coordinate rounding. Bound that numerical error
    // and check every vertex independently against the county boundary.
    assert.ok(Math.abs(area(shape) - area(clipped)) < Math.max(1, area(shape) * 0.00005), `${reportingArea.key}: boundary outside county`);
    const countyRings = county.geometry.type === 'MultiPolygon' ? county.geometry.coordinates.flat() : county.geometry.coordinates;
    const reportingRings = reportingArea.geometry.type === 'MultiPolygon' ? reportingArea.geometry.coordinates.flat() : reportingArea.geometry.coordinates;
    for (const ring of reportingRings) for (const point of ring) {
      if (booleanPointInPolygon(point, county.geometry)) continue;
      const nearEdge = countyRings.some((boundary) => boundary.slice(1).some((end, index) => {
        const start = boundary[index];
        const dx = end[0] - start[0], dy = end[1] - start[1];
        const lengthSquared = dx * dx + dy * dy;
        const fraction = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
        return Math.hypot(point[0] - start[0] - fraction * dx, point[1] - start[1] - fraction * dy) < 1e-8;
      }));
      assert.ok(nearEdge, `${reportingArea.key}: vertex outside its county`);
    }
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

test('every city/county overlay total agrees independently with original CSV rows for each source and year', () => {
  const geography = new Map(manifest.areas.map((area) => [area.key, area]));
  for (const period of ['all', '2021', '2022', '2023', '2024', '2025', '2026']) {
    for (const source of ['cjic-crime', 'cjic-victim']) {
      const expected = new Map();
      for (const [key, count] of originalAreaCounts) {
        const [rowSource, year, county, city] = key.split('|');
        if (rowSource !== source || period !== 'all' && period !== year) continue;
        const location = geography.get(`${county}|${city}`);
        assert.ok(location, key);
        const mapKey = location.precision === 'county' ? `${county}|__county__` : location.key;
        expected.set(mapKey, (expected.get(mapKey) || 0) + count);
      }
      const result = queryCJIC(manifest, chunks, { ...defaults, sources: [source], period, analysisOnly: true });
      assert.equal(result.total, [...expected.values()].reduce((sum, count) => sum + count, 0));
      assert.equal(result.incidents.length, 0);
      for (const overlay of result.areas) {
        assert.equal(overlay[source === 'cjic-crime' ? 'crime' : 'victims'], expected.get(overlay.key) || 0, `${source} ${period} ${overlay.key}`);
        expected.delete(overlay.key);
      }
      assert.equal(expected.size, 0, 'every original reporting place appears on the map or in county-only totals');
    }
  }
});

test('all official municipal matches retain the correct city/village/township type and county', async () => {
  const geography = JSON.parse(await readFile(`${root}/reporting-geography.json`, 'utf8'));
  const counties = JSON.parse(await readFile('src/lib/county-boundaries.json', 'utf8'));
  const rebuilt = buildReportingAreas(new Set(manifest.areas.map((area) => area.key)), geography, counties);
  for (let index = 0; index < rebuilt.length; index++) {
    const actual = manifest.areas.find((area) => area.key === rebuilt[index].key);
    assert.equal(actual.geographyLabel, rebuilt[index].geographyLabel);
    assert.equal(actual.precision, rebuilt[index].precision);
    assert.deepEqual(actual.geometry, rebuilt[index].geometry);
    if (actual.precision === 'reporting-area' && actual.city.endsWith(' Township')) assert.ok(actual.geographyLabel.endsWith(' Township'));
  }
  assert.equal(manifest.areas.find((area) => area.key === 'Oakland|Wixon').geographyLabel, 'City of Wixom');
  assert.equal(manifest.areas.find((area) => area.key === 'Macomb|Mount Clemens').geographyLabel, 'City of Mt Clemens');
  assert.equal(manifest.areas.find((area) => area.key === 'Macomb|Saint Clair Shores').geographyLabel, 'City of St Clair Shores');
});

test('zero-match villages stay separate from enclosing township counts', () => {
  const result = queryCJIC(manifest, chunks, { ...defaults, period: '2025', search: 'Holly Township' });
  const village = result.areas.find((area) => area.key === 'Oakland|Holly');
  const township = result.areas.find((area) => area.key === 'Oakland|Holly Township');
  assert.ok(township.crime > 0);
  assert.equal(village.crime, 0);
  assert.equal(village.victims, 0);
  assert.equal(village.geographyLabel, 'Village of Holly');
  assert.equal(reportingCount({ ...village, crime: 10, victims: 30 }, 'crime'), 10);
  assert.equal(reportingCount({ ...village, crime: 10, victims: 30 }, 'victims'), 30);
  assert.equal(reportingDensity({ ...village, crime: 10, victims: 30 }, 'victims'), 30 / village.areaKm2);
});

test('comparison breakdowns match original offense/year and demographic totals, without pagination', () => {
  const result = queryCJIC(manifest, chunks, { ...defaults, analysisOnly: true });
  const expectedOffenses = new Map();
  const expectedYears = new Map();
  for (const [key, count] of originalOffenseCounts) {
    const [source, year, offense] = key.split('|');
    const measure = source === 'cjic-crime' ? 'crime' : 'victims';
    for (const [map, label] of [[expectedOffenses, offense], [expectedYears, year]]) {
      if (!map.has(label)) map.set(label, { key: label, crime: 0, victims: 0 });
      map.get(label)[measure] += count;
    }
  }
  assert.deepEqual(result.analysis.byYear, [...expectedYears.values()].sort((a, b) => Number(a.key) - Number(b.key)));
  for (const entry of result.analysis.byOffense) assert.deepEqual(entry, expectedOffenses.get(entry.key));
  assert.equal(result.analysis.byOffense.length, expectedOffenses.size);
  assert.deepEqual(result.analysis.victimRaces, originalDemographics.race);
  assert.deepEqual(result.analysis.victimAges, originalDemographics.age);
  assert.deepEqual(result.analysis.victimSex, originalDemographics.sex);
  const city = queryCJIC(manifest, chunks, { ...defaults, analysisOnly: true, period: '2025', scope: 'Oakland|Troy' });
  assert.equal(city.areas.length, 1);
  for (const source of defaults.sources) assert.equal(city.sourceCounts[source], originalAreaCounts.get(`${source}|2025|Oakland|Troy`));
  const county = queryCJIC(manifest, chunks, { ...defaults, analysisOnly: true, scope: 'county:Macomb' });
  assert.ok(county.areas.every((area) => area.county === 'Macomb'));
  assert.ok(county.areas.some((area) => area.precision === 'county'));
  const unresolved = queryCJIC(manifest, chunks, { ...defaults, analysisOnly: true, scope: 'Macomb|__county__' });
  assert.equal(unresolved.areas.length, 1);
  assert.equal(unresolved.total, county.areas.find((area) => area.precision === 'county').crime + county.areas.find((area) => area.precision === 'county').victims);
});

test('comparison map keeps missing cohorts distinct from zero counts, handles density and zero baselines', () => {
  const a = queryCJIC(manifest, chunks, { ...defaults, analysisOnly: true, period: '2024', scope: 'Oakland|Troy' });
  const b = queryCJIC(manifest, chunks, { ...defaults, analysisOnly: true, period: '2025', scope: 'Oakland|Troy' });
  const base = { a, b, aLabel: 'A', bLabel: 'B', metric: 'crime', view: 'change', density: false };
  const [feature] = comparisonFeatures(base);
  assert.equal(feature.value, b.areas[0].crime - a.areas[0].crime);
  assert.equal(comparisonFeatures({ ...base, density: true })[0].value, b.areas[0].crime / b.areas[0].areaKm2 - a.areas[0].crime / a.areas[0].areaKm2);
  const different = queryCJIC(manifest, chunks, { ...defaults, analysisOnly: true, period: '2025', scope: 'Macomb|Warren' });
  assert.ok(comparisonFeatures({ ...base, b: different }).every((entry) => entry.value === null));
  assert.equal(comparisonValue(null, 'crime', false), null);
  assert.equal(comparisonValue({ ...a.areas[0], precision: 'county' }, 'crime', true), null);
  assert.equal(percentChange(0, 10), null);
  assert.equal(percentChange(0, 0), 0);
  assert.equal(percentChange(100, 125), 25);
  assert.equal(percentChange(100, 0), -100);
  assert.deepEqual(mergeBreakdowns([{ key: 'offense', crime: 2, victims: 3 }], []), [{ key: 'offense', aCrime: 2, aVictims: 3, bCrime: 0, bVictims: 0 }]);
  assert.equal(comparisonCSV([['City, name', '=formula', '"quote"', null, -5]]), '"City, name","\'=formula","""quote""",,-5');
});
