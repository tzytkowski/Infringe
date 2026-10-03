'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Download, RefreshCw } from 'lucide-react';
import { fetchCJIC } from '@/lib/cjic-client';
import { comparisonAreas, comparisonCSV, mergeBreakdowns, percentChange, scopeLabel } from '@/lib/cjic-comparison';
import type { CJICManifest, CJICResponse, ComparisonMap } from '@/lib/crime';
import { STANDARD_OFFENSES } from '@/lib/offense-taxonomy.mjs';

type Cohort = { scope: string; period: string; category: string; race: string };
type Props = { manifest: CJICManifest; initialScope: string; onMapChange: (value: ComparisonMap | null) => void; onSelectArea: (key: string) => void; selectedAreaKey: string | null };
const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
function change(a: number, b: number, unequalDuration = false) {
  const percent = percentChange(a, b);
  const reason = unequalDuration ? 'periods differ' : a < 10 || b < 10 ? 'small counts' : percent === null ? 'no baseline' : `${percent > 0 ? '+' : ''}${number(percent)}%`;
  return `${b - a > 0 ? '+' : ''}${number(b - a)} / ${reason}`;
}

function CohortControls({ name, value, onChange, manifest }: { name: 'A' | 'B'; value: Cohort; onChange: (value: Cohort) => void; manifest: CJICManifest }) {
  const prefix = `compare-${name.toLowerCase()}`;
  const years = [...new Set(Object.values(manifest.sources).flatMap((source) => source.chunks.map((chunk) => chunk.year)))].sort((a, b) => b - a);
  const categories = [...new Set(Object.values(manifest.sources).flatMap((source) => source.categories))].sort();
  return <fieldset className={`cohort cohort-${name.toLowerCase()}`}><legend>COHORT {name}</legend>
    <label htmlFor={`${prefix}-scope`}>Place</label><select id={`${prefix}-scope`} value={value.scope} onChange={(e) => onChange({ ...value, scope: e.target.value })}>
      <option value="all">Oakland + Macomb</option>
      {['Oakland', 'Macomb'].map((county) => <optgroup label={`${county} County`} key={county}><option value={`county:${county}`}>{county} — all reporting places</option>{manifest.areas.filter((area) => area.county === county && area.precision === 'reporting-area').map((area) => <option key={area.key} value={area.key}>{area.city}</option>)}<option value={`${county}|__county__`}>County-only / unresolved locations</option></optgroup>)}
    </select>
    <label htmlFor={`${prefix}-period`}>Year</label><select id={`${prefix}-period`} value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value })}><option value="all">All available years</option>{years.map((year) => <option value={year} key={year}>{year}{year === Number(manifest.coverageEnd.slice(0, 4)) ? ' (through Jun 30)' : ''}</option>)}</select>
    <label htmlFor={`${prefix}-offense`}>Offense</label><select id={`${prefix}-offense`} value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })}><option value="">All offenses</option><optgroup label="Standardized categories">{STANDARD_OFFENSES.map((entry) => <option key={entry.id} value={`standard:${entry.id}`}>{entry.id}</option>)}</optgroup><optgroup label="Original source labels">{categories.map((category) => <option key={category} value={category}>{category}</option>)}</optgroup></select>
    <label htmlFor={`${prefix}-race`}>Victim race</label><select id={`${prefix}-race`} value={value.race} onChange={(e) => onChange({ ...value, race: e.target.value })}><option value="">All races</option>{manifest.races.map((race) => <option key={race}>{race}</option>)}</select>
  </fieldset>;
}

