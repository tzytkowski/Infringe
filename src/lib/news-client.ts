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

export type LocalNewsArticle = {
  id: string;
  outlet: 'WXYZ' | 'WDIV';
  url: string;
  title: string;
  category: string;
  publishedAt: string;
};

export type NewsFile = { updatedAt: string; articleUpdatedAt: string; cases: LocalNewsCase[]; articles: LocalNewsArticle[] };

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
  return { ...(file as Omit<NewsFile, 'articles' | 'articleUpdatedAt'>), articles: [], articleUpdatedAt: file.updatedAt };
}

function validateNewsArticles(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('News article file is invalid');
  const file = value as { updatedAt?: unknown; articles?: unknown };
  if (typeof file.updatedAt !== 'string' || !Array.isArray(file.articles)) throw new Error('News article file is invalid');
  const seen = new Set<string>();
  for (const article of file.articles as LocalNewsArticle[]) {
    if (!article || typeof article.id !== 'string' || !/^[a-f0-9]{16}$/.test(article.id) || seen.has(article.id)) throw new Error('News article ID is invalid or duplicated');
    seen.add(article.id);
    if (!['WXYZ', 'WDIV'].includes(article.outlet) || typeof article.title !== 'string' || !article.title.trim() || typeof article.category !== 'string' || !article.category.trim()) throw new Error(`News article detail is invalid: ${article.id}`);
    if (!/^https:\/\/(www\.)?(wxyz\.com|clickondetroit\.com)\//.test(article.url) || !Number.isFinite(Date.parse(article.publishedAt))) throw new Error(`News article citation is invalid: ${article.id}`);
  }
  return file as { updatedAt: string; articles: LocalNewsArticle[] };
}

export async function fetchNewsCases(signal: AbortSignal): Promise<NewsFile> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const [caseResponse, articleResponse] = await Promise.all([
    fetch(`${base}/data/local-news/incidents.json`, { signal, cache: 'no-store' }),
    fetch(`${base}/data/local-news/articles.json`, { signal, cache: 'no-store' }),
  ]);
  if (!caseResponse.ok) throw new Error(`Reviewed news cases returned ${caseResponse.status}`);
  if (!articleResponse.ok) throw new Error(`Publisher news feed returned ${articleResponse.status}`);
  const cases = validateNewsFile(await caseResponse.json());
  const articles = validateNewsArticles(await articleResponse.json());
  return { ...cases, articles: articles.articles, articleUpdatedAt: articles.updatedAt };
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
    recordKind: 'reviewed-news-incident',
  };
}

function newsArticleToIncident(item: LocalNewsArticle): Incident {
  return {
    id: `news-article-${item.id}`,
    source: 'news',
    category: item.category,
    description: item.title,
    occurredAt: Date.parse(item.publishedAt),
    neighborhood: null,
    intersection: null,
    precinct: null,
    status: 'Publisher RSS article — incident details not individually reviewed',
    longitude: null,
    latitude: null,
    sourceArticles: [{ outlet: item.outlet, url: item.url }],
    fields: {
      'Record type': 'Publisher RSS article',
      'Date meaning': 'Article publication time; incident date not verified',
      'Publication date': item.publishedAt,
      'Article source': item.outlet,
      'Review status': 'Article metadata only; incident details not individually reviewed',
    },
    recordKind: 'publisher-rss-article',
  };
}

function timestampMatchesPeriod(value: string, period: string, now: number) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now) return false;
  if (period === 'all') return true;
  if (/^\d{4}$/.test(period)) return new Date(timestamp).getUTCFullYear() === Number(period);
  const days = period === '24h' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : null;
  return days !== null && timestamp >= now - days * 86_400_000;
}

function categoryMatches(category: string, description: string, selected: string) {
  const standardized = standardCategoryName(selected);
  if (selected === 'group:homicide') return isHomicideOffense(category) || isHomicideOffense(description);
  if (standardized) return standardizeOffense(category, description) === standardized;
  return !selected || category === selected;
}

export function filterNewsCases(file: NewsFile | null, period: string, category: string, races: string[], search: string, now = Date.now()): Incident[] {
  if (!file || races.length) return [];
  const term = search.trim().toLowerCase();
  const cases = file.cases.filter((item) => {
    if (!categoryMatches(item.category, item.label, category)) return false;
    if (!dateOnlyMatchesPeriod(item.incidentDate, period, now)) return false;
    if (term && ![item.label, item.city, item.county, item.location, ...item.articles.map((article) => article.outlet)].some((value) => value.toLowerCase().includes(term))) return false;
    return true;
  }).map(newsCaseToIncident);
  const articles = file.articles.filter((item) => {
    if (!categoryMatches(item.category, item.title, category) || !timestampMatchesPeriod(item.publishedAt, period, now)) return false;
    return !term || [item.title, item.outlet, item.category].some((value) => value.toLowerCase().includes(term));
  }).map(newsArticleToIncident);
  return [...cases, ...articles];
}
