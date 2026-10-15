import { CLEMIS_LAYER, COUNTY_QUERY_GEOMETRY, DETROIT_LAYER, type RemoteSource, type Incident, type IncidentResponse } from './crime';
import { isHomicideCategory, standardCategoryName, standardCategoryTerms, STANDARD_OFFENSES } from './offense-taxonomy.mjs';
import { fetchJSONResponse } from './http';

type ArcFeature = { attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } };
type ArcResponse = { features?: ArcFeature[]; count?: number; error?: { message?: string } };

const detroitFields = [
  'ESRI_OID', 'offense_category', 'offense_description', 'incident_occurred_at',
  'neighborhood', 'nearest_intersection', 'police_precinct', 'case_status',
  'longitude', 'latitude',
].join(',');

function dateWhere(days: number, field: string, now: number) {
  const stamp = new Date(now - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const end = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
  return `${field} >= TIMESTAMP '${stamp}' AND ${field} <= TIMESTAMP '${end}'`;
}

async function query(source: RemoteSource, params: URLSearchParams, signal: AbortSignal): Promise<ArcResponse> {
  const layer = source === 'clemis' ? CLEMIS_LAYER : DETROIT_LAYER;
  // POST keeps the county polygon out of the URL. ArcGIS Online permits browser CORS requests.
  const response = await fetchJSONResponse(`${layer}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal,
  });
  if (!response.ok) throw new Error(`${source === 'clemis' ? 'CLEMIS' : 'Detroit'} data service returned ${response.status}`);
  const data = await response.json() as ArcResponse;
  if (data.error) throw new Error(data.error.message || 'Crime data query failed');
  return data;
}

function baseQuery(source: RemoteSource, where: string) {
  const params = new URLSearchParams({ where, f: 'json' });
  if (source === 'clemis') {
    params.set('geometry', COUNTY_QUERY_GEOMETRY);
    params.set('geometryType', 'esriGeometryPolygon');
    params.set('inSR', '4326');
    params.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return params;
}

export async function fetchCategories(source: RemoteSource, signal: AbortSignal): Promise<string[]> {
  const field = source === 'clemis' ? 'CRIME_DESC' : 'offense_category';
  const params = baseQuery(source, `${field} IS NOT NULL`);
  params.set('outFields', field);
  params.set('returnDistinctValues', 'true');
  params.set('returnGeometry', 'false');
  params.set('orderByFields', field);
  params.set('resultRecordCount', '2000');
  const data = await query(source, params, signal);
  return [...new Set((data.features ?? [])
    .map((feature) => feature.attributes?.[field])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim()))].sort();
}

export async function fetchIncidentYears(source: RemoteSource, signal: AbortSignal): Promise<number[]> {
  if (source === 'clemis') return [new Date().getUTCFullYear()];
  const field = 'incident_year';
  const params = baseQuery(source, `${field} >= 1900`);
  params.set('outFields', field);
  params.set('returnDistinctValues', 'true');
  params.set('returnGeometry', 'false');
  params.set('orderByFields', `${field} DESC`);
  params.set('resultRecordCount', '2000');
  const data = await query(source, params, signal);
  return [...new Set((data.features ?? [])
    .map((feature) => Number(feature.attributes?.[field]))
    .filter((value) => Number.isInteger(value) && value >= 1900))].sort((a, b) => b - a);
}

export async function fetchIncidents(source: RemoteSource, period: string, category: string, search: string, offset: number, signal: AbortSignal, knownTotal?: number | null, includeUnmapped = true, now = Date.now()): Promise<IncidentResponse> {
  const currentYear = new Date().getUTCFullYear();
  const field = source === 'clemis' ? 'FROM_DATE' : 'incident_occurred_at';
  let where: string;
  if (period === 'all') where = '1=1';
  else if (period === '24h') where = dateWhere(1, field, now);
  else if (period === '7d') where = dateWhere(7, field, now);
  else if (period === '30d') where = dateWhere(30, field, now);
  else if (/^\d{4}$/.test(period) && Number(period) >= 1900 && Number(period) <= currentYear) {
    if (source === 'clemis' && Number(period) < 2026) {
      return { incidents: [], total: 0, offset, limit: 1000, nextOffset: offset, fetchedAt: new Date().toISOString() };
    }
    where = source === 'clemis'
      ? `FROM_DATE >= TIMESTAMP '${period}-01-01 00:00:00' AND FROM_DATE < TIMESTAMP '${Number(period) + 1}-01-01 00:00:00'`
      : `incident_year = ${Number(period)}`;
  } else throw new Error('Invalid time period');
  if (category) {
    if (category.length > 120 || /[\x00-\x1f]/.test(category)) throw new Error('Invalid crime category');
    const standardName = standardCategoryName(category);
    if (standardName) {
      if (standardName === 'Homicide') {
        // These are the agencies' published homicide categories. Exact category
        // matching is both substantially faster and prevents CLEMIS assault
        // charges such as "attempted murder" from being counted as homicides.
        where += source === 'clemis'
          ? " AND CRIME_DESC = 'Murder/Nonneg. Manslaughter'"
          : " AND offense_category IN ('HOMICIDE', 'JUSTIFIABLE HOMICIDE')";
      } else {
        const fields = source === 'clemis' ? ['CRIME_DESC'] : ['offense_category'];
        const terms = standardCategoryTerms(category);
        if (!terms.length) throw new Error('Unsupported standardized crime category');
        where += ` AND (${fields.flatMap((name) => terms.map((term) => `UPPER(${name}) LIKE '%${term}%'`)).join(' OR ')})`;
        const preceding = STANDARD_OFFENSES.slice(0, STANDARD_OFFENSES.findIndex((entry) => entry.id === standardName)).flatMap((entry) => entry.terms);
        if (preceding.length) where += ` AND NOT (${fields.flatMap((name) => preceding.map((term) => `UPPER(${name}) LIKE '%${term}%'`)).join(' OR ')})`;
      }
    } else {
      where += ` AND ${source === 'clemis' ? 'CRIME_DESC' : 'offense_category'} = '${category.replaceAll("'", "''")}'`;
    }
  }
  const term = search.trim();
  if (term) {
    if (term.length > 120 || /[\x00-\x1f]/.test(term)) throw new Error('Invalid search term');
    const escaped = term.replaceAll("'", "''").replace(/[%_]/g, '').toUpperCase();
    if (escaped) {
      const fields = source === 'clemis'
        ? ['AGENCY', 'CITY', 'CHARGEDESCRIPTION', 'LOCATION', 'CRIME_DESC']
        : ['offense_category', 'offense_description', 'neighborhood', 'nearest_intersection', 'police_precinct', 'case_status'];
      where += ` AND (${fields.map((name) => `UPPER(${name}) LIKE '%${escaped}%'`).join(' OR ')})`;
    }
  }
  const base = baseQuery(source, where);
  const countParams = new URLSearchParams(base);
  countParams.set('returnCountOnly', 'true');
  const dataParams = new URLSearchParams(base);
  const limit = 1000;
  dataParams.set('outFields', source === 'clemis' ? 'OBJECTID,AGENCY,CITY,CHARGEDESCRIPTION,LOCATION,FROM_DATE,CRIME_DESC' : detroitFields);
  dataParams.set('outSR', '4326');
  dataParams.set('returnGeometry', 'true');
  dataParams.set('orderByFields', source === 'clemis' ? 'FROM_DATE DESC,OBJECTID DESC' : 'incident_occurred_at DESC,ESRI_OID DESC');
  dataParams.set('resultOffset', String(offset));
  dataParams.set('resultRecordCount', String(limit));
  const [counts, data] = await Promise.all([
    knownTotal === undefined ? query(source, countParams, signal) : Promise.resolve({ count: knownTotal }),
    query(source, dataParams, signal),
  ]);
  const incidents: Incident[] = (data.features ?? []).flatMap((feature) => {
    const a = feature.attributes ?? {};
    const x = feature.geometry?.x ?? a.longitude;
    const y = feature.geometry?.y ?? a.latitude;
    const longitude = x == null || x === '' ? NaN : Number(x);
    const latitude = y == null || y === '' ? NaN : Number(y);
    const validPoint = Number.isFinite(longitude) && Number.isFinite(latitude)
      && longitude >= -85 && longitude <= -81 && latitude >= 41 && latitude <= 44;
    if (!validPoint && !includeUnmapped) return [];
    return [{
      id: `${source}-${String(source === 'clemis' ? a.OBJECTID ?? '' : a.ESRI_OID ?? '')}`,
      source,
      category: String((source === 'clemis' ? a.CRIME_DESC : a.offense_category) || 'Uncategorized').trim(),
      description: String((source === 'clemis' ? a.CHARGEDESCRIPTION || a.CRIME_DESC : a.offense_description || a.offense_category) || 'Reported offense').trim(),
      occurredAt: typeof a[field] === 'number' ? a[field] as number : null,
      neighborhood: a[source === 'clemis' ? 'CITY' : 'neighborhood'] ? String(a[source === 'clemis' ? 'CITY' : 'neighborhood']).trim() : null,
      intersection: a[source === 'clemis' ? 'LOCATION' : 'nearest_intersection'] ? String(a[source === 'clemis' ? 'LOCATION' : 'nearest_intersection']).trim() : null,
      precinct: source === 'detroit' && a.police_precinct ? String(a.police_precinct) : null,
      status: source === 'detroit' && a.case_status ? String(a.case_status) : null,
      longitude: validPoint ? longitude : null, latitude: validPoint ? latitude : null, locationPrecision: 'point',
      fields: Object.fromEntries(Object.entries(a).map(([key, value]) => [key, value == null ? null : typeof value === 'number' ? value : String(value)])),
    }];
  });
  return { incidents, total: typeof counts.count === 'number' ? counts.count : null,
    offset, limit, nextOffset: offset + (data.features?.length ?? 0), fetchedAt: new Date(now).toISOString() };
}

export async function fetchAllHomicideIncidents(source: RemoteSource, period: string, category: string, search: string, signal: AbortSignal, onProgress?: (data: IncidentResponse) => void): Promise<IncidentResponse> {
  const now = Date.now();
  if (!isHomicideCategory(category)) return fetchIncidents(source, period, category, search, 0, signal, undefined, true, now);
  let page = await fetchIncidents(source, period, category, search, 0, signal, undefined, true, now);
  let combined = page;
  onProgress?.(combined);
  while (!signal.aborted && (page.total === null ? page.nextOffset - page.offset === page.limit : page.nextOffset < page.total)) {
    const next = await fetchIncidents(source, period, category, search, page.nextOffset, signal, page.total, true, now);
    if (next.nextOffset <= page.nextOffset) {
      if (page.total === null) break;
      throw new Error('The data source returned incomplete records. Refresh to retry.');
    }
    const ids = new Set(combined.incidents.map((incident) => incident.id));
    combined = { ...next, offset: 0, incidents: [...combined.incidents, ...next.incidents.filter((incident) => !ids.has(incident.id))] };
    page = next;
    onProgress?.(combined);
  }
  return combined;
}
