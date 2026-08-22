'use client';

/* The World map, drawn by the one renderer (ADR-0019 clauses 3-4, slice h11).
 *
 * This component holds no map knowledge. It mounts the map view seam
 * (lib/mapView.js) over the MapLibre renderer, hands it a camera and the
 * Overlay as data, and hands taps back. Which Zoom band is drawn, what stands
 * in for one that has not arrived, what tilt the camera holds, and how a
 * Member's dot is painted are all answered behind the seam — which is what
 * lets those be tested in plain Node and what lets ADR-0013's real-time PBR
 * tier arrive as a third renderer rather than as a fork of this file.
 *
 * What it *does* own is the two conversions a browser is needed for: pixels
 * (a tap, the viewport a route has to fit into) and the effect lifecycle that
 * a WebGL context lives and dies by. Everything above that — Truth into map
 * data, props into a camera — is ParkMap.jsx's, and pure.
 *
 * The counterpart it replaced was components/ParkMapSvg.jsx, which projected
 * all of this by hand and retired with slice h18. Two projections of one Truth
 * is how a party dot and the route it is walking end up disagreeing on screen,
 * which is the failure ADR-0021 clause 3 is written against; there is one
 * projection now.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { frameBounds, offsetCentre } from '@party-tracker/shared/mapCamera.js';
import { metresPerPixel, zoomForResolution } from '@party-tracker/shared/zoomBands.js';
import { distance } from '@/lib/geo';
import { mountMapView } from '@/lib/mapView';
import { createMapLibreRenderer } from '@/lib/mapViewMaplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

/* Inline rather than globals.css, for the reason BandedWorldMap.jsx states:
   globals.css is a watched path for the README map shots, so appending to it
   stales map-day.png and map-night.png for a change that cannot affect them. */
