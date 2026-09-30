'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUpRight, ChevronDown, Crosshair, Database, Download, ExternalLink, Filter, Info, Maximize2, Radio, RefreshCw, Search, ShieldAlert, X } from 'lucide-react';
import { CJIC_SOURCE, CLEMIS_SOURCE, DATA_SOURCES, crimeGroup, isCJIC, isHomicideOffense, recordDate, type CJICManifest, type CJICMetric, type CJICResponse, type ComparisonMap, type CrimeSource, type IncidentResponse, type RegionalFocus, type RemoteSource } from '@/lib/crime';
import { recordLocation, recordMatchesValue, recordValues } from '@/lib/record-filter';
import { fetchCategories, fetchIncidents } from '@/lib/arcgis-client';
import { fetchCJIC, fetchCJICManifest } from '@/lib/cjic-client';
import RecordList from '@/components/RecordList';
import { densityScaleMidpoint, reportingDensity, reportingDensityMaximum } from '@/lib/map-density';
import CJICComparison from '@/components/CJICComparison';
import { comparisonAreas, comparisonFeatures } from '@/lib/cjic-comparison';

const CrimeMap = dynamic(() => import('@/components/CrimeMap'), { ssr: false });
const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 2015 }, (_, index) => currentYear - index);
type RemoteState = { data: IncidentResponse | null; loading: boolean; error: string | null };
type RecordSort = 'newest' | 'oldest' | 'offense-asc' | 'offense-desc' | 'location-asc' | 'location-desc' | 'source-asc' | 'source-desc';

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
  const [sources, setSources] = useState<CrimeSource[]>(['clemis']);
  const [regionalFocus, setRegionalFocus] = useState<RegionalFocus>('both');
  const [period, setPeriod] = useState('24h');
  const [category, setCategory] = useState('');
  const [remoteCategories, setRemoteCategories] = useState<string[]>([]);
  const [races, setRaces] = useState<string[]>([]);
  const [manifest, setManifest] = useState<CJICManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [remote, setRemote] = useState<Partial<Record<RemoteSource, RemoteState>>>({});
  const [local, setLocal] = useState<CJICResponse | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAreaKey, setSelectedAreaKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [locateSignal, setLocateSignal] = useState(0);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparison, setComparison] = useState<ComparisonMap | null>(null);
  const [comparisonScope, setComparisonScope] = useState('all');
  const [mapMetric, setMapMetric] = useState<CJICMetric>('crime');
  const [recordSort, setRecordSort] = useState<RecordSort>('newest');
  const [recordFilterField, setRecordFilterField] = useState('any');
  const [recordFilter, setRecordFilter] = useState('');
  const mapPanelRef = useRef<HTMLElement | null>(null);
  const sourceKey = sources.join('|');
  const raceKey = races.join('|');
  const isDetroitOnly = sources.length === 1 && sources[0] === 'detroit';
  const hasCJIC = sources.some(isCJIC);
  const hasAgency = sources.some((source) => !isCJIC(source));
  const viewKey = `${sourceKey}|${period}|${category}|${raceKey}|${debouncedSearch}|${refresh}`;
  const activeView = useRef(viewKey);
  activeView.current = viewKey;
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

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
    const selected = sources.filter((source): source is RemoteSource => !isCJIC(source));
    Promise.allSettled(selected.map((source) => fetchCategories(source, controller.signal))).then((results) => {
      if (!controller.signal.aborted) setRemoteCategories([...new Set(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []))].sort());
    });
    return () => controller.abort();
  }, [sourceKey]);

  useEffect(() => {
    if (comparisonMode || !['24h', '7d', '30d'].includes(period)) return;
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [period, comparisonMode]);

  useEffect(() => {
    const controller = new AbortController();
    const selected = races.length ? [] : sources.filter((source): source is RemoteSource => !isCJIC(source));
    setRemote(Object.fromEntries(selected.map((source) => [source, { data: null, loading: true, error: null }])));
    for (const source of selected) {
      fetchIncidents(source, period, category, 0, controller.signal).then((data) => {
        if (!controller.signal.aborted) setRemote((state) => ({ ...state, [source]: { data, loading: false, error: null } }));
      }).catch((cause) => {
        if (!controller.signal.aborted) setRemote((state) => ({ ...state, [source]: { data: null, loading: false, error: cause instanceof Error ? cause.message : 'Source unavailable' } }));
      });
    }
    return () => controller.abort();
  }, [sourceKey, period, category, raceKey, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const selected = sources.filter(isCJIC);
    setLocal(null);
    setLocalError(null);
    setLocalLoading(selected.length > 0);
    if (selected.length) fetchCJIC({ sources: selected, period, category, races, search: debouncedSearch }, controller.signal)
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
    ...remoteCategories, ...sources.filter(isCJIC).flatMap((source) => manifest?.sources[source].categories || []),
  ])].sort(), [remoteCategories, sourceKey, manifest]);
  const remoteIncidents = useMemo(() => Object.values(remote).flatMap((state) => state?.data?.incidents || []), [remote]);
  const visibleRemote = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return term ? remoteIncidents.filter((item) => Object.values(item.fields).some((value) => String(value ?? '').toLowerCase().includes(term))) : remoteIncidents;
  }, [remoteIncidents, debouncedSearch]);
  const sortedIncidents = useMemo(() => {
    const recordTime = (occurredAt: number | null, year: number | undefined) => occurredAt ?? Date.UTC(year || 0, 0, 1);
    const text = (value: string) => value.toLocaleLowerCase();
    return [...visibleRemote, ...(local?.incidents || [])].sort((a, b) => {
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
  }, [visibleRemote, local, recordSort]);
  const recordFilterFields = useMemo(() => [...new Set(sortedIncidents.flatMap((record) => Object.keys(record.fields)))].sort((a, b) => recordFieldLabel(a).localeCompare(recordFieldLabel(b))), [sortedIncidents]);
  useEffect(() => {
    if (recordFilterField.startsWith('field:') && !recordFilterFields.includes(recordFilterField.slice(6))) setRecordFilterField('any');
  }, [recordFilterField, recordFilterFields]);
  const recordFilterValues = useMemo(() => {
    const values = new Set<string>();
    for (const record of sortedIncidents) {
      const candidates = recordValues(record, recordFilterField);
      candidates.forEach((value) => {
        const text = String(value ?? '').trim();
        if (text) values.add(text);
      });
    }
    const options = [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (recordFilterField === 'offense' && sortedIncidents.some((record) => isHomicideOffense(record.category) || isHomicideOffense(record.description))) options.unshift('group:homicide');
    return options;
  }, [sortedIncidents, recordFilterField]);
  useEffect(() => {
    if (recordFilter && !recordFilterValues.some((value) => value === recordFilter)) setRecordFilter('');
  }, [recordFilter, recordFilterValues]);
  const incidents = useMemo(() => {
    return recordFilter ? sortedIncidents.filter((record) => recordMatchesValue(record, recordFilterField, recordFilter)) : sortedIncidents;
  }, [sortedIncidents, recordFilterField, recordFilter]);
  const loading = localLoading || Object.values(remote).some((state) => state?.loading);
  const remoteHasMore = Object.values(remote).some((state) => state?.data && (state.data.total === null ? state.data.incidents.length > 0 : state.data.nextOffset < state.data.total));
  const localHasMore = local !== null && local.nextOffset < local.total;
  const total = (local?.total || 0) + (debouncedSearch ? visibleRemote.length : Object.values(remote).reduce((sum, state) => sum + (state?.data?.total || 0), 0));
  const loadedCount = sortedIncidents.length;
  const errors = [...Object.entries(remote).flatMap(([source, state]) => state?.error ? [`${DATA_SOURCES.find((entry) => entry.id === source)?.label}: ${state.error}`] : []), ...(localError ? [`CJIC: ${localError}`] : [])];
  const selected = sortedIncidents.find((item) => item.id === selectedId) ?? null;
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
  const groupCounts = useMemo(() => visibleRemote.reduce((counts, item) => {
    const group = crimeGroup(item.category);
    counts[group] = (counts[group] || 0) + 1;
    return counts;
  }, { ...(local?.groups || {}) }), [visibleRemote, local]);

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
      tasks.push(fetchIncidents(source, period, category, data.nextOffset, controller.signal).then((next) => {
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

  function changeSources(next: CrimeSource[]) {
    setSources(next);
    setCategory('');
    if (next.length === 1 && next[0] === 'detroit') setRegionalFocus('both');
    if (!next.some(isCJIC)) setRaces([]);
    if (!next.some(isCJIC) && next.length > 0) {
      setPeriod('24h');
    } else if (next.some(isCJIC) && ['24h', '7d', '30d'].includes(period)) {
      const availableYears = next.filter(isCJIC).flatMap((source) => manifest?.sources[source].chunks.map((chunk) => chunk.year) || []);
      setPeriod(availableYears.length ? String(Math.max(...availableYears)) : 'all');
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
    if (isCJIC(source)) return localLoading ? 'Loading...' : localError ? 'Unavailable' : `${(local?.sourceCounts[source] || 0).toLocaleString()} rows`;
    return remote[source]?.loading ? 'Loading...' : remote[source]?.error ? 'Unavailable' : `${(remote[source]?.data?.total || 0).toLocaleString()} rows`;
  };

  return <div className={`shell ${comparisonMode ? 'comparing' : ''}`}>
    <header className="topbar">
      <a className="brand" href="/" aria-label="Infringe home"><span className="brand-mark" aria-hidden="true">◆</span><div><strong>INFRINGE</strong><small>METRO DETROIT CRIME ATLAS</small></div></a>
      <div className="topbar-center"><span className="pulse" /> PUBLIC RECORDS <span className="topbar-divider">/</span> METRO DETROIT, MICHIGAN</div>
      <div className="topbar-actions"><span className="clock-label">{fetchedAt ? `FETCHED ${new Date(fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'AWAITING DATA'}</span><button className="icon-button mobile-filter-toggle" title={mobileFilters ? 'Close filters' : 'Open filters'} aria-label={mobileFilters ? 'Close filters' : 'Open filters'} aria-expanded={mobileFilters} aria-controls="data-filters" onClick={() => setMobileFilters((value) => !value)}><Filter size={16} /><span className="mobile-filter-text">{comparisonMode ? 'Map settings' : 'Filters'}</span></button><button className="icon-button" title="Refresh data" aria-label="Refresh data" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={16} /></button></div>
    </header>

    {mobileFilters && <button className="mobile-filter-backdrop" type="button" aria-label="Close filters" onClick={() => setMobileFilters(false)} />}
    <aside className={`sidebar ${mobileFilters ? 'filters-open' : ''}`} id="data-filters" role={mobileFilters ? 'dialog' : undefined} aria-modal={mobileFilters || undefined} aria-label={mobileFilters ? (comparisonMode ? 'Map settings' : 'Filters and coverage') : undefined}>
      <div className="side-heading"><span>{comparisonMode ? 'MAP SETTINGS' : 'FILTERS & COVERAGE'}</span><Filter className="side-heading-icon" size={15} /><button className="mobile-filter-close" type="button" aria-label="Close filters" onClick={() => setMobileFilters(false)}><X size={18} /></button></div>
      {comparisonMode ? <section className="filter-section comparison-sidebar"><div className="section-label">CJIC COMPARISON</div><p>Choose two cohorts in the Compare panel. Each cohort has its own place, year, offense and victim-race filters.</p><p>Counts include every matching crime and victim row in the downloaded snapshot. Agency records are separate from this comparison.</p><label className="field-label focus-label" htmlFor="compare-focus">Map focus</label><select id="compare-focus" value={regionalFocus} onChange={(event) => setRegionalFocus(event.target.value as RegionalFocus)}><option value="both">Oakland + Macomb</option><option value="oakland">Oakland County</option><option value="macomb">Macomb County</option></select><p className="field-note">Snapshot: 2021 through June 30, 2026. Map colors show reporting areas; locations within them are unknown.</p><a className="small-link" href={CJIC_SOURCE} target="_blank" rel="noreferrer">Michigan CJIC source <ArrowUpRight size={13} /></a></section> : <>
      <section className="filter-section"><div className="section-label"><span>01</span> DATA SOURCES</div>
        <fieldset className="checkbox-group"><legend className="field-label">Coverage</legend><SelectAll label="All data sources" checked={sources.length === DATA_SOURCES.length} mixed={sources.length > 0 && sources.length < DATA_SOURCES.length} onChange={() => changeSources(sources.length === DATA_SOURCES.length ? [] : DATA_SOURCES.map((entry) => entry.id))} />
          {DATA_SOURCES.map((entry) => <label className="source-option" key={entry.id}><input type="checkbox" checked={sources.includes(entry.id)} onChange={() => toggleSource(entry.id)} /><span className="source-option-body"><strong><i style={{ background: entry.color }} />{entry.label}</strong><small>{entry.coverage}</small>{sources.includes(entry.id) && <small className="source-status">{sourceStatus(entry.id)}</small>}</span></label>)}
        </fieldset>
        <label className="field-label focus-label" htmlFor="regional-focus">Map focus</label><select id="regional-focus" value={regionalFocus} disabled={isDetroitOnly} onChange={(event) => setRegionalFocus(event.target.value as RegionalFocus)}><option value="both">Full selected coverage</option><option value="oakland">Oakland County</option><option value="macomb">Macomb County</option></select>{isDetroitOnly && <p className="field-note">Detroit Police coverage is limited to Detroit.</p>}
      </section>

      <section className="filter-section"><div className="section-label"><span>02</span> TIME PERIOD</div><label className="field-label" htmlFor="period">Reporting period</label><select id="period" value={period} onChange={(event) => setPeriod(event.target.value)}>
        <option value="all">All available years</option><option value="24h" disabled={hasCJIC}>Past 24 hours</option><option value="7d" disabled={hasCJIC}>Past 7 days</option><option value="30d" disabled={hasCJIC}>Past 30 days</option><optgroup label="By year">{years.map((year) => <option value={year} key={year}>{year}</option>)}</optgroup>
      </select>{hasCJIC && <p className="field-note">CJIC snapshot: 2021 through June 30, 2026. CSV dates have year precision. Recent day/week/month filters are disabled while a CJIC source is selected.</p>}{!hasCJIC && <p className="field-note">CLEMIS regional history starts in 2026; Detroit history starts in December 2016.</p>}</section>

      <section className="filter-section"><div className="section-label"><span>03</span> OFFENSE</div><label className="field-label" htmlFor="category">Crime category</label><select id="category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option><option value="group:homicide">Homicide / Murder (related offenses)</option>{categories.map((name) => <option value={name} key={name}>{name}</option>)}</select><p className="field-note">The grouped option includes source labels containing homicide, murder, or manslaughter. Record details show the original offense.</p></section>

      <section className="filter-section"><div className="section-label"><span>04</span> VICTIM RACE</div><fieldset className="checkbox-group" disabled={!hasCJIC || !manifest}><legend className="field-label">Reported victim race</legend>
        <SelectAll label="All races" checked={races.length === 0} mixed={races.some((race) => race !== '__none__')} onChange={() => setRaces(races.length === 0 ? ['__none__'] : [])} />
        {(manifest?.races || []).map((race) => <label className="race-option" key={race}><input type="checkbox" checked={races.length === 0 || races.includes(race)} onChange={() => {
          const current = races.length ? races.filter((race) => race !== '__none__') : manifest!.races;
          const next = current.includes(race) ? current.filter((value) => value !== race) : [...current, race];
          setRaces(next.length === manifest!.races.length ? [] : next.length ? next : ['__none__']);
        }} /><span>{race}</span></label>)}
      </fieldset><div className="notice"><Info size={15} /><span>Race describes victims. CJIC crime rows use victim records with matching incident and offense IDs. {races.length ? 'Sources without race data are excluded from this race-filtered view.' : 'CLEMIS and Detroit do not publish race in their mapped layers.'}</span></div>{manifestError && <p className="source-warning">{manifestError}</p>}</section>

      <div className="sidebar-bottom"><div className="section-label"><span>05</span> COVERAGE</div><div className="coverage-active"><span className="pulse" />{sources.length} SOURCES SELECTED</div><a href={CJIC_SOURCE} target="_blank" rel="noreferrer">Michigan CJIC dashboard <ArrowUpRight size={13} /></a><a href={CLEMIS_SOURCE} target="_blank" rel="noreferrer">CLEMIS public crime search <ArrowUpRight size={13} /></a><p>Agency datasets can overlap. Crime rows and victim rows are distinct records, not a combined count of unique crimes.</p></div>
      </>}
    </aside>

    <main className="main">
      <div className="stats-row">{comparisonMode ? (['a', 'b'] as const).flatMap((side) => (['crime', 'victims'] as const).map((metric) => <div className="stat" key={`${side}-${metric}`}><small>{side.toUpperCase()} · {metric === 'crime' ? 'CRIME ROWS' : 'VICTIM ROWS'}</small><strong>{comparison ? (comparison[side].sourceCounts[metric === 'crime' ? 'cjic-crime' : 'cjic-victim'] || 0).toLocaleString() : '...'}</strong><span>{comparison?.[side === 'a' ? 'aLabel' : 'bLabel'] || 'Preparing comparison'}</span></div>)) : <><div className="stat"><small>MATCHING ROWS</small><strong>{loading ? '...' : total.toLocaleString()}</strong><span>{errors.length ? 'partial source results' : 'selected sources / current filters'}</span></div><div className="stat"><small>AGENCY MAP POINTS</small><strong>{visibleRemote.length.toLocaleString()}</strong><span>loaded CLEMIS / Detroit records</span></div><div className="stat"><small>CJIC MAP ROWS</small><strong>{localLoading ? '...' : (local?.total || 0).toLocaleString()}</strong><span>{local?.areas.filter((area) => area.crime + area.victims > 0).length || 0} matching reporting areas</span></div><div className="stat source-stat"><small>OFFENSE GROUPS</small><strong>{Object.keys(groupCounts).length}</strong><span>{sources.length} selected data sources</span></div></>}</div>
      <div className="workspace"><section className={`map-panel${selected && !comparisonMode ? ' has-record-preview' : ''}`} ref={mapPanelRef}><CrimeMap incidents={comparisonMode ? [] : sortedIncidents} selectedId={selectedId} selectedAreaKey={selectedAreaKey} onSelect={selectRecord} resetSignal={resetSignal} locateSignal={locateSignal} sources={comparisonMode ? ['cjic-crime', 'cjic-victim'] : sources} areas={mapAreas} onSelectArea={selectArea} regionalFocus={regionalFocus} metric={effectiveMetric} comparison={comparisonMode ? comparison : null} /><div className="map-topline"><span><Activity size={13} />{comparisonMode ? 'CJIC COMPARISON' : regionalFocus === 'oakland' ? 'OAKLAND COUNTY' : regionalFocus === 'macomb' ? 'MACOMB COUNTY' : 'METRO DETROIT'}</span><div className="map-view-actions"><button className="reset-view" title="Reset map view" aria-label="Reset map view" onClick={() => setResetSignal((value) => value + 1)}><Maximize2 size={14} /></button><button className="reset-view" title="Center map on my location" aria-label="Center map on my location" onClick={() => setLocateSignal((value) => value + 1)}><Crosshair size={14} /></button></div></div>
        {selected && !comparisonMode && <article className="map-record-preview" aria-label="Selected public record"><div className="map-record-preview-head"><span>{DATA_SOURCES.find((entry) => entry.id === selected.source)?.shortLabel || 'PUBLIC RECORD'}</span><button type="button" aria-label="Close selected record" onClick={() => setSelectedId(null)}><X size={15} /></button></div><strong>{selected.description}</strong><p>{recordLocation(selected) || 'Location unavailable'} · {recordDate(selected)}</p><details><summary>Record details</summary><dl>{Object.entries(selected.fields).map(([field, value]) => <div key={field}><dt>{recordFieldLabel(field)}</dt><dd>{value === '' || value === null ? 'Not reported' : String(value)}</dd></div>)}</dl></details></article>}
        {hasCJIC && !comparisonMode && <label className="map-metric-control">CJIC map<select aria-label="CJIC map measure" value={effectiveMetric} onChange={(event) => setMapMetric(event.target.value as CJICMetric)}>{sources.includes('cjic-crime') && <option value="crime">Crime rows / sq km</option>}{sources.includes('cjic-victim') && <option value="victims">Victim rows / sq km</option>}{sources.includes('cjic-crime') && sources.includes('cjic-victim') && <option value="combined">All selected rows / sq km</option>}</select></label>}
        {comparisonMode && comparison && <div className="comparison-map-summary"><span><i className="cohort-dot a" />A · {comparison.aLabel}</span><span><i className="cohort-dot b" />B · {comparison.bLabel}</span></div>}
        <div className="heat-legend">
          <button className="heat-legend-toggle" type="button" aria-expanded={legendOpen} aria-label={legendOpen ? 'Hide map legend' : 'Show map legend'} onClick={() => setLegendOpen((open) => !open)}><span>MAP LEGEND</span><ChevronDown size={13} /></button>
          {legendOpen && <div className="heat-legend-content">
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
              {(hasAgency || !hasCJIC) && <div><div className="heat-legend-heading"><span>AGENCY INCIDENTS</span><b>RELATIVE</b></div><div className="heat-legend-scale" /><div className="heat-legend-labels"><span>LOW</span><span>MODERATE</span><span>HIGH</span></div></div>}
              {hasCJIC && <div className={hasAgency ? 'area-legend' : ''}><div className="heat-legend-heading"><span>CJIC {effectiveMetric === 'combined' ? 'SELECTED' : effectiveMetric === 'crime' ? 'CRIME' : 'VICTIM'} ROWS / SQ KM</span><b>LOG SCALE</b></div><div className="heat-legend-scale" /><div className="heat-legend-labels"><span>0</span><span>{densityLabel(densityScaleMidpoint(maximumDensity))}</span><span>{densityLabel(maximumDensity)}</span></div><small className="geography-note">Gray: no matching rows. Reporting boundaries, not incident points. {countyOnlyRows.toLocaleString()} county-only rows excluded from municipal heat.</small></div>}
            </>}
          </div>}
        </div>
        {!comparisonMode && <div className="map-bottomline"><span><i className="map-dot" />{loading ? 'LOADING RECORDS' : `${visibleRemote.length.toLocaleString()} POINTS / ${(local?.total || 0).toLocaleString()} CJIC ROWS`}</span></div>}
        {!comparisonMode && errors.length > 0 && <div className="map-error" role="alert"><ShieldAlert size={20} /><div><strong>Some source data is unavailable</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div><button className="icon-button" title="Retry unavailable sources" aria-label="Retry unavailable sources" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} /></button></div>}
      </section>

      <section className="records-panel"><div className="workspace-tabs" role="tablist" aria-label="Workspace view"><button role="tab" id="records-tab" aria-selected={!comparisonMode} aria-controls="records-view" onClick={() => { setComparisonMode(false); setComparison(null); setSelectedAreaKey(null); }}>Records</button><button role="tab" id="comparison-tab" aria-selected={comparisonMode} aria-controls="comparison-view" onClick={() => { if (!comparisonMode) openComparison(); }}>Compare &amp; analyze</button></div>{comparisonMode ? <div className="comparison-view" id="comparison-view" role="tabpanel" aria-labelledby="comparison-tab">{manifest ? <CJICComparison manifest={manifest} initialScope={comparisonScope} onMapChange={setComparison} onSelectArea={selectArea} selectedAreaKey={selectedAreaKey} /> : <p className="list-message" role="status">{manifestError || 'Loading CJIC metadata…'}</p>}</div> : <div className="records-view" id="records-view" role="tabpanel" aria-labelledby="records-tab"><div className="records-header"><div><small>PUBLIC RECORDS</small><h2>Crime &amp; victims</h2></div><div className="records-actions"><span className="record-count" aria-label={`${incidents.length} visible loaded records`}>{incidents.length.toLocaleString()} loaded</span><select aria-label="Sort public records" value={recordSort} onChange={(event) => setRecordSort(event.target.value as RecordSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="offense-asc">Offense: A–Z</option><option value="offense-desc">Offense: Z–A</option><option value="location-asc">Location: A–Z</option><option value="location-desc">Location: Z–A</option><option value="source-asc">Source: A–Z</option><option value="source-desc">Source: Z–A</option></select></div></div><div className="search-box"><Search size={15} /><input aria-label="Search records" placeholder="Search records..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="record-filter"><select aria-label="Choose a public-record field to filter" value={recordFilterField} onChange={(event) => { setRecordFilterField(event.target.value); setRecordFilter(''); }}><option value="any">Any record detail</option><option value="offense">Offense</option><option value="location">Location</option><option value="source">Source</option>{recordFilterFields.length > 0 && <optgroup label="Source fields">{recordFilterFields.map((field) => <option value={`field:${field}`} key={field}>{recordFieldLabel(field)}</option>)}</optgroup>}</select><select aria-label="Choose a public-record value to filter" value={recordFilter} onChange={(event) => setRecordFilter(event.target.value)} disabled={recordFilterValues.length === 0}><option value="">All values</option>{recordFilterValues.map((value) => <option value={value} key={value}>{value === 'group:homicide' ? 'Homicide / Murder (related offenses)' : value}</option>)}</select></div><div className="record-scope">Showing {incidents.length.toLocaleString()} of {loadedCount.toLocaleString()} loaded records{recordFilter ? ' after dropdown filter' : ''}. {total.toLocaleString()} source rows match the main filters. Sorting and dropdown values use loaded records.{search && ' Agency search uses loaded records; CJIC search covers all matching rows.'}</div>
        {selectedArea && <div className="selected-card"><div className="selected-eyebrow">CJIC REPORTING AREA<button className="icon-button" aria-label="Close area details" title="Close area details" onClick={() => setSelectedAreaKey(null)}><X size={13} /></button></div><strong>{selectedArea.city}, {selectedArea.county}</strong><p>{sources.includes('cjic-crime') ? `${selectedArea.crime.toLocaleString()} crime rows` : 'Crime source not selected'} / {sources.includes('cjic-victim') ? `${selectedArea.victims.toLocaleString()} victim rows` : 'Victim source not selected'}</p><p>{selectedArea.geographyLabel}</p><p>{selectedArea.precision === 'county' ? `No verified municipal boundary. Original reporting labels: ${selectedArea.reportingLabels.join(', ')}. These rows do not contribute to municipal heat.` : `${densityLabel(reportingDensity(selectedArea, effectiveMetric)!)} ${effectiveMetric === 'combined' ? 'selected' : effectiveMetric === 'crime' ? 'crime' : 'victim'} rows per sq km / ${densityLabel(selectedArea.areaKm2)} sq km. Locations within the boundary are unknown.`}</p><dl className="record-fields">{Object.entries(selectedArea.races).map(([race, count]) => <div key={race}><dt>{race}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl><p>{sources.includes('cjic-victim') ? 'Race counts represent matching victim rows.' : 'Race counts represent crime rows with linked victims; a row can have multiple victim races.'}</p><button className="compare-area-button" onClick={openComparison}>Compare this reporting area</button></div>}
        {selected && <div className="selected-card"><div className="selected-eyebrow">{DATA_SOURCES.find((entry) => entry.id === selected.source)?.shortLabel} RECORD<button className="icon-button" aria-label="Close record details" title="Close record details" onClick={() => setSelectedId(null)}><X size={13} /></button></div><strong>{selected.description}</strong><p>{selected.neighborhood || selected.intersection || 'Location unavailable'}{selected.county ? `, ${selected.county}` : ''} / {recordDate(selected)}</p>{isCJIC(selected.source) && <p>{selected.locationPrecision === 'county' ? 'County-only location.' : 'City / township reporting area.'} Exact incident coordinates are absent from the CSV.</p>}{selected.source === 'cjic-crime' && <p>Linked victim races: {selected.victimRaces?.join(', ') || 'No linked victim record'}</p>}<dl className="record-fields" aria-label="Record details">{Object.entries(selected.fields).map(([field, value]) => <div key={field}><dt>{recordFieldLabel(field)}</dt><dd>{value === '' || value === null ? <span className="missing-value">Not reported</span> : String(value)}</dd></div>)}</dl>{isCJIC(selected.source) && <a className="small-link" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/data/michigan-cjic/${selected.source === 'cjic-crime' ? 'crime' : 'victim'}-live.csv`} download><Download size={13} />Original source CSV</a>}</div>}
        <RecordList incidents={incidents} selectedId={selectedId} onSelect={selectRecord} message={incidents.length ? undefined : loading ? 'Loading selected public records...' : !sources.length ? 'No data sources selected.' : hasRecentPeriod && hasCJIC ? 'CJIC has year-only dates. Select a year or all available years to see those records.' : races.includes('__none__') ? 'No races selected.' : 'No records match the selected filters.'} />
        {!loading && (remoteHasMore || localHasMore) && <button className="load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading...' : <>Load more source records ({Math.max(0, total - loadedCount).toLocaleString()} not loaded) <ArrowDown size={14} /></>}</button>}
        </div>}
      </section></div>

      <footer className="source-strip"><div><Database size={16} /><span><strong>{comparisonMode ? 'CJIC crime + victim comparison' : sources.map((source) => DATA_SOURCES.find((entry) => entry.id === source)?.label).join(' + ') || 'No selected sources'}.</strong> Agency heat uses published points. CJIC heat uses reporting-boundary row density, not exact locations or population-adjusted risk. Crime and victim datasets may overlap.</span></div><div className="source-links">{DATA_SOURCES.filter((entry) => comparisonMode ? isCJIC(entry.id) : sources.includes(entry.id)).map((entry) => <a href={entry.url} target="_blank" rel="noreferrer" key={entry.id}>{entry.shortLabel}<ExternalLink size={12} /></a>)}</div></footer>
    </main>
    <div className="resource-bar"><span><Radio size={15} /> OTHER LIVE SOURCES</span><a href="https://metrodetroitscanner.com/watch" target="_blank" rel="noreferrer">Public scanner <ArrowUpRight size={13} /></a><a href="https://www.broadcastify.com/listen/ctid/1276" target="_blank" rel="noreferrer">Macomb County feeds <ArrowUpRight size={13} /></a><span className="resource-note">Dispatch traffic is unverified and is not plotted as crime.</span></div>
  </div>;
}
