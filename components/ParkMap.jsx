'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { distance, formatAge, formatDistance, project, unproject } from '@/lib/geo';
import { landTint, paletteFor } from '@/lib/theme';
import { heightLabel } from '@/lib/park';
import {
  labelZoomFor,
  normaliseRideName,
  partyMarkerState,
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
import { PoiMarker } from './MapSymbols';
import MapLegend from './MapLegend';

/* The map is drawn, not tiled: every polyline below is real OpenStreetMap
   geometry, projected to Web Mercator metres and painted as SVG. Pan with one
   finger, pinch or wheel to zoom, double-tap to zoom in.

   Nothing here knows which place it is drawing. It is handed layers of rings by
   name — paths, buildings, water, track — and a centre to open on, so a park, a
   campus or a state fair all render through the same code. Layers a venue has
   no examples of arrive empty and draw nothing.

   `to(x, y)` is the one place world metres become screen pixels — pan, zoom,
   rotation and the lifted centre all live in it, and everything drawn below
   goes through it.

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

function pathFromRing(ring, to) {
  if (!Array.isArray(ring) || ring.length < 2) return '';
  let d = '';
  for (let i = 0; i < ring.length; i += 1) {
    const [x, y] = project(ring[i][1], ring[i][0]);
    const [sx, sy] = to(x, y);
    d += `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)} ${sy.toFixed(1)}`;
  }
  return d;
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

export default function ParkMap({
  data,
  center,
  pois,
  me,
  members,
  meet,
  selected,
  onSelectPoi,
  onMapTap,
  armMeet,
  follow,
  onUserPan,
  heading,
  rideEligibility,
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
}) {
  const palette = paletteFor(theme);
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
  const fling = useRef({ vx: 0, vy: 0, t: 0 });
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  // The laid-out markers, so a tap can be resolved against what was drawn.
  const planRef = useRef({ lands: [], markers: [], labels: [] });

  viewRef.current = view;

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

  useEffect(() => stopAnim, [stopAnim]);

  /**
   * Tween the viewport to a target. Scale is interpolated geometrically —
   * linear interpolation of a px-per-metre figure reads as a lurch at the start
   * and a crawl at the end, because what the eye tracks is the ratio.
   */
  const animateTo = useCallback(
    (target, { duration = 620, ease = easeOut } = {}) => {
      stopAnim();
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
        setView(to);
        return;
      }
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const k = ease(p);
        setView({
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          scale: from.scale * (to.scale / from.scale) ** k,
        });
        raf.current = p < 1 ? requestAnimationFrame(step) : 0;
      };
      raf.current = requestAnimationFrame(step);
    },
    [stopAnim],
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
  const spin = useMemo(() => {
    const t = (-rotation * Math.PI) / 180;
    return { cos: Math.cos(t), sin: Math.sin(t) };
  }, [rotation]);
  // Course-up puts you near the bottom of the screen looking up the route, so
  // the centre of the map sits below the centre of the viewport.
  const cx = size.w / 2;
  const cy = size.h / 2 + liftCentre * size.h;

  const to = useCallback(
    (x, y) => {
      const u = (x - view.x) * view.scale;
      const v = (view.y - y) * view.scale;
      return [u * spin.cos - v * spin.sin + cx, u * spin.sin + v * spin.cos + cy];
    },
    [view, spin, cx, cy],
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
      const dx = px - cx;
      const dy = py - cy;
      const u = dx * spin.cos + dy * spin.sin;
      const v = -dx * spin.sin + dy * spin.cos;
      return unproject(u / view.scale + view.x, view.y - v / view.scale);
    },
    [view, spin, cx, cy],
  );

  /** Zoom about a screen point, keeping whatever is under it under it. */
  const zoomAround = useCallback(
    (factor, px, py, duration = 320) => {
      const v = viewRef.current;
      const scale = clampScale(v.scale * factor);
      const ox = px == null ? 0 : px - size.w / 2;
      const oy = py == null ? 0 : py - size.h / 2;
      animateTo(
        {
          x: v.x + ox / v.scale - ox / scale,
          y: v.y - oy / v.scale + oy / scale,
          scale,
        },
        { duration },
      );
    },
    [animateTo, size.w, size.h],
  );

  /* ---------- gestures ---------- */
  const onPointerDown = (e) => {
    stopAnim();
    fling.current = { vx: 0, vy: 0, t: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: viewRef.current.scale,
      };
    }
  };

  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);

    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = dist / gesture.current.dist;
      const scale = clampScale(gesture.current.scale * ratio);
      if (Math.abs(dist - gesture.current.dist) > 4) moved.current = true;
      setView((v) => ({ ...v, scale }));
      return;
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
    setView((s) => ({ ...s, x: s.x - u / s.scale, y: s.y + v / s.scale }));
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
      setView((s) => ({ ...s, x: s.x - u / s.scale, y: s.y + w / s.scale }));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [spin]);

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

    if (moved.current) {
      startFling();
      return;
    }

    const rect = wrapRef.current.getBoundingClientRect();
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
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const v = viewRef.current;
    const scale = clampScale(v.scale * (e.deltaY > 0 ? 0.9 : 1.11));
    const ox = px - size.w / 2;
    const oy = py - size.h / 2;
    setView({
      x: v.x + ox / v.scale - ox / scale,
      y: v.y - oy / v.scale + oy / scale,
      scale,
    });
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
  const showDetail = z > 0.7;
  const showService = z > 1.4;
  /* District names survive far further out than place names do, because the
     whole-venue view is precisely when "which part is that" is the question. */
  const showLands = z > 0.34;

  const layers = useMemo(() => {
    if (!data) return null;
    const ringOf = (f) => (Array.isArray(f) ? f : f?.r);
    const poly = (list, key) =>
      (list || []).map((f, i) => {
        const r = ringOf(f);
        if (!r?.length) return null;
        const d = pathFromRing(r, to);
        if (!d) return null;
        return <path key={`${key}${i}`} d={`${d}Z`} />;
      });
    const line = (list, key) =>
      (list || []).map((f, i) => {
        const r = ringOf(f);
        if (!r?.length) return null;
        return <path key={`${key}${i}`} d={pathFromRing(r, to)} />;
      });
    return { poly, line };
  }, [data, to]);

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
     what is already there. */
  const plan = useMemo(() => {
    const grid = new Declutter();
    const lands = [];
    const markers = [];
    const labels = [];
    if (!data) return { lands, markers, labels };

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

    // A name half over the edge of the phone is worse than no name: it reads
    // as a different, shorter word.
    const wholly = (box) => box.x0 >= 2 && box.y0 >= 2 && box.x1 <= size.w - 2 && box.y1 <= floor;

    /* District names go down first, but they have to survive each other too:
       they are gathered, ordered by how much of the screen each one actually
       occupies, and only then placed. Otherwise PLANET SNOOPY writes itself
       straight through INTERNATIONAL STREET and neither can be read. */
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
        // Keep the name over its own district and inside the usable frame; one
        // that is only visible behind the sheet does not get a name at all.
        const room = intersect(box, frame);
        if (!room) return;

        const width = textWidth(name, LAND_FONT, LAND_TRACKING);
        // The text is centred on the arc, so the arc only needs to be a little
        // longer than the words — and a longer one would only bow harder.
        const span = width * 1.25;
        let [dx, dy] = screenDir(axis.ux, axis.uy);
        const mag = Math.hypot(dx, dy) || 1;
        dx /= mag;
        dy /= mag;
        if (dx < 0) {
          dx = -dx;
          dy = -dy;
        }
        // Clamp the whole run, not its midpoint: a name centred inside the
        // frame still hangs half its length over the edge, which is how
        // RIVERTOWN used to come out as "OWN".
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
          // The district is mostly off screen. Stay as near to it as the screen
          // allows rather than printing half a word at the edge.
          const [nx, ny] = clampInto(ax, ay, room);
          [lx, ly] = clampInto(nx, ny, frameFits);
        } else {
          return; // longer than the screen along its own axis: no good place
        }

        /* Claim the run as a chain of small boxes rather than one bounding
           box. A near-vertical name is 15 px of ink through 220 px of map, and
           reserving the rectangle around it used to blank out whatever else
           lived in that column — which is how Diamondback lost its marker to
           the words INTERNATIONAL STREET. */
        const steps = Math.max(2, Math.round(width / 30));
        const step = width / steps;
        const along = step / 2;
        const across = 8; // half the cap height of the district face, plus a hair
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
          boxes,
          d: labelArc(lx, ly, dx, dy, span),
          area: (room.x1 - room.x0) * (room.y1 - room.y0),
        });
      });

      candidates.sort((a, b) => b.area - a.area);
      candidates.forEach((c) => {
        if (c.boxes.some((b) => !grid.free(b))) return;
        c.boxes.forEach((b) => grid.occupy(b));
        lands.push({ name: c.name, d: c.d });
      });
    }

    // You, your party and the meet-up own their pixels outright.
    const reserve = (lat, lng, half) => {
      if (lat == null || lng == null) return;
      const [sx, sy] = at(lat, lng);
      grid.claim(boxAround(sx, sy, half, half), true);
    };
    reserve(puck?.lat ?? me?.lat, puck?.lng ?? me?.lng, 15);
    (members || []).forEach((m) => reserve(m.lat, m.lng, 17));
    if (meet) reserve(meet.lat, meet.lng, 16);

    const selectedName = selected?.n ?? null;
    const ranked = [];
    pois.forEach((p, i) => {
      if (!visibleCategories.has(p.c)) return;
      const [sx, sy] = at(p.lat, p.lng);
      if (sx < -60 || sy < -60 || sx > size.w + 60 || sy > size.h + 60) return;
      const sym = symbolFor(p.c);
      const state = rideEligibility?.get(p.n) || 'unknown';
      const barred = state === 'no' || state === 'toobig';
      const isSel = selectedName === p.n;
      const isNav = routeTargetName === p.n;
      // A ride the party cannot ride today loses ties to one it can, so a
      // height filter clears space for what is actually on the table.
      const rank = sym.rank + (barred ? 1.4 : 0);
      const priority = isSel ? -1000 : isNav ? -900 : rank * 1000 + i;
      ranked.push({ p, sx, sy, sym, state, isSel, isNav, priority });
    });
    ranked.sort((a, b) => a.priority - b.priority);

    /* A place takes its marker and its name in one go, in importance order.
       Placing every marker first and then every label would let a snack bar's
       dot outrank Diamondback's name — which is exactly backwards.

       Four spots to try before giving up on a name: above is the habit of
       every printed map, and the other three are what rescues a coaster whose
       usual spot is already spoken for. */
    ranked.forEach((item) => {
      const r = sizeAtZoom(item.sym.r, z);
      const pinned = item.isSel || item.isNav;
      if (!grid.claim(boxAround(item.sx, item.sy, r + 1.5, r + 1.5), pinned)) return;
      markers.push({ ...item, r });

      // The selected place gets a callout with its name in it, so a label
      // underneath would only say the same thing again.
      const wanted = (pinned && !item.isSel) || z >= labelZoomFor(item.sym.rank);
      if (!wanted || item.isSel) return;
      const { sx, sy, p } = item;
      const halfW = textWidth(p.n, POI_FONT) / 2 + 3;
      const gap = r + 5;
      const spots = [
        { x: sx, y: sy - gap, anchor: 'middle', bx: sx, by: sy - gap - 4 },
        { x: sx, y: sy + gap + 10, anchor: 'middle', bx: sx, by: sy + gap + 6 },
        { x: sx + gap, y: sy + 3.5, anchor: 'start', bx: sx + gap + halfW - 3, by: sy },
        { x: sx - gap, y: sy + 3.5, anchor: 'end', bx: sx - gap - halfW + 3, by: sy },
      ];
      for (const spot of spots) {
        const box = boxAround(spot.bx, spot.by, halfW, 7);
        if (!wholly(box)) continue;
        if (!grid.claim(box, false)) continue;
        labels.push({
          key: `${p.n}${Math.round(sx)}`,
          text: p.n,
          x: spot.x,
          y: spot.y,
          anchor: spot.anchor,
          faded: item.state === 'no' || item.state === 'toobig',
        });
        return;
      }
    });

    return { lands, markers, labels };
  }, [
    data,
    pois,
    at,
    to,
    screenDir,
    size.w,
    size.h,
    bottomInset,
    z,
    showLands,
    landAxes,
    visibleCategories,
    rideEligibility,
    selected,
    routeTargetName,
    members,
    meet,
    me,
    puck,
  ]);

  planRef.current = plan;

  const bar = useMemo(() => scaleBar(z), [z]);

  const callout = useMemo(() => {
    if (!selected) return null;
    const [sx, sy] = at(selected.lat, selected.lng);
    if (sx < 0 || sy < 0 || sx > size.w || sy > size.h) return null;
    const away = me ? distance(me.lat, me.lng, selected.lat, selected.lng) : null;
    const rideish = selected.c === 'coaster' || selected.c === 'ride';
    return {
      // Kept clear of the edges, and flipped under the marker when there is no
      // room for it above.
      x: Math.min(Math.max(sx, 74), size.w - 74),
      y: sy,
      below: sy < 150,
      name: selected.n,
      away: away == null ? null : formatDistance(away),
      detail: rideish && selected.h ? heightLabel(selected) : selected.a || '',
      state: rideEligibility?.get(selected.n),
    };
  }, [selected, at, me, size.w, size.h, rideEligibility]);

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
      style={{ cursor: armMeet ? 'crosshair' : 'grab' }}
    >
      <svg width={size.w} height={size.h} className="mapSvg">
        <defs>
          {/* Depth without a raster tile behind it: a sheen down the water, a
              warm bloom on the live markers, and a soft drop for the pins. */}
          <linearGradient id="waterSheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--poolEdge)', stopOpacity: 0.34 }} />
            <stop offset="55%" style={{ stopColor: 'var(--waterFill)', stopOpacity: 0 }} />
          </linearGradient>
          <radialGradient id="meGlow">
            <stop offset="0%" style={{ stopColor: 'var(--beacon)', stopOpacity: 0.34 }} />
            <stop offset="100%" style={{ stopColor: 'var(--beacon)', stopOpacity: 0 }} />
          </radialGradient>
          <filter id="markerDrop" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#000" floodOpacity="0.45" />
          </filter>
        </defs>

        {/* park ground */}
        <g className="lyr-park">{layers.poly(data.park, 'pk')}</g>

        {/* themed lands */}
        <g className="lyr-land">
          {(data.lands || []).map((land, i) => {
            const tint = landTint(land.n, theme);
            return (
              <path
                key={`ld${i}`}
                d={`${pathFromRing(land.r, to)}Z`}
                fill={tint.fill}
                stroke={tint.stroke}
                strokeWidth="1"
              />
            );
          })}
        </g>

        <g className="lyr-wood">{layers.poly(data.wood, 'wd')}</g>
        {showDetail && (
          <g className="lyr-grass lyr-detail">{layers.poly(data.grass, 'gr')}</g>
        )}
        <g className="lyr-parking">{layers.poly(data.parking, 'pa')}</g>
        <g className="lyr-water">{layers.poly(data.water, 'wa')}</g>
        <g className="lyr-watersheen">{layers.poly(data.water, 'wash')}</g>
        <g className="lyr-pool">{layers.poly(data.pool, 'po')}</g>

        {showService && (
          <g className="lyr-service lyr-detail">{layers.line(data.service, 'sv')}</g>
        )}
        <g className="lyr-pathcase">{layers.line(data.path, 'pc')}</g>
        <g className="lyr-path">{layers.line(data.path, 'ph')}</g>

        {showDetail && (
          <g className="lyr-building lyr-detail">{layers.poly(data.building, 'bd')}</g>
        )}

        <g className="lyr-slide">{layers.line(data.slide, 'sl')}</g>
        <g className="lyr-coastershadow">{layers.line(data.coaster, 'cs')}</g>
        <g className="lyr-coaster">{layers.line(data.coaster, 'co')}</g>

        {/* the selected ride's own track, so the red spaghetti has an owner */}
        {litTrack.length > 0 && (
          <>
            <g className="lyr-trackglow">
              {litTrack.map((i) => (
                <path key={`tg${i}`} d={pathFromRing(data.coaster[i].r, to)} />
              ))}
            </g>
            <g className="lyr-trackpick">
              {litTrack.map((i) => (
                <path key={`tp${i}`} d={pathFromRing(data.coaster[i].r, to)} />
              ))}
            </g>
          </>
        )}

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
            <text key={`lt${l.name}`} className="landLabel" fill={landTint(l.name, theme).label}>
              <textPath href={`#${id}`} xlinkHref={`#${id}`} startOffset="50%">
                {l.name.toUpperCase()}
              </textPath>
            </text>
          );
        })}

        {/* the routes not taken, offered while you are still deciding — the tap
            that takes one is resolved in onPointerUp with the rest */}
        {alternatives?.map((alt, i) => {
          const d = pathFromLatLngs(alt.points, to);
          if (!d) return null;
          return <path key={`alt${i}`} className="altLine" d={d} />;
        })}

        {/* the walking route, under the markers it runs between */}
        {route?.points?.length > 1 &&
          (() => {
            // Split at the walker: what is behind fades, what is ahead leads.
            const ahead = pathFromLatLngs(routeAhead?.length > 1 ? routeAhead : route.points, to);
            const done = routeDone?.length > 1 ? pathFromLatLngs(routeDone, to) : '';
            return (
              <g className="routeLayer">
                {done && <path className="routeDone" d={done} />}
                <path className="routeCase" d={ahead} />
                <path className={`routeLine ${route.mode === 'direct' ? 'direct' : ''}`} d={ahead} />
                {routeStep?.at && routeStep.turn !== 'arrive' && (
                  <circle
                    cx={at(routeStep.at[0], routeStep.at[1])[0]}
                    cy={at(routeStep.at[0], routeStep.at[1])[1]}
                    r={6}
                    className="routeTurn"
                  />
                )}
              </g>
            );
          })()}

        {/* places */}
        {plan.markers.map((m) => (
          <g
            key={m.p.n + m.p.lat}
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
            style={{ textAnchor: l.anchor }}
            className={`poiLabel ${l.faded ? 'barred' : ''}`}
          >
            {l.text}
          </text>
        ))}

        {/* meet-up */}
        {meet &&
          (() => {
            const [sx, sy] = at(meet.lat, meet.lng);
            return (
              <g key="meet" className="meetPin">
                <ellipse
                  cx={sx}
                  cy={sy + 1.5}
                  rx={7}
                  ry={2.4}
                  fill="#000"
                  opacity="0.28"
                />
                <path
                  d={`M${sx} ${sy} l-9 -13 a11 11 0 1 1 18 0 Z`}
                  fill="var(--crimson)"
                  stroke="var(--markerEdge)"
                  strokeWidth="1.6"
                />
                <circle cx={sx} cy={sy - 16} r={4} fill="#fff" />
              </g>
            );
          })()}

        {/* party members */}
        {members.map((m) => {
          const [sx, sy] = at(m.lat, m.lng);
          const { age, stale, help, facing } = partyMarkerState(m, now);
          return (
            <g key={m.id} className="memMarker">
              {help && <circle cx={sx} cy={sy} r={20} className="helpRing" />}
              {/* Which way they are facing, so a roster row and a map marker
                  tell the same story. */}
              {facing != null && (
                <path
                  d={`M${sx} ${sy - 23} l5.5 9.5 h-11 Z`}
                  fill={help ? 'var(--crimson)' : m.colour}
                  opacity="0.8"
                  transform={`rotate(${facing - rotation} ${sx} ${sy})`}
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
              {stale && (
                <text x={sx} y={sy + 37} className="memAge">
                  {formatAge(age)}
                </text>
              )}
            </g>
          );
        })}

        {/* me — as a puck on the route while one is running, as a dot otherwise */}
        {me &&
          (() => {
            const [fx, fy] = at(me.lat, me.lng);
            const [sx, sy] = puck ? at(puck.lat, puck.lng) : [fx, fy];
            const accR = me.acc ? me.acc * view.scale : 0;
            // A bearing lands on screen at `bearing - rotation`, because that
            // is what turning the map under it does. The cone is drawn pointing
            // up, so it needs the same subtraction — with the map course-up the
            // two cancel and it points straight ahead, which is the point.
            const facing = puck?.course ?? heading;
            return (
              <g key="me">
                {accR > 6 && <circle cx={fx} cy={fy} r={accR} className="accCircle" />}
                {puck && <circle cx={fx} cy={fy} r={3} className="rawFix" />}
                <circle cx={sx} cy={sy} r={30} fill="url(#meGlow)" pointerEvents="none" />
                {facing != null && (
                  <path
                    d={
                      puck
                        ? `M${sx} ${sy - 30} l11 20 a24 24 0 0 0 -22 0 Z`
                        : `M${sx} ${sy - 26} l7 12 l-7 -4 l-7 4 Z`
                    }
                    className={puck ? 'puckCone' : ''}
                    fill="var(--beacon)"
                    opacity={puck ? 0.32 : 0.85}
                    transform={`rotate(${facing - rotation} ${sx} ${sy})`}
                  />
                )}
                <circle cx={sx} cy={sy} r={9} className="mePulse" />
                <circle cx={sx} cy={sy} r={9} className="mePulse slow" />
                <circle
                  cx={sx}
                  cy={sy}
                  r={7}
                  className="meDot"
                  fill="#FFC24A"
                  stroke="var(--markerEdge)"
                  strokeWidth="3"
                />
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
          <span>
            {callout.away ? `${callout.away} · ` : ''}
            {callout.detail}
          </span>
          {(callout.state === 'no' || callout.state === 'toobig') && (
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
            zoomAround(1.6, size.w / 2, size.h / 2);
          }}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="zoomBtn"
          onClick={() => {
            onUserPan?.();
            zoomAround(1 / 1.6, size.w / 2, size.h / 2);
          }}
          aria-label="Zoom out"
        >
          −
        </button>
      </div>

      {/* Everything the map says about itself, stacked in one corner so the
          key, the compass and the scale cannot drift apart. */}
      <div className="mapFurniture">
        <MapLegend
          palette={palette}
          visibleCategories={visibleCategories}
          onToggleCategory={onToggleCategory}
          heightFilterOn={!!rideEligibility}
        />
        <div className="mapMeta">
          {/* Which way is north, without having to open the compass tape. */}
          <div className="northRose" title={`North is ${Math.round((360 - rotation) % 360)}°`}>
            <svg viewBox="-13 -13 26 26" aria-hidden="true">
              <circle r="11.4" className="roseDial" />
              <g transform={`rotate(${-rotation})`}>
                <path d="M0 -8.2 L3.4 2.6 L0 0.4 L-3.4 2.6 Z" className="roseNeedle" />
                <path d="M0 8.2 L3.4 -2.6 L0 -0.4 L-3.4 -2.6 Z" className="roseTail" />
              </g>
              {/* The letter rides to north but never turns over with it. */}
              <text
                x={(Math.sin((-rotation * Math.PI) / 180) * 8.4).toFixed(2)}
                y={(-Math.cos((-rotation * Math.PI) / 180) * 8.4 + 2.4).toFixed(2)}
                className="roseN"
              >
                N
              </text>
            </svg>
          </div>
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
