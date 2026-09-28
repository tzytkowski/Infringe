import { mkdir, writeFile } from 'node:fs/promises';

const root = 'https://gisagocss.state.mi.us/arcgis/rest/services/OpenData/michigan_geographic_framework/MapServer';
const features = [];
for (const layer of [2, 3]) {
  const url = new URL(`${root}/${layer}/query`);
  url.search = new URLSearchParams({
    where: '1=1', geometry: '-83.71,42.41,-82.68,42.92',
    geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'NAME,LABEL,TYPE,FIPSCODE',
    outSR: '4326', returnGeometry: 'true', maxAllowableOffset: '0.001', f: 'geojson',
  }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Michigan geography returned ${response.status}`);
  const data = await response.json();
  if (data.error || !Array.isArray(data.features)) throw new Error(JSON.stringify(data.error || data));
  features.push(...data.features);
}
await mkdir('public/data/michigan-cjic', { recursive: true });
await writeFile('public/data/michigan-cjic/reporting-geography.json', JSON.stringify({ source: root, features }));
console.log(`Saved ${features.length} official Michigan city, township and village boundaries.`);
