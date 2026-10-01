'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { REGIONAL_FOCUS_BOUNDS, type AreaSummary, type CJICMetric, type ComparisonMap, type CrimeSource, type Incident, type RegionalFocus } from '@/lib/crime';
import { agencyHeatWeight, reportingCount, reportingDensity, reportingDensityMaximum, reportingHeatValue } from '@/lib/map-density';
import { comparisonFeatures } from '@/lib/cjic-comparison';

type Props = {
  incidents: Incident[];
  selectedId: string | null;
  selectedAreaKey: string | null;
  onSelect: (id: string) => void;
  resetSignal: number;
  locateSignal: number;
  sources: CrimeSource[];
  areas: AreaSummary[];
  onSelectArea: (key: string) => void;
  regionalFocus: RegionalFocus;
  metric: CJICMetric;
  comparison: ComparisonMap | null;
};

const DETROIT_BOUNDS: [number, number, number, number] = [-83.35, 42.21, -82.88, 42.49];
const COMBINED_BOUNDS: [number, number, number, number] = [-83.71, 42.21, -82.68, 42.92];

function fitBoundsOneLevelCloser(instance: maplibregl.Map, bounds: [number, number, number, number], padding: number, duration: number, milesNorth = -2, milesEast = 5) {
  const camera = instance.cameraForBounds(bounds, { padding });
  if (!camera?.center) { instance.fitBounds(bounds, { padding, duration }); return; }
  const center = maplibregl.LngLat.convert(camera.center);
  // One degree of longitude narrows with latitude; regional views retain the tuned east/south offset.
  const longitudeOffset = milesEast / (69.172 * Math.cos(center.lat * Math.PI / 180));
  const latitudeOffset = milesNorth / 69.172;
  instance.easeTo({ center: [center.lng + longitudeOffset, center.lat + latitudeOffset], zoom: Math.min((camera.zoom ?? instance.getZoom()) + 1, 17), bearing: camera.bearing, duration });
}

