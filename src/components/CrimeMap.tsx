'use client';

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { REGIONAL_FOCUS_BOUNDS, type CrimeSource, type Incident, type RegionalFocus } from '@/lib/crime';

type Props = {
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  resetSignal: number;
  source: CrimeSource;
  regionalFocus: RegionalFocus;
};

const DETROIT_BOUNDS: [number, number, number, number] = [-83.35, 42.21, -82.88, 42.49];

export default function CrimeMap({ incidents, selectedId, onSelect, resetSignal, source, regionalFocus }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
      bounds: source === 'detroit' ? DETROIT_BOUNDS : REGIONAL_FOCUS_BOUNDS[regionalFocus],
      fitBoundsOptions: { padding: 28 },
      minZoom: 5.5,
      maxZoom: 17,
      attributionControl: false,
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    instance.on('load', () => {
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
      instance.on('click', 'incident-hit-targets', (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (id != null) onSelectRef.current(String(id));
      });
      instance.on('mouseenter', 'incident-hit-targets', () => { instance.getCanvas().style.cursor = 'pointer'; });
      instance.on('mouseleave', 'incident-hit-targets', () => { instance.getCanvas().style.cursor = ''; });
    });
    return () => { instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const update = () => {
      const geojsonSource = instance.getSource('incidents') as maplibregl.GeoJSONSource | undefined;
      if (!geojsonSource || !instance.getLayer('incident-density')) return;
      const baseWeight = Math.max(0.06, Math.min(0.55, 75 / Math.max(incidents.length, 1)));
      const weight = Math.min(0.9, baseWeight * (source === 'clemis' ? 1.9 : 1));
      instance.setPaintProperty('incident-density', 'heatmap-weight', weight);
      geojsonSource.setData({
        type: 'FeatureCollection',
        features: incidents.map((item) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] },
          properties: { id: item.id },
        })),
      });
    };
    if (instance.isStyleLoaded()) update();
    else instance.once('load', update);
  }, [incidents, source]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !instance.getLayer('selected-halo')) return;
    const filter: maplibregl.FilterSpecification = ['==', ['get', 'id'], selectedId ?? ''];
    instance.setFilter('selected-halo', filter);
    instance.setFilter('selected-point', filter);
    const selected = incidents.find((item) => item.id === selectedId);
    if (selected) instance.easeTo({ center: [selected.longitude, selected.latitude], zoom: Math.max(instance.getZoom(), 12), duration: 650 });
  }, [selectedId, incidents]);

  useEffect(() => {
    if (map.current) map.current.fitBounds(source === 'detroit' ? DETROIT_BOUNDS : REGIONAL_FOCUS_BOUNDS[regionalFocus], { padding: 28, duration: 700 });
  }, [resetSignal, source, regionalFocus]);

  return <div className="map-canvas" ref={container} aria-label={`Heatmap of reported ${source === 'detroit' ? 'Detroit' : 'regional'} crime incidents`} />;
}
