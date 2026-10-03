import { isHomicideOffense, type Incident } from './crime';
import { dateOnlyMatchesPeriod, dateOnlyValue } from './date-only-period.mjs';
import { standardCategoryName, standardizeOffense } from './offense-taxonomy.mjs';

export type LocalNewsCase = {
  id: string;
  incidentDate: string;
  category: string;
  label: string;
  city: string;
  county: string;
  location: string;
  locationNote: string;
  longitude: number | null;
  latitude: number | null;
  victims: number;
  reviewedAt: string;
  articles: { outlet: 'WXYZ' | 'WDIV'; url: string }[];
};

export type NewsFile = { updatedAt: string; cases: LocalNewsCase[] };

function dateValue(date: string) {
  return dateOnlyValue(date);
}

export function validateNewsFile(value: unknown): NewsFile {
  if (!value || typeof value !== 'object') throw new Error('News case file is invalid');
  const file = value as Partial<NewsFile>;
  if (typeof file.updatedAt !== 'string' || !Array.isArray(file.cases)) throw new Error('News case file is invalid');
  const seen = new Set<string>();
  for (const item of file.cases) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9-]+$/.test(item.id) || seen.has(item.id)) throw new Error('News case ID is invalid or duplicated');
    seen.add(item.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.incidentDate) || !Number.isFinite(dateValue(item.incidentDate))) throw new Error(`Invalid incident date: ${item.id}`);
    if (![item.category, item.label, item.city, item.county, item.location, item.locationNote, item.reviewedAt].every((part) => typeof part === 'string' && !!part.trim())) throw new Error(`Missing case detail: ${item.id}`);
    if (!Number.isInteger(item.victims) || item.victims < 1) throw new Error(`Invalid victim count: ${item.id}`);
    if (item.longitude !== null || item.latitude !== null) {
      if (typeof item.longitude !== 'number' || typeof item.latitude !== 'number' || item.longitude < -85 || item.longitude > -81 || item.latitude < 41 || item.latitude > 44) throw new Error(`Invalid approximate coordinates: ${item.id}`);
    }
    if (!Array.isArray(item.articles) || !item.articles.length || item.articles.some((article) => !['WXYZ', 'WDIV'].includes(article.outlet) || !/^https:\/\/(www\.)?(wxyz\.com|clickondetroit\.com)\//.test(article.url))) throw new Error(`Invalid article citation: ${item.id}`);
  }
  return file as NewsFile;
}

export async function fetchNewsCases(signal: AbortSignal): Promise<NewsFile> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/data/local-news/incidents.json`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Reviewed news cases returned ${response.status}`);
  return validateNewsFile(await response.json());
}

export function newsCaseToIncident(item: LocalNewsCase): Incident {
  return {
    id: `news-${item.id}`,
    source: 'news',
    category: item.category,
    description: item.label,
    occurredAt: dateValue(item.incidentDate),
    datePrecision: 'date',
    neighborhood: item.city,
    intersection: item.location,
    precinct: null,
    status: 'Reviewed news report',
    longitude: item.longitude,
    latitude: item.latitude,
    locationPrecision: item.longitude === null ? undefined : 'approximate-point',
    county: item.county,
    sourceArticles: item.articles,
    fields: {
      'Victims reported': item.victims,
      'Reported location': item.location,
      'Map location note': item.locationNote,
      'Review date': item.reviewedAt,
      'Article sources': item.articles.map((article) => article.outlet).join(', '),
    },
  };
}

export function filterNewsCases(file: NewsFile | null, period: string, category: string, races: string[], search: string, now = Date.now()): Incident[] {
  if (!file || races.length) return [];
  const term = search.trim().toLowerCase();
  return file.cases.filter((item) => {
    const standardized = standardCategoryName(category);
    if (category === 'group:homicide' && !isHomicideOffense(item.category)) return false;
    if (standardized && standardizeOffense(item.category, item.label) !== standardized) return false;
    if (category && !standardized && category !== 'group:homicide' && item.category !== category) return false;
    if (!dateOnlyMatchesPeriod(item.incidentDate, period, now)) return false;
    if (term && ![item.label, item.city, item.county, item.location, ...item.articles.map((article) => article.outlet)].some((value) => value.toLowerCase().includes(term))) return false;
    return true;
  }).map(newsCaseToIncident);
}
