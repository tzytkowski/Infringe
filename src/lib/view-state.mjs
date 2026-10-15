export const DEFAULT_VIEW = {
  sources: ['detroit'],
  period: '24h',
  category: '',
  races: [],
  search: '',
  regionalFocus: 'both',
  recordSort: 'newest',
  recordFilterField: 'any',
  recordFilter: '',
};

export const BUILT_IN_VIEWS = [
  { id: 'detroit-homicides', name: 'All Detroit homicides', view: { sources: ['detroit', 'news'], period: 'all', category: 'standard:Homicide', races: [], search: '', regionalFocus: 'both' } },
  { id: 'metro-homicides', name: 'All metro homicides', view: { sources: ['news', 'clemis', 'detroit', 'cjic-crime', 'cjic-victim'], period: 'all', category: 'standard:Homicide', races: [], search: '', regionalFocus: 'both' } },
  { id: 'recent-agency', name: 'Recent agency crime', view: { sources: ['clemis', 'detroit'], period: '7d', category: '', races: [], search: '', regionalFocus: 'both' } },
  { id: 'cjic-history', name: 'CJIC complete history', view: { sources: ['cjic-crime', 'cjic-victim'], period: 'all', category: '', races: [], search: '', regionalFocus: 'both' } },
  { id: 'news-history', name: 'Historical news citations', view: { sources: ['news'], period: 'all', category: '', races: [], search: '', regionalFocus: 'both' } },
];

/** @param {URLSearchParams} params @param {string[]} allowedSources */
export function parseViewParams(params, allowedSources) {
  if (![...params.keys()].some((key) => ['sources', 'period', 'category', 'races', 'q', 'focus', 'sort', 'field', 'value'].includes(key))) return null;
  const requestedSources = [...new Set((params.get('sources') || '').split(',').filter((source) => allowedSources.includes(source)))];
  const sources = params.get('sources') === '' ? [] : requestedSources.length ? requestedSources : DEFAULT_VIEW.sources;
  // Older all-year links omitted period; new links always specify it.
  const period = params.get('period') || (params.has('sources') ? 'all' : DEFAULT_VIEW.period);
  const hasCJIC = sources.some((source) => source.startsWith('cjic-'));
  const field = (params.get('field') || 'any').slice(0, 128);
  return {
    sources,
    period: hasCJIC && ['24h', '7d', '30d'].includes(period) ? 'all' : period === 'all' || ['24h', '7d', '30d'].includes(period) || /^\d{4}$/.test(period) ? period : 'all',
    category: (params.get('category') || '').replace(/[\x00-\x1f]/g, '').slice(0, 120),
    races: (params.get('races') || '').split(',').filter(Boolean),
    search: (params.get('q') || '').slice(0, 120),
    regionalFocus: ['both', 'oakland', 'macomb'].includes(params.get('focus') || '') ? params.get('focus') : 'both',
    recordSort: ['newest', 'oldest', 'offense-asc', 'offense-desc', 'location-asc', 'location-desc', 'source-asc', 'source-desc'].includes(params.get('sort') || '') ? params.get('sort') : DEFAULT_VIEW.recordSort,
    recordFilterField: ['any', 'offense', 'location', 'source'].includes(field) || field.startsWith('field:') ? field : 'any',
    recordFilter: (params.get('value') || '').slice(0, 1000),
  };
}

/** @param {any} view */
export function serializeViewParams(view) {
  const params = new URLSearchParams();
  params.set('sources', (Array.isArray(view.sources) ? view.sources : DEFAULT_VIEW.sources).join(','));
  params.set('period', view.period || DEFAULT_VIEW.period);
  if (view.category) params.set('category', view.category);
  if (Array.isArray(view.races) && view.races.length) params.set('races', view.races.join(','));
  if (view.search) params.set('q', view.search);
  if (view.regionalFocus && view.regionalFocus !== 'both') params.set('focus', view.regionalFocus);
  if (view.recordSort && view.recordSort !== 'newest') params.set('sort', view.recordSort);
  if (view.recordFilterField && view.recordFilterField !== 'any') params.set('field', view.recordFilterField);
  if (view.recordFilter) params.set('value', view.recordFilter);
  return params;
}