export default function CrimeMap({ incidents, selectedId, selectedAreaKey, onSelect, resetSignal, locateSignal, sources, areas, onSelectArea, regionalFocus, metric, comparison }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const locationMarker = useRef<maplibregl.Marker | null>(null);
  const [satellite, setSatellite] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectAreaRef = useRef(onSelectArea);
  onSelectAreaRef.current = onSelectArea;
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const comparisonRef = useRef(comparison);
  comparisonRef.current = comparison;
  const metricRef = useRef(metric);
  metricRef.current = metric;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const detroitOnly = sources.length === 1 && sources[0] === 'detroit' && regionalFocus === 'both';
  const bounds = detroitOnly ? DETROIT_BOUNDS
    : (sources.includes('clemis') || sources.includes('detroit') || sources.includes('news')) && regionalFocus === 'both' ? COMBINED_BOUNDS : REGIONAL_FOCUS_BOUNDS[regionalFocus];
  const boundsKey = bounds.join(',');
  const boundsRef = useRef(bounds);
  // Detroit used the shared two-mile-south offset. A three-mile-north offset moves
  // that existing camera five miles north without changing the other presets.
  const centerNorthMiles = detroitOnly ? 3 : -2;
  const centerEastMiles = detroitOnly ? 3 : 5;
  const centerNorthMilesRef = useRef(centerNorthMiles);
  const centerEastMilesRef = useRef(centerEastMiles);
  const comparisonBounds = comparison && areas.length ? areas.reduce<[number, number, number, number]>((result, area) => [
    Math.min(result[0], area.bounds[0]), Math.min(result[1], area.bounds[1]), Math.max(result[2], area.bounds[2]), Math.max(result[3], area.bounds[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]) : null;
  const comparisonBoundsKey = comparisonBounds?.join(',') ?? '';
  boundsRef.current = comparisonBounds || bounds;
  centerNorthMilesRef.current = centerNorthMiles;
  centerEastMilesRef.current = centerEastMiles;

  useEffect(() => {
    if (!container.current || map.current) return;
    maplibregl.setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vendor/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          },
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors',
          },
        },
        layers: [{
          id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' },
          paint: { 'raster-brightness-min': 0, 'raster-brightness-max': 0.72, 'raster-contrast': 0.12 },
        }, {
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
      fitBoundsOneLevelCloser(instance, boundsRef.current, 28, 0, centerNorthMilesRef.current, centerEastMilesRef.current);
    });
    resizeObserver.observe(container.current);
    instance.on('load', () => {
      fitBoundsOneLevelCloser(instance, bounds, 28, 0, centerNorthMiles, centerEastMiles);
      instance.addSource('cjic-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({
        id: 'cjic-area-heat', type: 'fill', source: 'cjic-areas',
        filter: ['==', ['get', 'precision'], 'reporting-area'],
        paint: {
          'fill-color': '#24333b',
          'fill-opacity': 0.75,
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
      instance.addSource('news-cases', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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
        id: 'news-case-points', type: 'circle', source: 'news-cases',
        paint: { 'circle-radius': 8, 'circle-color': '#ed8f77', 'circle-stroke-color': '#fff4e4', 'circle-stroke-width': 2, 'circle-opacity': 0.95 },
      });
      instance.addLayer({
        id: 'news-case-hit-targets', type: 'circle', source: 'news-cases',
        paint: { 'circle-radius': 14, 'circle-color': '#ed8f77', 'circle-opacity': 0.001 },
      });
      instance.addLayer({
        id: 'selected-news-case', type: 'circle', source: 'news-cases',
        filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 17, 'circle-color': '#ed8f77', 'circle-opacity': 0.12, 'circle-stroke-color': '#fff4e4', 'circle-stroke-width': 2 },
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
        const point = instance.queryRenderedFeatures(event.point, { layers: ['news-case-hit-targets', 'incident-hit-targets'] })[0];
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
        const activeComparison = comparisonRef.current;
        const entry = activeComparison ? comparisonFeatures(activeComparison).find((item) => item.area.key === key) : null;
        if (activeComparison && entry) {
          for (const [name, cohort, label] of [['A', entry.a, activeComparison.aLabel], ['B', entry.b, activeComparison.bLabel]] as const) {
            const detail = document.createElement('p');
            detail.textContent = `${name} (${label}): ${cohort ? `${cohort.crime.toLocaleString()} crime / ${cohort.victims.toLocaleString()} victim rows` : 'outside this cohort'}`;
            counts.append(detail);
          }
          const difference = document.createElement('small');
          difference.textContent = entry.aValue !== null && entry.bValue !== null
            ? `B − A: ${(entry.bValue - entry.aValue).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${activeComparison.metric === 'crime' ? 'crime' : 'victim'} rows${activeComparison.density ? ' / sq km' : ''}`
            : 'Change is unavailable outside one cohort.';
          counts.append(difference);
        } else {
          counts.textContent = `${sourcesRef.current.includes('cjic-crime') ? `${area.crime.toLocaleString()} crime rows` : 'Crime source not selected'} / ${sourcesRef.current.includes('cjic-victim') ? `${area.victims.toLocaleString()} victim rows` : 'Victim source not selected'}`;
        }
        const note = document.createElement('small');
        note.textContent = area.precision === 'county' ? 'Unresolved reporting locations: excluded from municipal heat.'
          : activeComparison ? 'Reporting boundary; no exact incident coordinates or population-adjusted risk.'
          : `${reportingDensity(area, metricRef.current)!.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${metricRef.current === 'combined' ? 'selected' : metricRef.current === 'crime' ? 'crime' : 'victim'} rows per sq km across the reporting boundary; no exact incident coordinates.`;
        content.append(title, counts, note);
        popup.current?.remove();
        popup.current = new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(content).addTo(instance);
      });
      for (const layer of ['cjic-area-heat', 'cjic-county-outlines', 'incident-hit-targets', 'news-case-hit-targets']) {
        instance.on('mouseenter', layer, () => { instance.getCanvas().style.cursor = 'pointer'; });
        instance.on('mouseleave', layer, () => { instance.getCanvas().style.cursor = ''; });
      }
    });
    return () => { resizeObserver.disconnect(); popup.current?.remove(); locationMarker.current?.remove(); locationMarker.current = null; instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const updateBasemap = () => {
      instance.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none');
      instance.setLayoutProperty('osm', 'visibility', satellite ? 'none' : 'visible');
    };
    if (instance.isStyleLoaded()) updateBasemap();
    else instance.once('load', updateBasemap);
    return () => { instance.off('load', updateBasemap); };
  }, [satellite]);

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
      const newsSource = instance.getSource('news-cases') as maplibregl.GeoJSONSource | undefined;
      newsSource?.setData({ type: 'FeatureCollection', features: incidents
        .filter((item) => item.source === 'news' && item.locationPrecision === 'approximate-point' && item.longitude !== null && item.latitude !== null)
        .map((item) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [item.longitude!, item.latitude!] }, properties: { id: item.id } })) });
      const areaSource = instance.getSource('cjic-areas') as maplibregl.GeoJSONSource | undefined;
      const maximum = reportingDensityMaximum(areas, metric);
      const entries = comparison ? comparisonFeatures(comparison) : null;
      const features = entries ? entries.map((entry) => ({
        type: 'Feature' as const, geometry: entry.area.geometry,
        properties: { key: entry.area.key, heat: entry.heat, count: entry.value, precision: entry.area.precision, areaKm2: entry.area.areaKm2,
          side: comparison!.view !== 'change' ? 'pair' : !entry.a ? 'b' : !entry.b ? 'a' : 'pair' },
      })) : areas.map((area) => ({
        type: 'Feature', geometry: area.geometry,
        properties: { key: area.key, heat: reportingHeatValue(area, maximum, metric), count: reportingCount(area, metric), precision: area.precision, areaKm2: area.areaKm2, side: 'pair' },
      }));
      areaSource?.setData({ type: 'FeatureCollection', features: features.sort((a, b) => b.properties.areaKm2 - a.properties.areaKm2) as GeoJSON.Feature[] });
      // Draw small village overlays after enclosing townships, including neutral
      // zero-match overlays, so each clickable place keeps its own count.
      const normalPalette: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['get', 'heat'],
        0, '#287e9e', 0.27, '#2db1c1', 0.45, '#70d3c2', 0.7, '#f1bc69', 0.88, '#f97752', 1, '#ef4c4e'];
      const changePalette: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['get', 'heat'], -1, '#43aade', 0, '#34414a', 1, '#f4ba63'];
      instance.setPaintProperty('cjic-area-heat', 'fill-color', ['case',
        ['==', ['get', 'side'], 'a'], '#70bde5', ['==', ['get', 'side'], 'b'], '#f4ba63',
        ['any', ['==', ['get', 'count'], 0], ['==', ['get', 'count'], null]], '#24333b',
        comparison?.view === 'change' ? changePalette : normalPalette]);
      instance.setPaintProperty('cjic-area-heat', 'fill-opacity', ['case', ['any', ['==', ['get', 'count'], 0], ['==', ['get', 'count'], null]], 0.95, 0.68]);
      instance.setLayoutProperty('incident-density', 'visibility', comparison ? 'none' : 'visible');
      instance.setLayoutProperty('incident-hit-targets', 'visibility', comparison ? 'none' : 'visible');
      instance.setLayoutProperty('news-case-points', 'visibility', comparison ? 'none' : 'visible');
      instance.setLayoutProperty('news-case-hit-targets', 'visibility', comparison ? 'none' : 'visible');
    };
    if (instance.getSource('incidents')) update();
    else instance.once('load', update);
    return () => { instance.off('load', update); };
  }, [incidents, sources, areas, metric, comparison]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !instance.getLayer('selected-halo')) return;
    const selected = incidents.find((item) => item.id === selectedId);
    const filter: maplibregl.FilterSpecification = ['==', ['get', 'id'], selected && ['point', 'approximate-point'].includes(selected.locationPrecision || '') ? selectedId ?? '' : ''];
    instance.setFilter('selected-halo', filter);
    instance.setFilter('selected-point', filter);
    instance.setFilter('selected-news-case', ['==', ['get', 'id'], selected?.source === 'news' ? selectedId ?? '' : '']);
    const key = selected?.areaKey || selectedAreaKey;
    instance.setFilter('selected-area', ['==', ['get', 'key'], key ?? '']);
    const area = areas.find((item) => item.key === key);
    if (area) instance.fitBounds(area.bounds, { padding: 48, maxZoom: 13, duration: 650 });
    else if (selected && ['point', 'approximate-point'].includes(selected.locationPrecision || '') && selected.longitude !== null && selected.latitude !== null) instance.easeTo({ center: [selected.longitude, selected.latitude], zoom: Math.max(instance.getZoom(), 12), duration: 650 });
  }, [selectedId, selectedAreaKey, incidents, areas]);

  useEffect(() => {
    if (map.current) fitBoundsOneLevelCloser(map.current, bounds, 28, 700, centerNorthMiles, centerEastMiles);
  }, [resetSignal, boundsKey, centerNorthMiles, centerEastMiles]);

  useEffect(() => {
    if (!locateSignal) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const instance = map.current;
      if (!instance) return;
      if (!locationMarker.current) {
        const marker = document.createElement('span');
        marker.className = 'current-location-marker';
        marker.setAttribute('aria-label', 'Your current location');
        locationMarker.current = new maplibregl.Marker({ element: marker, anchor: 'center' }).addTo(instance);
      }
      locationMarker.current.setLngLat([coords.longitude, coords.latitude]);
      instance.easeTo({ center: [coords.longitude, coords.latitude], zoom: Math.max(instance.getZoom(), 13), duration: 700 });
    }, () => undefined, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  }, [locateSignal]);

  useEffect(() => {
    if (map.current && comparisonBounds) map.current.fitBounds(comparisonBounds, { padding: 48, maxZoom: 13, duration: 700 });
  }, [comparisonBoundsKey]);

  return <><div className="map-canvas" ref={container} aria-label="Agency incident heatmap and CJIC reporting-boundary density map" /><button className="map-basemap-toggle" type="button" onClick={() => setSatellite((value) => !value)} aria-label={`Switch to ${satellite ? 'regular' : 'satellite'} map`} title={`Switch to ${satellite ? 'regular' : 'satellite'} map`}>{satellite ? 'Map' : 'Satellite'}</button></>;
}
