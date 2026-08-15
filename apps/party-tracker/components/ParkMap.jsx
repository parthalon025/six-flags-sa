'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { distance, formatAge, formatDistance, formatWalk, project, unproject } from '@/lib/geo';
import { landTint, paletteFor } from '@/lib/theme';
import Icon from '@/components/Icon';
import { heightLabel, isRideable } from '@/lib/park';
import {
  labelWantedAtZoom,
  layerVisible,
  normaliseRideName,
  partyMarkerState,
  planZoom,
  sizeAtZoom,
  symbolFor,
} from '@/lib/mapSymbols';
import {
  Declutter,
  boxAround,
  clampInto,
  intersect,
  labelArc,
  principalAxis,
  scaleBar,
  textWidth,
} from '@/lib/mapLabels';
import { Glyph, PoiMarker } from './MapSymbols';
import { identityOf, samePlace } from '@/lib/venue/ids';
import { useVenueSelector } from '@/lib/venue/useVenue';
import MapLegend from './MapLegend';
import { markerDeclutterPriority, markerWantsLabel } from '@/lib/mapVisual';
import { localViewTransform, stableCullView } from '@/lib/mapViewport';
import {
  assembleIsoMeshes,
  isoLocal,
  isoScreenToWorld,
  isoToScreen,
  isoViewTransform,
} from '@/lib/isoTycoon';

/* The map is drawn, not tiled: every polyline below is real OpenStreetMap
   geometry, projected to Web Mercator metres and painted as SVG. Pan with one
   finger, pinch or wheel to zoom, double-tap to zoom in.

   Nothing here knows which place it is drawing. It is handed layers of rings by
   name — paths, buildings, water, track — and a centre to open on, so a park, a
   campus or a state fair all render through the same code. Layers a venue has
   no examples of arrive empty and draw nothing.

   Static geometry is projected once into mercator metres, rebased onto the
   venue centre (SVG float32 otherwise shimmers at max zoom), and moved with an
   SVG transform; `to(x, y)` is still the one place absolute world metres become
   screen pixels for anything that has to stay upright (labels, markers, the
   puck).

   Everything that moves the viewport goes through animateTo(), so a tap on a
   roster row glides to the person instead of teleporting, and a flick keeps
   coasting after your thumb leaves the glass. */

const MIN_SCALE = 0.18;
const MAX_SCALE = 6;
const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/* Expo-out for travel, back-out for arrivals: the small overshoot at the end of
   a focus jump is what makes it read as "the map moved" rather than "the map
   was replaced". */
const easeOut = (t) => 1 - (1 - t) ** 4;
const easeBack = (t) => {
  const c = 1.34;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

const prefersStill = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* Distance from a point to a line segment, in screen pixels. Used to work out
   whether a tap landed on one of the alternative routes. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const LAND_FONT = 15;
const LAND_TRACKING = 2.4; // .16em at 15px
const POI_FONT = 9.5;

/** Screen projection for a viewport snapshot — used by the declutter pass so
 *  membership does not re-run on every pan frame. */
function projectionFor(view, spin, cx, cy, iso = false) {
  const to = (x, y) => {
    if (iso) return isoToScreen(x, y, view, cx, cy);
    const u = (x - view.x) * view.scale;
    const v = (view.y - y) * view.scale;
    return [u * spin.cos - v * spin.sin + cx, u * spin.sin + v * spin.cos + cy];
  };
  const at = (lat, lng) => to(...project(lat, lng));
  const screenDir = (ux, uy) => {
    if (iso) return [ux, -uy];
    const u = ux;
    const v = -uy;
    return [u * spin.cos - v * spin.sin, u * spin.sin + v * spin.cos];
  };
  return { to, at, screenDir };
}

/** Label spots around a marker, in screen pixels. */
const LABEL_SPOTS = (sx, sy, r, halfW, gap) => [
  { x: sx, y: sy - gap, anchor: 'middle', bx: sx, by: sy - gap - 4 },
  { x: sx, y: sy + gap + 10, anchor: 'middle', bx: sx, by: sy + gap + 6 },
  { x: sx + gap, y: sy + 3.5, anchor: 'start', bx: sx + gap + halfW - 3, by: sy },
  { x: sx - gap, y: sy + 3.5, anchor: 'end', bx: sx - gap - halfW + 3, by: sy },
];

/* Screen-space paths for overlays that move every frame live in
   pathFromLatLngs below. Venue geometry uses {@link worldPathFromRing}. */

/** Mercator-metre path, rebased to `origin` so SVG transforms stay precise. */
function worldPathFromRing(ring, close = false, origin = [0, 0], iso = false) {
  if (!Array.isArray(ring) || ring.length < 2) return '';
  const [ox, oy] = origin;
  let d = '';
  for (let i = 0; i < ring.length; i += 1) {
    const [x, y] = project(ring[i][1], ring[i][0]);
    if (iso) {
      const p = isoLocal(x - ox, y - oy);
      d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    } else {
      d += `${i === 0 ? 'M' : 'L'}${(x - ox).toFixed(2)} ${(y - oy).toFixed(2)}`;
    }
  }
  return close ? `${d}Z` : d;
}

function worldPaths(list, close, origin = [0, 0], iso = false) {
  const out = [];
  (list || []).forEach((f, i) => {
    const r = Array.isArray(f) ? f : f?.r;
    const d = worldPathFromRing(r, close, origin, iso);
    if (!d) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of r || []) {
      const [x, y] = project(pt[1], pt[0]);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const bbox = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    out.push({ i, d, n: f?.n, bbox });
  });
  return out;
}

/** Frustum test in mercator space — skip paths off-screen at high zoom. */
function featureInView(f, view, cx, cy, spin, w, h, pad = 0.2, iso = false) {
  if (!f?.bbox) return true;
  const { minX, minY, maxX, maxY } = f.bbox;
  const corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
  let sMinX = Infinity;
  let sMinY = Infinity;
  let sMaxX = -Infinity;
  let sMaxY = -Infinity;
  for (const [x, y] of corners) {
    let sx;
    let sy;
    if (iso) {
      [sx, sy] = isoToScreen(x, y, view, cx, cy);
    } else {
      const u = (x - view.x) * view.scale;
      const v = (view.y - y) * view.scale;
      sx = u * spin.cos - v * spin.sin + cx;
      sy = u * spin.sin + v * spin.cos + cy;
    }
    sMinX = Math.min(sMinX, sx);
    sMinY = Math.min(sMinY, sy);
    sMaxX = Math.max(sMaxX, sx);
    sMaxY = Math.max(sMaxY, sy);
  }
  const padX = w * pad;
  const padY = h * pad;
  return !(sMaxX < -padX || sMinX > w + padX || sMaxY < -padY || sMinY > h + padY);
}

/* Map geometry is [lng, lat] because that is how the file stores it; a route
   comes back from the router as [lat, lng] because that is how every position
   in the app is written. Hence the second one. */
function pathFromLatLngs(points, to) {
  if (!Array.isArray(points) || points.length < 2) return '';
  let d = '';
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = project(points[i][0], points[i][1]);
    const [sx, sy] = to(x, y);
    d += `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)} ${sy.toFixed(1)}`;
  }
  return d;
}

/** World-coordinate path from a route's [lat, lng] points. Drawn once in
 *  mercator metres (rebased to `origin`), then transformed by viewTransform
 *  like venue geometry. Use vector-effect="non-scaling-stroke" for stroke width. */
function worldPathFromLatLngs(points, origin = [0, 0], iso = false) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const [ox, oy] = origin;
  let d = '';
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = project(points[i][0], points[i][1]);
    if (iso) {
      const p = isoLocal(x - ox, y - oy);
      d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    } else {
      d += `${i === 0 ? 'M' : 'L'}${(x - ox).toFixed(2)} ${(y - oy).toFixed(2)}`;
    }
  }
  return d;
}

function ringToLocalMercator(ring, origin) {
  const [ox, oy] = origin;
  return (ring || []).map(([lng, lat]) => {
    const [x, y] = project(lat, lng);
    return [x - ox, y - oy];
  });
}