const S = {
  canvas: { position: 'absolute', inset: 0 },
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

export default function ParkMapGl({
  /** `{ id, bounds, geometry, bands }` — Truth geometry and any baked bands. */
  world,
  /** The Skin's paint pack. Restyles, never repositions. */
  palette = null,
  skin = null,
  /** This World's Places, for the seam's own hit-test lookup. */
  places = [],
  /** `overlayGeoJson()`'s five collections. */
  overlay = null,
  /** Where the camera should be. See `applyCamera` below for each field. */
  camera,
  /** Usable height is the viewport less whatever furniture covers the map. */
  insetBottom = 0,
  /** Skin-declared camera feel (ADR-0019 clause 2). */
  maxPitch = undefined,
  onSelectPlace = null,
  onMapTap = null,
  onUserPan = null,
  /** Map chrome — the key, the attribution — drawn over the canvas. */
  children = null,
  style = null,
}) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const [error, setError] = useState(null);
  /* A World opens framed on its own bounds, and framing needs a viewport. On
     the first render the container has not been laid out yet and is zero
     pixels wide, so mounting then would open every park at a zoom worked out
     from nothing. Wait for one layout instead — MapLibre handles every resize
     after that itself. */
  const [laidOut, setLaidOut] = useState(false);
  // Read through refs inside the mount effect: a tap handler that depended on
  // the current callbacks would tear down and rebuild the WebGL context every
  // time the parent re-rendered with a fresh inline arrow.
  const handlers = useRef({ onSelectPlace, onMapTap, onUserPan });
  handlers.current = { onSelectPlace, onMapTap, onUserPan };

  /** The camera the seam is asked for, resolved against the viewport.
   *
   *  Every field is optional and `null` means "leave it": a Follow that also
   *  re-zoomed would undo every pinch, and a camera re-centred on each render
   *  would never let a guest look anywhere.
   *
   *  @param {object} next
   *  @param {{lng: number, lat: number}|null} next.center where to be.
   *  @param {number|null} next.resolution how close, in ground metres per
   *    pixel. Metres rather than a zoom because a zoom means different ground
   *    at different latitudes, and "walking zoom" is a statement about ground.
   *  @param {{west,south,east,north}|null} next.fit a box to frame. Outranks
   *    centre and resolution: framing a route is a statement about the whole
   *    route rather than about one point of it.
   *  @param {number} next.bearing
   *  @param {number} next.lift fraction of the viewport the centre moves
   *    forward along the bearing, so the puck sits low during Go.
   *  @param {number|null} next.easeMs glide rather than jump.
   *  @param {number} next.deadbandMetres a move smaller than this is not a
   *    move. GPS and graph snapping jitter by a metre or two, and a camera
   *    that chased it reads as the map bouncing in place.
   */
  const applyCamera = useCallback((next) => {
    const view = viewRef.current;
    const node = containerRef.current;
    if (!view || !node || !next) return;
    const held = view.state().camera;
    const width = Math.max(1, node.clientWidth);
    const height = Math.max(1, node.clientHeight - insetBottom);

    let center = next.center ?? held.center;
    let zoom = held.zoom;
    if (next.resolution) zoom = zoomForResolution(next.resolution, { latitude: center.lat });
    if (next.fit) {
      const framed = frameBounds(next.fit, { width, height });
      center = framed.center;
      zoom = framed.zoom;
    }
    const bearing = next.bearing ?? 0;

    /* Course-up wants the puck low on the glass with the road ahead above it,
       so the centre moves *forward along the bearing* — north would slide the
       map the wrong way on every corner. Done in ground metres because that is
       the only place it is the same distance at every zoom. Applied before the
       deadband, because what the deadband compares against is where the camera
       actually is, and where it actually is includes this. */
    if (next.lift) {
      center = offsetCentre(center, {
        metres: next.lift * height * metresPerPixel(zoom, { latitude: center.lat }),
        bearing,
      });
    }

    const still = zoom === held.zoom
      && bearing === held.bearing
      && distance(held.center.lat, held.center.lng, center.lat, center.lng)
        < (next.deadbandMetres ?? 0);
    if (still) return;

    const wanted = { center, zoom, bearing };
    if (next.easeMs) view.easeCamera(wanted, { durationMs: next.easeMs });
    else view.setCamera(wanted);
  }, [insetBottom]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth > 0 && node.clientHeight > 0) setLaidOut(true);
    });
    observer.observe(node);
    if (node.clientWidth > 0 && node.clientHeight > 0) setLaidOut(true);
    return () => observer.disconnect();
  }, []);

  // Mount. Keyed on the World: a new venue is a new style, and MapLibre takes
  // its style at construction.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || !laidOut || !world?.bounds) return undefined;
    let alive = true;

    const view = mountMapView(node, {
      renderer: createMapLibreRenderer({
        // MapLibre's own failures arrive asynchronously and are the caller's
        // to show: a map that has stopped drawing must say so rather than sit
        // there looking like an empty park.
        onError: (err) => {
          if (alive) setError(err?.message || 'MapLibre error');
        },
        // A pinch happens inside the renderer; the seam only learns about it
        // if it is handed back. It drops a camera it is already at, so this
        // round trip settles instead of echoing.
        onCameraMoved: (moved) => {
          if (!alive || !viewRef.current) return;
          viewRef.current.setCamera(moved);
        },
        onTap: ({ point, lngLat }) => {
          if (!alive || !viewRef.current) return;
          const place = viewRef.current.hitTest(point);
          if (place) handlers.current.onSelectPlace?.(place);
          else handlers.current.onMapTap?.(lngLat.lat, lngLat.lng);
        },
      }),
      world,
      skin,
      palette,
      places,
      /* A view opens somewhere, and the somewhere a World opens on is the
         whole World: ADR-0016's truth bounds framed into the glass. That is
         the first half of slice h18's opening-view decision, and it is a
         *box* — no centre is chosen here, which is what retired the
         disagreement between the two renderers' opening points. The second
         half, the flight to the guest's own position, arrives through the
         camera prop like every other move: see lib/openingView.js. */
      camera: frameBounds(world.bounds, {
        width: Math.max(1, node.clientWidth),
        height: Math.max(1, node.clientHeight - insetBottom),
      }),
      ...(maxPitch == null ? {} : { maxPitch }),
    });
    viewRef.current = view;

    return () => {
      alive = false;
      viewRef.current = null;
      view.destroy();
    };
    // Only the World changes what is mounted. The camera, the Overlay and the
    // callbacks all reach a live view through the effects below or through
    // `handlers`; depending on them here would rebuild the GL context on every
    // GPS fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world?.id, skin, laidOut]);

  /* Truth in, every frame the parent says it changed. `laidOut` is a
     dependency of both of these because the view does not exist until it
     flips: without it the Overlay and camera of the render that mounted the
     map would be pushed at nothing and never pushed again. */
  useEffect(() => {
    if (overlay) viewRef.current?.setOverlay(overlay);
  }, [overlay, laidOut]);

  useEffect(() => {
    applyCamera(camera);
  }, [camera, applyCamera, laidOut]);

  // A guest touching the glass is a guest who no longer wants Follow dragging
  // the camera out from under them. The renderer owns the gesture itself; this
  // only needs to know one started.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const started = () => handlers.current.onUserPan?.();
    node.addEventListener('pointerdown', started);
    node.addEventListener('wheel', started, { passive: true });
    return () => {
      node.removeEventListener('pointerdown', started);
      node.removeEventListener('wheel', started);
    };
  }, []);

  return (
    <div className="mapWrap" style={style ?? undefined} data-renderer="gl">
      <div ref={containerRef} style={S.canvas} data-testid="park-map-gl" />
      {children}
      {error && (
        <div style={S.error} role="alert" data-testid="park-map-gl-error">
          Map unavailable: {error}
        </div>
      )}
    </div>
  );
}