export default function CJICComparison({ manifest, initialScope, onMapChange, onSelectArea, selectedAreaKey }: Props) {
  const completeYears = [...new Set(manifest.sources['cjic-crime'].chunks.map((chunk) => chunk.year))].filter((year) => year < Number(manifest.coverageEnd.slice(0, 4))).sort((a, b) => b - a);
  const [a, setA] = useState<Cohort>({ scope: initialScope, period: String(completeYears[1] ?? completeYears[0]), category: '', race: '' });
  const [b, setB] = useState<Cohort>({ scope: initialScope, period: String(completeYears[0]), category: '', race: '' });
  const [result, setResult] = useState<{ a: CJICResponse; b: CJICResponse } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [metric, setMetric] = useState<'crime' | 'victims'>('crime');
  const [view, setView] = useState<'a' | 'b' | 'change'>('change');
  const [density, setDensity] = useState(false);
  const [breakdown, setBreakdown] = useState<'offenses' | 'years' | 'race' | 'age' | 'sex'>('offenses');
  const [areaSearch, setAreaSearch] = useState('');
  const [areaSort, setAreaSort] = useState<'name' | 'a' | 'b' | 'change'>('b');
  const aLabel = `${scopeLabel(manifest, a.scope)} · ${a.period === 'all' ? '2021–2026' : a.period}`;
  const bLabel = `${scopeLabel(manifest, b.scope)} · ${b.period === 'all' ? '2021–2026' : b.period}`;
  const configKey = JSON.stringify([a, b, manifest.version, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setResult(null);
    const query = (cohort: Cohort) => fetchCJIC({ sources: ['cjic-crime', 'cjic-victim'], period: cohort.period, scope: cohort.scope, category: cohort.category, races: cohort.race ? [cohort.race] : [], search: '', analysisOnly: true }, controller.signal);
    Promise.all([query(a), query(b)]).then(([left, right]) => { if (!controller.signal.aborted) setResult({ a: left, b: right }); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Comparison could not load.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [configKey]);
  useEffect(() => {
    onMapChange(result ? { ...result, aLabel, bLabel, metric, view, density } : null);
  }, [result, aLabel, bLabel, metric, view, density, onMapChange]);

  const areas = useMemo(() => result ? comparisonAreas(result.a, result.b) : [], [result]);
  const areaRows = useMemo(() => areas.filter(({ area }) => `${area.city} ${area.county}`.toLowerCase().includes(areaSearch.toLowerCase())).sort((left, right) => {
    const score = (entry: typeof left) => areaSort === 'a' ? entry.a?.[metric] ?? -1 : areaSort === 'b' ? entry.b?.[metric] ?? -1 : entry.a && entry.b ? Math.abs(entry.b[metric] - entry.a[metric]) : -1;
    return areaSort === 'name' ? left.area.city.localeCompare(right.area.city) : score(right) - score(left) || left.area.city.localeCompare(right.area.city);
  }), [areas, areaSearch, areaSort, metric]);
  const selected = areas.find(({ area }) => area.key === selectedAreaKey);
  const hasComparableAreas = areas.some(({ area, a, b }) => area.precision === 'reporting-area' && a && b);
  const dataRows = useMemo(() => {
    if (!result?.a.analysis || !result.b.analysis) return [];
    if (breakdown === 'offenses' || breakdown === 'years') return mergeBreakdowns(result.a.analysis[breakdown === 'offenses' ? 'byOffense' : 'byYear'], result.b.analysis[breakdown === 'offenses' ? 'byOffense' : 'byYear']);
    const field = breakdown === 'race' ? 'victimRaces' : breakdown === 'age' ? 'victimAges' : 'victimSex';
    const left = result.a.analysis[field], right = result.b.analysis[field];
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => ({ key, aCrime: 0, bCrime: 0, aVictims: left[key] ?? 0, bVictims: right[key] ?? 0 }));
  }, [result, breakdown]);
  const aCrime = result?.a.sourceCounts['cjic-crime'] ?? 0, bCrime = result?.b.sourceCounts['cjic-crime'] ?? 0;
  const aVictims = result?.a.sourceCounts['cjic-victim'] ?? 0, bVictims = result?.b.sourceCounts['cjic-victim'] ?? 0;
  const countyOnly = (response: CJICResponse) => response.areas.filter((area) => area.precision === 'county').reduce((total, area) => total + area.crime + area.victims, 0);
  const partial = [a.period, b.period].some((period) => period === 'all' || period === manifest.coverageEnd.slice(0, 4));
  const mixedPeriods = (a.period === 'all') !== (b.period === 'all');
  const unequalDuration = mixedPeriods || (a.period !== b.period && (a.period === manifest.coverageEnd.slice(0, 4) || b.period === manifest.coverageEnd.slice(0, 4)));
  const hasDemographic = ['race', 'age', 'sex'].includes(breakdown);
  const chartValue = (row: typeof dataRows[number], side: 'a' | 'b') => {
    const cohort = side === 'a' ? a : b;
    if (breakdown === 'years' && cohort.period !== 'all' && row.key !== cohort.period) return null;
    return side === 'a' ? hasDemographic || metric === 'victims' ? row.aVictims : row.aCrime : hasDemographic || metric === 'victims' ? row.bVictims : row.bCrime;
  };
  const chartRows = breakdown === 'years' ? dataRows : [...dataRows].sort((left, right) => Math.max(chartValue(right, 'a') ?? 0, chartValue(right, 'b') ?? 0) - Math.max(chartValue(left, 'a') ?? 0, chartValue(left, 'b') ?? 0));
  const chartMaximum = Math.max(1, ...chartRows.flatMap((row) => [chartValue(row, 'a') ?? 0, chartValue(row, 'b') ?? 0]));
  function buildExportCSV() {
    if (!result) return null;
    const configRows: (string | number | null)[][] = [['Cohort', 'Place', 'Year', 'Offense', 'Victim race'], ...[a, b].map((cohort, index) => [index ? 'B' : 'A', scopeLabel(manifest, cohort.scope), cohort.period, cohort.category === 'group:homicide' ? 'Homicide / Murder' : cohort.category || 'All offenses', cohort.race || 'All races']), [], ['Area', 'County', 'Boundary precision', 'A crime rows', 'B crime rows', 'Crime change', 'Crime change %', 'A victim rows', 'B victim rows', 'Victim change', 'Victim change %']];
    const rows = areas.map(({ area, a, b }) => [area.city, area.county, area.precision, a?.crime ?? null, b?.crime ?? null, a && b ? b.crime - a.crime : null, a && b && !unequalDuration && a.crime >= 10 && b.crime >= 10 ? percentChange(a.crime, b.crime) : null, a?.victims ?? null, b?.victims ?? null, a && b ? b.victims - a.victims : null, a && b && !unequalDuration && a.victims >= 10 && b.victims >= 10 ? percentChange(a.victims, b.victims) : null]);
    const breakdownRows = dataRows.map((row) => {
      const outsideA = breakdown === 'years' && a.period !== 'all' && row.key !== a.period;
      const outsideB = breakdown === 'years' && b.period !== 'all' && row.key !== b.period;
      return [row.key, hasDemographic || outsideA ? null : row.aCrime, hasDemographic || outsideB ? null : row.bCrime, outsideA ? null : row.aVictims, outsideB ? null : row.bVictims];
    });
    return comparisonCSV([...configRows, ...rows, [], [breakdown, 'A crime rows', 'B crime rows', 'A victim rows', 'B victim rows'], ...breakdownRows]);
  }
  const exportContent = useMemo(buildExportCSV, [result, configKey, breakdown, unequalDuration]);
  // These aggregate exports are small. A self-contained URL also works in
  // static deployments and embedded browsers without a blob download handler.
  const exportUrl = exportContent === null ? null : `data:text/csv;charset=utf-8,${encodeURIComponent(exportContent)}`;
  return <div className="comparison-panel">
    <div className="comparison-intro"><h2>CJIC comparison</h2><p>Compare two places, years, offenses or victim races. Both datasets are included; these controls are independent of the records filters.</p></div>
    <div className="cohort-controls"><CohortControls name="A" manifest={manifest} value={a} onChange={setA} /><CohortControls name="B" manifest={manifest} value={b} onChange={setB} /></div>
    <div className="comparison-actions"><button onClick={() => { setA(b); setB(a); }}><ArrowLeftRight size={14} />Swap A / B</button><button disabled={completeYears.length < 2} onClick={() => { setA({ ...a, period: String(completeYears[1]) }); setB({ ...a, period: String(completeYears[0]) }); }}>Compare last 2 full years</button><a href={exportUrl || undefined} download="cjic-comparison.csv" aria-disabled={!exportUrl}><Download size={14} />Export data</a></div>
    {exportContent !== null && <details className="comparison-csv"><summary>View / copy CSV</summary><textarea aria-label="Comparison CSV data" readOnly value={exportContent} /><small>Use this copy if your browser does not save the download.</small></details>}
    {partial && <p className="comparison-notice">The latest year ends {manifest.coverageEnd}. CJIC provides only the incident year, so matching January–June against the same months in an earlier year is unavailable. Use “Compare last 2 full years” for an equal-length year comparison.</p>}
    {unequalDuration && <p className="comparison-notice">These periods have different lengths. Percentage changes are hidden; count differences are descriptive, not annualized trends.</p>}
    {!unequalDuration && <p className="comparison-note">Percentage changes are hidden when either count is below 10; the count difference remains visible.</p>}
    {a.race !== b.race && <p className="comparison-note">The cohorts use different victim-race filters. Crime rows match linked victim races; unlinked crime rows are excluded when a race is selected.</p>}
    {loading && <p role="status" className="comparison-note">Analyzing all matching CJIC rows…</p>}
    {error && <div className="comparison-notice" role="alert">{error}<button className="comparison-retry" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={13} />Retry comparison</button></div>}
    {result && <>
      <div className="cohort-key"><span><i className="cohort-dot a" />A: {aLabel}</span><span><i className="cohort-dot b" />B: {bLabel}</span></div>
      <div className="comparison-totals"><div><small>CRIME ROWS</small><strong>{number(aCrime)} → {number(bCrime)}</strong><span>{change(aCrime, bCrime, unequalDuration)}</span></div><div><small>VICTIM ROWS</small><strong>{number(aVictims)} → {number(bVictims)}</strong><span>{change(aVictims, bVictims, unequalDuration)}</span></div></div>
      <p className="comparison-note">Victim rows per 100 crime rows: A {aCrime ? number(aVictims / aCrime * 100) : 'N/A'} · B {bCrime ? number(bVictims / bCrime * 100) : 'N/A'}. This compares export row volumes, not victims per unique crime or a probability.</p>
      <div className="comparison-map-controls"><label>Map measure<select aria-label="Comparison map measure" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}><option value="crime">Crime rows</option><option value="victims">Victim rows</option></select></label><label>Map view<select aria-label="Comparison map view" value={view} onChange={(e) => setView(e.target.value as typeof view)}><option value="change">Change: B − A</option><option value="a">Cohort A</option><option value="b">Cohort B</option></select></label></div>
      <label className="comparison-density"><input type="checkbox" checked={density} onChange={(e) => setDensity(e.target.checked)} />Map rows per sq km instead of counts</label>
      <p className="comparison-note">{view === 'change' ? hasComparableAreas ? 'Blue = lower in B; amber = higher in B. Places outside one cohort are labeled A only / B only, without a change calculation.' : 'Blue = cohort A; amber = cohort B. These cohorts cover different places, so map areas have no shared baseline. Compare their totals in the data panel.' : `Map colors show matching ${metric === 'crime' ? 'crime' : 'victim'} rows in cohort ${view.toUpperCase()}.`} {number(countyOnly(result.a))} A / {number(countyOnly(result.b))} B county-only rows stay in totals and tables, outside municipal heat.</p>
      {selected && <div className="comparison-selection"><strong>{selected.area.city}, {selected.area.county}</strong><span>A: {selected.a ? `${number(selected.a.crime)} crime / ${number(selected.a.victims)} victim rows` : 'outside cohort'}</span><span>B: {selected.b ? `${number(selected.b.crime)} crime / ${number(selected.b.victims)} victim rows` : 'outside cohort'}</span><small>{selected.area.geographyLabel}. {selected.area.precision === 'county' ? 'No verified municipal boundary.' : 'Reporting boundary; exact incident locations are unavailable.'}</small></div>}
      <div className="comparison-section-title"><h3>Places</h3><select aria-label="Sort comparison places" value={areaSort} onChange={(e) => setAreaSort(e.target.value as typeof areaSort)}><option value="b">B count ↓</option><option value="a">A count ↓</option><option value="change">Largest change</option><option value="name">Name A–Z</option></select></div>
      <input className="comparison-search" aria-label="Find comparison place" placeholder="Find city / township…" value={areaSearch} onChange={(e) => setAreaSearch(e.target.value)} />
      <div className="comparison-table-scroll"><table className="comparison-table"><caption>{metric === 'crime' ? 'Crime' : 'Victim'} rows by reporting place. Select a place to highlight its boundary.</caption><thead><tr><th>Place</th><th>A</th><th>B</th><th>Change</th></tr></thead><tbody>{areaRows.map(({ area, a, b }) => <tr key={area.key} className={area.key === selectedAreaKey ? 'active' : ''}><th><button onClick={() => onSelectArea(area.key)}>{area.city}<small>{area.county}{area.precision === 'county' ? ' · county only' : ''}</small></button></th><td>{a ? number(a[metric]) : '—'}</td><td>{b ? number(b[metric]) : '—'}</td><td>{a && b ? change(a[metric], b[metric], unequalDuration) : a ? 'A only' : 'B only'}</td></tr>)}</tbody></table>{!areaRows.length && <p className="comparison-note">No places match this search.</p>}</div>
      <div className="comparison-section-title"><h3>Breakdown</h3><select aria-label="Comparison breakdown" value={breakdown} onChange={(e) => setBreakdown(e.target.value as typeof breakdown)}><option value="offenses">Offenses</option><option value="years">Year trend</option><option value="race">Victim race</option><option value="age">Victim age</option><option value="sex">Victim sex</option></select></div>
      {breakdown === 'years' && <p className="comparison-note">Years outside a cohort's selected period are unavailable, not zero. Choose all available years for a full trend.</p>}
      <div className="comparison-chart" aria-label={`${breakdown} comparison chart`} role="img">{chartRows.slice(0, 8).map((row) => {
        const left = chartValue(row, 'a'), right = chartValue(row, 'b');
        return <div className="comparison-chart-row" key={row.key}><span>{row.key}</span><div><i className="a" style={{ width: `${(left ?? 0) / chartMaximum * 75}%` }} /><b>A {left === null ? 'outside period' : number(left)}</b></div><div><i className="b" style={{ width: `${(right ?? 0) / chartMaximum * 75}%` }} /><b>B {right === null ? 'outside period' : number(right)}</b></div></div>;
      })}</div>
      <div className="comparison-table-scroll"><table className="comparison-table"><caption>{hasDemographic ? 'Victim rows only; crime rows have no comparable victim demographics.' : 'All matching rows, including county-only reporting locations.'}</caption><thead><tr><th>{breakdown}</th>{!hasDemographic && <><th>A crime</th><th>B crime</th></>}<th>A victims</th><th>B victims</th></tr></thead><tbody>{dataRows.map((row) => {
        const outsideA = breakdown === 'years' && a.period !== 'all' && row.key !== a.period;
        const outsideB = breakdown === 'years' && b.period !== 'all' && row.key !== b.period;
        return <tr key={row.key}><th>{row.key}</th>{!hasDemographic && <><td>{outsideA ? '—' : number(row.aCrime)}</td><td>{outsideB ? '—' : number(row.bCrime)}</td></>}<td>{outsideA ? '—' : number(row.aVictims)}</td><td>{outsideB ? '—' : number(row.bVictims)}</td></tr>;
      })}</tbody></table>{!dataRows.length && <p className="comparison-note">No matching rows in either cohort.</p>}</div>
      <p className="comparison-note">Counts use every matching original export row. Duplicate rows and multiple victims/offenses can exist. These are descriptive comparisons, not population-adjusted crime rates or evidence of causation.</p>
    </>}
  </div>;
}
