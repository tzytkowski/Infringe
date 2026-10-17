'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChartPie, ListFilter, Grid3X3, ChartNoAxesCombined, ChartLine, CalendarRange, ArrowUpRight, Info, X } from 'lucide-react';
import { fetchIncidents } from '@/lib/arcgis-client';
import { fetchCJIC } from '@/lib/cjic-client';
import { DATA_SOURCES, isCJIC, isRemoteSource, type CrimeSource, type Incident, type CJICBreakdown } from '@/lib/crime';
import { filterNewsCases, type NewsFile } from '@/lib/news-client';
import { recordMatchesValue } from '@/lib/record-filter';
import { standardizeOffense } from '@/lib/offense-taxonomy.mjs';
import { buildRecordTrend, trendAxisLabel, trendCountAxis } from '@/lib/record-trend.mjs';
import { buildTimingGrid, trailingAverage } from '@/lib/chart-analysis.mjs';
import { CrimeMix, TimingPattern, VictimRace } from './AnalyticalViews';
import LoadingSpinner from './LoadingSpinner';
import './analytics.css';

type Props = { sources: CrimeSource[]; period: string; category: string; races: string[]; search: string; refresh: number; field: string; value: string; newsFile: NewsFile | null; newsError: string | null; onOffenseSelect: (category: string) => void; onUseVictims: () => void; onPeriodSelect: (period: string) => void };
type TrendRecord = { occurredAt: number | null; datePrecision?: string; count?: number };
type Result = { key: string; records: TrendRecord[]; annual: CJICBreakdown[]; offenses: Record<string, number>; victimRaces: Record<string, number>; error?: string; now: number };

