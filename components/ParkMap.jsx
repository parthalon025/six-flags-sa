'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { project, unproject } from '@/lib/geo';
import { landTint, paletteFor } from '@/lib/theme';
import Icon from '@/components/Icon';

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
  dimmedNames,
  visibleCategories,
  focusPoint,
  theme,
  route,
  routeStep,
  routeAhead,
  routeDone,
  alternatives,
  onPickAlternative,
  puck,
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
    const stop = (e) => e.preventDefault();
    node.addEventListener('wheel', stop, { passive: false });
    return () => node.removeEventListener('wheel', stop);
  }, []);

  /* ---------- layer rendering ---------- */
  const z = view.scale;
  const showDetail = z > 0.7;
  const showLabels = z > 0.85;
  const showService = z > 1.4;

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

  if (!data) {
    return (
      <div className="mapWrap" ref={wrapRef}>
        <div className="mapLoading">
          <span>Drawing the map…</span>
        </div>
      </div>
    );
  }

  const visiblePois = pois.filter((p) => visibleCategories.has(p.c));

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
              tinted bloom under the location puck, and a soft drop for the pins. */}
          <linearGradient id="waterSheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--poolEdge)', stopOpacity: 0.34 }} />
            <stop offset="55%" style={{ stopColor: 'var(--waterFill)', stopOpacity: 0 }} />
          </linearGradient>
          <radialGradient id="meGlow">
            <stop offset="0%" style={{ stopColor: 'var(--blue)', stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: 'var(--blue)', stopOpacity: 0 }} />
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

        {/* land names */}
        {showLabels &&
          Object.entries(data.landAnchors || {}).map(([name, [lat, lng]]) => {
            const [sx, sy] = at(lat, lng);
            const tint = landTint(name, theme);
            return (
              <text key={name} x={sx} y={sy} className="landLabel" fill={tint.label}>
                {name.toUpperCase()}
              </text>
            );
          })}

        {/* the routes not taken, offered while you are still deciding */}
        {alternatives?.map((alt, i) => {
          const d = pathFromLatLngs(alt.points, to);
          if (!d) return null;
          return (
            <g
              key={`alt${i}`}
              className="altRoute"
              onPointerUp={(e) => {
                e.stopPropagation();
                pointers.current.clear();
                if (!moved.current) onPickAlternative?.(alt.index);
              }}
            >
              <path className="altHit" d={d} />
              <path className="altLine" d={d} />
            </g>
          );
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

        {/* POIs */}
        {visiblePois.map((p) => {
          const [sx, sy] = at(p.lat, p.lng);
          if (sx < -40 || sy < -40 || sx > size.w + 40 || sy > size.h + 40) return null;
          const isSel = selected && selected.n === p.n;
          const dim = dimmedNames?.has(p.n);
          const colour = palette.categories[p.c] || '#888';
          const big = p.c === 'coaster' || isSel;
          return (
            <g
              key={p.n + p.lat}
              className="poiMarker"
              onPointerUp={(e) => {
                e.stopPropagation();
                pointers.current.clear();
                if (!moved.current) onSelectPoi(p);
              }}
              opacity={dim ? 0.28 : 1}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={sx} cy={sy} r={big ? 14 : 11} fill="transparent" />
              {isSel && (
                <>
                  <circle cx={sx} cy={sy} r={9} className="poiHaloGlow" />
                  <circle cx={sx} cy={sy} r={12} className="poiHalo" />
                </>
              )}
              <circle
                cx={sx}
                cy={sy}
                r={big ? 5.4 : 3.6}
                className="pin"
                fill={colour}
                stroke="var(--markerEdge)"
                strokeWidth="1.4"
                filter={big ? 'url(#markerDrop)' : undefined}
              />
              {(showLabels && (big || z > 1.6)) && (
                <text x={sx} y={sy - 9} className="poiLabel">
                  {p.n}
                </text>
              )}
            </g>
          );
        })}

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
          const stale = Date.now() - m.ts > 300000;
          const help = m.status === 'NEED HELP';
          return (
            <g key={m.id} className="memMarker" opacity={stale ? 0.45 : 1}>
              {help && <circle cx={sx} cy={sy} r={20} className="helpRing" />}
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
              <text x={sx} y={sy + 25} className="memName">
                {m.name}
              </text>
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
                    fill="var(--blue)"
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
                  fill="var(--blue)"
                  stroke="var(--puckRing)"
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
          <Icon name="plus" size={19} />
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
          <Icon name="minus" size={19} />
        </button>
      </div>

      <div className="scaleBar">
        <span style={{ width: `${Math.round(100 * view.scale)}px` }} />
        <em>100 m</em>
      </div>
    </div>
  );
}
