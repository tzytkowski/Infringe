'use client';

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { REGIONAL_FOCUS_BOUNDS, type AreaSummary, type CrimeSource, type Incident, type RegionalFocus } from '@/lib/crime';
import { agencyHeatWeight, reportingDensity, reportingDensityMaximum, reportingHeatValue } from '@/lib/map-density';

type Props = {
  incidents: Incident[];
  selectedId: string | null;
  selectedAreaKey: string | null;
  onSelect: (id: string) => void;
  resetSignal: number;
  sources: CrimeSource[];
  areas: AreaSummary[];
  onSelectArea: (key: string) => void;
  regionalFocus: RegionalFocus;
};

const DETROIT_BOUNDS: [number, number, number, number] = [-83.35, 42.21, -82.88, 42.49];
const COMBINED_BOUNDS: [number, number, number, number] = [-83.71, 42.21, -82.68, 42.92];

export default function CrimeMap({ incidents, selectedId, selectedAreaKey, onSelect, resetSignal, sources, areas, onSelectArea, regionalFocus }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectAreaRef = useRef(onSelectArea);
  onSelectAreaRef.current = onSelectArea;
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const bounds = sources.length === 1 && sources[0] === 'detroit' && regionalFocus === 'both' ? DETROIT_BOUNDS
    : sources.includes('detroit') && regionalFocus === 'both' ? COMBINED_BOUNDS : REGIONAL_FOCUS_BOUNDS[regionalFocus];
  const boundsKey = bounds.join(',');
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  useEffect(() => {
    if (!container.current || map.current) return;
    maplibregl.setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vendor/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors',
          },
        },
        layers: [{
          id: 'osm', type: 'raster', source: 'osm',
          paint: { 'raster-saturation': -1, 'raster-brightness-min': 0, 'raster-brightness-max': 0.34, 'raster-contrast': 0.16 },
        }],
      },
      bounds,
      fitBoundsOptions: { padding: 28 },
      minZoom: 5.5,
      maxZoom: 17,
      attributionControl: false,
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    const resizeObserver = new ResizeObserver(() => {
      instance.resize();
      instance.fitBounds(boundsRef.current, { padding: 28, duration: 0 });
    });
    resizeObserver.observe(container.current);
    instance.on('load', () => {
      instance.addSource('cjic-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({
        id: 'cjic-area-heat', type: 'fill', source: 'cjic-areas',
        filter: ['==', ['get', 'precision'], 'reporting-area'],
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'heat'],
            0, '#287e9e', 0.27, '#2db1c1', 0.45, '#70d3c2', 0.7, '#f1bc69', 0.88, '#f97752', 1, '#ef4c4e'],
          'fill-opacity': 0.55,
        },
      });
      instance.addLayer({
        id: 'cjic-area-outlines', type: 'line', source: 'cjic-areas',
        filter: ['==', ['get', 'precision'], 'reporting-area'],
        paint: { 'line-color': '#e0e8e2', 'line-opacity': 0.38, 'line-width': 0.8 },
      });
      instance.addLayer({
        id: 'cjic-county-outlines', type: 'line', source: 'cjic-areas',
        filter: ['==', ['get', 'precision'], 'county'],
        paint: { 'line-color': '#c5cdd1', 'line-opacity': 0.7, 'line-width': 1.3, 'line-dasharray': [3, 3] },
      });
      instance.addSource('incidents', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      instance.addLayer({
        id: 'incident-density', type: 'heatmap', source: 'incidents',
        paint: {
          'heatmap-weight': 0.1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, 0.85, 9, 1.05, 12, 1.35, 16, 1.6],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 14, 9, 22, 12, 32, 16, 42],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.95, 13, 0.88, 17, 0.76],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(36, 143, 168, 0)',
            0.06, 'rgba(35, 132, 163, 0.22)',
            0.17, 'rgba(45, 177, 193, 0.58)',
            0.29, 'rgba(112, 211, 194, 0.78)',
            0.43, 'rgba(241, 188, 105, 0.9)',
            0.68, 'rgba(249, 119, 82, 0.97)',
            1, 'rgba(239, 76, 78, 1)',
          ],
        },
      });
      instance.addLayer({
        id: 'incident-hit-targets', type: 'circle', source: 'incidents',
        filter: ['==', ['get', 'kind'], 'incident'],
        paint: { 'circle-color': '#ffffff', 'circle-opacity': 0.001, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 7, 13, 12] },
      });
      instance.addLayer({
        id: 'selected-halo', type: 'circle', source: 'incidents',
        filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 18, 'circle-color': '#ffffff', 'circle-opacity': 0.13, 'circle-stroke-color': '#ffffff', 'circle-stroke-opacity': 0.8, 'circle-stroke-width': 1.5 },
      });
      instance.addLayer({
        id: 'selected-point', type: 'circle', source: 'incidents',
        filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 4.5, 'circle-color': '#f8d29a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
      instance.addLayer({
        id: 'selected-area', type: 'line', source: 'cjic-areas',
        filter: ['==', ['get', 'key'], ''],
        paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.95 },
      });
      instance.on('click', (event) => {
        // Actual incident points take priority over the reporting polygons underneath.
        const point = instance.queryRenderedFeatures(event.point, { layers: ['incident-hit-targets'] })[0];
        if (point?.properties.id != null) { onSelectRef.current(String(point.properties.id)); return; }
        const feature = instance.queryRenderedFeatures(event.point, { layers: ['cjic-area-heat', 'cjic-county-outlines'] })
          .find((item) => item.properties.precision === 'reporting-area')
          || instance.queryRenderedFeatures(event.point, { layers: ['cjic-county-outlines'] })[0];
        const key = feature?.properties.key;
        const area = areasRef.current.find((item) => item.key === key);
        if (!area) return;
        onSelectAreaRef.current(area.key);
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${area.city}, ${area.county}`;
        const counts = document.createElement('p');
        counts.textContent = `${area.crime.toLocaleString()} crime rows / ${area.victims.toLocaleString()} victim rows`;
        const note = document.createElement('small');
        note.textContent = area.precision === 'county' ? 'Unresolved reporting locations: excluded from municipal heat.'
          : `${reportingDensity(area)!.toLocaleString(undefined, { maximumFractionDigits: 1 })} rows per sq km across the reporting boundary; no exact incident coordinates.`;
        content.append(title, counts, note);
        popup.current?.remove();
        popup.current = new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(content).addTo(instance);
      });
      for (const layer of ['cjic-area-heat', 'cjic-county-outlines', 'incident-hit-targets']) {
        instance.on('mouseenter', layer, () => { instance.getCanvas().style.cursor = 'pointer'; });
        instance.on('mouseleave', layer, () => { instance.getCanvas().style.cursor = ''; });
      }
    });
    return () => { resizeObserver.disconnect(); popup.current?.remove(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const update = () => {
      popup.current?.remove();
      const geojsonSource = instance.getSource('incidents') as maplibregl.GeoJSONSource | undefined;
      if (!geojsonSource || !instance.getLayer('incident-density')) return;
      const points = incidents.filter((item) => item.locationPrecision === 'point' && item.longitude !== null && item.latitude !== null);
      const weight = agencyHeatWeight(points.length);
      instance.setPaintProperty('incident-density', 'heatmap-weight', weight);
      geojsonSource.setData({
        type: 'FeatureCollection',
        features: points.map((item) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [item.longitude!, item.latitude!] },
            properties: { id: item.id, kind: 'incident' },
          })),
      });
      const areaSource = instance.getSource('cjic-areas') as maplibregl.GeoJSONSource | undefined;
      const maximum = reportingDensityMaximum(areas);
      areaSource?.setData({ type: 'FeatureCollection', features: [...areas].sort((a, b) => b.areaKm2 - a.areaKm2).map((area) => ({
        type: 'Feature', geometry: area.geometry,
        properties: { key: area.key, heat: reportingHeatValue(area, maximum), precision: area.precision },
      })) });
    };
    if (instance.getSource('incidents')) update();
    else instance.once('load', update);
    return () => { instance.off('load', update); };
  }, [incidents, sources, areas]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !instance.getLayer('selected-halo')) return;
    const selected = incidents.find((item) => item.id === selectedId);
    const filter: maplibregl.FilterSpecification = ['==', ['get', 'id'], selected?.locationPrecision === 'point' ? selectedId ?? '' : ''];
    instance.setFilter('selected-halo', filter);
    instance.setFilter('selected-point', filter);
    const key = selected?.areaKey || selectedAreaKey;
    instance.setFilter('selected-area', ['==', ['get', 'key'], key ?? '']);
    const area = areas.find((item) => item.key === key);
    if (area) instance.fitBounds(area.bounds, { padding: 48, maxZoom: 13, duration: 650 });
    else if (selected?.locationPrecision === 'point' && selected.longitude !== null && selected.latitude !== null) instance.easeTo({ center: [selected.longitude, selected.latitude], zoom: Math.max(instance.getZoom(), 12), duration: 650 });
  }, [selectedId, selectedAreaKey, incidents, areas]);

  useEffect(() => {
    if (map.current) map.current.fitBounds(bounds, { padding: 28, duration: 700 });
  }, [resetSignal, boundsKey]);

  return <div className="map-canvas" ref={container} aria-label="Agency incident heatmap and CJIC reporting-boundary density map" />;
}
