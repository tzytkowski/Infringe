import type { AreaSummary, CJICBreakdown, CJICManifest, CJICResponse, ComparisonMap } from './crime';

export function percentChange(a: number, b: number): number | null {
  return a === 0 ? (b === 0 ? 0 : null) : (b - a) / a * 100;
}

export function comparisonAreas(a: CJICResponse, b: CJICResponse) {
  const aAreas = new Map(a.areas.map((area) => [area.key, area]));
  const bAreas = new Map(b.areas.map((area) => [area.key, area]));
  return [...new Set([...aAreas.keys(), ...bAreas.keys()])].map((key) => ({
    area: (aAreas.get(key) || bAreas.get(key))!, a: aAreas.get(key) ?? null, b: bAreas.get(key) ?? null,
  }));
}

export function comparisonValue(area: AreaSummary | null, metric: 'crime' | 'victims', density: boolean): number | null {
  if (!area || (density && (area.precision !== 'reporting-area' || area.areaKm2 <= 0))) return null;
  return area[metric] / (density ? area.areaKm2 : 1);
}

export function comparisonFeatures(comparison: ComparisonMap) {
  const entries = comparisonAreas(comparison.a, comparison.b).map(({ area, a, b }) => {
    const aValue = comparisonValue(a, comparison.metric, comparison.density);
    const bValue = comparisonValue(b, comparison.metric, comparison.density);
    const value = comparison.view === 'a' ? aValue : comparison.view === 'b' ? bValue
      : aValue !== null && bValue !== null ? bValue - aValue : null;
    return { area, a, b, value, aValue, bValue };
  });
  const maximum = Math.max(0, ...entries.filter(({ area }) => area.precision === 'reporting-area').map(({ value }) => Math.abs(value ?? 0)));
  return entries.map((entry) => ({ ...entry,
    heat: entry.value === null || maximum === 0 ? 0 : Math.sign(entry.value) * Math.log1p(Math.abs(entry.value)) / Math.log1p(maximum),
  }));
}

export function mergeBreakdowns(a: CJICBreakdown[], b: CJICBreakdown[]) {
  const left = new Map(a.map((row) => [row.key, row]));
  const right = new Map(b.map((row) => [row.key, row]));
  return [...new Set([...left.keys(), ...right.keys()])].map((key) => ({
    key, aCrime: left.get(key)?.crime ?? 0, aVictims: left.get(key)?.victims ?? 0,
    bCrime: right.get(key)?.crime ?? 0, bVictims: right.get(key)?.victims ?? 0,
  }));
}

export function scopeLabel(manifest: CJICManifest, scope: string) {
  if (scope === 'all') return 'Oakland + Macomb';
  if (scope.startsWith('county:')) return `${scope.slice(7)} County`;
  const area = manifest.areas.find((item) => item.key === scope);
  if (area) return `${area.city}, ${area.county}`;
  return `${scope.split('|')[0]} county-only locations`;
}

export function comparisonCSV(rows: (string | number | null)[][]) {
  return rows.map((row) => row.map((value) => {
    if (value === null) return '';
    if (typeof value === 'number') return String(value);
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
