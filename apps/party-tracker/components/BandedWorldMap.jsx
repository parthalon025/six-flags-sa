'use client';

/* Train H thin vertical (#563). Draws one baked World through MapLibre as a
   raster image on its truth bounds — ADR-0016's image-on-truth-bounds contract,
   which is exactly what MapLibre's `image` source takes — and applies the
   pitch-eases-with-zoom camera from packages/shared/mapCamera.js.

   Deliberately narrow: no Overlay, no gestures beyond MapLibre's own, one band
   (the mid bake is what exists today). The point is to judge whether flat
   painted art reads well pitched, and whether a mobile WebView holds up, before
   the tiler and the close band get built. The HUD reports what the shared band
   table would select at the current camera, so band selection can be validated
   by eye against the art. */

import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { bandForZoom, bandBoundaryZooms } from '@party-tracker/shared/zoomBands.js';
import { pitchEaseRange, pitchForZoom } from '@party-tracker/shared/mapCamera.js';
import { previewWorldPaths } from '@/lib/bandedWorldPreview';
import 'maplibre-gl/dist/maplibre-gl.css';

function worldStyle(sidecar, imageUrl) {
  const { west, south, east, north } = sidecar.bounds;
  return {
    version: 8,
    sources: {
      world: {
        type: 'image',
        url: imageUrl,
        // Clockwise from top-left, as MapLibre expects.
        coordinates: [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0d1b22' } },
      { id: 'world', type: 'raster', source: 'world', paint: { 'raster-fade-duration': 200 } },
    ],
  };
}

export default function BandedWorldMap({ skin, onReady = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [error, setError] = useState(null);
  const [hud, setHud] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let cancelled = false;
    let map = null;
    const { sidecar: sidecarUrl, image: imageUrl } = previewWorldPaths(skin);

    (async () => {
      const res = await fetch(sidecarUrl);
      if (!res.ok) throw new Error(`world sidecar unavailable (HTTP ${res.status})`);
      const sidecar = await res.json();
      if (cancelled) return;

      const { west, south, east, north } = sidecar.bounds;
      const latitude = (north + south) / 2;
      const easeRange = pitchEaseRange({ latitude });
      const boundaries = bandBoundaryZooms({ latitude });

      map = new MapLibreMap({
        container: containerRef.current,
        style: worldStyle(sidecar, imageUrl),
        center: [(west + east) / 2, latitude],
        zoom: 14,
        pitch: 0,
        attributionControl: false,
      });
      mapRef.current = map;

      // The camera contract: pitch is a function of zoom, staged clear of every
      // band handoff (ADR-0021 clause 4). Reading it from the shared module
      // rather than a local curve is the point — the gate can ask the same
      // question without a browser.
      const applyCamera = () => {
        const zoom = map.getZoom();
        const wanted = pitchForZoom(zoom, { latitude });
        if (Math.abs(map.getPitch() - wanted) > 0.01) map.setPitch(wanted);
        setHud({
          zoom,
          pitch: wanted,
          band: bandForZoom(zoom, { latitude }),
          easeRange,
          boundaries,
        });
      };

      map.on('zoom', applyCamera);
      map.on('load', () => {
        if (cancelled) return;
        applyCamera();
        onReady?.(map);
      });
      map.on('error', (e) => {
        if (!cancelled) setError(e?.error?.message || 'MapLibre error');
      });
    })().catch((err) => {
      if (!cancelled) setError(err.message);
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // Only the Skin changes what is drawn. onReady is deliberately absent:
    // callers pass it inline, so depending on its identity would tear down and
    // rebuild the WebGL context on every unrelated parent render — the same
    // reason DisplayMap.jsx keeps onMapReady out of its own deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin]);

  return (
    <div className="bandedWorldWrap" data-testid="banded-world-map">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {hud && (
        <dl className="bandedWorldHud" data-testid="banded-world-hud">
          <div><dt>zoom</dt><dd data-testid="hud-zoom">{hud.zoom.toFixed(2)}</dd></div>
          <div><dt>band</dt><dd data-testid="hud-band">{hud.band}</dd></div>
          <div><dt>pitch</dt><dd data-testid="hud-pitch">{hud.pitch.toFixed(1)}&deg;</dd></div>
          <div>
            <dt>ease</dt>
            <dd>{hud.easeRange.startZoom.toFixed(2)}&ndash;{hud.easeRange.endZoom.toFixed(2)}</dd>
          </div>
          <div>
            <dt>handoffs</dt>
            <dd>{hud.boundaries.map((b) => b.toFixed(2)).join(', ')}</dd>
          </div>
        </dl>
      )}
      {error && (
        <div className="bandedWorldError" role="alert" data-testid="banded-world-error">
          Baked world unavailable: {error}
        </div>
      )}
    </div>
  );
}
