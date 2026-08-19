'use client';

import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, addProtocol } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';

/* Phase 1 display-pipeline spike (issue #527, ADR-0013): draws Big Kahuna's
   certified display pack through MapLibre GL JS instead of ParkMap.jsx's
   hand-rolled SVG. Sibling to ParkMap.jsx in role — renders a World's map
   given venue data — but far narrower in scope: static base map and Place
   pins only, MapLibre's own camera (no gestures/Follow/Go), no Overlay.
   Reachable only behind mapLibreDisplayEnabled() (see app/page.js).

   MapLibre is handed raw pois.json [lng, lat] pairs and projects them itself
   with the same Web Mercator math lib/geo.js's project() implements — this
   component never calls project()/localMetres(); those exist so a parity
   test can check MapLibre agrees with the SVG renderer independently. */

const DISPLAY_BASE = '/api/display-spike';
const SKIN = 'watercolor-quest';

let protocolRegistered = false;
function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  // Main-thread registration is enough even though vector tiles load in
  // MapLibre's worker pool: a worker that sees an unregistered scheme relays
  // the fetch to the main thread (makeRequest's "GR" fallback), where this
  // registry answers it. Do not setWorkerCount(0) to "avoid" workers — an
  // empty pool leaves the dispatcher with no actors and tiles never load.
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

function placesGeoJson(pois) {
  return {
    type: 'FeatureCollection',
    features: (pois || [])
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { id: p.i || '', name: p.n || '', category: p.c || '' },
      })),
  };
}

export default function DisplayMap({ venue, pois, className = '', onMapReady = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const center = venue?.center;
    if (!center || !containerRef.current) return undefined;
    ensurePmtilesProtocol();

    let cancelled = false;
    let map = null;

    (async () => {
      const res = await fetch(`${DISPLAY_BASE}/${SKIN}.style.json`);
      if (!res.ok) throw new Error(`display pack style unavailable (HTTP ${res.status})`);
      const style = await res.json();
      // The pack's style.json carries a repo-relative "pmtiles://base.pmtiles"
      // source url. MapLibre resolves that against the page's own origin
      // when handed a style object rather than a style URL, so it is
      // rewritten here to the one place this spike serves the pack's bytes.
      const packUrl = `${window.location.origin}${DISPLAY_BASE}/base.pmtiles`;
      style.sources = {
        ...style.sources,
        park: { ...style.sources.park, url: `pmtiles://${packUrl}` },
      };
      if (cancelled) return;

      map = new MapLibreMap({
        container: containerRef.current,
        style,
        center: [center.lng, center.lat],
        zoom: 16,
        attributionControl: false,
      });
      mapRef.current = map;
      window.__displayMap = map; // TEMP DEBUG — remove before ship

      map.on('load', () => {
        if (cancelled) return;
        map.addSource('places', { type: 'geojson', data: placesGeoJson(pois) });
        map.addLayer({
          id: 'places',
          type: 'circle',
          source: 'places',
          paint: {
            'circle-radius': 5,
            'circle-color': '#F4511E',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
          },
        });
      });
      map.on('error', (e) => {
        if (!cancelled) setError(e?.error?.message || 'MapLibre error');
      });
      // For the parity harness (issue #527 Testing Decisions) to reach
      // map.project() independently of both renderers — never used by the
      // shipped app, which passes no callback.
      onMapReady?.(map);
    })().catch((err) => {
      if (!cancelled) setError(err.message);
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // pois only changes the places source's data, not the camera/style setup —
    // rebuilding the whole map for a POI refresh would restart the load race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id, venue?.center?.lat, venue?.center?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource('places')) return;
    map.getSource('places').setData(placesGeoJson(pois));
  }, [pois]);

  return (
    <div className={`mapWrap ${className}`} data-testid="display-map">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {error && (
        <div className="displayMapError" role="alert" data-testid="display-map-error">
          Display pack unavailable: {error}
        </div>
      )}
    </div>
  );
}
