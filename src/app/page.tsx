'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUpRight, BookmarkPlus, ChevronDown, Crosshair, Database, Download, ExternalLink, Filter, Link2, Maximize2, Radio, RefreshCw, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import { CJIC_SOURCE, CLEMIS_SOURCE, DATA_SOURCES, crimeGroup, isCJIC, isRemoteSource, recordDate, type CJICManifest, type CJICMetric, type CJICResponse, type ComparisonMap, type CrimeSource, type Incident, type IncidentResponse, type RegionalFocus, type RemoteSource } from '@/lib/crime';
import { recordLocation, recordMatchesValue, recordValues } from '@/lib/record-filter';
import { fetchAllHomicideIncidents, fetchCategories, fetchIncidents, fetchIncidentYears } from '@/lib/arcgis-client';
import { fetchCJIC, fetchCJICManifest } from '@/lib/cjic-client';
import RecordList from '@/components/RecordList';
import { densityScaleMidpoint, reportingDensity, reportingDensityMaximum } from '@/lib/map-density';
import CJICComparison from '@/components/CJICComparison';
import { comparisonAreas, comparisonFeatures } from '@/lib/cjic-comparison';
import { fetchNewsCases, filterNewsCases, type NewsFile } from '@/lib/news-client';
import { enrichAndLinkIncidents } from '@/lib/incident-links.mjs';
import { isHomicideCategory, offenseColor, standardCategoryName, STANDARD_OFFENSES } from '@/lib/offense-taxonomy.mjs';
import { BUILT_IN_VIEWS, DEFAULT_VIEW, parseViewParams, serializeViewParams } from '@/lib/view-state.mjs';

const CrimeMap = dynamic(() => import('@/components/CrimeMap'), { ssr: false });
const currentYear = new Date().getFullYear();
const agencyYears = Array.from({ length: currentYear - 2015 }, (_, index) => currentYear - index);
type RemoteState = { data: IncidentResponse | null; loading: boolean; error: string | null };
type RecordSort = 'newest' | 'oldest' | 'offense-asc' | 'offense-desc' | 'location-asc' | 'location-desc' | 'source-asc' | 'source-desc';
type FilterView = { sources: CrimeSource[]; period: string; category: string; races: string[]; search: string; regionalFocus: RegionalFocus; recordSort?: RecordSort };
type SavedView = { id: string; name: string; view: FilterView };

const RECORD_FIELD_LABELS: Record<string, string> = {
  ESRI_OID: 'Record ID',
  OBJECTID: 'Record ID',
  offense_category: 'Offense category',
  offense_description: 'Offense description',
  incident_occurred_at: 'Incident date and time',
  neighborhood: 'Neighborhood',
  nearest_intersection: 'Nearest intersection',
  police_precinct: 'Police precinct',
  case_status: 'Case status',
  longitude: 'Longitude',
  latitude: 'Latitude',
  AGENCY: 'Reporting agency',
  CITY: 'City',
  CHARGEDESCRIPTION: 'Charge description',
  LOCATION: 'Reported location',
  FROM_DATE: 'Incident date and time',
  CRIME_DESC: 'Offense description',
};

