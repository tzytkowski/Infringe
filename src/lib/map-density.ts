import type { AreaSummary } from './crime';

export function agencyHeatWeight(pointCount: number) {
  return Math.min(0.55, 75 / Math.max(pointCount, 1));
}

export function reportingDensity(area: AreaSummary): number | null {
  return area.precision === 'reporting-area' && area.areaKm2 > 0 ? (area.crime + area.victims) / area.areaKm2 : null;
}

export function reportingDensityMaximum(areas: AreaSummary[]) {
  return Math.max(0, ...areas.map((area) => reportingDensity(area) ?? 0));
}

export function reportingHeatValue(area: AreaSummary, maximum: number) {
  const density = reportingDensity(area);
  return density !== null && maximum > 0 ? Math.min(1, Math.log1p(density) / Math.log1p(maximum)) : 0;
}

export function densityScaleMidpoint(maximum: number) {
  return Math.expm1(Math.log1p(maximum) / 2);
}
