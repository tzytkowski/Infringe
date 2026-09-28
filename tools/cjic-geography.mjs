import { arcgisToGeoJSON } from '@terraformer/arcgis';
import { area } from '@turf/area';
import { intersect } from '@turf/intersect';
import { featureCollection } from '@turf/helpers';

const aliases = {
  'Mount Clemens': 'Mt Clemens', 'Saint Clair Shores': 'St Clair Shores',
  Clarkston: 'Village of Clarkston', 'Orchard Lake': 'Orchard Lake Village', Wixon: 'Wixom',
  'Grosse Pointe Shores': 'The Village of Grosse Pointe Shores A Michigan City',
};

export function geometryBounds(geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const points = polygons.flat(2);
  return points.reduce((bounds, [x, y]) => [Math.min(bounds[0], x), Math.min(bounds[1], y), Math.max(bounds[2], x), Math.max(bounds[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
}

export function buildReportingAreas(keys, geography, countyFeatures) {
  const counties = new Map(countyFeatures.map((county) => [county.attributes.NAME.replace(/ County$/, ''), arcgisToGeoJSON(county)]));
  return [...keys].sort().map((key) => {
    const [countyName, city] = key.split('|');
    const county = counties.get(countyName);
    if (!county) throw new Error(`Missing county boundary: ${countyName}`);
    const township = city.endsWith(' Township');
    const name = aliases[city] || city.replace(/ Township$/, '');
    // Names alone are ambiguous: Northville city and Northville township differ.
    const candidates = geography.features.filter((feature) => feature.properties.NAME === name
      && (township ? feature.properties.TYPE === 'Township' : ['City', 'Village'].includes(feature.properties.TYPE)));
    const matches = candidates.map((feature) => {
      const clipped = intersect(featureCollection([feature, county]));
      return { feature, clipped, size: clipped ? area(clipped) : 0 };
    }).filter((match) => match.size > 10_000).sort((a, b) => b.size - a.size);
    const match = matches[0];
    if (matches.length > 1) throw new Error(`Ambiguous reporting boundary: ${key}`);
    const shape = match?.clipped || county;
    return {
      key, county: countyName, city, precision: match ? 'reporting-area' : 'county',
      geographyLabel: match?.feature.properties.LABEL || `${countyName} County only`,
      geometry: shape.geometry, bounds: geometryBounds(shape.geometry), areaKm2: area(shape) / 1_000_000,
    };
  });
}
