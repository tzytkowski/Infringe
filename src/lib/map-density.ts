import type { AreaSummary, CJICMetric } from './crime';

export function agencyHeatWeight(pointCount: number) {
  return Math.min(0.55, 75 / Math.max(pointCount, 1));
}

export function reportingCount(area: AreaSummary, metric: CJICMetric = 'combined') {
  return metric === 'combined' ? area.crime + area.victims : area[metric];
}

export function reportingDensity(area: AreaSummary, metric: CJICMetric = 'combined'): number | null {
  return area.precision === 'reporting-area' && area.areaKm2 > 0 ? reportingCount(area, metric) / area.areaKm2 : null;
}

export function reportingDensityMaximum(areas: AreaSummary[], metric: CJICMetric = 'combined') {
  return Math.max(0, ...areas.map((area) => reportingDensity(area, metric) ?? 0));
}

export function reportingHeatValue(area: AreaSummary, maximum: number, metric: CJICMetric = 'combined') {
  const density = reportingDensity(area, metric);
  return density !== null && maximum > 0 ? Math.min(1, Math.log1p(density) / Math.log1p(maximum)) : 0;
}

export function densityScaleMidpoint(maximum: number) {
  return Math.expm1(Math.log1p(maximum) / 2);
}
