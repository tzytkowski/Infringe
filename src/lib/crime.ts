import countyBoundaries from './county-boundaries.json';

export const DETROIT_LAYER = 'https://services2.arcgis.com/qvkbeam7Wirps6zC/ArcGIS/rest/services/RMS_Crime_Incidents/FeatureServer/0';
export const DETROIT_SOURCE = 'https://data.detroitmi.gov/datasets/detroitmi::rms-crime-incidents/about';
export const CLEMIS_LAYER = 'https://services1.arcgis.com/cobAR8TNI9VyhY8z/arcgis/rest/services/PublicCrimeSearchOffenses/FeatureServer/4';
export const CLEMIS_SOURCE = 'https://experience.arcgis.com/experience/a945468523494efe97f8ab28d689f6dd';
export type CrimeSource = 'detroit' | 'clemis';
export type RegionalFocus = 'both' | 'oakland' | 'macomb';

// The map extents include a little space around both counties. Incident queries
// use the county polygons below, which never imply complete agency coverage.
export const REGIONAL_BOUNDS: [number, number, number, number] = [-83.71, 42.41, -82.68, 42.92];
export const REGIONAL_FOCUS_BOUNDS: Record<RegionalFocus, [number, number, number, number]> = {
  both: REGIONAL_BOUNDS,
  oakland: [-83.71, 42.41, -83.06, 42.91],
  macomb: [-83.13, 42.43, -82.68, 42.92],
};

// Generalized Oakland and Macomb boundaries from the public Michigan County
// Boundaries FeatureServer. Kept locally so the map and spatial queries agree.
export const COUNTY_QUERY_GEOMETRY = JSON.stringify({
  rings: countyBoundaries.flatMap((county) => county.geometry.rings),
  spatialReference: { wkid: 4326 },
});

export type Incident = {
  id: string;
  category: string;
  description: string;
  occurredAt: number | null;
  neighborhood: string | null;
  intersection: string | null;
  precinct: string | null;
  status: string | null;
  longitude: number;
  latitude: number;
};

export type IncidentResponse = {
  incidents: Incident[];
  total: number | null;
  offset: number;
  limit: number;
  nextOffset: number;
  fetchedAt: string;
};

export function crimeGroup(category: string) {
  const c = category.toUpperCase();
  if (/HOMICIDE|MURDER|ASSAULT|ROBBERY|KIDNAP|SEXUAL|SEX OFFENSE|RAPE|STALK|INTIMIDATION/.test(c)) return 'Person';
  if (/THEFT|LARCENY|BURGLARY|MOTOR VEHICLE|STOLEN|FRAUD|ARSON|VANDAL|DAMAGE|PROPERTY/.test(c)) return 'Property';
  if (/DRUG|NARCOTIC|WEAPON|PROSTITUTION|GAMBLING/.test(c)) return 'Society';
  return 'Other';
}

export const GROUP_COLORS: Record<string, string> = {
  Person: '#fb6b6b',
  Property: '#f4ba63',
  Society: '#9c8bfa',
  Other: '#64c9cc',
};

export function formatDate(value: number | null) {
  return value ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(value) : 'Date unavailable';
}
