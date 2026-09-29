'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUpRight, ChevronDown, Crosshair, Database, Download, ExternalLink, Filter, Info, Radio, RefreshCw, Search, ShieldAlert, X } from 'lucide-react';
import { CJIC_SOURCE, CLEMIS_SOURCE, DATA_SOURCES, crimeGroup, isCJIC, recordDate, type CJICManifest, type CJICResponse, type CrimeSource, type IncidentResponse, type RegionalFocus, type RemoteSource } from '@/lib/crime';
import { fetchCategories, fetchIncidents } from '@/lib/arcgis-client';
import { fetchCJIC, fetchCJICManifest } from '@/lib/cjic-client';
import RecordList from '@/components/RecordList';
import { densityScaleMidpoint, reportingDensity, reportingDensityMaximum } from '@/lib/map-density';

const CrimeMap = dynamic(() => import('@/components/CrimeMap'), { ssr: false });
const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 2015 }, (_, index) => currentYear - index);
type RemoteState = { data: IncidentResponse | null; loading: boolean; error: string | null };

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
  const [mobileFilters, setMobileFilters] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const sourceKey = sources.join('|');
  const raceKey = races.join('|');
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
    if (!['24h', '7d', '30d'].includes(period)) return;
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [period]);

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

  const categories = useMemo(() => [...new Set([
    ...remoteCategories, ...sources.filter(isCJIC).flatMap((source) => manifest?.sources[source].categories || []),
  ])].sort(), [remoteCategories, sourceKey, manifest]);
  const remoteIncidents = useMemo(() => Object.values(remote).flatMap((state) => state?.data?.incidents || []), [remote]);
  const visibleRemote = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return term ? remoteIncidents.filter((item) => Object.values(item.fields).some((value) => String(value ?? '').toLowerCase().includes(term))) : remoteIncidents;
  }, [remoteIncidents, debouncedSearch]);
  const incidents = useMemo(() => [...visibleRemote, ...(local?.incidents || [])].sort((a, b) =>
    (b.occurredAt ?? Date.UTC(b.year || 0, 0, 1)) - (a.occurredAt ?? Date.UTC(a.year || 0, 0, 1))), [visibleRemote, local]);
  const loading = localLoading || Object.values(remote).some((state) => state?.loading);
  const remoteHasMore = Object.values(remote).some((state) => state?.data && (state.data.total === null ? state.data.incidents.length > 0 : state.data.nextOffset < state.data.total));
  const localHasMore = local !== null && local.nextOffset < local.total;
  const total = (local?.total || 0) + (debouncedSearch ? visibleRemote.length : Object.values(remote).reduce((sum, state) => sum + (state?.data?.total || 0), 0));
  const errors = [...Object.entries(remote).flatMap(([source, state]) => state?.error ? [`${DATA_SOURCES.find((entry) => entry.id === source)?.label}: ${state.error}`] : []), ...(localError ? [`CJIC: ${localError}`] : [])];
  const selected = incidents.find((item) => item.id === selectedId) ?? null;
  const selectedArea = local?.areas.find((area) => area.key === selectedAreaKey) ?? null;
  const maximumDensity = reportingDensityMaximum(local?.areas || []);
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

  function toggleSource(source: CrimeSource) {
    const next = DATA_SOURCES.filter((entry) => sources.includes(entry.id) !== (entry.id === source)).map((entry) => entry.id);
    setSources(next);
    setCategory('');
    if (!next.some(isCJIC)) setRaces([]);
  }
  function selectRecord(id: string) { setSelectedAreaKey(null); setSelectedId(id); }
  function selectArea(key: string) { setSelectedId(null); setSelectedAreaKey(key); }
  const hasRecentPeriod = ['24h', '7d', '30d'].includes(period);
  const sourceStatus = (source: CrimeSource) => {
    if (!sources.includes(source)) return '';
    if (!isCJIC(source) && races.length) return 'No race field';
    if (isCJIC(source)) return localLoading ? 'Loading...' : localError ? 'Unavailable' : `${(local?.sourceCounts[source] || 0).toLocaleString()} rows`;
    return remote[source]?.loading ? 'Loading...' : remote[source]?.error ? 'Unavailable' : `${(remote[source]?.data?.total || 0).toLocaleString()} rows`;
  };

  return <div className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">◆</span><div><strong>INFRINGE</strong><small>METRO DETROIT CRIME ATLAS</small></div></div>
      <div className="topbar-center"><span className="pulse" /> PUBLIC RECORDS <span className="topbar-divider">/</span> METRO DETROIT, MICHIGAN</div>
      <div className="topbar-actions"><span className="clock-label">{fetchedAt ? `FETCHED ${new Date(fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'AWAITING DATA'}</span><button className="icon-button mobile-filter-toggle" title={mobileFilters ? 'Close filters' : 'Open filters'} aria-label={mobileFilters ? 'Close filters' : 'Open filters'} aria-expanded={mobileFilters} aria-controls="data-filters" onClick={() => setMobileFilters((value) => !value)}>{mobileFilters ? <X size={16} /> : <Filter size={16} />}</button><button className="icon-button" title="Refresh data" aria-label="Refresh data" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={16} /></button></div>
    </header>

    <aside className={`sidebar ${mobileFilters ? 'filters-open' : ''}`} id="data-filters">
      <div className="side-heading"><span>EXPLORER</span><Filter size={15} /></div>
      <section className="filter-section"><div className="section-label"><span>01</span> DATA SOURCES</div>
        <fieldset className="checkbox-group"><legend className="field-label">Coverage</legend><SelectAll label="All data sources" checked={sources.length === DATA_SOURCES.length} mixed={sources.length > 0 && sources.length < DATA_SOURCES.length} onChange={() => { const next = sources.length === DATA_SOURCES.length ? [] : DATA_SOURCES.map((entry) => entry.id); setSources(next); setCategory(''); if (!next.length) setRaces([]); }} />
          {DATA_SOURCES.map((entry) => <label className="source-option" key={entry.id}><input type="checkbox" checked={sources.includes(entry.id)} onChange={() => toggleSource(entry.id)} /><span className="source-option-body"><strong><i style={{ background: entry.color }} />{entry.label}</strong><small>{entry.coverage}</small>{sources.includes(entry.id) && <small className="source-status">{sourceStatus(entry.id)}</small>}</span></label>)}
        </fieldset>
        <label className="field-label focus-label" htmlFor="regional-focus">Map focus</label><select id="regional-focus" value={regionalFocus} onChange={(event) => setRegionalFocus(event.target.value as RegionalFocus)}><option value="both">Full selected coverage</option><option value="oakland">Oakland County</option><option value="macomb">Macomb County</option></select>
      </section>

      <section className="filter-section"><div className="section-label"><span>02</span> TIME PERIOD</div><label className="field-label" htmlFor="period">Reporting period</label><select id="period" value={period} onChange={(event) => setPeriod(event.target.value)}>
        <option value="all">All available years</option><option value="24h">Past 24 hours</option><option value="7d">Past 7 days</option><option value="30d">Past 30 days</option><optgroup label="By year">{years.map((year) => <option value={year} key={year}>{year}</option>)}</optgroup>
      </select>{hasCJIC && <p className="field-note">CJIC snapshot: 2021 through June 30, 2026. CSV dates have year precision.{hasRecentPeriod ? ' CJIC has no day-level dates for this recent-period filter.' : ''}</p>}{!hasCJIC && <p className="field-note">CLEMIS regional history starts in 2026; Detroit history starts in December 2016.</p>}</section>

      <section className="filter-section"><div className="section-label"><span>03</span> OFFENSE</div><label className="field-label" htmlFor="category">Crime category</label><select id="category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((name) => <option value={name} key={name}>{name}</option>)}</select></section>

      <section className="filter-section"><div className="section-label"><span>04</span> VICTIM RACE</div><fieldset className="checkbox-group" disabled={!hasCJIC || !manifest}><legend className="field-label">Reported victim race</legend>
        <SelectAll label="All races" checked={races.length === 0} mixed={races.some((race) => race !== '__none__')} onChange={() => setRaces(races.length === 0 ? ['__none__'] : [])} />
        {(manifest?.races || []).map((race) => <label className="race-option" key={race}><input type="checkbox" checked={races.length === 0 || races.includes(race)} onChange={() => {
          const current = races.length ? races.filter((race) => race !== '__none__') : manifest!.races;
          const next = current.includes(race) ? current.filter((value) => value !== race) : [...current, race];
          setRaces(next.length === manifest!.races.length ? [] : next.length ? next : ['__none__']);
        }} /><span>{race}</span></label>)}
      </fieldset><div className="notice"><Info size={15} /><span>Race describes victims. CJIC crime rows use victim records with matching incident and offense IDs. {races.length ? 'Sources without race data are excluded from this race-filtered view.' : 'CLEMIS and Detroit do not publish race in their mapped layers.'}</span></div>{manifestError && <p className="source-warning">{manifestError}</p>}</section>

      <div className="sidebar-bottom"><div className="section-label"><span>05</span> COVERAGE</div><div className="coverage-active"><span className="pulse" />{sources.length} SOURCES SELECTED</div><a href={CJIC_SOURCE} target="_blank" rel="noreferrer">Michigan CJIC dashboard <ArrowUpRight size={13} /></a><a href={CLEMIS_SOURCE} target="_blank" rel="noreferrer">CLEMIS public crime search <ArrowUpRight size={13} /></a><p>Agency datasets can overlap. Crime rows and victim rows are distinct records, not a combined count of unique crimes.</p></div>
    </aside>

    <main className="main">
      <div className="stats-row"><div className="stat"><small>MATCHING ROWS</small><strong>{loading ? '...' : total.toLocaleString()}</strong><span>{errors.length ? 'partial source results' : 'selected sources / current filters'}</span></div><div className="stat"><small>AGENCY MAP POINTS</small><strong>{visibleRemote.length.toLocaleString()}</strong><span>loaded CLEMIS / Detroit records</span></div><div className="stat"><small>CJIC MAP ROWS</small><strong>{localLoading ? '...' : (local?.total || 0).toLocaleString()}</strong><span>{local?.areas.length || 0} reporting areas / all matches</span></div><div className="stat source-stat"><small>OFFENSE GROUPS</small><strong>{Object.keys(groupCounts).length}</strong><span>{sources.length} selected data sources</span></div></div>
      <div className="workspace"><section className="map-panel"><CrimeMap incidents={incidents} selectedId={selectedId} selectedAreaKey={selectedAreaKey} onSelect={selectRecord} resetSignal={resetSignal} sources={sources} areas={local?.areas || []} onSelectArea={selectArea} regionalFocus={regionalFocus} /><div className="map-topline"><span><Activity size={13} />{regionalFocus === 'oakland' ? 'OAKLAND COUNTY' : regionalFocus === 'macomb' ? 'MACOMB COUNTY' : 'METRO DETROIT'}</span><button className="reset-view" title="Reset map view" aria-label="Reset map view" onClick={() => setResetSignal((value) => value + 1)}><Crosshair size={14} /></button></div>
        <div className="heat-legend"><button className="heat-legend-toggle" type="button" aria-expanded={legendOpen} aria-label={legendOpen ? 'Hide map legend' : 'Show map legend'} onClick={() => setLegendOpen((open) => !open)}><span>MAP LEGEND</span><ChevronDown size={13} /></button>{legendOpen && <div className="heat-legend-content">{(hasAgency || !hasCJIC) && <div><div className="heat-legend-heading"><span>AGENCY INCIDENTS</span><b>RELATIVE</b></div><div className="heat-legend-scale" /><div className="heat-legend-labels"><span>LOW</span><span>MODERATE</span><span>HIGH</span></div></div>}{hasCJIC && <div className={hasAgency ? 'area-legend' : ''}><div className="heat-legend-heading"><span>CJIC ROWS / SQ KM</span><b>LOG SCALE</b></div><div className="heat-legend-scale" /><div className="heat-legend-labels"><span>0</span><span>{densityLabel(densityScaleMidpoint(maximumDensity))}</span><span>{densityLabel(maximumDensity)}</span></div><small className="geography-note">Reporting boundaries, not incident points. {countyOnlyRows.toLocaleString()} county-only rows excluded from municipal heat.</small></div>}</div>}</div>
        <div className="map-bottomline"><span><i className="map-dot" />{loading ? 'LOADING RECORDS' : `${visibleRemote.length.toLocaleString()} POINTS / ${(local?.total || 0).toLocaleString()} CJIC ROWS`}</span></div>
        {errors.length > 0 && <div className="map-error" role="alert"><ShieldAlert size={20} /><div><strong>Some source data is unavailable</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div><button className="icon-button" title="Retry unavailable sources" aria-label="Retry unavailable sources" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} /></button></div>}
      </section>

      <section className="records-panel"><div className="records-header"><div><small>PUBLIC RECORDS</small><h2>Crime &amp; victims</h2></div><span className="record-count">{incidents.length.toLocaleString()}</span></div><div className="search-box"><Search size={15} /><input aria-label="Search records" placeholder="Search records..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="record-scope">{search ? 'CJIC: all rows / agency data: loaded points' : 'Newest period first / source shown on each row'}</div>
        {selectedArea && <div className="selected-card"><div className="selected-eyebrow">CJIC REPORTING AREA<button className="icon-button" aria-label="Close area details" title="Close area details" onClick={() => setSelectedAreaKey(null)}><X size={13} /></button></div><strong>{selectedArea.city}, {selectedArea.county}</strong><p>{selectedArea.crime.toLocaleString()} crime rows / {selectedArea.victims.toLocaleString()} victim rows</p><p>{selectedArea.geographyLabel}</p><p>{selectedArea.precision === 'county' ? `No verified municipal boundary. Original reporting labels: ${selectedArea.reportingLabels.join(', ')}. These rows do not contribute to municipal heat.` : `${densityLabel(reportingDensity(selectedArea)!)} rows per sq km / ${densityLabel(selectedArea.areaKm2)} sq km. Locations within the boundary are unknown.`}</p><dl className="record-fields">{Object.entries(selectedArea.races).map(([race, count]) => <div key={race}><dt>{race}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl><p>{sources.includes('cjic-victim') ? 'Race counts represent matching victim rows.' : 'Race counts represent crime rows with linked victims; a row can have multiple victim races.'}</p></div>}
        {selected && <div className="selected-card"><div className="selected-eyebrow">{DATA_SOURCES.find((entry) => entry.id === selected.source)?.shortLabel} RECORD<button className="icon-button" aria-label="Close record details" title="Close record details" onClick={() => setSelectedId(null)}><X size={13} /></button></div><strong>{selected.description}</strong><p>{selected.neighborhood || selected.intersection || 'Location unavailable'}{selected.county ? `, ${selected.county}` : ''} / {recordDate(selected)}</p>{isCJIC(selected.source) && <p>{selected.locationPrecision === 'county' ? 'County-only location.' : 'City / township reporting area.'} Exact incident coordinates are absent from the CSV.</p>}{selected.source === 'cjic-crime' && <p>Linked victim races: {selected.victimRaces?.join(', ') || 'No linked victim record'}</p>}<dl className="record-fields" aria-label="All source fields">{Object.entries(selected.fields).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value === '' || value === null ? <span className="missing-value">Not reported</span> : String(value)}</dd></div>)}</dl>{isCJIC(selected.source) && <a className="small-link" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/data/michigan-cjic/${selected.source === 'cjic-crime' ? 'crime' : 'victim'}-live.csv`} download><Download size={13} />Original source CSV</a>}</div>}
        <RecordList incidents={incidents} selectedId={selectedId} onSelect={selectRecord} message={incidents.length ? undefined : loading ? 'Loading selected public records...' : !sources.length ? 'No data sources selected.' : hasRecentPeriod && hasCJIC ? 'CJIC has year-only dates. Select a year or all available years to see those records.' : races.includes('__none__') ? 'No races selected.' : 'No records match the selected filters.'} />
        {!loading && (remoteHasMore || localHasMore) && <button className="load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading...' : <>Load more records <ArrowDown size={14} /></>}</button>}
      </section></div>

      <footer className="source-strip"><div><Database size={16} /><span><strong>{sources.map((source) => DATA_SOURCES.find((entry) => entry.id === source)?.label).join(' + ') || 'No selected sources'}.</strong> Agency heat uses published points. CJIC heat uses reporting-boundary row density, not exact locations or population-adjusted risk. Crime and victim datasets may overlap.</span></div><div className="source-links">{DATA_SOURCES.filter((entry) => sources.includes(entry.id)).map((entry) => <a href={entry.url} target="_blank" rel="noreferrer" key={entry.id}>{entry.shortLabel}<ExternalLink size={12} /></a>)}</div></footer>
    </main>
    <div className="resource-bar"><span><Radio size={15} /> OTHER LIVE SOURCES</span><a href="https://metrodetroitscanner.com/watch" target="_blank" rel="noreferrer">Public scanner <ArrowUpRight size={13} /></a><a href="https://www.broadcastify.com/listen/ctid/1276" target="_blank" rel="noreferrer">Macomb County feeds <ArrowUpRight size={13} /></a><span className="resource-note">Dispatch traffic is unverified and is not plotted as crime.</span></div>
  </div>;
}