export default function RecordTrend({ sources, period, category, races, search, refresh, field, value, newsFile, newsError, onOffenseSelect, onUseVictims, onPeriodSelect }: Props) {
  const [style, setStyle] = useState(0);
  const [showAverage, setShowAverage] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId();
  const container = useRef<HTMLElement>(null);
  const plotContainer = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [cardWidth, setCardWidth] = useState(1000);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setCardWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!plotContainer.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(plotContainer.current);
    return () => observer.disconnect();
  }, [style, result]);
  const key = JSON.stringify([sources, period, category, races, search, refresh, field, value]);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const now = Date.now();
    async function load() {
      if (sources.includes('news') && !newsFile && !newsError) return;
      if (sources.includes('news') && newsError) throw new Error(newsError);
      const offenses: Record<string, number> = {};
      const tallyOffense = (record: Incident) => {
        const offense = record.standardOffense || standardizeOffense(record.category, record.description);
        offenses[offense] = (offenses[offense] || 0) + 1;
      };
      const matches = (record: Incident) => recordMatchesValue({ ...record, standardOffense: record.standardOffense || standardizeOffense(record.category, record.description) }, field, value);
      const batches = await Promise.all((races.length ? [] : sources.filter(isRemoteSource)).map(async (source) => {
        let page = await fetchIncidents(source, period, category, search, 0, signal, undefined, true, now);
        // Retain hourly counts, not millions of source rows, across broad date ranges.
        const records = new Map<number | null, TrendRecord>();
        const seen = new Set<string>();
        const tally = (items: Incident[]) => items.forEach((record) => {
          if (seen.has(record.id)) return;
          seen.add(record.id);
          if (!matches(record)) return;
          tallyOffense(record);
          const hour = record.occurredAt === null ? null : Math.floor(record.occurredAt / 3_600_000) * 3_600_000;
          records.set(hour, { occurredAt: hour, count: (records.get(hour)?.count || 0) + 1 });
        });
        tally(page.incidents);
        while (page.total === null ? page.nextOffset - page.offset === page.limit : page.nextOffset < page.total) {
          const next = await fetchIncidents(source, period, category, search, page.nextOffset, signal, page.total, true, now);
          if (next.nextOffset <= page.nextOffset) {
            if (page.total === null) break;
            throw new Error('The source returned incomplete trend data. Refresh to retry.');
          }
          tally(next.incidents);
          page = next;
        }
        return [...records.values()];
      }));
      const selectedCJIC = sources.filter(isCJIC);
      const cjic = selectedCJIC.length ? await fetchCJIC({ sources: selectedCJIC, period, category, races, search, analysisOnly: true, limit: 0, recordFilterField: field, recordFilterValue: value }, signal) : null;
      const news = sources.includes('news') ? filterNewsCases(newsFile, period, category, races, search, now).filter(matches) : [];
      news.forEach(tallyOffense);
      for (const row of cjic?.analysis?.byOffense || []) {
        const name = standardizeOffense(row.key);
        offenses[name] = (offenses[name] || 0) + row.crime + row.victims;
      }
      const records = [...batches.flat(), ...news];
      if (!signal.aborted) setResult({ key, records, annual: cjic?.analysis?.byYear || [], offenses, victimRaces: cjic?.analysis?.victimRaces || {}, now });
    }
    load().catch((cause) => {
      if (!signal.aborted) setResult({ key, records: [], annual: [], offenses: {}, victimRaces: {}, now, error: cause instanceof Error ? cause.message : 'Analytics unavailable' });
    });
    return () => controller.abort();
    // The serialized key includes every query and record filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, newsFile, newsError]);
  const current = result?.key === key ? result : null;
  const trend = useMemo(() => buildRecordTrend(current?.records || [], period, current?.annual || [], current?.now), [current, period]);
  const points = trend.points;
  const averages = trailingAverage(points);
  const timing = useMemo(() => buildTimingGrid(current?.records || []), [current]);
  const { ceiling, ticks } = trendCountAxis(Math.max(0, ...points.map((point) => point.count)));
  const height = 210;
  const left = width < 500 ? 48 : 56, right = width - 16, top = 20, bottom = height - 36;
  const x = (index: number) => points.length === 1 ? (left + right) / 2 : left + index / (points.length - 1) * (right - left);
  const y = (count: number) => bottom - count / ceiling * (bottom - top);
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.count)}`).join(' ');
  const sourceLabel = sources.map((source) => DATA_SOURCES.find((entry) => entry.id === source)?.shortLabel).join(' + ');
  const periodLabel = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All available dates' }[period] || period;
  const message = !current ? 'Loading complete analytics…' : current.error ? `Analytics unavailable: ${current.error}` : style === 0 && !points.length ? 'No dated records match these filters.' : null;
  const activePoint = hovered === null ? null : points[hovered];
  const labelEvery = Math.max(1, Math.ceil((points.length - 1) / (width < 500 ? 3 : 6)));
  const icons = [ChartLine, ChartPie, ListFilter, Grid3X3];
  const victimTotal = Object.values(current?.victimRaces || {}).reduce((sum, count) => sum + count, 0);
  const annualCount = (current?.annual || []).reduce((sum, row) => sum + row.crime + row.victims, 0);
  const viewTotal = style === 1 ? victimTotal : style === 3 ? timing.total : trend.total;
  const viewUnit = style === 1 ? 'CJIC victim rows' : style === 3 ? 'entries with exact times' : 'matching entries';
  const title = ['Activity over time', 'Reported victim race', 'Major offense categories', 'Activity by day & hour'][style];
  const peak = points.reduce<(typeof points)[number] | null>((largest, point) => !largest || point.count > largest.count ? point : largest, null);
  const panelId = `${gradientId}-panel`;
  const aboutId = `${gradientId}-about`;
  const order = [0, 2, 1, 3];
  return <section ref={container} className="record-trend" id="data-overview" aria-label="Filtered record trend" aria-busy={!current}>
    <div className="overview-heading"><div className="overview-title"><ChartNoAxesCombined size={19} aria-hidden="true" /><h2>Data overview</h2><span className="overview-source" title={sourceLabel}>{sourceLabel || 'No sources'}</span></div><div className="overview-actions"><span className="overview-period">{periodLabel}</span></div>
    </div>
    <div className="overview-tabs" role="tablist" aria-label="Data views">{order.map((index) => { const Icon = icons[index]; return <button role="tab" id={`${gradientId}-tab-${index}`} aria-controls={panelId} aria-selected={style === index} tabIndex={style === index ? 0 : -1} key={index} type="button" onClick={() => { setStyle(index); setHovered(null); }} onKeyDown={(event) => { const at = order.indexOf(index); const next = event.key === 'ArrowRight' ? (at + 1) % order.length : event.key === 'ArrowLeft' ? (at + order.length - 1) % order.length : event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : -1; if (next >= 0) { event.preventDefault(); setStyle(order[next]); setHovered(null); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); } }}><Icon size={15} aria-hidden="true" /><span>{['Activity', 'Victim race', 'Offenses', 'Patterns'][index]}</span></button>; })}</div>
    <div className="overview-panel" id={panelId} role="tabpanel" aria-labelledby={`${gradientId}-tab-${style}`}>
    <div className="overview-metric"><div><h3>{title}</h3><div><strong>{current && !current.error && !(style === 1 && !sources.includes('cjic-victim')) ? viewTotal.toLocaleString() : '—'}</strong><span>{viewUnit}</span></div></div>{category && <button className="offense-filter-chip" type="button" onClick={() => onOffenseSelect('')} title="Clear offense filter">{category.replace('standard:', '')}<X size={12} /></button>}</div>
    <div className="overview-visual">
    {message ? <div className="analysis-loading" role="status">{!current && <LoadingSpinner />}<span>{message}</span></div> : style === 1 ? <VictimRace counts={current?.victimRaces || {}} available={sources.includes('cjic-victim')} onUseVictims={onUseVictims} /> : style === 2 ? <CrimeMix counts={current?.offenses || {}} onSelect={onOffenseSelect} /> : style === 3 ? <TimingPattern records={current?.records || []} annualCount={annualCount} compact={cardWidth < 620} /> : points.length === 1 && trend.unit === 'year' ? <div className="single-period-summary"><span><CalendarRange size={26} aria-hidden="true" /></span><div><strong>One year selected</strong><p>This source reports annual totals. Choose all years to see how activity changes over time.</p><button type="button" onClick={() => onPeriodSelect('all')}>View yearly trend <ArrowUpRight size={14} aria-hidden="true" /></button></div></div> : <div className="analysis-split activity-layout"><div className="activity-main"><div className="activity-toolbar"><span><i />Recorded entries</span><label className="trend-average-control"><input type="checkbox" checked={showAverage} disabled={points.length < 3} onChange={(event) => setShowAverage(event.target.checked)} /><i />3-{trend.unit} average</label></div><div className="trend-plot-wrap" ref={plotContainer}><svg className="trend-plot" viewBox={`0 0 ${width} ${height}`} role="img" tabIndex={0} onPointerMove={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); const at = (event.clientX - bounds.left) * width / bounds.width; setHovered(Math.max(0, Math.min(points.length - 1, Math.round((at - left) / (right - left) * (points.length - 1))))); }} onPointerLeave={() => setHovered(null)} onBlur={() => setHovered(null)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setHovered(Math.max(0, Math.min(points.length - 1, (hovered ?? 0) + (event.key === 'ArrowRight' ? 1 : -1)))); } }} aria-label={`Trend chart: ${trend.total.toLocaleString()} matching source entries by ${trend.unit}, Eastern time. Use arrow keys to inspect counts.`}>
      <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d9ad70" stopOpacity=".1" /><stop offset="100%" stopColor="#d9ad70" stopOpacity="0" /></linearGradient></defs>
      {ticks.map((tick) => <g key={tick}><line className={`trend-grid${tick === 0 ? ' baseline' : ''}`} x1={left} y1={y(tick)} x2={right} y2={y(tick)} /><text x={left - 12} y={y(tick) + 4} textAnchor="end">{tick.toLocaleString()}</text></g>)}
      <path fill={`url(#${gradientId})`} d={`${path} L${x(points.length - 1)},${bottom} L${x(0)},${bottom} Z`} />
      <path className="trend-line" d={path} />
      {showAverage && <path className="trend-average-line" d={averages.map((value, index) => value === null ? '' : `${index === 2 ? 'M' : 'L'}${x(index)},${y(value)}`).join(' ')} />}
      {points.map((point, index) => <g key={point.key}><circle className="trend-point" cx={x(index)} cy={y(point.count)} r={points.length > 40 ? 0 : 2.8}><title>{point.label}: {point.count.toLocaleString()} entries</title></circle>
        {(index === points.length - 1 || index % labelEvery === 0 && points.length - 1 - index > labelEvery * .5) && <text x={x(index)} y={height - 10} textAnchor={points.length === 1 ? 'middle' : index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{trendAxisLabel(point, trend.unit)}</text>}</g>)}
      {activePoint && hovered !== null && <g className="trend-crosshair"><line x1={x(hovered)} x2={x(hovered)} y1={top} y2={bottom} /><circle cx={x(hovered)} cy={y(activePoint.count)} r="5" /></g>}
    </svg>
    {style === 0 && activePoint && !message && hovered !== null && <div className="trend-tooltip" style={{ left: `${Math.max(24, Math.min(76, x(hovered) / width * 100))}%` }}><span>{activePoint.label}</span><strong>{activePoint.count.toLocaleString()} <small>entries</small></strong>{showAverage && averages[hovered] !== null && <span>Trailing average: {averages[hovered]?.toFixed(1)}</span>}</div>}
    </div></div><aside className="analysis-rail"><span className="rail-eyebrow">{activePoint ? 'SELECTED BUCKET' : 'PEAK ACTIVITY'}</span><strong className="rail-value">{(activePoint || peak)?.count.toLocaleString() || '0'}</strong><span className="rail-label">{(activePoint || peak)?.label || 'No dated entries'}</span><div className="rail-detail"><span>Mean bucket count</span><strong>{points.length ? ((trend.total - trend.undated) / points.length).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '0'}</strong></div><p>{points.length} {trend.unit} buckets{trend.unit === 'year' ? ' · Annual source precision' : ' · Eastern time'}. Edge buckets may be partial.</p></aside></div>}
    </div></div>
    <div className="overview-footer"><span><i />{current && !current.error ? style === 1 ? sources.includes('cjic-victim') ? 'CJIC victim rows · complete totals' : 'Victim race unavailable in this feed' : style === 3 ? 'Exact timestamps · Eastern time' : 'Complete matching dataset' : current?.error ? 'Source unavailable' : 'Loading selected sources'}</span><button type="button" popoverTarget={aboutId}><Info size={13} />About this data</button></div>
    <div id={aboutId} popover="auto" className="analytics-about"><strong>Reading these charts</strong><p>Source entries can overlap and are not a count of unique crimes or people. CJIC victim race describes victim rows, not suspects; percentages are not population-adjusted.</p><p>Agency times refer to incidents. Publisher article times refer to publication. CJIC annual rows and date-only reports are excluded from hourly patterns. Missing dates are excluded from the trend.</p><p>Moving averages use three trailing buckets and may include partial edge buckets. Partial periods, reporting delays, and source coverage affect comparisons.</p></div>
  </section>;
}