function recordFieldLabel(field: string) {
  return RECORD_FIELD_LABELS[field] || field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SelectAll({ checked, mixed, onChange, label }: { checked: boolean; mixed: boolean; onChange: () => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <label className="check-all"><input ref={input} type="checkbox" checked={checked} onChange={onChange} />{label}</label>;
}

export default function Home() {
  const [sources, setSources] = useState<CrimeSource[]>(DEFAULT_VIEW.sources as CrimeSource[]);
  const [regionalFocus, setRegionalFocus] = useState<RegionalFocus>(DEFAULT_VIEW.regionalFocus as RegionalFocus);
  const [period, setPeriod] = useState(DEFAULT_VIEW.period);
  const [category, setCategory] = useState(DEFAULT_VIEW.category);
  const [remoteCategories, setRemoteCategories] = useState<string[]>([]);
  const [remoteYears, setRemoteYears] = useState<number[]>([]);
  const [races, setRaces] = useState<string[]>(DEFAULT_VIEW.races);
  const [manifest, setManifest] = useState<CJICManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [remote, setRemote] = useState<Partial<Record<RemoteSource, RemoteState>>>({});
  const [local, setLocal] = useState<CJICResponse | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [newsFile, setNewsFile] = useState<NewsFile | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAreaKey, setSelectedAreaKey] = useState<string | null>(null);
  const [search, setSearch] = useState(DEFAULT_VIEW.search);
  const [debouncedSearch, setDebouncedSearch] = useState(DEFAULT_VIEW.search);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [locateSignal, setLocateSignal] = useState(0);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [publicRecordsOpen, setPublicRecordsOpen] = useState(true);
  const [localNewsOpen, setLocalNewsOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparison, setComparison] = useState<ComparisonMap | null>(null);
  const [comparisonScope, setComparisonScope] = useState('all');
  const [mapMetric, setMapMetric] = useState<CJICMetric>('crime');
  const [recordSort, setRecordSort] = useState<RecordSort>(DEFAULT_VIEW.recordSort as RecordSort);
  const [recordFilterField, setRecordFilterField] = useState('any');
  const [recordFilter, setRecordFilter] = useState('');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [isNamingView, setIsNamingView] = useState(false);
  const [savedViewName, setSavedViewName] = useState('');
  const [urlReady, setUrlReady] = useState(false);
  const mapPanelRef = useRef<HTMLElement | null>(null);
  const sourceKey = sources.join('|');
  const raceKey = races.join('|');
  const isDetroitOnly = sources.length === 1 && sources[0] === 'detroit';
  const hasCJIC = sources.some(isCJIC);
  const hasAgency = sources.some(isRemoteSource);
  const viewKey = `${sourceKey}|${period}|${category}|${raceKey}|${debouncedSearch}|${refresh}`;
  const activeView = useRef(viewKey);
  activeView.current = viewKey;
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('infringe-saved-views') || '[]');
      if (Array.isArray(stored)) setSavedViews(stored);
    } catch { /* Ignore malformed local preferences. */ }
    const params = new URLSearchParams(window.location.search);
    const onlyLegacyDefaultParams = [...params.keys()].every((key) => ['sources', 'period'].includes(key))
      && params.get('sources') === 'clemis'
      && params.get('period') === DEFAULT_VIEW.period;
    const parsed = onlyLegacyDefaultParams ? null : parseViewParams(params, DATA_SOURCES.map((source) => source.id));
    if (parsed) applyView(parsed as FilterView);
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const params = serializeViewParams({ sources, period, category, races, search: debouncedSearch, regionalFocus, recordSort });
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, [urlReady, sourceKey, period, category, raceKey, debouncedSearch, regionalFocus, recordSort]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (sources.length === 1 && sources[0] === 'clemis' && /^\d{4}$/.test(period) && Number(period) !== currentYear) setPeriod('all');
  }, [sourceKey, period]);

  useEffect(() => {
    const controller = new AbortController();
    setManifestError(null);
    fetchCJICManifest(controller.signal).then(setManifest).catch((cause) => {
      if (!controller.signal.aborted) setManifestError(cause instanceof Error ? cause.message : 'CJIC metadata unavailable');
    });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setRemoteCategories([]);
    setRemoteYears([]);
    const selected = sources.filter(isRemoteSource);
    Promise.allSettled(selected.map((source) => fetchCategories(source, controller.signal))).then((results) => {
      if (!controller.signal.aborted) setRemoteCategories([...new Set(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []))].sort());
    });
    Promise.allSettled(selected.map((source) => fetchIncidentYears(source, controller.signal))).then((results) => {
      if (!controller.signal.aborted) setRemoteYears([...new Set(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []))].sort((a, b) => b - a));
    });
    return () => controller.abort();
  }, [sourceKey]);

  useEffect(() => {
    if (!sources.includes('news')) { setNewsFile(null); setNewsError(null); return; }
    const controller = new AbortController();
    setNewsError(null);
    fetchNewsCases(controller.signal).then((file) => { if (!controller.signal.aborted) setNewsFile(file); })
      .catch((cause) => { if (!controller.signal.aborted) setNewsError(cause instanceof Error ? cause.message : 'News case file unavailable'); });
    return () => controller.abort();
  }, [sourceKey, refresh]);

  useEffect(() => {
    if (comparisonMode || !['24h', '7d', '30d'].includes(period)) return;
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [period, comparisonMode]);

  useEffect(() => {
    const controller = new AbortController();
    const selected = races.length ? [] : sources.filter(isRemoteSource);
    setRemote(Object.fromEntries(selected.map((source) => [source, { data: null, loading: true, error: null }])));
    for (const source of selected) {
      fetchAllHomicideIncidents(source, period, category, debouncedSearch, controller.signal, (data) => {
        if (!controller.signal.aborted) setRemote((state) => ({ ...state, [source]: { data, loading: data.total === null || data.nextOffset < data.total, error: null } }));
      }).then((data) => {
        if (!controller.signal.aborted) setRemote((state) => ({ ...state, [source]: { data, loading: false, error: null } }));
      }).catch((cause) => {
        if (!controller.signal.aborted) setRemote((state) => ({ ...state, [source]: { data: null, loading: false, error: cause instanceof Error ? cause.message : 'Source unavailable' } }));
      });
    }
    return () => controller.abort();
  }, [sourceKey, period, category, raceKey, debouncedSearch, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const selected = sources.filter(isCJIC);
    setLocal(null);
    setLocalError(null);
    setLocalLoading(selected.length > 0);
    if (selected.length) fetchCJIC({ sources: selected, period, category, races, search: debouncedSearch, limit: isHomicideCategory(category) ? 100_000 : undefined }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setLocal(data); })
      .catch((cause) => { if (!controller.signal.aborted) setLocalError(cause instanceof Error ? cause.message : 'CJIC data unavailable'); })
      .finally(() => { if (!controller.signal.aborted) setLocalLoading(false); });
    return () => controller.abort();
  }, [sourceKey, period, category, raceKey, debouncedSearch, refresh]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedAreaKey(null);
    moreController.current?.abort();
    setLoadingMore(false);
  }, [viewKey]);
  useEffect(() => () => moreController.current?.abort(), []);

  useEffect(() => {
    if (!mobileFilters) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileFilters(false); };
    const mobileViewport = window.matchMedia('(max-width: 840px)');
    const closeOnWideViewport = () => { if (!mobileViewport.matches) setMobileFilters(false); };
    window.addEventListener('keydown', closeOnEscape);
    mobileViewport.addEventListener('change', closeOnWideViewport);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); mobileViewport.removeEventListener('change', closeOnWideViewport); };
  }, [mobileFilters]);

  const categories = useMemo(() => [...new Set([
    ...remoteCategories,
    ...sources.filter(isCJIC).flatMap((source) => manifest?.sources[source].categories || []),
    ...(sources.includes('news') ? [...(newsFile?.cases || []), ...(newsFile?.articles || [])].map((item) => item.category) : []),
  ])].sort(), [remoteCategories, sourceKey, manifest, newsFile]);
  const years = useMemo(() => [...new Set([
    ...agencyYears,
    ...remoteYears,
    ...(newsFile?.cases.map((item) => Number(item.incidentDate.slice(0, 4))) || []),
    ...(newsFile?.articles.map((item) => new Date(item.publishedAt).getUTCFullYear()) || []),
    ...Object.values(manifest?.sources || {}).flatMap((source) => source.chunks.map((chunk) => chunk.year)),
  ])].filter((year) => Number.isInteger(year) && year <= currentYear).sort((a, b) => b - a), [remoteYears, newsFile, manifest]);
  const yearAvailable = (year: number) => sources.some((source) => {
    if (source === 'clemis') return year === currentYear;
    if (source === 'detroit') return (year >= 2016 && year <= currentYear) || remoteYears.includes(year);
    if (source === 'news') return newsFile?.cases.some((item) => Number(item.incidentDate.slice(0, 4)) === year)
      || newsFile?.articles.some((item) => new Date(item.publishedAt).getUTCFullYear() === year) || false;
    return manifest?.sources[source].chunks.some((chunk) => chunk.year === year) || false;
  });
  const remoteIncidents = useMemo(() => Object.values(remote).flatMap((state) => state?.data?.incidents || []), [remote]);
  const visibleRemote = remoteIncidents;
  const newsIncidents = useMemo(() => sources.includes('news') ? filterNewsCases(newsFile, period, category, races, debouncedSearch) : [], [newsFile, sourceKey, period, category, raceKey, debouncedSearch]);
  const sortedIncidents = useMemo<Incident[]>(() => {
    const recordTime = (occurredAt: number | null, year: number | undefined) => occurredAt ?? Date.UTC(year || 0, 0, 1);
    const text = (value: string) => value.toLocaleLowerCase();
    return (enrichAndLinkIncidents([...visibleRemote, ...newsIncidents, ...(local?.incidents || [])]) as Incident[]).sort((a, b) => {
      const aLocation = recordLocation(a);
      const bLocation = recordLocation(b);
      const aSource = DATA_SOURCES.find((source) => source.id === a.source)?.label || a.source;
      const bSource = DATA_SOURCES.find((source) => source.id === b.source)?.label || b.source;
      let result: number;
      switch (recordSort) {
        case 'oldest': result = recordTime(a.occurredAt, a.year) - recordTime(b.occurredAt, b.year); break;
        case 'offense-asc': result = text(a.category).localeCompare(text(b.category)); break;
        case 'offense-desc': result = text(b.category).localeCompare(text(a.category)); break;
        case 'location-asc': result = text(aLocation).localeCompare(text(bLocation)); break;
        case 'location-desc': result = text(bLocation).localeCompare(text(aLocation)); break;
        case 'source-asc': result = text(aSource).localeCompare(text(bSource)); break;
        case 'source-desc': result = text(bSource).localeCompare(text(aSource)); break;
        default: result = recordTime(b.occurredAt, b.year) - recordTime(a.occurredAt, a.year);
      }
      return result || a.id.localeCompare(b.id);
    });
  }, [visibleRemote, newsIncidents, local, recordSort]);
  const recordFilterFields = useMemo(() => [...new Set(sortedIncidents.flatMap((record) => Object.keys(record.fields)))].sort((a, b) => recordFieldLabel(a).localeCompare(recordFieldLabel(b))), [sortedIncidents]);
  useEffect(() => {
    if (recordFilterField.startsWith('field:') && !recordFilterFields.includes(recordFilterField.slice(6))) setRecordFilterField('any');
  }, [recordFilterField, recordFilterFields]);
  const recordFilterValues = useMemo(() => {
    if (recordFilterField === 'offense') return [...STANDARD_OFFENSES.map((entry) => entry.id), 'Other']
      .sort((a, b) => a.localeCompare(b));
    const values = new Set<string>();
    for (const record of sortedIncidents) {
      const candidates = recordValues(record, recordFilterField);
      candidates.forEach((value) => {
        const text = String(value ?? '').trim();
        if (text) values.add(text);
      });
    }
    const options = [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return options;
  }, [sortedIncidents, recordFilterField]);
  useEffect(() => {
    if (recordFilter && !recordFilterValues.some((value) => value === recordFilter)) setRecordFilter('');
  }, [recordFilter, recordFilterValues]);
  const incidents = useMemo(() => {
    return recordFilter ? sortedIncidents.filter((record) => recordMatchesValue(record, recordFilterField, recordFilter)) : sortedIncidents;
  }, [sortedIncidents, recordFilterField, recordFilter]);
  const loading = localLoading || (sources.includes('news') && !newsFile && !newsError) || Object.values(remote).some((state) => state?.loading);
  const remoteHasMore = Object.values(remote).some((state) => state?.data && (state.data.total === null ? state.data.incidents.length > 0 : state.data.nextOffset < state.data.total));
  const localHasMore = local !== null && local.nextOffset < local.total;
  const total = (local?.total || 0) + newsIncidents.length + Object.values(remote).reduce((sum, state) => sum + (state?.data?.total || 0), 0);
  const loadedCount = sortedIncidents.length;
  const errors = [...Object.entries(remote).flatMap(([source, state]) => state?.error ? [`${DATA_SOURCES.find((entry) => entry.id === source)?.label}: ${state.error}`] : []), ...(localError ? [`CJIC: ${localError}`] : []), ...(newsError ? [`News cases: ${newsError}`] : [])];
  const selected = sortedIncidents.find((item) => item.id === selectedId) ?? null;
  const relatedRecords = selected?.relatedIncidentIds?.map((id) => sortedIncidents.find((item) => item.id === id)).filter((item) => item !== undefined) || [];
  const selectedArea = local?.areas.find((area) => area.key === selectedAreaKey) ?? null;
  const effectiveMetric = mapMetric === 'crime' && !sources.includes('cjic-crime') ? 'victims' : mapMetric === 'victims' && !sources.includes('cjic-victim') ? 'crime' : mapMetric;
  const maximumDensity = reportingDensityMaximum(local?.areas || [], effectiveMetric);
  const mapAreas = useMemo(() => comparisonMode ? comparison ? comparisonAreas(comparison.a, comparison.b).map((entry) => entry.area) : [] : local?.areas || [], [comparisonMode, comparison, local]);
  const comparisonEntries = useMemo(() => comparison ? comparisonFeatures(comparison) : [], [comparison]);
  const comparisonMaximum = Math.max(0, ...comparisonEntries.filter((entry) => entry.area.precision === 'reporting-area').map((entry) => Math.abs(entry.value ?? 0)));
  const hasComparableAreas = comparisonEntries.some((entry) => entry.area.precision === 'reporting-area' && entry.a && entry.b);
  const countyOnlyRows = (local?.areas || []).filter((area) => area.precision === 'county').reduce((sum, area) => sum + area.crime + area.victims, 0);
  const densityLabel = (density: number) => density.toLocaleString('en-US', { maximumFractionDigits: 1 });
  const fetchedAt = [local?.fetchedAt, ...Object.values(remote).map((state) => state?.data?.fetchedAt)].filter((value): value is string => !!value).sort().at(-1);
  const groupCounts = useMemo(() => [...visibleRemote, ...newsIncidents].reduce((counts, item) => {
    const group = crimeGroup(item.category);
    counts[group] = (counts[group] || 0) + 1;
    return counts;
  }, { ...(local?.groups || {}) }), [visibleRemote, newsIncidents, local]);
  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    const requestedView = activeView.current;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    const tasks: Promise<void>[] = [];
    if (local && local.nextOffset < local.total) tasks.push(fetchCJIC({ sources: sources.filter(isCJIC), period, category, races, search: debouncedSearch, offset: local.nextOffset }, controller.signal).then((data) => {
      if (!controller.signal.aborted && activeView.current === requestedView) setLocal((previous) => previous ? { ...data, incidents: [...previous.incidents, ...data.incidents] } : data);
    }).catch((cause) => { if (!controller.signal.aborted && activeView.current === requestedView) setLocalError(cause instanceof Error ? cause.message : 'Could not load CJIC records'); }));
    for (const [name, state] of Object.entries(remote)) {
      const data = state?.data;
      if (!data || (data.total !== null && data.nextOffset >= data.total)) continue;
      const source = name as RemoteSource;
      tasks.push(fetchIncidents(source, period, category, debouncedSearch, data.nextOffset, controller.signal).then((next) => {
        if (controller.signal.aborted || activeView.current !== requestedView) return;
        setRemote((previous) => {
          const previousData = previous[source]?.data;
          if (!previousData) return previous;
          const ids = new Set(previousData.incidents.map((item) => item.id));
          return { ...previous, [source]: { loading: false, error: null, data: { ...next, total: next.nextOffset === data.nextOffset ? data.nextOffset : next.total, incidents: [...previousData.incidents, ...next.incidents.filter((item) => !ids.has(item.id))] } } };
        });
      }).catch((cause) => {
        if (!controller.signal.aborted && activeView.current === requestedView) setRemote((previous) => ({ ...previous, [source]: { ...previous[source]!, error: cause instanceof Error ? cause.message : 'Could not load more records' } }));
      }));
    }
    await Promise.allSettled(tasks);
    if (!controller.signal.aborted && activeView.current === requestedView) setLoadingMore(false);
  }, [loadingMore, loading, local, remote, sourceKey, period, category, raceKey, debouncedSearch]);

  function currentView(): FilterView {
    return { sources, period, category, races, search, regionalFocus, recordSort };
  }
  function applyView(view: FilterView) {
    const allowedSources = new Set(DATA_SOURCES.map((source) => source.id));
    const allowedSorts: RecordSort[] = ['newest', 'oldest', 'offense-asc', 'offense-desc', 'location-asc', 'location-desc', 'source-asc', 'source-desc'];
    const nextSources = (view.sources || []).filter((source): source is CrimeSource => allowedSources.has(source));
    setSources(nextSources.length ? nextSources : DEFAULT_VIEW.sources as CrimeSource[]);
    setPeriod(view.period || DEFAULT_VIEW.period);
    setCategory(view.category || DEFAULT_VIEW.category);
    setRaces(view.races || DEFAULT_VIEW.races);
    setSearch(view.search || DEFAULT_VIEW.search);
    setDebouncedSearch(view.search || DEFAULT_VIEW.search);
    setRegionalFocus(['both', 'oakland', 'macomb'].includes(view.regionalFocus) ? view.regionalFocus : DEFAULT_VIEW.regionalFocus as RegionalFocus);
    setRecordSort(view.recordSort && allowedSorts.includes(view.recordSort) ? view.recordSort : 'newest');
    setRecordFilterField('any');
    setRecordFilter('');
  }
  function saveCurrentView() {
    const name = savedViewName.trim();
    if (!name) return;
    const next = [...savedViews, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: name.slice(0, 60), view: currentView() }];
    setSavedViews(next);
    window.localStorage.setItem('infringe-saved-views', JSON.stringify(next));
    setSavedViewName('');
    setIsNamingView(false);
  }
  function deleteSavedView(id: string) {
    const next = savedViews.filter((view) => view.id !== id);
    setSavedViews(next);
    window.localStorage.setItem('infringe-saved-views', JSON.stringify(next));
  }

  function changeSources(next: CrimeSource[]) {
    setSources(next);
    // Standardized categories are deliberately shared by every source. Keep
    // them selected while switching coverage; raw source labels are not
    // portable and still need to be cleared.
    if (category && !standardCategoryName(category)) setCategory('');
    if (next.length === 1 && next[0] === 'detroit') setRegionalFocus('both');
    if (!next.some(isCJIC)) setRaces([]);
    if (next.some(isCJIC) && ['24h', '7d', '30d'].includes(period)) {
      setPeriod('all');
    } else if (next.length === 1 && next[0] === 'clemis' && /^\d{4}$/.test(period) && Number(period) !== currentYear) {
      setPeriod('all');
    }
  }
  function toggleSource(source: CrimeSource) {
    changeSources(DATA_SOURCES.filter((entry) => sources.includes(entry.id) !== (entry.id === source)).map((entry) => entry.id));
  }
  function selectRecord(id: string) {
    setSelectedAreaKey(null);
    setSelectedId(id);
    if (window.matchMedia('(max-width: 640px)').matches) {
      requestAnimationFrame(() => mapPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }
  function selectArea(key: string) { setSelectedId(null); setSelectedAreaKey(key); }
  function openComparison() {
    setComparisonScope(selectedAreaKey || 'all'); setSelectedId(null); setSelectedAreaKey(null); setComparison(null); setComparisonMode(true); setLegendOpen(true); setMobileFilters(false);
  }
  const hasRecentPeriod = ['24h', '7d', '30d'].includes(period);
  const sourceStatus = (source: CrimeSource) => {
    if (!sources.includes(source)) return '';
    if (!isCJIC(source) && races.length) return 'No race field';
    if (source === 'news') return newsError ? 'Unavailable' : newsFile ? `${newsIncidents.length.toLocaleString()} matching / ${(newsFile.cases.length + newsFile.articles.length).toLocaleString()} available` : 'Loading...';
    if (isCJIC(source)) return localLoading ? 'Loading...' : localError ? 'Unavailable' : `${(local?.sourceCounts[source] || 0).toLocaleString()} rows`;
    const state = remote[source];
    if (state?.error) return 'Unavailable';
    if (state?.loading && state.data) return `${state.data.incidents.length.toLocaleString()} / ${(state.data.total ?? state.data.incidents.length).toLocaleString()} loading`;
    return state?.loading ? 'Loading...' : `${(state?.data?.total || 0).toLocaleString()} rows`;
  };

  return <div className={`shell ${comparisonMode ? 'comparing' : ''}`}>
    <header className="topbar">
      <a className="brand" href="/" aria-label="Infringe home"><span className="brand-mark" aria-hidden="true">◆</span><div><strong>INFRINGE</strong><small>METRO DETROIT CRIME ATLAS</small></div></a>
      <div className="topbar-center"><span className="pulse" /> PUBLIC DATA &amp; NEWS <span className="topbar-divider">/</span> METRO DETROIT, MICHIGAN</div>
      <div className="topbar-actions"><span className="clock-label">{fetchedAt ? `FETCHED ${new Date(fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : newsFile ? `REVIEWED ${newsFile.updatedAt}` : 'AWAITING DATA'}</span><button className="icon-button mobile-filter-toggle" title={mobileFilters ? 'Close filters' : 'Open filters'} aria-label={mobileFilters ? 'Close filters' : 'Open filters'} aria-expanded={mobileFilters} aria-controls="data-filters" onClick={() => setMobileFilters((value) => !value)}><Filter size={16} /><span className="mobile-filter-text">{comparisonMode ? 'Map settings' : 'Filters'}</span></button><button className="icon-button" title="Refresh data" aria-label="Refresh data" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={16} /></button></div>
    </header>

    {mobileFilters && <button className="mobile-filter-backdrop" type="button" aria-label="Close filters" onClick={() => setMobileFilters(false)} />}
    <aside className={`sidebar ${mobileFilters ? 'filters-open' : ''}`} id="data-filters" role={mobileFilters ? 'dialog' : undefined} aria-modal={mobileFilters || undefined} aria-label={mobileFilters ? (comparisonMode ? 'Map settings' : 'Filters and coverage') : undefined}>
      <div className="side-heading"><span>{comparisonMode ? 'MAP SETTINGS' : 'FILTERS & COVERAGE'}</span><Filter className="side-heading-icon" size={15} /><button className="mobile-filter-close" type="button" aria-label="Close filters" onClick={() => setMobileFilters(false)}><X size={18} /></button></div>
      {comparisonMode ? <section className="filter-section comparison-sidebar"><div className="section-label">CJIC COMPARISON</div><p>Choose two cohorts in the Compare panel. Each cohort has its own place, year, offense and victim-race filters.</p><p>Counts include every matching crime and victim row in the downloaded snapshot. Agency records are separate from this comparison.</p><label className="field-label focus-label" htmlFor="compare-focus">Map focus</label><select id="compare-focus" value={regionalFocus} onChange={(event) => setRegionalFocus(event.target.value as RegionalFocus)}><option value="both">Oakland + Macomb</option><option value="oakland">Oakland County</option><option value="macomb">Macomb County</option></select><p className="field-note">Snapshot: 2021 through June 30, 2026. Map colors show reporting areas; locations within them are unknown.</p><a className="small-link" href={CJIC_SOURCE} target="_blank" rel="noreferrer">Michigan CJIC source <ArrowUpRight size={13} /></a></section> : <>
      <section className="filter-section view-presets"><div className="section-label">QUICK VIEWS</div><select id="view-preset" aria-label="Preset" defaultValue="" onChange={(event) => { const preset = BUILT_IN_VIEWS.find((view) => view.id === event.target.value); if (preset) applyView(preset.view as FilterView); event.currentTarget.value = ''; }}><option value="">Choose a preset…</option>{BUILT_IN_VIEWS.map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}</select>{isNamingView ? <form className="save-view-form" onSubmit={(event) => { event.preventDefault(); saveCurrentView(); }}><label className="field-label" htmlFor="saved-view-name">View name</label><input id="saved-view-name" value={savedViewName} maxLength={60} autoFocus placeholder="Detroit homicide archive" onChange={(event) => setSavedViewName(event.target.value)} /><div><button type="submit" disabled={!savedViewName.trim()}><BookmarkPlus size={12} />Save</button><button type="button" onClick={() => { setSavedViewName(''); setIsNamingView(false); }}>Cancel</button></div></form> : <button type="button" className="save-view-button" onClick={() => setIsNamingView(true)}><BookmarkPlus size={13} />Save current view</button>}{savedViews.length > 0 && <div className="saved-views" aria-label="Saved views">{savedViews.map((view) => <div key={view.id}><button type="button" onClick={() => applyView(view.view)}>{view.name}</button><button type="button" aria-label={`Delete saved view ${view.name}`} onClick={() => deleteSavedView(view.id)}><Trash2 size={12} /></button></div>)}</div>}</section>
      <section className="filter-section data-source-section"><div className="section-label"><span>01</span> DATA SOURCES</div>
        <fieldset className="checkbox-group data-source-group"><legend className="sr-only">Data sources</legend><SelectAll label="All data sources" checked={sources.length === DATA_SOURCES.length} mixed={sources.length > 0 && sources.length < DATA_SOURCES.length} onChange={() => changeSources(sources.length === DATA_SOURCES.length ? [] : DATA_SOURCES.map((entry) => entry.id))} />
          <div className="source-disclosure">
            <button type="button" className="source-disclosure-toggle" aria-expanded={publicRecordsOpen} aria-controls="public-record-sources" onClick={() => setPublicRecordsOpen((open) => !open)}><span>Public records</span><small>{sources.filter((source) => source !== 'news').length} selected</small><ChevronDown size={14} /></button>
            {publicRecordsOpen && <div className="source-disclosure-body" id="public-record-sources">{DATA_SOURCES.filter((entry) => entry.id !== 'news').map((entry) => <label className="source-option" key={entry.id}><input type="checkbox" checked={sources.includes(entry.id)} onChange={() => toggleSource(entry.id)} /><span className="source-option-body"><strong><i style={{ background: entry.color }} />{entry.label}</strong><small>{entry.coverage}</small>{sources.includes(entry.id) && <small className="source-status">{sourceStatus(entry.id)}</small>}</span></label>)}</div>}
          </div>
          <div className="source-disclosure news-source-disclosure">
            <button type="button" className="source-disclosure-toggle" aria-expanded={localNewsOpen} aria-controls="local-news-sources" onClick={() => setLocalNewsOpen((open) => !open)}><span>Local news</span><small>{sources.includes('news') ? '1 selected' : 'None selected'}</small><ChevronDown size={14} /></button>
            {localNewsOpen && <div className="source-disclosure-body" id="local-news-sources">{DATA_SOURCES.filter((entry) => entry.id === 'news').map((entry) => <label className="source-option" key={entry.id}><input type="checkbox" checked={sources.includes(entry.id)} onChange={() => toggleSource(entry.id)} /><span className="source-option-body"><strong><i style={{ background: entry.color }} />{entry.label}</strong><small>{entry.coverage}</small>{sources.includes(entry.id) && <small className="source-status">{sourceStatus(entry.id)}</small>}</span></label>)}</div>}
          </div>
        </fieldset>
        <label className="field-label focus-label" htmlFor="regional-focus">Map focus</label><select id="regional-focus" value={regionalFocus} disabled={isDetroitOnly} onChange={(event) => setRegionalFocus(event.target.value as RegionalFocus)}><option value="both">Full selected coverage</option><option value="oakland">Oakland County</option><option value="macomb">Macomb County</option></select>
      </section>

      <section className="filter-section"><div className="section-label"><span>02</span> TIME PERIOD</div><select id="period" aria-label="Reporting period" value={period} onChange={(event) => setPeriod(event.target.value)}>
        <option value="all">All available years</option><option value="24h" disabled={hasCJIC}>Past 24 hours</option><option value="7d" disabled={hasCJIC}>Past 7 days</option><option value="30d" disabled={hasCJIC}>Past 30 days</option><optgroup label="By year">{years.map((year) => <option value={year} key={year} disabled={!yearAvailable(year)}>{year}{yearAvailable(year) ? '' : ' — unavailable'}</option>)}</optgroup>
      </select>{hasCJIC && <p className="field-note">CJIC snapshot: 2021 through June 30, 2026. CSV dates have year precision. Recent day/week/month filters are disabled while a CJIC source is selected.</p>}{sources.includes('clemis') && <p className="field-note">The live CLEMIS layer currently contains 2026 records and zero 2025 records. Earlier years are disabled when no other selected source covers them.</p>}{sources.includes('news') && <p className="field-note">News combines {newsFile?.cases.length.toLocaleString() || 0} individually reviewed incidents with {newsFile?.articles.length.toLocaleString() || 0} current official publisher-feed articles across crime categories. Reviewed cases use incident dates; feed articles use publication times and are not claimed as verified incidents. RSS cannot provide a complete historical archive.</p>}</section>

      <section className="filter-section"><div className="section-label"><span>03</span> OFFENSE</div><select id="category" aria-label="Crime category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option><option value="standard:Homicide">Homicide / murder</option><optgroup label="Other standardized categories">{STANDARD_OFFENSES.filter((entry) => entry.id !== 'Homicide').map((entry) => <option value={`standard:${entry.id}`} key={entry.id}>{entry.id}</option>)}</optgroup><optgroup label="Original source labels">{categories.map((name) => <option value={name} key={name}>{name}</option>)}</optgroup></select></section>

      <section className="filter-section"><div className="section-label"><span>04</span> VICTIM RACE</div><fieldset className="checkbox-group" disabled={!hasCJIC || !manifest}><legend className="field-label">Reported victim race</legend>
        <SelectAll label="All races" checked={races.length === 0} mixed={races.some((race) => race !== '__none__')} onChange={() => setRaces(races.length === 0 ? ['__none__'] : [])} />
        {(manifest?.races || []).map((race) => <label className="race-option" key={race}><input type="checkbox" checked={races.length === 0 || races.includes(race)} onChange={() => {
          const current = races.length ? races.filter((race) => race !== '__none__') : manifest!.races;
          const next = current.includes(race) ? current.filter((value) => value !== race) : [...current, race];
          setRaces(next.length === manifest!.races.length ? [] : next.length ? next : ['__none__']);
        }} /><span>{race}</span></label>)}
      </fieldset>{manifestError && <p className="source-warning">{manifestError}</p>}</section>

      <div className="sidebar-bottom"><div className="section-label"><span>05</span> COVERAGE</div><div className="coverage-active"><span className="pulse" />{sources.length} SOURCES SELECTED</div><a href={CJIC_SOURCE} target="_blank" rel="noreferrer">Michigan CJIC dashboard <ArrowUpRight size={13} /></a><a href={CLEMIS_SOURCE} target="_blank" rel="noreferrer">CLEMIS public crime search <ArrowUpRight size={13} /></a><p>Agency datasets can overlap. Crime rows and victim rows are distinct records, not a combined count of unique crimes.</p></div>
      </>}
    </aside>

    <main className="main">
      <div className="stats-row">{comparisonMode ? (['a', 'b'] as const).flatMap((side) => (['crime', 'victims'] as const).map((metric) => <div className="stat" key={`${side}-${metric}`}><small>{side.toUpperCase()} · {metric === 'crime' ? 'CRIME ROWS' : 'VICTIM ROWS'}</small><strong>{comparison ? (comparison[side].sourceCounts[metric === 'crime' ? 'cjic-crime' : 'cjic-victim'] || 0).toLocaleString() : '...'}</strong><span>{comparison?.[side === 'a' ? 'aLabel' : 'bLabel'] || 'Preparing comparison'}</span></div>)) : <><div className="stat"><small>MATCHING RECORDS</small><strong>{loading ? '...' : total.toLocaleString()}</strong><span>{errors.length ? 'partial source results' : 'selected sources / current filters'}</span></div><div className="stat"><small>AGENCY MAP POINTS</small><strong>{visibleRemote.length.toLocaleString()}</strong><span>loaded CLEMIS / Detroit records</span></div><div className="stat"><small>CJIC MAP ROWS</small><strong>{localLoading ? '...' : (local?.total || 0).toLocaleString()}</strong><span>{local?.areas.filter((area) => area.crime + area.victims > 0).length || 0} matching reporting areas</span></div><div className="stat source-stat"><small>OFFENSE GROUPS</small><strong>{Object.keys(groupCounts).length}</strong><span>{sources.length} selected data sources</span></div></>}</div>
      <div className="workspace"><section className={`map-panel${selected && !comparisonMode ? ' has-record-preview' : ''}`} ref={mapPanelRef}><CrimeMap incidents={comparisonMode ? [] : sortedIncidents} selectedId={selectedId} selectedAreaKey={selectedAreaKey} onSelect={selectRecord} resetSignal={resetSignal} locateSignal={locateSignal} sources={comparisonMode ? ['cjic-crime', 'cjic-victim'] : sources} areas={mapAreas} onSelectArea={selectArea} regionalFocus={regionalFocus} metric={effectiveMetric} comparison={comparisonMode ? comparison : null} /><div className="map-topline"><span><Activity size={13} />{comparisonMode ? 'CJIC COMPARISON' : regionalFocus === 'oakland' ? 'OAKLAND COUNTY' : regionalFocus === 'macomb' ? 'MACOMB COUNTY' : 'METRO DETROIT'}</span><div className="map-view-actions"><button className="reset-view" title="Reset map view" aria-label="Reset map view" onClick={() => setResetSignal((value) => value + 1)}><Maximize2 size={14} /></button><button className="reset-view" title="Center map on my location" aria-label="Center map on my location" onClick={() => setLocateSignal((value) => value + 1)}><Crosshair size={14} /></button></div></div>
        {selected && !comparisonMode && <article className="map-record-preview" aria-label="Selected public record"><div className="map-record-preview-head"><span>{DATA_SOURCES.find((entry) => entry.id === selected.source)?.shortLabel || 'PUBLIC RECORD'}</span><button type="button" aria-label="Close selected record" onClick={() => setSelectedId(null)}><X size={15} /></button></div><strong>{selected.description}</strong><p>{recordLocation(selected) || 'Location unavailable'} · {recordDate(selected)}</p><details><summary>Record details</summary><dl>{Object.entries(selected.fields).map(([field, value]) => <div key={field}><dt>{recordFieldLabel(field)}</dt><dd>{value === '' || value === null ? 'Not reported' : String(value)}</dd></div>)}</dl></details></article>}
        {hasCJIC && !comparisonMode && <label className="map-metric-control">CJIC map<select aria-label="CJIC map measure" value={effectiveMetric} onChange={(event) => setMapMetric(event.target.value as CJICMetric)}>{sources.includes('cjic-crime') && <option value="crime">Crime rows / sq km</option>}{sources.includes('cjic-victim') && <option value="victims">Victim rows / sq km</option>}{sources.includes('cjic-crime') && sources.includes('cjic-victim') && <option value="combined">All selected rows / sq km</option>}</select></label>}
        {comparisonMode && comparison && <div className="comparison-map-summary"><span><i className="cohort-dot a" />A · {comparison.aLabel}</span><span><i className="cohort-dot b" />B · {comparison.bLabel}</span></div>}
        {legendOpen && <div className="heat-legend" aria-label="Map legend">
          <div className="heat-legend-content">
            {comparisonMode ? !comparison ? <small className="geography-note">Calculating comparison…</small> : comparison.view === 'change' && !hasComparableAreas ? <>
              <div className="heat-legend-heading"><span>COHORT PLACES</span></div>
              <div className="cohort-key"><span><i className="cohort-dot a" />A only</span><span><i className="cohort-dot b" />B only</span></div>
              <small className="geography-note">Different places have no shared map baseline. Compare crime and victim totals in the data panel. County-only locations use dashed outlines.</small>
            </> : <>
              <div className="heat-legend-heading"><span>{comparison.view === 'change' ? 'B − A' : comparison.view === 'a' ? 'COHORT A' : 'COHORT B'} · {comparison.metric === 'victims' ? 'VICTIM' : 'CRIME'} ROWS{comparison.density ? ' / SQ KM' : ''}</span><b>LOG SCALE</b></div>
              <div className={`heat-legend-scale ${comparison.view === 'change' ? 'comparison-scale' : ''}`} />
              <div className="heat-legend-labels"><span>{comparison.view === 'change' && comparisonMaximum > 0 ? `−${densityLabel(comparisonMaximum)}` : '0'}</span><span>{comparison.view === 'change' ? '0' : densityLabel(densityScaleMidpoint(comparisonMaximum))}</span><span>{densityLabel(comparisonMaximum)}</span></div>
              <small className="geography-note">{comparison.view === 'change' ? 'Blue: lower in B. Amber: higher in B. A-only / B-only places use cohort colors, not a calculated change.' : 'Color shows matching rows in this cohort.'} Gray: zero / no comparable data. County-only locations use dashed outlines.</small>
            </> : <>
              {hasAgency && <div><div className="heat-legend-heading"><span>AGENCY INCIDENTS</span><b>RELATIVE</b></div><div className="heat-legend-scale" /><div className="heat-legend-labels"><span>LOW</span><span>MODERATE</span><span>HIGH</span></div></div>}
              {sources.includes('news') && <small className="geography-note"><i className="news-legend-dot" /> Orange circles: reviewed news cases at approximate reported intersections. These are excluded from agency heat and may overlap police records.</small>}
              {hasCJIC && <div className={hasAgency ? 'area-legend' : ''}><div className="heat-legend-heading"><span>CJIC {effectiveMetric === 'combined' ? 'SELECTED' : effectiveMetric === 'crime' ? 'CRIME' : 'VICTIM'} ROWS / SQ KM</span><b>LOG SCALE</b></div><div className="heat-legend-scale" /><div className="heat-legend-labels"><span>0</span><span>{densityLabel(densityScaleMidpoint(maximumDensity))}</span><span>{densityLabel(maximumDensity)}</span></div><small className="geography-note">Gray: no matching rows. Reporting boundaries, not incident points. {countyOnlyRows.toLocaleString()} county-only rows excluded from municipal heat.</small></div>}
            </>}
          </div>
        </div>}
        {!comparisonMode && <div className="map-bottomline"><button className="map-legend-control" type="button" aria-expanded={legendOpen} aria-label={legendOpen ? 'Hide map legend' : 'Show map legend'} onClick={() => setLegendOpen((open) => !open)}><i className="map-dot" />{loading ? 'LOADING RECORDS' : `${visibleRemote.length.toLocaleString()} AGENCY / ${newsIncidents.length.toLocaleString()} NEWS / ${(local?.total || 0).toLocaleString()} CJIC ROWS`}</button></div>}
        {!comparisonMode && errors.length > 0 && <div className="map-error" role="alert"><ShieldAlert size={20} /><div><strong>Some source data is unavailable</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div><button className="icon-button" title="Retry unavailable sources" aria-label="Retry unavailable sources" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} /></button></div>}
      </section>

      <section className="records-panel"><div className="workspace-tabs" role="tablist" aria-label="Workspace view"><button role="tab" id="records-tab" aria-selected={!comparisonMode} aria-controls="records-view" onClick={() => { setComparisonMode(false); setComparison(null); setSelectedAreaKey(null); }}>Records</button><button role="tab" id="comparison-tab" aria-selected={comparisonMode} aria-controls="comparison-view" onClick={() => { if (!comparisonMode) openComparison(); }}>Compare &amp; analyze</button></div>{comparisonMode ? <div className="comparison-view" id="comparison-view" role="tabpanel" aria-labelledby="comparison-tab">{manifest ? <CJICComparison manifest={manifest} initialScope={comparisonScope} onMapChange={setComparison} onSelectArea={selectArea} selectedAreaKey={selectedAreaKey} /> : <p className="list-message" role="status">{manifestError || 'Loading CJIC metadata…'}</p>}</div> : <div className="records-view" id="records-view" role="tabpanel" aria-labelledby="records-tab"><div className="records-header"><div><small>SOURCE ENTRIES</small><h2>Incidents, victims &amp; articles</h2></div><div className="records-actions"><span className="record-count" aria-label={`${incidents.length} visible loaded records`}>{incidents.length.toLocaleString()} loaded</span><select aria-label="Sort public records" value={recordSort} onChange={(event) => setRecordSort(event.target.value as RecordSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="offense-asc">Offense: A–Z</option><option value="offense-desc">Offense: Z–A</option><option value="location-asc">Location: A–Z</option><option value="location-desc">Location: Z–A</option><option value="source-asc">Source: A–Z</option><option value="source-desc">Source: Z–A</option></select></div></div><div className="search-box"><Search size={15} /><input aria-label="Search all matching records" placeholder="Search all source records..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="record-filter"><select aria-label="Choose a public-record field to filter" value={recordFilterField} onChange={(event) => { setRecordFilterField(event.target.value); setRecordFilter(''); }}><option value="any">Any record detail</option><option value="offense">Offense</option><option value="location">Location</option><option value="source">Source</option>{recordFilterFields.length > 0 && <optgroup label="Source fields">{recordFilterFields.map((field) => <option value={`field:${field}`} key={field}>{recordFieldLabel(field)}</option>)}</optgroup>}</select><select aria-label="Choose a public-record value to filter" value={recordFilter} onChange={(event) => setRecordFilter(event.target.value)} disabled={recordFilterValues.length === 0}><option value="">All values</option>{recordFilterValues.map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
        {selectedArea && <div className="selected-card"><div className="selected-eyebrow">CJIC REPORTING AREA<button className="icon-button" aria-label="Close area details" title="Close area details" onClick={() => setSelectedAreaKey(null)}><X size={13} /></button></div><strong>{selectedArea.city}, {selectedArea.county}</strong><p>{sources.includes('cjic-crime') ? `${selectedArea.crime.toLocaleString()} crime rows` : 'Crime source not selected'} / {sources.includes('cjic-victim') ? `${selectedArea.victims.toLocaleString()} victim rows` : 'Victim source not selected'}</p><p>{selectedArea.geographyLabel}</p><p>{selectedArea.precision === 'county' ? `No verified municipal boundary. Original reporting labels: ${selectedArea.reportingLabels.join(', ')}. These rows do not contribute to municipal heat.` : `${densityLabel(reportingDensity(selectedArea, effectiveMetric)!)} ${effectiveMetric === 'combined' ? 'selected' : effectiveMetric === 'crime' ? 'crime' : 'victim'} rows per sq km / ${densityLabel(selectedArea.areaKm2)} sq km. Locations within the boundary are unknown.`}</p><dl className="record-fields">{Object.entries(selectedArea.races).map(([race, count]) => <div key={race}><dt>{race}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl><p>{sources.includes('cjic-victim') ? 'Race counts represent matching victim rows.' : 'Race counts represent crime rows with linked victims; a row can have multiple victim races.'}</p><button className="compare-area-button" onClick={openComparison}>Compare this reporting area</button></div>}
        {selected && <div className="selected-card"><div className="selected-eyebrow" style={{ color: offenseColor(selected.category, selected.description, selected.standardOffense) }}>{DATA_SOURCES.find((entry) => entry.id === selected.source)?.shortLabel}{selected.recordKind === 'publisher-rss-article' ? ' · ARTICLE' : selected.recordKind === 'reviewed-news-incident' ? ' · REVIEWED' : ''}{selected.standardOffense ? ` · ${selected.standardOffense.toUpperCase()}` : ''}<button className="icon-button" aria-label="Close record details" title="Close record details" onClick={() => setSelectedId(null)}><X size={13} /></button></div><strong>{selected.description}</strong><p>{recordLocation(selected) || 'Location unavailable'} / {recordDate(selected)}</p><p><strong>Standard offense:</strong> {selected.standardOffense || 'Other'} · Original label: {selected.category}</p>{isCJIC(selected.source) && <p>{selected.locationPrecision === 'county' ? 'County-only location.' : 'City / township reporting area.'} Exact incident coordinates are absent from the CSV.</p>}{selected.source === 'cjic-crime' && <p>Linked victim races: {selected.victimRaces?.join(', ') || 'No linked victim record'}</p>}{relatedRecords.length > 0 && <div className="related-records"><strong><Link2 size={13} />Likely same incident</strong><p>Date and location evidence links these source entries; totals remain separate.</p>{relatedRecords.map((record) => <button type="button" key={record.id} onClick={() => selectRecord(record.id)}>{DATA_SOURCES.find((source) => source.id === record.source)?.shortLabel} · {record.description}</button>)}</div>}<dl className="record-fields" aria-label="Record details">{Object.entries(selected.fields).map(([field, value]) => <div key={field}><dt>{recordFieldLabel(field)}</dt><dd>{value === '' || value === null ? <span className="missing-value">Not reported</span> : String(value)}</dd></div>)}</dl>{isCJIC(selected.source) && <a className="small-link" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/data/michigan-cjic/${selected.source === 'cjic-crime' ? 'crime' : 'victim'}-live.csv`} download><Download size={13} />Original source CSV</a>}</div>}
        {selected?.source === 'news' && <div className="news-citations"><strong>Original reporting</strong><p>{selected.recordKind === 'publisher-rss-article' ? 'Official publisher-feed metadata. The displayed date is publication time; incident facts and location have not been individually reviewed.' : 'One case may have several articles. The map marker is approximate; see the location note above.'}</p>{selected.sourceArticles?.map((article) => <a href={article.url} key={article.url} target="_blank" rel="noreferrer">{article.outlet} report <ExternalLink size={12} /></a>)}</div>}
        <RecordList incidents={incidents} selectedId={selectedId} onSelect={selectRecord} message={incidents.length ? undefined : loading ? 'Loading selected public records...' : !sources.length ? 'No data sources selected.' : hasRecentPeriod && hasCJIC ? 'CJIC has year-only dates. Select a year or all available years to see those records.' : sources.length === 1 && sources[0] === 'news' && newsFile ? `No news entries match this period. ${(newsFile.cases.length + newsFile.articles.length).toLocaleString()} reviewed incidents and publisher articles are available under their supported periods.` : races.includes('__none__') ? 'No races selected.' : 'No records match the selected filters.'} />
        {!loading && (remoteHasMore || localHasMore) && <button className="load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading...' : <>Load more source records ({Math.max(0, total - loadedCount).toLocaleString()} not loaded) <ArrowDown size={14} /></>}</button>}
        </div>}
      </section></div>

      <footer className="source-strip"><div><Database size={16} /><span><strong>{comparisonMode ? 'CJIC crime + victim comparison' : sources.map((source) => DATA_SOURCES.find((entry) => entry.id === source)?.label).join(' + ') || 'No selected sources'}.</strong> Agency heat uses published points. CJIC heat uses reporting-boundary row density. Reviewed news incidents and unreviewed publisher-feed articles are labeled separately.</span></div><div className="source-links">{DATA_SOURCES.filter((entry) => comparisonMode ? isCJIC(entry.id) : sources.includes(entry.id)).flatMap((entry) => entry.id === 'news' ? [<a href="https://www.wxyz.com/about-us/rss" target="_blank" rel="noreferrer" key="news-wxyz">WXYZ<ExternalLink size={12} /></a>, <a href="https://www.clickondetroit.com/rss/" target="_blank" rel="noreferrer" key="news-wdiv">WDIV<ExternalLink size={12} /></a>] : [<a href={entry.url} target="_blank" rel="noreferrer" key={entry.id}>{entry.shortLabel}<ExternalLink size={12} /></a>])}</div></footer>
    </main>
    <div className="resource-bar"><span><Radio size={15} /> OTHER LIVE SOURCES</span><a href="https://metrodetroitscanner.com/watch" target="_blank" rel="noreferrer">Public scanner <ArrowUpRight size={13} /></a><a href="https://www.broadcastify.com/listen/ctid/1276" target="_blank" rel="noreferrer">Macomb County feeds <ArrowUpRight size={13} /></a><span className="resource-note">Dispatch traffic is unverified and is not plotted as crime.</span></div>
  </div>;
}
