'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { project, unproject } from '@/lib/geo';
import { paletteFor } from '@/lib/theme';

/* The map is drawn, not tiled: every polyline below is real OpenStreetMap
   geometry for Kings Island, projected to Web Mercator metres and painted as
   SVG. Pan with one finger, pinch or wheel to zoom, double-tap to zoom in.

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

function pathFromRing(ring, toX, toY) {
  if (!Array.isArray(ring) || ring.length < 2) return '';
  let d = '';
  for (let i = 0; i < ring.length; i += 1) {
    const [x, y] = project(ring[i][1], ring[i][0]);
    d += `${i === 0 ? 'M' : 'L'}${toX(x).toFixed(1)} ${toY(y).toFixed(1)}`;
  }
  return d;
}

export default function ParkMap({
  data,
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
}) {
  const palette = paletteFor(theme);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 360, h: 640 });
  // view is centred on a mercator metre coordinate at `scale` px per metre
  const [view, setView] = useState(() => {
    const [x, y] = project(39.3428, -84.2666);
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

  // Follow mode keeps the marker centred without fighting manual pans. A short
  // glide rather than a jump: fixes land every few seconds and a teleporting
  // map is how you lose track of where you were looking.
  useEffect(() => {
    if (!follow || !me) return;
    const [x, y] = project(me.lat, me.lng);
    animateTo({ x, y }, { duration: 480 });
  }, [follow, me, animateTo]);

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

  const toX = useCallback((x) => (x - view.x) * view.scale + size.w / 2, [view, size.w]);
  const toY = useCallback((y) => (view.y - y) * view.scale + size.h / 2, [view, size.h]);

  const screenToLatLng = useCallback(
    (px, py) => {
      const x = (px - size.w / 2) / view.scale + view.x;
      const y = view.y - (py - size.h / 2) / view.scale;
      return unproject(x, y);
    },
    [view, size],
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
    setView((v) => ({ ...v, x: v.x - dx / v.scale, y: v.y + dy / v.scale }));
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
      setView((v) => ({ ...v, x: v.x - dx / v.scale, y: v.y + dy / v.scale }));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);

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
        const d = pathFromRing(r, toX, toY);
        if (!d) return null;
        return <path key={`${key}${i}`} d={`${d}Z`} />;
      });
    const line = (list, key) =>
      (list || []).map((f, i) => {
        const r = ringOf(f);
        if (!r?.length) return null;
        return <path key={`${key}${i}`} d={pathFromRing(r, toX, toY)} />;
      });
    return { poly, line };
  }, [data, toX, toY]);

  if (!data) {
    return (
      <div className="mapWrap" ref={wrapRef}>
        <div className="mapLoading">
          <span>Drawing the park…</span>
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
          {data.lands.map((land, i) => {
            const tint = palette.lands[land.n] || palette.lands['Front Gate'];
            return (
              <path
                key={`ld${i}`}
                d={`${pathFromRing(land.r, toX, toY)}Z`}
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
            const [x, y] = project(lat, lng);
            const tint = palette.lands[name] || palette.lands['Front Gate'];
            return (
              <text
                key={name}
                x={toX(x)}
                y={toY(y)}
                className="landLabel"
                fill={tint.label}
              >
                {name.toUpperCase()}
              </text>
            );
          })}

        {/* POIs */}
        {visiblePois.map((p) => {
          const [x, y] = project(p.lat, p.lng);
          const sx = toX(x);
          const sy = toY(y);
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
            const [x, y] = project(meet.lat, meet.lng);
            return (
              <g key="meet" className="meetPin">
                <ellipse
                  cx={toX(x)}
                  cy={toY(y) + 1.5}
                  rx={7}
                  ry={2.4}
                  fill="#000"
                  opacity="0.28"
                />
                <path
                  d={`M${toX(x)} ${toY(y)} l-9 -13 a11 11 0 1 1 18 0 Z`}
                  fill="var(--crimson)"
                  stroke="var(--markerEdge)"
                  strokeWidth="1.6"
                />
                <circle cx={toX(x)} cy={toY(y) - 16} r={4} fill="#fff" />
              </g>
            );
          })()}

        {/* party members */}
        {members.map((m) => {
          const [x, y] = project(m.lat, m.lng);
          const sx = toX(x);
          const sy = toY(y);
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

        {/* me */}
        {me &&
          (() => {
            const [x, y] = project(me.lat, me.lng);
            const sx = toX(x);
            const sy = toY(y);
            const accR = me.acc ? me.acc * view.scale : 0;
            return (
              <g key="me">
                {accR > 6 && <circle cx={sx} cy={sy} r={accR} className="accCircle" />}
                <circle cx={sx} cy={sy} r={30} fill="url(#meGlow)" pointerEvents="none" />
                {heading != null && (
                  <path
                    d={`M${sx} ${sy - 26} l7 12 l-7 -4 l-7 4 Z`}
                    fill="var(--beacon)"
                    opacity="0.85"
                    transform={`rotate(${heading} ${sx} ${sy})`}
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

        {/* range line to the selected place */}
        {me && selected && (
          <line
            x1={toX(project(me.lat, me.lng)[0])}
            y1={toY(project(me.lat, me.lng)[1])}
            x2={toX(project(selected.lat, selected.lng)[0])}
            y2={toY(project(selected.lat, selected.lng)[1])}
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

      <div className="scaleBar">
        <span style={{ width: `${Math.round(100 * view.scale)}px` }} />
        <em>100 m</em>
      </div>
    </div>
  );
}
