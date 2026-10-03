export const BUILT_IN_VIEWS = [
  { id: 'detroit-homicides', name: 'All Detroit homicides', view: { sources: ['detroit', 'news'], period: 'all', category: 'standard:Homicide', races: [], search: '', regionalFocus: 'both' } },
  { id: 'metro-homicides', name: 'All metro homicides', view: { sources: ['news', 'clemis', 'detroit', 'cjic-crime', 'cjic-victim'], period: 'all', category: 'standard:Homicide', races: [], search: '', regionalFocus: 'both' } },
  { id: 'recent-agency', name: 'Recent agency crime', view: { sources: ['clemis', 'detroit'], period: '7d', category: '', races: [], search: '', regionalFocus: 'both' } },
  { id: 'cjic-history', name: 'CJIC complete history', view: { sources: ['cjic-crime', 'cjic-victim'], period: 'all', category: '', races: [], search: '', regionalFocus: 'both' } },
  { id: 'news-history', name: 'Historical news citations', view: { sources: ['news'], period: 'all', category: '', races: [], search: '', regionalFocus: 'both' } },
];

/** @param {URLSearchParams} params @param {string[]} allowedSources */
export function parseViewParams(params, allowedSources) {
  if (![...params.keys()].some((key) => ['sources', 'period', 'category', 'races', 'q', 'focus', 'sort'].includes(key))) return null;
  const sources = (params.get('sources') || '').split(',').filter((source) => allowedSources.includes(source));
  const period = params.get('period') || 'all';
  return {
    sources,
    period: period === 'all' || ['24h', '7d', '30d'].includes(period) || /^\d{4}$/.test(period) ? period : 'all',
    category: (params.get('category') || '').slice(0, 160),
    races: (params.get('races') || '').split(',').filter(Boolean),
    search: (params.get('q') || '').slice(0, 120),
    regionalFocus: ['both', 'oakland', 'macomb'].includes(params.get('focus') || '') ? params.get('focus') : 'both',
    recordSort: params.get('sort') || 'newest',
  };
}

/** @param {any} view */
export function serializeViewParams(view) {
  const params = new URLSearchParams();
  params.set('sources', (view.sources || []).join(','));
  if (view.period && view.period !== 'all') params.set('period', view.period);
  if (view.category) params.set('category', view.category);
  if (view.races?.length) params.set('races', view.races.join(','));
  if (view.search) params.set('q', view.search);
  if (view.regionalFocus && view.regionalFocus !== 'both') params.set('focus', view.regionalFocus);
  if (view.recordSort && view.recordSort !== 'newest') params.set('sort', view.recordSort);
  return params;
}
