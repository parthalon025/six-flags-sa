'use client';

/* Train H thin vertical (#563). Draws one baked World on its truth bounds —
   ADR-0016's image-on-truth-bounds contract — with the pitch-eases-with-zoom
   camera of ADR-0019 clause 2.

   This component holds no map knowledge of its own any more. It fetches the
   World's sidecar, mounts the map view seam (lib/mapView.js) over the MapLibre
   renderer, and hands the seam back the camera whenever a gesture moves it.
   Which band that camera selects, what stands in for a band the device has not
   got, and what tilt to hold are all the seam's answers — the HUD below reports
   them, so band selection can be judged by eye against the art.

   Deliberately narrow, still: no Overlay and one band, because the mid bake is
   what the pack ships today. The point is to judge whether flat painted art
   reads well pitched and whether a mobile WebView holds up, before the tiler
   and the close band get built. */

import { useEffect, useRef, useState } from 'react';
import { bandBoundaryZooms } from '@party-tracker/shared/zoomBands.js';
import { pitchEaseRange, skinCameraPreset } from '@party-tracker/shared/mapCamera.js';
import { mountMapView } from '@/lib/mapView';
import { createMapLibreRenderer } from '@/lib/mapViewMaplibre';
import { previewWorldPaths, PREVIEW_VENUE } from '@/lib/bandedWorldPreview';
import 'maplibre-gl/dist/maplibre-gl.css';

/* Inline, not globals.css: this preview is dev-only behind a flag, and
   globals.css is a watched path for the README map shots — appending to it
   stales map-day.png and map-night.png for a change that cannot affect the
   shipped map. Inline style objects are the established pattern here
   (DisplayMap.jsx, GlanceRail.jsx). */
const S = {
  wrap: { position: 'relative', flex: 1 },
  canvas: { position: 'absolute', inset: 0 },
  hud: {
    position: 'absolute',
    left: '0.75rem',
    bottom: '0.75rem',
    margin: 0,
    padding: '0.5rem 0.7rem',
    borderRadius: '0.5rem',
    background: 'rgba(6, 18, 24, 0.82)',
    color: '#cfe3e8',
    font: '500 0.75rem/1.5 ui-monospace, monospace',
  },
  row: { display: 'flex', gap: '0.5rem' },
  term: { opacity: 0.6, minWidth: '4.5rem' },
  def: { margin: 0 },
  error: {
    position: 'absolute',
    right: '0.75rem',
    bottom: '0.75rem',
    left: '0.75rem',
    padding: '0.6rem 0.8rem',
    borderRadius: '0.5rem',
    background: '#5b1a1a',
    color: '#ffe8e8',
    font: '500 0.8rem/1.4 system-ui, sans-serif',
  },
};

/** What the pack actually ships for this Skin: the mid band, as one image on
 *  truth bounds. Overview and close stream by viewport (ADR-0021 clause 5) and
 *  are not built yet, so the seam is told the device holds mid and nothing
 *  else — which is exactly the state a phone starts a park day in. */
function previewWorld(sidecar, skin) {
  const { image } = previewWorldPaths(skin);
  return { id: PREVIEW_VENUE, bounds: sidecar.bounds, bands: { mid: { image } } };
}

export default function BandedWorldMap({ skin, onReady = null }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [hud, setHud] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let cancelled = false;
    let view = null;

    (async () => {
      const { sidecar: sidecarUrl } = previewWorldPaths(skin);
      const res = await fetch(sidecarUrl);
      if (!res.ok) throw new Error(`world sidecar unavailable (HTTP ${res.status})`);
      const sidecar = await res.json();
      if (cancelled) return;

      const world = previewWorld(sidecar, skin);
      const { west, south, east, north } = world.bounds;
      const latitude = (north + south) / 2;

      const report = () => {
        if (cancelled || !view) return;
        setHud({ ...view.state(), easeRange: pitchEaseRange({ latitude }), boundaries: bandBoundaryZooms({ latitude }) });
      };

      view = mountMapView(containerRef.current, {
        renderer: createMapLibreRenderer({
          onError: (err) => {
            if (!cancelled) setError(err.message || 'MapLibre error');
          },
          // A pinch happens inside the renderer; the seam only learns about it
          // if it is handed back. It drops a camera it is already at, so this
          // round trip settles instead of echoing.
          onCameraMoved: (camera) => {
            if (cancelled || !view) return;
            view.setCamera(camera);
            report();
          },
        }),
        world,
        skin,
        /* The Skin's declared camera feel (ADR-0019 clause 2). Its pitch
           ceiling the seam derives from `skin` itself; its bearing is the
           OPENING camera's and belongs here, because bearing is the caller's
           to own — a gesture that turns the world comes straight back through
           setCamera, and a seam that reimposed the preset would spin it back
           on every pan. For pixel-tycoon that quarter-turn is most of what
           survives of the isometric read (clause 6). */
        camera: {
          center: { lng: (west + east) / 2, lat: latitude },
          zoom: 14,
          bearing: skinCameraPreset(skin).bearing,
        },
      });

      report();
      onReady?.(view);
    })().catch((err) => {
      if (!cancelled) setError(err.message);
    });

    return () => {
      cancelled = true;
      view?.destroy();
      view = null;
    };
    // Only the Skin changes what is drawn. onReady is deliberately absent:
    // callers pass it inline, so depending on its identity would tear down and
    // rebuild the WebGL context on every unrelated parent render — the same
    // reason DisplayMap.jsx keeps onMapReady out of its own deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin]);

  return (
    <div style={S.wrap} data-testid="banded-world-map">
      <div ref={containerRef} style={S.canvas} />
      {hud && (
        <dl style={S.hud} data-testid="banded-world-hud">
          <div style={S.row}><dt style={S.term}>zoom</dt><dd style={S.def} data-testid="hud-zoom">{hud.camera.zoom.toFixed(2)}</dd></div>
          <div style={S.row}><dt style={S.term}>band</dt><dd style={S.def} data-testid="hud-band">{hud.plan.primary}</dd></div>
          <div style={S.row}>
            <dt style={S.term}>drawing</dt>
            <dd style={S.def} data-testid="hud-drawing">
              {hud.plan.draw.join(' + ')}{hud.plan.primaryReady ? '' : ' (placeholder)'}
            </dd>
          </div>
          <div style={S.row}><dt style={S.term}>pitch</dt><dd style={S.def} data-testid="hud-pitch">{hud.camera.pitch.toFixed(1)}&deg;</dd></div>
          <div style={S.row}>
            <dt style={S.term}>ease</dt>
            <dd style={S.def}>{hud.easeRange.startZoom.toFixed(2)}&ndash;{hud.easeRange.endZoom.toFixed(2)}</dd>
          </div>
          <div style={S.row}>
            <dt style={S.term}>handoffs</dt>
            <dd style={S.def}>{hud.boundaries.map((b) => b.toFixed(2)).join(', ')}</dd>
          </div>
        </dl>
      )}
      {error && (
        <div style={S.error} role="alert" data-testid="banded-world-error">
          Baked world unavailable: {error}
        </div>
      )}
    </div>
  );
}
