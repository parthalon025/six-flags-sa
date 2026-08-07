'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { project, unproject } from '@/lib/geo';
import { landTint, paletteFor } from '@/lib/theme';

/* The map is drawn, not tiled: every polyline below is real OpenStreetMap
   geometry, projected to Web Mercator metres and painted as SVG. Pan with one
   finger, pinch or wheel to zoom.

   Nothing here knows which place it is drawing. It is handed layers of rings by
   name — paths, buildings, water, track — and a centre to open on, so a park, a
   campus or a state fair all render through the same code. Layers a venue has
   no examples of arrive empty and draw nothing. */


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

  // A new venue is a new part of the world: jump to it rather than leaving the
  // view parked over the last one, where its geometry is thousands of miles off
  // screen and the map looks broken.
  const venueKey = `${center?.lat},${center?.lng}`;
  useEffect(() => {
    if (!center) return;
    const [x, y] = project(center.lat, center.lng);
    setView((v) => ({ ...v, x, y }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueKey]);

  // Follow mode keeps the marker centred without fighting manual pans.
  useEffect(() => {
    if (!follow || !me) return;
    const [x, y] = project(me.lat, me.lng);
    setView((v) => ({ ...v, x, y }));
  }, [follow, me]);

  // An explicit focus request (tapping a roster row, a ride, the meet-up)
  // recentres and zooms in a little if we are far out.
  useEffect(() => {
    if (!focusPoint) return;
    const [x, y] = project(focusPoint.lat, focusPoint.lng);
    setView((v) => ({ x, y, scale: Math.max(v.scale, 1.6) }));
  }, [focusPoint]);

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

  /* ---------- gestures ---------- */
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.scale,
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
      const scale = Math.min(6, Math.max(0.18, gesture.current.scale * ratio));
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
    setView((v) => ({ ...v, x: v.x - dx / v.scale, y: v.y + dy / v.scale }));
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (!moved.current && pointers.current.size === 0) {
      const rect = wrapRef.current.getBoundingClientRect();
      const [lat, lng] = screenToLatLng(e.clientX - rect.left, e.clientY - rect.top);
      onMapTap?.(lat, lng);
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    onUserPan?.();
    setView((v) => ({
      ...v,
      scale: Math.min(6, Math.max(0.18, v.scale * (e.deltaY > 0 ? 0.88 : 1.14))),
    }));
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
        <div className="mapLoading">Drawing the map…</div>
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
        {/* park ground */}
        <g className="lyr-park">{layers.poly(data.park, 'pk')}</g>

        {/* themed lands */}
        {(data.lands || []).map((land, i) => {
          const tint = landTint(land.n, theme);
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

        <g className="lyr-wood">{layers.poly(data.wood, 'wd')}</g>
        {showDetail && <g className="lyr-grass">{layers.poly(data.grass, 'gr')}</g>}
        <g className="lyr-parking">{layers.poly(data.parking, 'pa')}</g>
        <g className="lyr-water">{layers.poly(data.water, 'wa')}</g>
        <g className="lyr-pool">{layers.poly(data.pool, 'po')}</g>

        {showService && <g className="lyr-service">{layers.line(data.service, 'sv')}</g>}
        <g className="lyr-pathcase">{layers.line(data.path, 'pc')}</g>
        <g className="lyr-path">{layers.line(data.path, 'ph')}</g>

        {showDetail && <g className="lyr-building">{layers.poly(data.building, 'bd')}</g>}

        <g className="lyr-slide">{layers.line(data.slide, 'sl')}</g>
        <g className="lyr-coastershadow">{layers.line(data.coaster, 'cs')}</g>
        <g className="lyr-coaster">{layers.line(data.coaster, 'co')}</g>

        {/* land names */}
        {showLabels &&
          Object.entries(data.landAnchors || {}).map(([name, [lat, lng]]) => {
            const [x, y] = project(lat, lng);
            const tint = landTint(name, theme);
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
              onPointerUp={(e) => {
                e.stopPropagation();
                pointers.current.clear();
                if (!moved.current) onSelectPoi(p);
              }}
              opacity={dim ? 0.28 : 1}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={sx} cy={sy} r={big ? 14 : 11} fill="transparent" />
              {isSel && <circle cx={sx} cy={sy} r={11} className="poiHalo" />}
              <circle
                cx={sx}
                cy={sy}
                r={big ? 5 : 3.6}
                fill={colour}
                stroke="var(--markerEdge)"
                strokeWidth="1.4"
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
            <g key={m.id} opacity={stale ? 0.45 : 1}>
              {help && <circle cx={sx} cy={sy} r={20} className="helpRing" />}
              <circle
                cx={sx}
                cy={sy}
                r={13}
                fill={help ? 'var(--crimson)' : m.colour}
                stroke="var(--markerEdge)"
                strokeWidth="2"
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
                {heading != null && (
                  <path
                    d={`M${sx} ${sy - 26} l7 12 l-7 -4 l-7 4 Z`}
                    fill="var(--beacon)"
                    opacity="0.85"
                    transform={`rotate(${heading} ${sx} ${sy})`}
                  />
                )}
                <circle cx={sx} cy={sy} r={9} className="mePulse" />
                <circle cx={sx} cy={sy} r={7} fill="#FFC24A" stroke="var(--markerEdge)" strokeWidth="3" />
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

      <div className="scaleBar">
        <span style={{ width: `${Math.round(100 * view.scale)}px` }} />
        <em>100 m</em>
      </div>
    </div>
  );
}
