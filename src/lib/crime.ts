import countyBoundaries from './county-boundaries.json';
import type { MultiPolygon, Polygon } from 'geojson';

export const DETROIT_LAYER = 'https://services2.arcgis.com/qvkbeam7Wirps6zC/ArcGIS/rest/services/RMS_Crime_Incidents/FeatureServer/0';
export const DETROIT_SOURCE = 'https://data.detroitmi.gov/datasets/detroitmi::rms-crime-incidents/about';
export const CLEMIS_LAYER = 'https://services1.arcgis.com/cobAR8TNI9VyhY8z/arcgis/rest/services/PublicCrimeSearchOffenses/FeatureServer/4';
export const CLEMIS_SOURCE = 'https://experience.arcgis.com/experience/a945468523494efe97f8ab28d689f6dd';
export const CJIC_SOURCE = 'https://www.michigan.gov/msp/divisions/cjic/dashboard-portal/crime-dashboard';
export type RemoteSource = 'detroit' | 'clemis';
export type CJICSource = 'cjic-crime' | 'cjic-victim';
export type CrimeSource = RemoteSource | CJICSource | 'news';
export const DATA_SOURCES: { id: CrimeSource; label: string; shortLabel: string; coverage: string; color: string; url: string }[] = [
  { id: 'news', label: 'Local news reports', shortLabel: 'NEWS', coverage: 'WXYZ + WDIV / reviewed citations', color: '#ed8f77', url: 'https://www.wxyz.com/about-us/rss' },
  { id: 'clemis', label: 'CLEMIS offenses', shortLabel: 'CLEMIS', coverage: 'Oakland + Macomb / 2026 onward', color: '#f4ba63', url: CLEMIS_SOURCE },
  { id: 'detroit', label: 'Detroit Police', shortLabel: 'DPD', coverage: 'Detroit / December 2016 onward', color: '#fb6b6b', url: DETROIT_SOURCE },
  { id: 'cjic-crime', label: 'CJIC crime', shortLabel: 'CJIC CRIME', coverage: 'Oakland + Macomb / 2021-2026', color: '#79cfad', url: CJIC_SOURCE },
  { id: 'cjic-victim', label: 'CJIC victims', shortLabel: 'CJIC VICTIM', coverage: 'Oakland + Macomb / 2021-2026', color: '#b7a0ee', url: CJIC_SOURCE },
];
export function isCJIC(source: CrimeSource): source is CJICSource { return source === 'cjic-crime' || source === 'cjic-victim'; }
export function isRemoteSource(source: CrimeSource): source is RemoteSource { return source === 'detroit' || source === 'clemis'; }
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
  source: CrimeSource;
  category: string;
  description: string;
  occurredAt: number | null;
  neighborhood: string | null;
  intersection: string | null;
  precinct: string | null;
  status: string | null;
  longitude: number | null;
  latitude: number | null;
  year?: number;
  county?: string;
  race?: string;
  victimRaces?: string[];
  areaKey?: string;
  locationPrecision?: 'point' | 'approximate-point' | 'reporting-area' | 'county';
  datePrecision?: 'date';
  sourceArticles?: { outlet: string; url: string }[];
  fields: Record<string, string | number | null>;
};

export type ReportingArea = {
  key: string;
  county: string;
  city: string;
  geometry: Polygon | MultiPolygon;
  bounds: [number, number, number, number];
  areaKm2: number;
  precision: 'reporting-area' | 'county';
  geographyLabel: string;
};
export type AreaSummary = ReportingArea & { crime: number; victims: number; races: Record<string, number>; reportingLabels: string[] };
export type CJICManifest = {
  version: string;
  preparedAt: string;
  coverage: string;
  coverageEnd: string;
  races: string[];
  areas: ReportingArea[];
  sources: Record<CJICSource, { fields: string[]; total: number; categories: string[]; chunks: { year: number; count: number; file: string }[] }>;
};
export type CJICResponse = {
  incidents: Incident[];
  total: number;
  nextOffset: number;
  sourceCounts: Partial<Record<CJICSource, number>>;
  areas: AreaSummary[];
  groups: Record<string, number>;
  fetchedAt: string;
  analysis?: {
    byYear: CJICBreakdown[];
    byOffense: CJICBreakdown[];
    victimRaces: Record<string, number>;
    victimAges: Record<string, number>;
    victimSex: Record<string, number>;
  };
};
export type CJICBreakdown = { key: string; crime: number; victims: number };
export type CJICMetric = 'crime' | 'victims' | 'combined';
export type ComparisonMap = {
  a: CJICResponse;
  b: CJICResponse;
  aLabel: string;
  bLabel: string;
  metric: 'crime' | 'victims';
  view: 'a' | 'b' | 'change';
  density: boolean;
};

export function recordDate(item: Incident) {
  if (item.year !== undefined) return `${item.year} (year only)`;
  if (item.datePrecision === 'date' && item.occurredAt) return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit', month: 'short', day: 'numeric', year: 'numeric',
  }).format(item.occurredAt);
  return formatDate(item.occurredAt);
}

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

export function isHomicideOffense(value: string) {
  return /\b(HOMICIDE|MURDER|MANSLAUGHTER)\b/i.test(value);
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
