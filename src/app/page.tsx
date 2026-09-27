'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUpRight, Crosshair, Database, ExternalLink, Filter, Info, MapPin, Radio, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { CLEMIS_SOURCE, DETROIT_SOURCE, GROUP_COLORS, crimeGroup, formatDate, type CrimeSource, type Incident, type RegionalFocus } from '@/lib/crime';
import { fetchCategories, fetchIncidents } from '@/lib/arcgis-client';

const CrimeMap = dynamic(() => import('@/components/CrimeMap'), { ssr: false });
const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 2015 }, (_, index) => currentYear - index);

export default function Home() {
  const [source, setSource] = useState<CrimeSource>('clemis');
  const [regionalFocus, setRegionalFocus] = useState<RegionalFocus>('both');
  const [period, setPeriod] = useState('7d');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextOffset, setNextOffset] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const viewKey = `${source}|${period}|${category}|${refresh}`;
  const activeView = useRef(viewKey);
  activeView.current = viewKey;

  useEffect(() => {
    const controller = new AbortController();
    setCategories([]);
    fetchCategories(source, controller.signal).then((items) => {
      if (!controller.signal.aborted) setCategories(items);
    }).catch(() => {});
    return () => controller.abort();
  }, [source]);

  useEffect(() => {
    if (!['24h', '7d', '30d'].includes(period)) return;
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [period]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setIncidents([]);
    setTotal(null);
    setNextOffset(0);
    setSelectedId(null);
    fetchIncidents(source, period, category, 0, controller.signal)
      .then((data) => { setIncidents(data.incidents); setTotal(data.total); setNextOffset(data.nextOffset); setFetchedAt(data.fetchedAt); })
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'Data unavailable'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [source, period, category, refresh]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || (total !== null && nextOffset >= total)) return;
    const requestedView = activeView.current;
    setLoadingMore(true);
    try {
      const data = await fetchIncidents(source, period, category, nextOffset, new AbortController().signal);
      if (activeView.current !== requestedView) return;
      setIncidents((items) => [...items, ...data.incidents.filter((next) => !items.some((item) => item.id === next.id))]);
      setTotal(data.total);
      setNextOffset(data.nextOffset);
      setFetchedAt(data.fetchedAt);
    } catch (cause) { if (activeView.current === requestedView) setError(cause instanceof Error ? cause.message : 'Could not load more records'); }
    finally { setLoadingMore(false); }
  }, [loadingMore, loading, total, nextOffset, source, period, category]);

  const selected = incidents.find((item) => item.id === selectedId) ?? null;
  const visibleList = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? incidents.filter((item) => [item.category, item.description, item.neighborhood, item.intersection]
      .some((value) => value?.toLowerCase().includes(term))) : incidents;
  }, [incidents, search]);
  const groupCounts = useMemo(() => incidents.reduce((counts, item) => {
    const group = crimeGroup(item.category);
    counts[group] = (counts[group] || 0) + 1;
    return counts;
  }, {} as Record<string, number>), [incidents]);

  return <div className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">◆</span><div><strong>INFRINGE</strong><small>METRO DETROIT CRIME ATLAS</small></div></div>
      <div className="topbar-center"><span className="pulse" /> PUBLIC RECORDS <span className="topbar-divider">/</span> METRO DETROIT, MICHIGAN</div>
      <div className="topbar-actions"><span className="clock-label">{fetchedAt ? `FETCHED ${new Date(fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'AWAITING DATA'}</span><button className="icon-button" title="Refresh data" aria-label="Refresh data" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={16} /></button></div>
    </header>

    <aside className="sidebar">
      <div className="side-heading"><span>EXPLORER</span><Filter size={15} /></div>
      <div className="intro-card"><div className="eyebrow"><Activity size={13} /> DATA VIEW / 01</div><h1>Reported crime,<br /><em>on the map.</em></h1><p>Explore where reported offenses concentrate by time, category, and agency coverage.</p></div>

      <section className="filter-section"><div className="section-label"><span>01</span> DATA SOURCE</div><label className="field-label" htmlFor="source">Coverage</label><select id="source" value={source} onChange={(event) => { setCategory(''); if (event.target.value === 'clemis' && /^\d{4}$/.test(period) && Number(period) < 2026) setPeriod('7d'); setRegionalFocus('both'); setSource(event.target.value as CrimeSource); }}><option value="clemis">Oakland + Macomb · CLEMIS</option><option value="detroit">Detroit Police · city</option></select><p className="field-note">{source === 'clemis' ? 'Map area spans both counties. Records come from participating agencies only; some departments do not publish here. This public layer currently starts in 2026.' : 'Detroit Police reports from December 2016 onward.'}</p>{source === 'clemis' && <><label className="field-label focus-label" htmlFor="regional-focus">Map focus</label><select id="regional-focus" value={regionalFocus} onChange={(event) => setRegionalFocus(event.target.value as RegionalFocus)}><option value="both">Both counties · full area</option><option value="oakland">Oakland County</option><option value="macomb">Macomb County</option></select><p className="field-note">Map focus changes the view. Counts and records still use the full regional area.</p></>}</section>

      <section className="filter-section"><div className="section-label"><span>02</span> TIME PERIOD</div><label className="field-label" htmlFor="period">Incident occurred</label><select id="period" value={period} onChange={(event) => setPeriod(event.target.value)}>
        <option value="24h">Past 24 hours</option><option value="7d">Past 7 days</option><option value="30d">Past 30 days</option>
        <optgroup label="By year">{years.filter((year) => source === 'detroit' || year >= 2026).map((year) => <option value={year} key={year}>{year}</option>)}</optgroup>
      </select><p className="field-note">Recent periods refresh every 5 minutes. Records appear as participating agencies publish them.</p></section>

      <section className="filter-section"><div className="section-label"><span>03</span> OFFENSE</div><label className="field-label" htmlFor="category">Crime category</label><select id="category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((name) => <option value={name} key={name}>{name}</option>)}</select><p className="field-note">The heatmap reflects loaded records. Load more to include additional matches.</p></section>

      <section className="filter-section"><div className="section-label"><span>04</span> DEMOGRAPHICS</div><label className="field-label" htmlFor="race">Person race</label><select id="race" disabled value="unavailable" onChange={() => {}}><option value="unavailable">Unavailable in this source</option></select><div className="notice"><Info size={15} /><span>Neither mapped public layer includes victim, suspect, or arrestee race. Michigan&apos;s MICR program records race separately, but it cannot be assigned to these map points.</span></div><a className="small-link" href="https://www.michigan.gov/msp/divisions/cjic/dashboard-portal" target="_blank" rel="noreferrer">Explore Michigan crime dashboard <ArrowUpRight size={13} /></a></section>

      <div className="sidebar-bottom"><div className="section-label"><span>05</span> COVERAGE</div><div className="coverage-active"><span className="pulse" /> {source === 'detroit' ? 'DETROIT CITY' : 'OAKLAND + MACOMB AREA'} <b>CONNECTED</b></div><a href="https://gis.macombgov.org/GO/Sheriff_Site" target="_blank" rel="noreferrer">Macomb County Sheriff map <ArrowUpRight size={13} /></a><a href={CLEMIS_SOURCE} target="_blank" rel="noreferrer">CLEMIS public crime search <ArrowUpRight size={13} /></a><p>{source === 'clemis' ? 'Gaps on the map may reflect agencies that do not publish to this public CLEMIS layer.' : 'Switch the data source above to map participating regional departments.'}</p></div>
    </aside>

    <main className="main">
      <div className="stats-row"><div className="stat"><small>MATCHING RECORDS</small><strong>{loading ? '—' : total?.toLocaleString() ?? '—'}</strong><span>reported offenses</span></div><div className="stat"><small>LOADED RECORDS</small><strong>{loading ? '—' : incidents.length.toLocaleString()}</strong><span>{total !== null && nextOffset < total ? 'load more below' : 'records loaded'}</span></div><div className="stat"><small>OFFENSE GROUPS</small><strong>{loading ? '—' : Object.keys(groupCounts).length}</strong><span>in loaded records</span></div><div className="stat source-stat"><small>PRIMARY SOURCE</small><strong>{source === 'detroit' ? 'DPD RMS' : 'CLEMIS'}</strong><span>public agency data</span></div></div>

      <div className="workspace"><section className="map-panel"><CrimeMap incidents={incidents} selectedId={selectedId} onSelect={setSelectedId} resetSignal={resetSignal} source={source} regionalFocus={regionalFocus} /><div className="map-topline"><span><Activity size={13} /> {source === 'detroit' ? 'DETROIT' : regionalFocus === 'oakland' ? 'OAKLAND COUNTY' : regionalFocus === 'macomb' ? 'MACOMB COUNTY' : 'OAKLAND + MACOMB'} DENSITY MAP</span><button onClick={() => setResetSignal((value) => value + 1)}><Crosshair size={14} /> Reset view</button></div><div className="heat-legend" role="img" aria-label="Relative incident concentration: teal is lower, amber is moderate, coral is higher"><div className="heat-legend-heading"><span>INCIDENT CONCENTRATION</span><b>RELATIVE</b></div><div className="heat-legend-scale" /><div className="heat-legend-labels"><span>LOW</span><span>MODERATE</span><span>HIGH</span></div></div><div className="map-bottomline"><span><i className="map-dot" /> {loading ? 'LOADING RECORDS' : error ? 'SOURCE ERROR' : `${incidents.length.toLocaleString()} OFFENSES LOADED`}</span><span>LOCATIONS MAY BE APPROXIMATE</span></div>{error && <div className="map-error"><ShieldAlert size={20} /><div><strong>Could not load incident data</strong><span>{error}</span></div><button onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}</section>

      <section className="records-panel"><div className="records-header"><div><small>INCIDENT STREAM</small><h2>Reported offenses</h2></div><span className="record-count">{incidents.length}</span></div><div className="search-box"><Search size={15} /><input aria-label="Search loaded records" placeholder="Search loaded records..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="record-scope">{search ? `Searching ${incidents.length.toLocaleString()} loaded records` : `Newest first · ${source === 'detroit' ? 'Detroit city' : 'Oakland + Macomb area'}`}</div>
        {selected && <div className="selected-card"><div className="selected-eyebrow">SELECTED INCIDENT <span onClick={() => setSelectedId(null)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelectedId(null); }}>×</span></div><strong>{selected.description}</strong><p>{selected.neighborhood || selected.intersection || (source === 'detroit' ? 'Detroit' : 'Metro Detroit')} · {formatDate(selected.occurredAt)}</p><div>{selected.category}{selected.precinct ? ` · Precinct ${selected.precinct}` : ''}</div></div>}
        <div className="record-list">{loading && <div className="list-message">Loading {source === 'detroit' ? 'Detroit' : 'regional'} public records…</div>}{!loading && !error && visibleList.length === 0 && <div className="list-message">No records match this view. Try a different period or category.</div>}{visibleList.map((item) => <button className={`record ${selectedId === item.id ? 'active' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><span className="record-accent" style={{ background: GROUP_COLORS[crimeGroup(item.category)] }} /><span className="record-body"><span className="record-category">{item.category}</span><strong>{item.description}</strong><span className="record-meta"><MapPin size={11} /> {item.neighborhood || item.intersection || (source === 'detroit' ? 'Detroit' : 'Metro Detroit')} <span>·</span> {formatDate(item.occurredAt)}</span></span><ArrowUpRight size={14} className="record-arrow" /></button>)}</div>
        {!loading && !search && total !== null && nextOffset < total && <button className="load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : <>Load more records <ArrowDown size={14} /></>}</button>}
      </section></div>

      <footer className="source-strip"><div><Database size={16} /><span><strong>Source: {source === 'detroit' ? 'Detroit Police Department RMS Crime Incidents' : 'CLEMIS Public Crime Search Offenses'}.</strong> One row is one offense; an incident can have several offenses. Data is preliminary and may change.</span></div><a href={source === 'detroit' ? DETROIT_SOURCE : CLEMIS_SOURCE} target="_blank" rel="noreferrer">VIEW SOURCE <ExternalLink size={13} /></a></footer>
    </main>

    <div className="resource-bar"><span><Radio size={15} /> OTHER LIVE SOURCES</span><a href="https://metrodetroitscanner.com/watch" target="_blank" rel="noreferrer">Listen to public scanner <ArrowUpRight size={13} /></a><a href="https://www.broadcastify.com/listen/ctid/1276" target="_blank" rel="noreferrer">Macomb County feeds <ArrowUpRight size={13} /></a><span className="resource-note">Dispatch traffic is unverified and is not plotted as crime.</span></div>
  </div>;
}