function mercatorBbox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of ring || []) {
    const [x, y] = project(pt[1], pt[0]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Venue geometry has no live-location inputs. Keeping it behind its own memo
 * boundary lets GPS and heading paints reconcile only the moving overlays. */
const ParkMapStaticWorld = memo(function ParkMapStaticWorld({
  world,
  mapLayers,
  showDetail,
  showService,
  lowZoom,
  theme,
  venue,
  iso = false,
  isoBuildings = [],
  isoTracks = [],
}) {
  return (
    <>
      <g className="lyr-sea">
        {world.sea.map((f) => (
          <path key={`se${f.i}`} d={f.d} />
        ))}
      </g>

      <g className="lyr-park">
        {world.park.map((f) => (
          <path key={`pk${f.i}`} d={f.d} />
        ))}
      </g>

      <g className="lyr-land">
        {world.lands.map((land) => {
          const tint = landTint(land.n, theme, venue);
          return (
            <path
              key={`ld${land.i}`}
              d={land.d}
              fill={tint.fill}
              stroke={tint.stroke}
              strokeWidth="1"
            />
          );
        })}
      </g>

      <g className="lyr-wood">
        {world.wood.map((f) => (
          <path key={`wd${f.i}`} d={f.d} />
        ))}
      </g>
      {showDetail && (
        <g className="lyr-grass lyr-detail">
          {world.grass.map((f) => (
            <path key={`gr${f.i}`} d={f.d} />
          ))}
        </g>
      )}
      <g className="lyr-parking">
        {world.parking.map((f) => (
          <path key={`pa${f.i}`} d={f.d} />
        ))}
      </g>
      <g className="lyr-water">
        {world.water.map((f) => (
          <path key={`wa${f.i}`} d={f.d} />
        ))}
      </g>
      <g className="lyr-watersheen">
        {world.water.map((f) => (
          <path key={`wash${f.i}`} d={f.d} />
        ))}
      </g>
      <g className="lyr-pool">
        {world.pool.map((f) => (
          <path key={`po${f.i}`} d={f.d} />
        ))}
      </g>

      <g className="lyr-boundary">
        {world.boundary.map((f) => (
          <path key={`bd${f.i}`} d={f.d} />
        ))}
      </g>

      {showService && (
        <g className="lyr-service lyr-detail">
          {mapLayers.service.map((f) => (
            <path key={`sv${f.i}`} d={f.d} />
          ))}
        </g>
      )}
      {!lowZoom && (
        <g className="lyr-pathcase">
          {mapLayers.path.map((f) => (
            <path key={`pc${f.i}`} d={f.d} />
          ))}
        </g>
      )}
      <g className="lyr-path">
        {mapLayers.path.map((f) => (
          <path key={`ph${f.i}`} d={f.d} />
        ))}
      </g>

      {!iso && showDetail && (
        <g className="lyr-building lyr-detail">
          {mapLayers.building.map((f) => (
            <path key={`bldg${f.i}`} d={f.d} />
          ))}
        </g>
      )}

      {!lowZoom && (
        <g className="lyr-slide">
          {world.slide.map((f) => (
            <path key={`sl${f.i}`} d={f.d} />
          ))}
        </g>
      )}
      {!iso && showDetail && (
        <>
          <g className="lyr-coastershadow">
            {world.coaster.map((f) => (
              <path key={`cs${f.i}`} d={f.d} />
            ))}
          </g>
          <g className="lyr-coaster">
            {world.coaster.map((f) => (
              <path key={`co${f.i}`} d={f.d} />
            ))}
          </g>
        </>
      )}
      {iso && (
        <g className="lyr-iso">
          {isoBuildings.map((b) => (
            <g key={`iso-b${b.i}`} className="isoBuilding">
              <path className="isoFoot" d={b.foot.d} />
              {b.walls.map((w, wi) => (
                <path
                  key={wi}
                  className={w.side === 'L' ? 'isoWallL' : 'isoWallR'}
                  d={w.d}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path className="isoRoof" d={b.roof.d} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {isoTracks.map((t) => (
            <g key={`iso-c${t.i}`} className="isoCoaster">
              <path className="isoShadow" d={t.shadow.d} vectorEffect="non-scaling-stroke" />
              {t.supports.map((s, si) => (
                <path key={si} className="isoSupport" d={s.d} vectorEffect="non-scaling-stroke" />
              ))}
              <path className="isoTrack" d={t.track.d} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </g>
      )}
    </>
  );
});

function ParkMap({
  data,
  center,
  pois,
  me,
  members,
  meet,
  car,
  selected,
  onSelectPoi,
  onMapTap,
  armMeet,
  follow,
  onUserPan,
  heading,
  eligibility,
  visibleCategories,
  onToggleCategory,
  focusPoint,
  theme,
  route,
  routeStep,
  routeAhead,
  routeDone,
  routeTargetName,
  alternatives,
  onPickAlternative,
  puck,
  bottomInset = 190,
  rotation = 0,
  liftCentre = 0,
  navZoom = null,
  fitPoints,
  fitKey = null,
  /** Fold the category key while route preview or walking HUD is up. */
  mapKeyHidden = false,
  /** Optional map perf HUD callback (Diagnostics M0). */
  onMapStats = null,
  marks = [],
  selfKit = null,
  onThankMark = null,
  /** Queue pins and path crumbs from Overlay — not extra ride Places. */
  overlayPins = [],
  /** Next Plan Place id — promoted in declutter below Go/selection. */
  planNextPlaceId = null,
  /** Soft exploration fog filter from mapVisual.fogMapStyle. */
  fogFilter = null,
}) {
  const palette = paletteFor(theme);
  const iso = theme === 'pixel-tycoon';
  // The venue's own district tints, where it has hand-picked any.
  const venue = useVenueSelector((s) => s.venue);
  // What this venue has any of at all, so the key can offer switches for those
  // and only those. Cheap: it is one pass over a list of a few hundred.
  const presentCategories = useMemo(() => new Set((pois || []).map((p) => p.c)), [pois]);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 360, h: 640 });
  // view is centred on a mercator metre coordinate at `scale` px per metre
  const [view, setView] = useState(() => {
    const [x, y] = project(center?.lat ?? 0, center?.lng ?? 0);
    return { x, y, scale: 0.95 };
  });
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const moved = useRef(false);
  const viewRef = useRef(view);
  const raf = useRef(0);
  const viewRaf = useRef(0);
  const pendingView = useRef(null);
  const fling = useRef({ vx: 0, vy: 0, t: 0 });
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  // Cached wrap rect for the active gesture — getBoundingClientRect every
  // touchmove is layout thrash on phones during pinch.
  const wrapRect = useRef(null);
  // Sticky across both finger-ups so a pinch cannot hand off to fling.
  const pinchSession = useRef(false);
  // The laid-out markers, so a tap can be resolved against what was drawn.
  const planRef = useRef({ lands: [], markers: [], labels: [] });
  // Hysteresis for zoom-gated layers and place names — previous pass's answer,
  // so a jittery pinch does not restrobe the map.
  const [layersOn, setLayersOn] = useState({ lands: false, detail: false, service: false });
  const [shownLabels, setShownLabels] = useState(() => new Set());
  const pixelRatio =
    typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;

  viewRef.current = view;

  const readWrapRect = useCallback((force = false) => {
    if (!force && wrapRect.current) return wrapRect.current;
    const node = wrapRef.current;
    if (!node) return { left: 0, top: 0, width: 0, height: 0 };
    wrapRect.current = node.getBoundingClientRect();
    return wrapRect.current;
  }, []);

  /** Push a view change. Gestures may fire faster than paint; coalesce to one
   *  React update per frame while keeping viewRef hot for the next event. */
  const pushView = useCallback((next) => {
    const resolved = typeof next === 'function' ? next(viewRef.current) : next;
    const prev = viewRef.current;
    // Wheel/pinch at the scale clamp still rebuilds a new object; skip the
    // React paint when nothing actually moved. On phones a clamped pinch still
    // floods move events; bailing here keeps the map from thrashing.
    if (
      prev &&
      Math.abs(resolved.x - prev.x) < 1e-9 &&
      Math.abs(resolved.y - prev.y) < 1e-9 &&
      Math.abs(resolved.scale - prev.scale) < 1e-12
    ) {
      return;
    }
    viewRef.current = resolved;
    pendingView.current = resolved;
    if (viewRaf.current) return;
    viewRaf.current = requestAnimationFrame(() => {
      viewRaf.current = 0;
      if (pendingView.current) setView(pendingView.current);
    });
  }, []);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const ro = new ResizeObserver(() => {
      setSize({ w: node.clientWidth, h: node.clientHeight });
    });
    ro.observe(node);
    setSize({ w: node.clientWidth, h: node.clientHeight });
    return () => ro.disconnect();
  }, []);

  const stopAnim = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  useEffect(
    () => () => {
      stopAnim();
      if (viewRaf.current) cancelAnimationFrame(viewRaf.current);
    },
    [stopAnim],
  );

  /**
   * Tween the viewport to a target. Scale is interpolated geometrically —
   * linear interpolation of a px-per-metre figure reads as a lurch at the start
   * and a crawl at the end, because what the eye tracks is the ratio.
   */
  const animateTo = useCallback(
    (target, { duration = 620, ease = easeOut } = {}) => {
      stopAnim();
      if (viewRaf.current) {
        cancelAnimationFrame(viewRaf.current);
        viewRaf.current = 0;
      }
      const from = { ...viewRef.current };
      const to = {
        x: Number.isFinite(target.x) ? target.x : from.x,
        y: Number.isFinite(target.y) ? target.y : from.y,
        scale: clampScale(Number.isFinite(target.scale) ? target.scale : from.scale),
      };
      const still = Math.abs(to.x - from.x) < 0.2 && Math.abs(to.y - from.y) < 0.2
        && Math.abs(to.scale - from.scale) < 0.001;
      if (still) return;
      if (prefersStill() || duration <= 0) {
        pushView(to);
        return;
      }
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const k = ease(p);
        const next = {
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          scale: from.scale * (to.scale / from.scale) ** k,
        };
        pushView(next);
        raf.current = p < 1 ? requestAnimationFrame(step) : 0;
      };
      raf.current = requestAnimationFrame(step);
    },
    [stopAnim, pushView],
  );

  // A new venue is a new part of the world: jump to it rather than leaving the
  // view parked over the last one, where its geometry is thousands of miles off
  // screen and the map looks broken. A jump, not a glide — animateTo() would
  // sweep the camera across a continent.
  const venueKey = `${center?.lat},${center?.lng}`;
  useEffect(() => {
    if (!center) return;
    stopAnim();
    const [x, y] = project(center.lat, center.lng);
    setView((v) => ({ ...v, x, y }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueKey]);

  // Follow mode keeps the marker centred without fighting manual pans. While a
  // route is running it follows the snapped point rather than the raw fix, so
  // the camera stops sliding sideways every time GPS changes its mind. A short
  // glide rather than a jump: fixes land every few seconds and a teleporting
  // map is how you lose track of where you were looking.
  const anchorLat = puck?.lat ?? me?.lat ?? null;
  const anchorLng = puck?.lng ?? me?.lng ?? null;
  useEffect(() => {
    if (!follow || anchorLat == null) return;
    const [x, y] = project(anchorLat, anchorLng);
    const cur = viewRef.current;
    const drift = Math.hypot(x - cur.x, y - cur.y);
    // GPS and graph snapping jitter by a metre or two; at walking zoom that is
    // a few pixels, but zoomed in it reads as the map bouncing in place.
    const deadband = Math.max(0.8, 6 / cur.scale);
    if (drift < deadband) return;
    animateTo({ x, y }, { duration: 480 });
  }, [follow, anchorLat, anchorLng, animateTo]);

  // An explicit focus request (tapping a roster row, a ride, the meet-up)
  // recentres and zooms in a little if we are far out.
  useEffect(() => {
    if (!focusPoint) return;
    const [x, y] = project(focusPoint.lat, focusPoint.lng);
    animateTo(
      { x, y, scale: Math.max(viewRef.current.scale, 1.6) },
      { duration: 700, ease: easeBack },
    );
  }, [focusPoint, animateTo]);

  // Setting off pulls the camera in to walking zoom; ending a route leaves it
  // where the walk finished rather than yanking it back out.
  useEffect(() => {
    if (navZoom == null) return;
    setView((v) => ({ ...v, scale: navZoom }));
  }, [navZoom]);

  /* Frame a whole route on screen — what you want while deciding, as against
     the nose-down camera you want while walking. Keyed rather than watching the
     points array, so panning around a preview does not keep snapping back. */
  useEffect(() => {
    if (!fitKey || !fitPoints?.length || !size.w || !size.h) return;
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    fitPoints.forEach(([lat, lng]) => {
      const [x, y] = project(lat, lng);
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    });
    const usableW = size.w * 0.82;
    const usableH = size.h * 0.46;
    const scale = Math.min(
      6,
      Math.max(0.18, Math.min(usableW / Math.max(east - west, 1), usableH / Math.max(north - south, 1))),
    );
    setView({ x: (west + east) / 2, y: (south + north) / 2, scale });
  }, [fitKey, fitPoints, size.w, size.h]);

  /* Rotation lives in the projection rather than in an SVG transform over the
     whole map. A transform would take every label and marker round with it —
     upside-down ride names the moment you walk south — and undoing that per
     element costs more than the two extra multiplications here. */
  const mapRotation = iso ? 0 : rotation;
  const spin = useMemo(() => {
    const t = (-mapRotation * Math.PI) / 180;
    return { cos: Math.cos(t), sin: Math.sin(t) };
  }, [mapRotation]);
  // Course-up puts you near the bottom of the screen looking up the route, so
  // the centre of the map sits below the centre of the viewport.
  const cx = size.w / 2;
  const cy = size.h / 2 + liftCentre * size.h;

  const to = useCallback(
    (x, y) => {
      if (iso) return isoToScreen(x, y, view, cx, cy);
      const u = (x - view.x) * view.scale;
      const v = (view.y - y) * view.scale;
      return [u * spin.cos - v * spin.sin + cx, u * spin.sin + v * spin.cos + cy];
    },
    [iso, view, spin, cx, cy],
  );

  const at = useCallback((lat, lng) => to(...project(lat, lng)), [to]);

  /* A world direction as a screen direction. North is not up once the map
     turns, and a district name lying along its district has to turn with it. */
  const screenDir = useCallback(
    (ux, uy) => {
      const u = ux;
      const v = -uy;
      return [u * spin.cos - v * spin.sin, u * spin.sin + v * spin.cos];
    },
    [spin],
  );

  const screenToLatLng = useCallback(
    (px, py) => {
      if (iso) {
        const w = isoScreenToWorld(px, py, view, cx, cy);
        return unproject(w.x, w.y);
      }
      const dx = px - cx;
      const dy = py - cy;
      const u = dx * spin.cos + dy * spin.sin;
      const v = -dx * spin.sin + dy * spin.cos;
      return unproject(u / view.scale + view.x, view.y - v / view.scale);
    },
    [iso, view, spin, cx, cy],
  );

  /** World metres under a screen point at the current view. */
  const screenToWorld = useCallback(
    (px, py, snap = viewRef.current) => {
      if (iso) return isoScreenToWorld(px, py, snap, cx, cy);
      const dx = px - cx;
      const dy = py - cy;
      const u = dx * spin.cos + dy * spin.sin;
      const v = -dx * spin.sin + dy * spin.cos;
      return {
        x: u / snap.scale + snap.x,
        y: snap.y - v / snap.scale,
      };
    },
    [iso, spin, cx, cy],
  );

  /** View centre that keeps `world` pinned under the same screen point at `scale`. */
  const viewForScaleAt = useCallback(
    (scale, px, py, worldPt, snap = viewRef.current) => {
      if (iso) {
        const pinned = isoScreenToWorld(px, py, { ...snap, scale }, cx, cy);
        return {
          x: snap.x + (worldPt.x - pinned.x),
          y: snap.y + (worldPt.y - pinned.y),
          scale,
        };
      }
      const dx = px - cx;
      const dy = py - cy;
      const u = dx * spin.cos + dy * spin.sin;
      const v = -dx * spin.sin + dy * spin.cos;
      return {
        x: worldPt.x - u / scale,
        y: worldPt.y + v / scale,
        scale,
      };
    },
    [iso, spin, cx, cy],
  );

  /** Zoom about a screen point, keeping whatever is under it under it. */
  const zoomAround = useCallback(
    (factor, px, py, duration = 320) => {
      const v = viewRef.current;
      const scale = clampScale(v.scale * factor);
      const fx = px == null ? cx : px;
      const fy = py == null ? cy : py;
      const world = screenToWorld(fx, fy, v);
      animateTo(viewForScaleAt(scale, fx, fy, world, v), { duration });
    },
    [animateTo, screenToWorld, viewForScaleAt, cx, cy],
  );

  /* ---------- gestures ---------- */
  const onPointerDown = (e) => {
    stopAnim();
    fling.current = { vx: 0, vy: 0, t: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    // Fresh layout box for this gesture — pinch maths and tap hit-tests share it.
    readWrapRect(true);
    if (pointers.current.size === 2) {
      pinchSession.current = true;
      const [a, b] = [...pointers.current.values()];
      const rect = readWrapRect();
      gesture.current = {
        mode: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: viewRef.current.scale,
        midX: (a.x + b.x) / 2 - rect.left,
        midY: (a.y + b.y) / 2 - rect.top,
      };
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    // Touch screens deliver coalesced samples between frames; folding them in
    // keeps the finger glued to the map and gives fling a truer release velocity.
    const samples =
      typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length
        ? e.getCoalescedEvents()
        : [e];

    for (const sample of samples) {
      const prev = pointers.current.get(sample.pointerId) || pointers.current.get(e.pointerId);
      if (!prev) continue;
      const next = { x: sample.clientX, y: sample.clientY };
      pointers.current.set(e.pointerId, next);

      if (pointers.current.size === 2 && gesture.current?.mode === 'pinch') {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const ratio = dist / gesture.current.dist;
        const scale = clampScale(gesture.current.scale * ratio);
        if (Math.abs(dist - gesture.current.dist) > 4) {
          moved.current = true;
          onUserPan?.();
        }
        const rect = readWrapRect();
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        const snap = viewRef.current;
        const world = screenToWorld(midX, midY, snap);
        pushView(viewForScaleAt(scale, midX, midY, world, snap));
        continue;
      }

      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        moved.current = true;
        onUserPan?.();
      }
      // Screen-space velocity, kept for the flick. Blended rather than replaced so
      // one stuttering frame at lift-off cannot cancel the whole throw.
      fling.current = {
        vx: fling.current.vx * 0.5 + dx * 0.5,
        vy: fling.current.vy * 0.5 + dy * 0.5,
        t: performance.now(),
      };
      // A drag is in screen pixels; with the map turned, the world moves along a
      // different axis than the finger does.
      const u = dx * spin.cos + dy * spin.sin;
      const v = -dx * spin.sin + dy * spin.cos;
      pushView((s) => ({ ...s, x: s.x - u / s.scale, y: s.y + v / s.scale }));
    }
  };

  /** Momentum after a flick: decay the last velocity until it is under a pixel. */
  const startFling = useCallback(() => {
    const { vx, vy, t } = fling.current;
    if (prefersStill()) return;
    if (performance.now() - t > 110) return;
    if (Math.hypot(vx, vy) < 3) return;
    let dx = Math.max(-60, Math.min(60, vx));
    let dy = Math.max(-60, Math.min(60, vy));
    const step = () => {
      dx *= 0.93;
      dy *= 0.93;
      if (Math.hypot(dx, dy) < 0.4) {
        raf.current = 0;
        return;
      }
      // Same screen-to-world rotation the drag uses: a flick on a turned map has
      // to coast along the axis the thumb threw it, not along north.
      const u = dx * spin.cos + dy * spin.sin;
      const w = -dx * spin.sin + dy * spin.cos;
      pushView((s) => ({ ...s, x: s.x - u / s.scale, y: s.y + w / s.scale }));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [spin, pushView]);

  const pickAt = (px, py) => {
    let best = null;
    for (const m of planRef.current.markers) {
      const reach = Math.max(m.r + 6, 13);
      const d = Math.hypot(m.sx - px, m.sy - py);
      if (d <= reach && (!best || d < best.d)) best = { poi: m.p, d };
    }
    return best?.poi ?? null;
  };

  const pickRouteAt = (px, py) => {
    let best = null;
    (alternatives || []).forEach((alt) => {
      const pts = alt.points || [];
      for (let i = 1; i < pts.length; i += 1) {
        const [ax, ay] = at(pts[i - 1][0], pts[i - 1][1]);
        const [bx, by] = at(pts[i][0], pts[i][1]);
        const d = distToSegment(px, py, ax, ay, bx, by);
        if (d <= 20 && (!best || d < best.d)) best = { index: alt.index, d };
      }
    });
    return best?.index ?? null;
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size > 0) return;
    wrapRect.current = null;
    const wasPinch = pinchSession.current;
    pinchSession.current = false;

    // Pinch must not hand off to fling — on phones that reads as the map
    // leaping after a zoom. pinchSession stays set until every finger is up.
    if (moved.current && !wasPinch) {
      startFling();
      return;
    }

    const rect = readWrapRect(true);
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Resolved here rather than by a handler on each marker: setPointerCapture
    // above retargets every later pointer event at the wrapper, so a pointerup
    // listener on a marker never heard the tap that landed on it and nothing
    // was ever selectable. Hit-testing what we actually placed is exact, and it
    // is 150 comparisons instead of 150 event listeners.
    const poi = pickAt(px, py);
    if (poi) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      onSelectPoi?.(poi);
      return;
    }
    const alt = pickRouteAt(px, py);
    if (alt != null) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      onPickAlternative?.(alt);
      return;
    }

    const now = performance.now();
    const tap = lastTap.current;
    // Second tap of a double-tap zooms instead of repeating the first tap's
    // action, so a meet-up pin is never dropped twice in the same spot.
    if (now - tap.t < 300 && Math.hypot(px - tap.x, py - tap.y) < 34) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      zoomAround(1.85, px, py, 420);
      onUserPan?.();
      return;
    }
    lastTap.current = { t: now, x: px, y: py };
    const [lat, lng] = screenToLatLng(px, py);
    onMapTap?.(lat, lng);
  };

  const onWheel = (e) => {
    e.preventDefault();
    onUserPan?.();
    stopAnim();
    const rect = readWrapRect(true);
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const v = viewRef.current;
    const scale = clampScale(v.scale * (e.deltaY > 0 ? 0.9 : 1.11));
    const world = screenToWorld(px, py, v);
    pushView(viewForScaleAt(scale, px, py, world, v));
  };

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    // Stop the page scrolling behind the map — but not inside the key, which
    // is a scrolling list sitting on top of it.
    const stop = (e) => {
      if (!e.target?.closest?.('.mapKey')) e.preventDefault();
    };
    node.addEventListener('wheel', stop, { passive: false });
    return () => node.removeEventListener('wheel', stop);
  }, []);

  /* ---------- layer rendering ---------- */
  const z = view.scale;
  const zPlan = planZoom(z);
  /* District names / detail / service layers use enter/leave thresholds so a
     pinch that jitters on the boundary does not remount thousands of paths. */
  const showLands = layerVisible(zPlan, 0.34, 0.28, layersOn.lands);
  const showDetail = layerVisible(zPlan, 0.7, 0.62, layersOn.detail);
  const showService = layerVisible(zPlan, 1.4, 1.28, layersOn.service);
  const lowZoom = !showDetail || zPlan < 0.85;

  useEffect(() => {
    setLayersOn((prev) => {
      if (prev.lands === showLands && prev.detail === showDetail && prev.service === showService) {
        return prev;
      }
      return { lands: showLands, detail: showDetail, service: showService };
    });
  }, [showLands, showDetail, showService]);

  /* Venue geometry in mercator metres, rebased to the venue centre so SVG
     float32 transforms stay sharp at max zoom. Built once per dataset/origin. */
  const worldOrigin = useMemo(
    () => project(center?.lat ?? 0, center?.lng ?? 0),
    [center?.lat, center?.lng],
  );

  const world = useMemo(() => {
    if (!data) return null;
    const origin = worldOrigin;
    return {
      sea: worldPaths(data.sea, true, origin, iso),
      park: worldPaths(data.park, true, origin, iso),
      lands: (data.lands || [])
        .map((land, i) => {
          const d = worldPathFromRing(land.r, true, origin, iso);
          return d ? { i, d, n: land.n } : null;
        })
        .filter(Boolean),
      wood: worldPaths(data.wood, true, origin, iso),
      grass: worldPaths(data.grass, true, origin, iso),
      parking: worldPaths(data.parking, true, origin, iso),
      water: worldPaths(data.water, true, origin, iso),
      pool: worldPaths(data.pool, true, origin, iso),
      boundary: data.boundary ? worldPaths([data.boundary], true, origin, iso) : [],
      service: worldPaths(data.service, false, origin, iso),
      path: worldPaths(data.path, false, origin, iso),
      building: worldPaths(data.building, true, origin, iso),
      slide: worldPaths(data.slide, false, origin, iso),
      coaster: (data.coaster || [])
        .map((f, i) => {
          const d = worldPathFromRing(Array.isArray(f) ? f : f?.r, false, origin, iso);
          return d ? { i, d, n: f?.n } : null;
        })
        .filter(Boolean),
    };
  }, [data, worldOrigin, iso]);

  const isoMeshesAll = useMemo(() => {
    if (!iso || !data) return { buildings: [], tracks: [] };
    const origin = worldOrigin;
    const buildingRings = [];
    const buildingBboxes = [];
    (data.building || []).forEach((f) => {
      const r = Array.isArray(f) ? f : f?.r;
      buildingRings.push(ringToLocalMercator(r, origin));
      buildingBboxes.push(mercatorBbox(r));
    });
    const coasterLines = [];
    const coasterBboxes = [];
    (data.coaster || []).forEach((f) => {
      const r = Array.isArray(f) ? f : f?.r;
      coasterLines.push(ringToLocalMercator(r, origin));
      coasterBboxes.push(mercatorBbox(r));
    });
    const assembled = assembleIsoMeshes(buildingRings, coasterLines, {
      maxBuildings: 800,
      maxTracks: 200,
    });
    return {
      buildings: assembled.buildings.map((b) => ({ ...b, bbox: buildingBboxes[b.i] })),
      tracks: assembled.tracks.map((t) => ({ ...t, bbox: coasterBboxes[t.i] })),
    };
  }, [iso, data, worldOrigin]);

  const viewTransform = useMemo(
    () =>
      iso
        ? isoViewTransform({
            cx,
            cy,
            scale: z,
            viewX: view.x,
            viewY: view.y,
            originX: worldOrigin[0],
            originY: worldOrigin[1],
            pixelRatio,
          })
        : localViewTransform({
            cx,
            cy,
            rotation,
            scale: z,
            viewX: view.x,
            viewY: view.y,
            originX: worldOrigin[0],
            originY: worldOrigin[1],
            pixelRatio,
          }),
    [iso, cx, cy, rotation, z, view.x, view.y, worldOrigin, pixelRatio],
  );

  /* Cull path-heavy venues even in overview, but snap the cull camera onto a
     screen-sized grid so membership does not thrash every pan frame. */
  const cullCellX = Math.round((view.x * Math.max(view.scale, 0.01)) / 160);
  const cullCellY = Math.round((view.y * Math.max(view.scale, 0.01)) / 160);
  const cullScaleBand = Math.round(view.scale * 40);
  const cullEnabled = world?.path.length > 80 || (showDetail && z >= 1.2);
  const cullView = useMemo(() => {
    if (!cullEnabled) return null;
    return stableCullView(view);
    // Quantized cell deps — not raw view — keep the object identity stable
    // across pan frames inside the same cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cullEnabled, cullCellX, cullCellY, cullScaleBand]);

  const drawWorld = useMemo(() => {
    if (!world) return null;
    if (!cullView) return world;
    const cullPad = lowZoom ? 1.2 : 0.55;
    const cull = (list) =>
      list.filter((f) => featureInView(f, cullView, cx, cy, spin, size.w, size.h, cullPad, iso));
    return {
      ...world,
      path: cull(world.path),
      building: cull(world.building),
      service: showService ? cull(world.service) : world.service,
    };
  }, [world, cullView, lowZoom, cx, cy, spin, size.w, size.h, showService, iso]);

  const mapLayers = drawWorld || world;

  const isoMeshes = useMemo(() => {
    if (!iso) return { buildings: [], tracks: [] };
    const cam = cullView || stableCullView(view);
    const vis = (list, pad) =>
      list.filter((f) => featureInView(f, cam, cx, cy, spin, size.w, size.h, pad, true));
    return {
      buildings: vis(isoMeshesAll.buildings, 0.55).slice(0, 400),
      tracks: vis(isoMeshesAll.tracks, 0.7).slice(0, 80),
    };
    // Quantized cull cells — not raw view — keep meshes stable across pan frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, isoMeshesAll, cullView, cullCellX, cullCellY, cullScaleBand, cx, cy, spin, size.w, size.h]);

  /* Route paths in world coordinates — drawn once per route change, then
     transformed by viewTransform like venue geometry. Uses non-scaling-stroke
     so stroke widths stay constant across zoom levels. */
  const worldRouteAhead = useMemo(
    () => worldPathFromLatLngs(routeAhead?.length > 1 ? routeAhead : route?.points, worldOrigin, iso),
    [routeAhead, route?.points, worldOrigin, iso],
  );
  const worldRouteDone = useMemo(
    () => (routeDone?.length > 1 ? worldPathFromLatLngs(routeDone, worldOrigin, iso) : ''),
    [routeDone, worldOrigin, iso],
  );
  const worldAlternatives = useMemo(
    () => (alternatives || []).map((alt) => worldPathFromLatLngs(alt.points, worldOrigin, iso)),
    [alternatives, worldOrigin, iso],
  );

  /* Coaster track carries the ride's name in the source geometry, so the red
     polylines need not stay anonymous: tapping Diamondback can light up
     Diamondback's track rather than leaving you to guess which squiggle it is. */
  const trackByRide = useMemo(() => {
    const index = new Map();
    (data?.coaster || []).forEach((f, i) => {
      const key = normaliseRideName(f?.n);
      if (!key) return;
      const bucket = index.get(key);
      if (bucket) bucket.push(i);
      else index.set(key, [i]);
    });
    return index;
  }, [data]);

  const litTrack = useMemo(() => {
    if (!selected || !data?.coaster) return [];
    const keys = [normaliseRideName(selected.n), normaliseRideName(selected.alias)];
    const out = [];
    keys.forEach((k) => {
      if (k) (trackByRide.get(k) || []).forEach((i) => out.push(i));
    });
    return out;
  }, [selected, trackByRide, data]);

  /* Each district's long axis, computed once from the geometry rather than per
     frame. Some are two polygons under one name, so they are pooled. */
  const landAxes = useMemo(() => {
    if (!data?.lands?.length) return [];
    const pooled = new Map();
    data.lands.forEach((land) => {
      const pts = (land.r || []).map(([lng, lat]) => project(lat, lng));
      const cur = pooled.get(land.n);
      if (cur) cur.push(...pts);
      else pooled.set(land.n, pts);
    });
    return [...pooled.entries()]
      .map(([name, pts]) => ({ name, axis: principalAxis(pts) }))
      .filter((l) => l.axis);
  }, [data]);

  /* ---------- the decluttering pass ----------
     One budget of screen space, spent in importance order: district names
     first, then the markers you and your party are, then places, then place
     names. Anything that will not fit is dropped rather than drawn on top of
     what is already there.

     Membership decisions use a quantized zoom so a continuous pinch does not
     re-bid every frame; marker/label positions still track the live view. */
  const layoutPlan = useMemo(() => {
    const grid = new Declutter();
    const landWinners = [];
    const markerItems = [];
    const nextShown = new Set();
    if (!data) return { landWinners, markerItems, nextShown };

    const { to, at, screenDir } = projectionFor(viewRef.current, spin, cx, cy, iso);

    // `bottomInset` is how much of the map the sheet is standing on right now:
    // it grows when the sheet is opened and shrinks to the nav bar while
    // walking, and a label laid out against the wrong number ends up behind it.
    const floor = size.h - bottomInset;
    const frame = { x0: 58, x1: size.w - 58, y0: 104, y1: floor - 6 };
    [
      { x0: -30, x1: size.w + 30, y0: -30, y1: 100 }, // the title card
      { x0: -30, x1: size.w + 30, y0: floor, y1: size.h + 30 }, // the sheet
      { x0: size.w - 96, x1: size.w + 30, y0: floor - 200, y1: floor + 4 }, // zoom pad + FABs
      { x0: -30, x1: 180, y0: floor - 106, y1: floor + 4 }, // key, compass, scale
    ].forEach((box) => grid.occupy(box));

    if (showLands) {
      const candidates = [];
      landAxes.forEach(({ name, axis }) => {
        const anchor = data.landAnchors?.[name];
        if (!anchor) return;
        const { x0, x1, y0, y1 } = axis.bounds;
        const corners = [to(x0, y0), to(x1, y0), to(x1, y1), to(x0, y1)];
        const box = {
          x0: Math.min(...corners.map((c) => c[0])),
          x1: Math.max(...corners.map((c) => c[0])),
          y0: Math.min(...corners.map((c) => c[1])),
          y1: Math.max(...corners.map((c) => c[1])),
        };
        const room = intersect(box, frame);
        if (!room) return;

        const width = textWidth(name, LAND_FONT, LAND_TRACKING);
        const span = width * 1.25;
        let [dx, dy] = screenDir(axis.ux, axis.uy);
        const mag = Math.hypot(dx, dy) || 1;
        dx /= mag;
        dy /= mag;
        if (dx < 0) {
          dx = -dx;
          dy = -dy;
        }
        const insetX = Math.abs(dx * width) / 2 + 4;
        const insetY = Math.abs(dy * width) / 2 + 8;
        const shrink = (rect) => ({
          x0: rect.x0 + insetX,
          x1: rect.x1 - insetX,
          y0: rect.y0 + insetY,
          y1: rect.y1 - insetY,
        });
        const roomFits = shrink(room);
        const frameFits = shrink(frame);
        const holds = (r) => r.x0 <= r.x1 && r.y0 <= r.y1;
        const [ax, ay] = at(anchor[0], anchor[1]);
        let lx;
        let ly;
        if (holds(roomFits)) {
          [lx, ly] = clampInto(ax, ay, roomFits);
        } else if (holds(frameFits)) {
          const [nx, ny] = clampInto(ax, ay, room);
          [lx, ly] = clampInto(nx, ny, frameFits);
        } else {
          return;
        }

        const steps = Math.max(2, Math.round(width / 30));
        const step = width / steps;
        const along = step / 2;
        const across = 8;
        const boxes = [];
        for (let i = 0; i < steps; i += 1) {
          const t = -width / 2 + (i + 0.5) * step;
          boxes.push(
            boxAround(
              lx + dx * t,
              ly + dy * t,
              Math.abs(dx) * along + Math.abs(dy) * across,
              Math.abs(dy) * along + Math.abs(dx) * across,
            ),
          );
        }
        candidates.push({
          name,
          anchor,
          axis,
          span,
          boxes,
          area: (room.x1 - room.x0) * (room.y1 - room.y0),
        });
      });

      candidates.sort((a, b) => b.area - a.area);
      candidates.forEach((c) => {
        if (c.boxes.some((b) => !grid.free(b))) return;
        c.boxes.forEach((b) => grid.occupy(b));
        landWinners.push({
          name: c.name,
          anchor: c.anchor,
          axis: c.axis,
          span: c.span,
        });
      });
    }

    const reserve = (lat, lng, half) => {
      if (lat == null || lng == null) return;
      const [sx, sy] = at(lat, lng);
      grid.claim(boxAround(sx, sy, half, half), true);
    };
    reserve(puck?.lat ?? me?.lat, puck?.lng ?? me?.lng, 15);
    (members || []).forEach((m) => reserve(m.lat, m.lng, 17));
    if (meet) reserve(meet.lat, meet.lng, 16);
    const routePts = route?.points;
    if (routePts?.length > 1) {
      const step = Math.max(1, Math.floor(routePts.length / 14));
      for (let ri = 0; ri < routePts.length; ri += step) {
        const [sx, sy] = at(routePts[ri][0], routePts[ri][1]);
        grid.occupy(boxAround(sx, sy, 7, 7), true);
      }
    }

    const ranked = [];
    pois.forEach((p, i) => {
      if (!visibleCategories.has(p.c)) return;
      const [sx, sy] = at(p.lat, p.lng);
      if (sx < -60 || sy < -60 || sx > size.w + 60 || sy > size.h + 60) return;
      const sym = symbolFor(p.c);
      const placeId = identityOf(p);
      const state = eligibility?.at(placeId)?.kind || 'unknown';
      const barred = state === 'not';
      const isSel = samePlace(selected, p);
      const isNav = Boolean(routeTargetName) && (placeId === routeTargetName || p.n === routeTargetName);
      const isPlanNext =
        Boolean(planNextPlaceId) && (placeId === planNextPlaceId || p.i === planNextPlaceId);
      const priority = markerDeclutterPriority({
        isSelected: isSel,
        isNav,
        isPlanNext,
        rank: sym.rank,
        barred,
        index: i,
      });
      ranked.push({ p, sx, sy, sym, state, isSel, isNav, isPlanNext, priority });
    });
    ranked.sort((a, b) => a.priority - b.priority);

    ranked.forEach((item) => {
      const r = sizeAtZoom(item.sym.r, zPlan);
      const pinned = item.isSel || item.isNav || item.isPlanNext;
      if (!grid.claim(boxAround(item.sx, item.sy, r + 1.5, r + 1.5), pinned)) return;

      const placeId = identityOf(item.p);
      const wasShown = shownLabels.has(placeId);
      const wanted =
        markerWantsLabel({
          isSelected: item.isSel,
          isNav: item.isNav,
          isPlanNext: item.isPlanNext,
          rank: item.sym.rank,
          zPlan,
          wasShown,
        }) || (pinned && !item.isSel);
      let labelSpot = -1;
      if (wanted && !item.isSel) {
        const halfW = textWidth(item.p.n, POI_FONT) / 2 + 3;
        const gap = r + 5;
        const spots = LABEL_SPOTS(item.sx, item.sy, r, halfW, gap);
        for (let si = 0; si < spots.length; si += 1) {
          const spot = spots[si];
          const box = boxAround(spot.bx, spot.by, halfW, 7);
          if (box.x0 < 2 || box.y0 < 2 || box.x1 > size.w - 2 || box.y1 > floor - 2) continue;
          if (!grid.claim(box, false)) continue;
          labelSpot = si;
          nextShown.add(placeId);
          break;
        }
      }

      markerItems.push({
        p: item.p,
        placeId,
        sym: item.sym,
        state: item.state,
        isSel: item.isSel,
        isNav: item.isNav,
        isPlanNext: item.isPlanNext,
        r,
        labelSpot,
        faded: item.state === 'not',
      });
    });

    return { landWinners, markerItems, markerTotal: ranked.length, nextShown };
  }, [
    data,
    pois,
    size.w,
    size.h,
    bottomInset,
    zPlan,
    showLands,
    landAxes,
    visibleCategories,
    eligibility,
    selected,
    routeTargetName,
    planNextPlaceId,
    route?.points,
    members,
    meet,
    me,
    puck,
    shownLabels,
    spin,
    cx,
    cy,
    iso,
  ]);

  const plan = useMemo(() => {
    const lands = [];
    const markers = [];
    const labels = [];
    const { landWinners, markerItems, nextShown } = layoutPlan;

    const floor = size.h - bottomInset;
    const frame = { x0: 58, x1: size.w - 58, y0: 104, y1: floor - 6 };
    const wholly = (box) => box.x0 >= 2 && box.y0 >= 2 && box.x1 <= size.w - 2 && box.y1 <= floor;

    landWinners.forEach(({ name, anchor, axis, span }) => {
      const { x0, x1, y0, y1 } = axis.bounds;
      const corners = [to(x0, y0), to(x1, y0), to(x1, y1), to(x0, y1)];
      const box = {
        x0: Math.min(...corners.map((c) => c[0])),
        x1: Math.max(...corners.map((c) => c[0])),
        y0: Math.min(...corners.map((c) => c[1])),
        y1: Math.max(...corners.map((c) => c[1])),
      };
      const room = intersect(box, frame);
      if (!room) return;

      const width = textWidth(name, LAND_FONT, LAND_TRACKING);
      let [dx, dy] = screenDir(axis.ux, axis.uy);
      const mag = Math.hypot(dx, dy) || 1;
      dx /= mag;
      dy /= mag;
      if (dx < 0) {
        dx = -dx;
        dy = -dy;
      }
      const insetX = Math.abs(dx * width) / 2 + 4;
      const insetY = Math.abs(dy * width) / 2 + 8;
      const shrink = (rect) => ({
        x0: rect.x0 + insetX,
        x1: rect.x1 - insetX,
        y0: rect.y0 + insetY,
        y1: rect.y1 - insetY,
      });
      const roomFits = shrink(room);
      const frameFits = shrink(frame);
      const holds = (r) => r.x0 <= r.x1 && r.y0 <= r.y1;
      const [ax, ay] = at(anchor[0], anchor[1]);
      let lx;
      let ly;
      if (holds(roomFits)) {
        [lx, ly] = clampInto(ax, ay, roomFits);
      } else if (holds(frameFits)) {
        const [nx, ny] = clampInto(ax, ay, room);
        [lx, ly] = clampInto(nx, ny, frameFits);
      } else {
        return;
      }
      lands.push({ name, d: labelArc(lx, ly, dx, dy, span) });
    });

    markerItems.forEach((item) => {
      const [sx, sy] = at(item.p.lat, item.p.lng);
      if (sx < -60 || sy < -60 || sx > size.w + 60 || sy > size.h + 60) return;
      markers.push({ ...item, sx, sy });

      if (item.labelSpot < 0) return;
      const halfW = textWidth(item.p.n, POI_FONT) / 2 + 3;
      const gap = item.r + 5;
      const spot = LABEL_SPOTS(sx, sy, item.r, halfW, gap)[item.labelSpot];
      const box = boxAround(spot.bx, spot.by, halfW, 7);
      if (!wholly(box)) return;
      labels.push({
        key: item.placeId,
        text: item.p.n,
        x: spot.x,
        y: spot.y,
        anchor: spot.anchor,
        faded: item.faded,
      });
    });

    return { lands, markers, labels, nextShown };
  }, [layoutPlan, at, to, screenDir, size.w, size.h, bottomInset]);

  planRef.current = plan;

  /* Node-budget telemetry for the diagnostics panel: how much of the venue's
     paths/buildings/markers actually reached the screen versus how much
     exists, plus whether the high-zoom cull is currently in play. Pushed on
     a ref by the caller (see page.js), not state, so watching this never
     costs the rest of the app a re-render. */
  useEffect(() => {
    if (!onMapStats || !world) return;
    const pathTotal = world.path.length;
    const pathDrawn = drawWorld?.path.length ?? pathTotal;
    const buildingTotal = world.building.length;
    const buildingDrawn = drawWorld?.building.length ?? buildingTotal;
    const markerTotal = layoutPlan.markerTotal ?? plan.markers.length;
    const markerDrawn = plan.markers.length;
    onMapStats({
      pathTotal,
      pathDrawn,
      buildingTotal,
      buildingDrawn,
      markerTotal,
      markerDrawn,
      zoom: z,
      zoomBand: zPlan,
      culling: Boolean(cullView),
    });
  }, [onMapStats, world, drawWorld, layoutPlan, plan, z, zPlan, cullView]);

  useEffect(() => {
    setShownLabels((prev) => {
      const next = plan.nextShown || new Set();
      if (prev.size === next.size && [...next].every((k) => prev.has(k))) return prev;
      return next;
    });
  }, [plan]);

  const bar = useMemo(() => scaleBar(z), [z]);

  const callout = useMemo(() => {
    if (!selected) return null;
    const [sx, sy] = at(selected.lat, selected.lng);
    if (sx < 0 || sy < 0 || sx > size.w || sy > size.h) return null;
    const away = me ? distance(me.lat, me.lng, selected.lat, selected.lng) : null;
    const rideish = isRideable(selected);
    const bits = [];
    if (away != null) bits.push(`${formatDistance(away)} · ${formatWalk(away)}`);
    if (rideish && selected.h) bits.push(heightLabel(selected));
    else if (selected.a) bits.push(selected.a);
    return {
      // Kept clear of the edges, and flipped under the marker when there is no
      // room for it above.
      x: Math.min(Math.max(sx, 74), size.w - 74),
      y: sy,
      below: sy < 150,
      name: selected.n,
      detail: bits.join(' · '),
      state: eligibility?.at(identityOf(selected))?.kind,
    };
  }, [selected, at, me, size.w, size.h, eligibility]);

  if (!data) {
    return (
      <div className="mapWrap" ref={wrapRef}>
        <div className="mapLoading">
          <span>Drawing the map…</span>
        </div>
      </div>
    );
  }

  const now = Date.now();

  return (
    <div
      className="mapWrap"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{
        cursor: armMeet ? 'crosshair' : 'grab',
        ...(fogFilter
          ? {
              '--mapFogSaturate': String(fogFilter.saturate),
              '--mapFogBright': String(fogFilter.brightness),
            }
          : null),
      }}
      data-fog={fogFilter ? 'soft' : undefined}
    >
      <svg width={size.w} height={size.h} className="mapSvg">
        <defs>
          {/* Depth without a raster tile behind it: a sheen down the water, a
              warm bloom on the live markers, and a soft drop for the pins. */}
          <linearGradient id="waterSheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--poolEdge)', stopOpacity: 0.34 }} />
            <stop offset="55%" style={{ stopColor: 'var(--waterFill)', stopOpacity: 0 }} />
          </linearGradient>
          <pattern id="rctGrass" patternUnits="userSpaceOnUse" width="36" height="36">
            <rect width="36" height="36" fill="#4FA83A" />
            <rect width="18" height="18" fill="#5BB844" />
            <rect x="18" y="18" width="18" height="18" fill="#5BB844" />
            <rect y="18" width="18" height="18" fill="#459832" />
          </pattern>
          <pattern id="rctWater" patternUnits="userSpaceOnUse" width="32" height="32">
            <rect width="32" height="32" fill="#3AA8D0" />
            <rect width="16" height="16" fill="#4AB8DC" />
            <rect x="16" y="16" width="16" height="16" fill="#2E98C0" />
          </pattern>
          <radialGradient id="meGlow">
            <stop offset="0%" style={{ stopColor: 'var(--blue)', stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: 'var(--blue)', stopOpacity: 0 }} />
          </radialGradient>
          <filter id="markerDrop" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#000" floodOpacity="0.45" />
          </filter>
        </defs>

        {/* Venue geometry in local mercator metres — the transform is
            pan/zoom/rotate around the venue origin. Labels and markers stay
            outside so they remain upright. */}
        <g className="mapWorld" transform={viewTransform}>
          <ParkMapStaticWorld
            world={world}
            mapLayers={mapLayers}
            showDetail={showDetail}
            showService={showService}
            lowZoom={lowZoom}
            theme={theme}
            venue={venue}
            iso={iso}
            isoBuildings={isoMeshes.buildings}
            isoTracks={isoMeshes.tracks}
          />

          {/* the selected ride's own track, so the red spaghetti has an owner */}
          {litTrack.length > 0 && (
            <>
              <g className="lyr-trackglow">
                {litTrack.map((i) => {
                  const d = iso
                    ? isoMeshesAll.tracks.find((t) => t.i === i)?.track.d
                    : world.coaster.find((f) => f.i === i)?.d;
                  return d ? <path key={`tg${i}`} d={d} /> : null;
                })}
              </g>
              <g className="lyr-trackpick">
                {litTrack.map((i) => {
                  const d = iso
                    ? isoMeshesAll.tracks.find((t) => t.i === i)?.track.d
                    : world.coaster.find((f) => f.i === i)?.d;
                  return d ? <path key={`tp${i}`} d={d} /> : null;
                })}
              </g>
            </>
          )}
        </g>

        {/* District names, lying along their district and clamped to the part
            of it you can actually see. */}
        <defs>
          {plan.lands.map((l) => (
            <path key={`lp${l.name}`} id={`landline-${l.name.replace(/\W+/g, '-')}`} d={l.d} />
          ))}
        </defs>
        {plan.lands.map((l) => {
          const id = `landline-${l.name.replace(/\W+/g, '-')}`;
          return (
            <text key={`lt${l.name}`} className="landLabel" fill={landTint(l.name, theme, venue).label}>
              <textPath href={`#${id}`} xlinkHref={`#${id}`} startOffset="50%">
                {l.name.toUpperCase()}
              </textPath>
            </text>
          );
        })}

        {/* the routes not taken, offered while you are still deciding — the tap
            that takes one is resolved in onPointerUp with the rest
            Routes are drawn in world coordinates and transformed like venue
            geometry for smooth pan/zoom. non-scaling-stroke keeps line width
            constant across zoom levels. */}
        <g className="routeOverlay" transform={viewTransform}>
          {worldAlternatives.map((d, i) =>
            d ? (
              <path
                key={`alt${i}`}
                className="altLine"
                d={d}
                vectorEffect="non-scaling-stroke"
              />
            ) : null,
          )}

          {/* the walking route, under the markers it runs between */}
          {route?.points?.length > 1 && (
            <g className="routeLayer">
              {worldRouteDone && (
                <path className="routeDone" d={worldRouteDone} vectorEffect="non-scaling-stroke" />
              )}
              <path className="routeCase" d={worldRouteAhead} vectorEffect="non-scaling-stroke" />
              <path
                className={`routeLine ${route.mode === 'direct' ? 'direct' : ''}`}
                d={worldRouteAhead}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </g>

        {/* Turn indicator — in screen coordinates since it's a fixed-size circle */}
        {route?.points?.length > 1 && routeStep?.at && routeStep.turn !== 'arrive' && (
          <circle
            cx={at(routeStep.at[0], routeStep.at[1])[0]}
            cy={at(routeStep.at[0], routeStep.at[1])[1]}
            r={6}
            className="routeTurn"
          />
        )}

        {/* places */}
        {plan.markers.map((m) => (
          <g
            key={m.placeId}
            className="poiMarker"
            transform={`translate(${m.sx.toFixed(1)} ${m.sy.toFixed(1)})`}
            style={{ cursor: 'pointer' }}
          >
            {/* Names the marker for a screen reader and for a desktop hover,
                whether or not the decluttering pass could afford to print it. */}
            <title>{m.p.n}</title>
            {m.isSel && (
              <>
                <circle r={m.r + 2} className="poiHaloGlow" />
                <circle r={m.r + 5} className="poiHalo" />
              </>
            )}
            <g filter={m.sym.rank <= 2 ? 'url(#markerDrop)' : undefined}>
              <PoiMarker
                category={m.p.c}
                colour={palette.categories[m.p.c] || '#888'}
                barredInk={palette.barred}
                r={m.r}
                state={m.state}
              />
            </g>
          </g>
        ))}
        {plan.labels.map((l) => (
          <text
            key={l.key}
            x={l.x}
            y={l.y}
            style={{ textAnchor: l.anchor, ...(l.faded ? { fill: palette.barred } : null) }}
            className={`poiLabel ${l.faded ? 'barred' : ''}`}
          >
            {l.text}
          </text>
        ))}

        {(overlayPins || []).map((pin) => {
          if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return null;
          const [sx, sy] = at(pin.lat, pin.lng);
          const path = pin.kind === 'path';
          return (
            <g
              key={pin.id}
              className={`overlayPin overlayPin-${pin.kind || 'fact'} fieldResearch`}
              data-overlay-pin={pin.kind || 'fact'}
              transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}
            >
              <title>{pin.label || pin.kind || 'Overlay'}</title>
              <circle className="overlayHalo" r={path ? 11 : 14} />
              <circle r={path ? 5 : 8} />
            </g>
          );
        })}

        {/* meet-up — Parkbound simplified Waypoint (brand sheet: live map) */}
        {meet &&
          (() => {
            const [sx, sy] = at(meet.lat, meet.lng);
            const s = 1.15;
            return (
              <g key="meet" className="meetPin" transform={`translate(${sx} ${sy})`}>
                <ellipse cx={0} cy={10} rx={9} ry={2.8} fill="#000" opacity="0.28" />
                {/* Diamond sides with corner gaps */}
                <path
                  d={`M${-9.5 * s} ${-14 * s} L0 ${-20 * s} L${9.5 * s} ${-14 * s}
                      M${14 * s} ${-9.5 * s} L${20 * s} 0 L${14 * s} ${9.5 * s}
                      M${9.5 * s} ${14 * s} L0 ${20 * s} L${-9.5 * s} ${14 * s}
                      M${-14 * s} ${9.5 * s} L${-20 * s} 0 L${-14 * s} ${-9.5 * s}`}
                  fill="none"
                  stroke="var(--aqua)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Teal outward arrows */}
                <path d={`M0 ${-24 * s} L${3.2 * s} ${-17.2 * s} H${-3.2 * s} Z`} fill="var(--aqua)" />
                <path d={`M${24 * s} 0 L${17.2 * s} ${-3.2 * s} V${3.2 * s} Z`} fill="var(--aqua)" />
                <path d={`M0 ${24 * s} L${-3.2 * s} ${17.2 * s} H${3.2 * s} Z`} fill="var(--aqua)" />
                <path d={`M${-24 * s} 0 L${-17.2 * s} ${3.2 * s} V${-3.2 * s} Z`} fill="var(--aqua)" />
                {/* Orange compass eye */}
                <circle cx={0} cy={0} r={6.2 * s} fill="var(--adventure)" stroke="var(--markerEdge)" strokeWidth="1.2" />
              </g>
            );
          })()}

        {/* where the car is — a pin, like the meet-up, because both are a spot
            somebody chose rather than a place the park has. Violet and carrying
            a car, so it is never mistaken for the crimson meet-up pin at a
            glance across a car park in the dark. */}
        {car &&
          (() => {
            const [sx, sy] = at(car.lat, car.lng);
            return (
              <g key="car" className="carPin">
                <ellipse cx={sx} cy={sy + 1.5} rx={7} ry={2.4} fill="#000" opacity="0.28" />
                <path
                  d={`M${sx} ${sy} l-9 -13 a11 11 0 1 1 18 0 Z`}
                  fill="var(--indigo)"
                  stroke="var(--markerEdge)"
                  strokeWidth="1.6"
                />
                <g transform={`translate(${sx} ${sy - 16})`}>
                  <Glyph name="car" size={13} colour="#fff" />
                </g>
              </g>
            );
          })()}

        {/* Marks left at Places — under Members so live GPS stays on top. */}
        {(marks || []).map((mark) => {
          const pt =
            Number.isFinite(mark.lat) && Number.isFinite(mark.lng)
              ? mark
              : (pois || []).find((p) => p.i === mark.placeId || p.id === mark.placeId);
          if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng)) return null;
          const [sx, sy] = at(pt.lat, pt.lng);
          const letter = String(mark.type || 'm').charAt(0).toUpperCase();
          return (
            <g
              key={mark.id}
              className="worldMark"
              opacity={mark.opacity ?? 1}
              onClick={(e) => {
                e.stopPropagation();
                onThankMark?.(mark);
              }}
            >
              <title>{mark.phrase || mark.type}</title>
              <circle cx={sx} cy={sy} r={8} fill="var(--sun)" stroke="var(--markerEdge)" strokeWidth="1.4" />
              <text x={sx} y={sy + 3.5} className="worldMarkLetter">
                {letter}
              </text>
            </g>
          );
        })}

        {/* party members */}
        {members.map((m) => {
          if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) return null;
          const [sx, sy] = at(m.lat, m.lng);
          const { age, stale, help, facing } = partyMarkerState(m, now);
          const placeName = m.place?.name || null;
          const trail = Array.isArray(m.trail) ? m.trail.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) : [];
          return (
            <g key={m.id} className="memMarker">
              {trail.map((p, i) => {
                const [x, y] = at(p.lat, p.lng);
                return (
                  <circle
                    key={`${m.id}-t${i}`}
                    cx={x}
                    cy={y}
                    r={2.4}
                    fill={m.colour}
                    opacity="0.45"
                    pointerEvents="none"
                  />
                );
              })}
              {help && <circle cx={sx} cy={sy} r={20} className="helpRing" />}
              {/* Which way they are facing, so a roster row and a map marker
                  tell the same story. */}
              {facing != null && (
                <path
                  d={`M${sx} ${sy - 23} l5.5 9.5 h-11 Z`}
                  fill={help ? 'var(--crimson)' : m.colour}
                  opacity="0.8"
                  transform={`rotate(${facing - mapRotation} ${sx} ${sy})`}
                />
              )}
              {/* Staleness is a broken ring and a clock, not a fade: fading is
                  what a ride they are too short for looks like, and one map
                  cannot say two things with the same ink. */}
              {stale && <circle cx={sx} cy={sy} r={17.5} className="staleRing" />}
              <circle
                cx={sx}
                cy={sy}
                r={13}
                fill={help ? 'var(--crimson)' : m.colour}
                stroke="var(--markerEdge)"
                strokeWidth="2"
                filter="url(#markerDrop)"
              />
              <text x={sx} y={sy + 4} className="memInitials">
                {m.initials}
              </text>
              <text x={sx} y={sy + 27} className="memName">
                {m.name}
              </text>
              {placeName ? (
                <text x={sx} y={sy + 37} className="memAge">
                  {placeName}
                </text>
              ) : null}
              {stale && (
                <text x={sx} y={sy + (placeName ? 47 : 37)} className="memAge">
                  {formatAge(age)}
                </text>
              )}
              {m.kit && (
                <g className="kitBadge" pointerEvents="none">
                  <circle cx={sx + 11} cy={sy - 11} r={7.5} fill="var(--bg2)" stroke={m.colour} strokeWidth="1.4" />
                  <text x={sx + 11} y={sy - 8} className="kitLetter">
                    {String(m.kit).replace(/-/g, ' ').trim().charAt(0).toUpperCase()}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* me — as a puck on the route while one is running, as a dot otherwise */}
        {me &&
          (() => {
            const raw = me.raw ?? me;
            const [fx, fy] = at(raw.lat, raw.lng);
            const [sx, sy] = puck ? at(puck.lat, puck.lng) : at(me.lat, me.lng);
            const accM = raw.acc ?? me.acc;
            const accR = accM ? accM * view.scale : 0;
            const showRaw = puck || me.snapped;
            // A bearing lands on screen at `bearing - rotation`, because that
            // is what turning the map under it does. The cone is drawn pointing
            // up, so it needs the same subtraction — with the map course-up the
            // two cancel and it points straight ahead, which is the point.
            const facing = puck?.course ?? heading;
            return (
              <g key="me">
                {accR > 6 && <circle cx={fx} cy={fy} r={accR} className="accCircle" />}
                {showRaw && <circle cx={fx} cy={fy} r={3} className="rawFix" />}
                <circle cx={sx} cy={sy} r={30} fill="url(#meGlow)" pointerEvents="none" />
                {facing != null && (
                  <path
                    d={
                      puck
                        ? `M${sx} ${sy - 30} l11 20 a24 24 0 0 0 -22 0 Z`
                        : `M${sx} ${sy - 26} l7 12 l-7 -4 l-7 4 Z`
                    }
                    className={puck ? 'puckCone' : ''}
                    fill="var(--blue)"
                    opacity={puck ? 0.32 : 0.85}
                    transform={`rotate(${facing - mapRotation} ${sx} ${sy})`}
                  />
                )}
                <circle cx={sx} cy={sy} r={9} className="mePulse" />
                <circle cx={sx} cy={sy} r={9} className="mePulse slow" />
                <circle
                  cx={sx}
                  cy={sy}
                  r={7}
                  className="meDot"
                  fill="var(--blue)"
                  stroke="var(--puckRing)"
                  strokeWidth="3"
                />
                {selfKit && (
                  <g className="kitBadge" pointerEvents="none">
                    <circle cx={sx + 10} cy={sy - 10} r={7} fill="var(--bg2)" stroke="var(--blue)" strokeWidth="1.4" />
                    <text x={sx + 10} y={sy - 7} className="kitLetter">
                      {String(selfKit).replace(/-/g, ' ').trim().charAt(0).toUpperCase()}
                    </text>
                  </g>
                )}
              </g>
            );
          })()}

        {/* range line to the selected place — the route replaces it when one
            is running, since two lines to the same pin is one too many */}
        {me && selected && !route && (
          <line
            x1={at(me.lat, me.lng)[0]}
            y1={at(me.lat, me.lng)[1]}
            x2={at(selected.lat, selected.lng)[0]}
            y2={at(selected.lat, selected.lng)[1]}
            className="rangeLine"
          />
        )}
      </svg>

      {/* What you tapped, answered where you tapped it. */}
      {callout && (
        <div
          className={`poiCallout ${callout.below ? 'below' : ''}`}
          style={{ left: `${callout.x}px`, top: `${callout.y}px` }}
          aria-hidden="true"
        >
          <b>{callout.name}</b>
          {callout.detail && <span>{callout.detail}</span>}
          {(callout.state === 'not') && (
            <em className="calloutBar">Not this height</em>
          )}
          {callout.state === 'companion' && <em className="calloutAdult">Needs a grown-up</em>}
        </div>
      )}

      <div className="mapVignette" aria-hidden="true" />
      <div className="mapScrim top" aria-hidden="true" />
      <div className="mapScrim bottom" aria-hidden="true" />

      {/* The wrapper owns pointer capture for panning, so the pad has to keep its
          own presses to itself or a tap on "+" reads as a tap on the map. */}
      <div
        className="zoomPad"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="zoomBtn"
          onClick={() => {
            onUserPan?.();
            zoomAround(1.6, cx, cy);
          }}
          aria-label="Zoom in"
        >
          <Icon name="plus" size={19} />
        </button>
        <button
          type="button"
          className="zoomBtn"
          onClick={() => {
            onUserPan?.();
            zoomAround(1 / 1.6, cx, cy);
          }}
          aria-label="Zoom out"
        >
          <Icon name="minus" size={19} />
        </button>
      </div>

      {/* Everything the map says about itself, stacked in one corner so the
          key, the compass and the scale cannot drift apart. */}
      <div className="mapFurniture">
        <MapLegend
          palette={palette}
          visibleCategories={visibleCategories}
          onToggleCategory={onToggleCategory}
          heightFilterOn={Boolean(
            eligibility &&
              pois.some((p) => {
                const k = eligibility.at(identityOf(p)).kind;
                return k && k !== 'eligible';
              }),
          )}
          presentCategories={presentCategories}
          hidden={mapKeyHidden}
        />
        <div className="mapMeta">
          <div className="scaleBar">
            <span style={{ width: `${Math.round(bar.px)}px` }} />
            <em>
              {bar.label} · {bar.metres} m
            </em>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Parent re-renders on every sheet-drag frame (live --sheetH). The map's
   bottomInset is the resting height, so memo keeps pan/zoom off that path. */
export default memo(ParkMap);
