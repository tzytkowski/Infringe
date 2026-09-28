import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse';
import { buildReportingAreas } from './cjic-geography.mjs';

const root = 'public/data/michigan-cjic';
const destination = `${root}/prepared`;
const inputs = ['victim', 'crime'];
const schemaVersion = 2;
const fingerprints = await Promise.all(inputs.map(async (name) => {
  const info = await stat(`${root}/${name}-live.csv`);
  return { name, size: info.size, modified: info.mtimeMs };
}));
const geographyText = await readFile(`${root}/reporting-geography.json`, 'utf8');
const countyText = await readFile('src/lib/county-boundaries.json', 'utf8');
const version = createHash('sha256').update(JSON.stringify({ schemaVersion, fingerprints, geographyText, countyText })).digest('hex').slice(0, 16);
try {
  const previous = JSON.parse(await readFile(`${destination}/manifest.json`, 'utf8'));
  if (previous.version === version) {
    await Promise.all(Object.values(previous.sources).flatMap((source) => source.chunks.map((chunk) => stat(`${destination}/${chunk.file}`))));
    console.log('CJIC data is up to date.');
    process.exit(0);
  }
} catch { /* Rebuild when the input files or generated files change. */ }

await mkdir(destination, { recursive: true });
const geography = JSON.parse(geographyText);
const counties = JSON.parse(countyText);
const races = new Set();
const linkedVictims = new Map();
const places = new Set();
const datasets = {};

function victimKey(record) {
  return [record.COUNTY_DESCRIPTION, record['Year of INCIDENT_DATE'], record.MICR_INCIDENTS_ID, record.MICR_OFFENSE].join('|');
}

async function* records(name) {
  const file = await open(`${root}/${name}-live.csv`, 'r');
  const bytes = Buffer.alloc(2);
  await file.read(bytes, 0, 2, 0);
  await file.close();
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8';
  const parser = createReadStream(`${root}/${name}-live.csv`, { encoding }).pipe(parse({
    bom: true, delimiter: '\t', columns: (headers) => headers.map((name) => name || '__EMPTY_COLUMN__'),
    skip_empty_lines: true,
  }));
  for await (const record of parser) {
    if (record.__EMPTY_COLUMN__) throw new Error('The unnamed export column contains data.');
    delete record.__EMPTY_COLUMN__;
    if (!['Macomb', 'Oakland'].includes(record.COUNTY_DESCRIPTION)) throw new Error(`Unexpected county: ${record.COUNTY_DESCRIPTION}`);
    if (!/^\d{4}$/.test(record['Year of INCIDENT_DATE'])) throw new Error('A CJIC row has no valid year.');
    yield record;
  }
}

// Determine race bits before linking crime rows; keep every original victim row.
for await (const record of records('victim')) races.add(record.RACE || 'Not reported');
const raceNames = [...races].sort();
if (raceNames.length > 30) throw new Error('The race index needs more than 30 bits.');
const raceBits = new Map(raceNames.map((name, index) => [name, 2 ** index]));

for (const name of inputs) {
  const years = new Map();
  const categories = new Set();
  let fields;
  let total = 0;
  for await (const record of records(name)) {
    fields ??= Object.keys(record);
    const year = Number(record['Year of INCIDENT_DATE']);
    if (!years.has(year)) years.set(year, []);
    const raceMask = name === 'victim'
      ? raceBits.get(record.RACE || 'Not reported')
      : linkedVictims.get(victimKey(record)) || 0;
    if (name === 'victim') linkedVictims.set(victimKey(record), (linkedVictims.get(victimKey(record)) || 0) | raceMask);
    years.get(year).push({ values: fields.map((field) => record[field]), raceMask, order: total++ });
    categories.add(record.MICR_OFFENSE);
    places.add(`${record.COUNTY_DESCRIPTION}|${record.CITY_DESCRIPTION}`);
  }
  const idColumn = fields.indexOf('MICR_INCIDENTS_ID');
  const chunks = [];
  for (const [year, records] of [...years].sort(([a], [b]) => b - a)) {
    records.sort((a, b) => Number(b.values[idColumn]) - Number(a.values[idColumn]) || a.order - b.order);
    const dictionaries = fields.map(() => []);
    const indexes = fields.map(() => new Map());
    const values = [];
    const masks = [];
    for (const record of records) {
      record.values.forEach((value, column) => {
        const index = indexes[column];
        if (!index.has(value)) { index.set(value, dictionaries[column].length); dictionaries[column].push(value); }
        values.push(index.get(value));
      });
      masks.push(record.raceMask);
    }
    const file = `${name}-${year}-${version}.json`;
    const text = JSON.stringify({ fields, dictionaries, values, masks });
    await writeFile(`${destination}/${file}`, text);
    chunks.push({ year, count: records.length, file });
    console.log(`CJIC ${name} ${year}: ${records.length.toLocaleString()} rows, ${(Buffer.byteLength(text) / 1_000_000).toFixed(1)} MB`);
  }
  datasets[`cjic-${name}`] = { fields, total, categories: [...categories].sort(), chunks };
}

const reportingAreas = buildReportingAreas(places, geography, counties);
const manifest = {
  version, preparedAt: new Date().toISOString(), coverage: '2021-2026', coverageEnd: '2026-06-30',
  source: 'https://www.michigan.gov/msp/divisions/cjic/dashboard-portal/crime-dashboard',
  geographySource: geography.source, races: raceNames, areas: reportingAreas, sources: datasets,
};
await writeFile(`${destination}/manifest.json`, JSON.stringify(manifest));
console.log(`Prepared ${Object.values(datasets).reduce((sum, source) => sum + source.total, 0).toLocaleString()} rows. ${reportingAreas.filter((area) => area.precision === 'county').length} reporting areas have county-only geography.`);
