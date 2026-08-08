'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatAge, formatDistance, distance, project, unproject } from '@/lib/geo';
import { paletteFor } from '@/lib/theme';
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
   geometry for Kings Island, projected to Web Mercator metres and painted as
   SVG. Pan with one finger, pinch or wheel to zoom.

   `to(x, y)` is the one place world metres become screen pixels — pan, zoom,
   rotation and the lifted centre all live in it, and everything drawn below
   goes through it. */

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
    const [x, y] = project(39.3428, -84.2666);
    return { x, y, scale: 0.95 };
  });
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const moved = useRef(false);
  // The laid-out markers, so a tap can be resolved against what was drawn.
  const planRef = useRef({ lands: [], markers: [], labels: [] });

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

  // Follow mode keeps the marker centred without fighting manual pans. While a
  // route is running it follows the snapped point rather than the raw fix, so
  // the camera stops sliding sideways every time GPS changes its mind.
  const anchorLat = puck?.lat ?? me?.lat ?? null;
  const anchorLng = puck?.lng ?? me?.lng ?? null;
  useEffect(() => {
    if (!follow || anchorLat == null) return;
    const [x, y] = project(anchorLat, anchorLng);
    setView((v) => ({ ...v, x, y }));
  }, [follow, anchorLat, anchorLng]);

  // An explicit focus request (tapping a roster row, a ride, the meet-up)
  // recentres and zooms in a little if we are far out.
  useEffect(() => {
    if (!focusPoint) return;
    const [x, y] = project(focusPoint.lat, focusPoint.lng);
    setView((v) => ({ x, y, scale: Math.max(v.scale, 1.6) }));
  }, [focusPoint]);

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
     turns, and a land name lying along its land has to turn with it. */
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
    // A drag is in screen pixels; with the map turned, the world moves along a
    // different axis than the finger does.
    const u = dx * spin.cos + dy * spin.sin;
    const v = -dx * spin.sin + dy * spin.cos;
    setView((s) => ({ ...s, x: s.x - u / s.scale, y: s.y + v / s.scale }));
  };

  /* Taps are resolved here rather than by handlers on each marker.
     `setPointerCapture` above retargets every later pointer event at the
     wrapper, so a pointerup listener on a marker never heard the tap that
     landed on it and nothing was ever selectable. Hit-testing against the
     markers we actually placed is both correct and exact — the target is the
     circle we drew, not whatever the SVG happens to think was under the
     finger — and it costs 150 comparisons instead of 150 event listeners. */
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
    if (moved.current || pointers.current.size !== 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const poi = pickAt(px, py);
    if (poi) {
      onSelectPoi?.(poi);
      return;
    }
    const alt = pickRouteAt(px, py);
    if (alt != null) {
      onPickAlternative?.(alt);
      return;
    }
    const [lat, lng] = screenToLatLng(px, py);
    onMapTap?.(lat, lng);
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
  /* Land names survive far further out than place names do, because the
     park-wide view is precisely when "which land is that" is the question. */
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

  /* Coaster track carries the ride's name in the source data, so the 121 red
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

  /* Each land's long axis, computed once from the geometry rather than per
     frame. Some lands are two polygons under one name, so they are pooled. */
  const landAxes = useMemo(() => {
    if (!data?.lands) return [];
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
     One budget of screen space, spent in importance order: land names first
     (they are the map's skeleton), then the markers you and your party are,
     then places, then place names. Anything that will not fit is dropped
     rather than drawn on top of what is already there. */
  const plan = useMemo(() => {
    const grid = new Declutter();
    const lands = [];
    const markers = [];
    const labels = [];
    if (!data) return { lands, markers, labels };

    // Chrome eats the top and the bottom of the map; a name placed under the
    // sheet has been drawn for nobody. Reserving those rectangles up front
    // costs one line each and saves every later pass from thinking about them.
    // `bottomInset` is how much of the map the sheet is standing on right now:
    // it grows when the sheet is opened and goes to nothing while walking, and
    // a label laid out against the wrong number ends up behind it.
    const floor = size.h - bottomInset;
    const frame = { x0: 58, x1: size.w - 58, y0: 104, y1: floor - 6 };
    [
      { x0: -30, x1: size.w + 30, y0: -30, y1: 100 }, // the title card
      { x0: -30, x1: size.w + 30, y0: floor, y1: size.h + 30 }, // the sheet
      { x0: size.w - 96, x1: size.w + 30, y0: floor - 140, y1: floor + 4 }, // meet + recentre
      { x0: -30, x1: 180, y0: floor - 106, y1: floor + 4 }, // key, compass, scale
    ].forEach((box) => grid.occupy(box));

    // A name half over the edge of the phone is worse than no name: it reads
    // as a different, shorter word.
    const wholly = (box) => box.x0 >= 2 && box.y0 >= 2 && box.x1 <= size.w - 2 && box.y1 <= floor;

    /* Land names go down first, but they have to survive each other too: they
       are gathered, ordered by how much of the screen each land actually
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
        // Keep the name over its own land and inside the usable frame; a land
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
          // The land is mostly off screen. Stay as near to it as the screen
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
        const across = 8; // half the cap height of the land face, plus a hair
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
      ranked.push({ p, sx, sy, sym, state, isSel, isNav, rank, priority });
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
    const state = rideEligibility?.get(selected.n);
    return {
      // Kept clear of the edges, and flipped under the marker when there is no
      // room for it above.
      x: Math.min(Math.max(sx, 74), size.w - 74),
      y: sy,
      below: sy < 150,
      name: selected.n,
      away: away == null ? null : formatDistance(away),
      height: rideish ? heightLabel(selected) : selected.a || '',
      state,
    };
  }, [selected, at, me, size.w, size.h, rideEligibility]);

  if (!data) {
    return (
      <div className="mapWrap" ref={wrapRef}>
        <div className="mapLoading">Drawing the park…</div>
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
        {/* park ground */}
        <g className="lyr-park">{layers.poly(data.park, 'pk')}</g>

        {/* themed lands */}
        {data.lands.map((land, i) => {
          const tint = palette.lands[land.n] || palette.lands['Front Gate'];
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

        {/* land names, lying along their land and clamped to the part of it
            you can actually see */}
        <defs>
          {plan.lands.map((l) => (
            <path key={`lp${l.name}`} id={`landline-${l.name.replace(/\W+/g, '-')}`} d={l.d} />
          ))}
        </defs>
        {plan.lands.map((l) => {
          const tint = palette.lands[l.name] || palette.lands['Front Gate'];
          return (
            <text key={`lt${l.name}`} className="landLabel" fill={tint.label}>
              <textPath
                href={`#landline-${l.name.replace(/\W+/g, '-')}`}
                xlinkHref={`#landline-${l.name.replace(/\W+/g, '-')}`}
                startOffset="50%"
              >
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
            transform={`translate(${m.sx.toFixed(1)} ${m.sy.toFixed(1)})`}
            style={{ cursor: 'pointer' }}
          >
            {/* Names the marker for a screen reader and for a desktop hover,
                whether or not the decluttering pass could afford to print it. */}
            <title>{m.p.n}</title>
            <PoiMarker
              category={m.p.c}
              colour={palette.categories[m.p.c] || '#888'}
              r={m.r}
              state={m.state}
              selected={m.isSel}
            />
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
            <g key={m.id}>
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
              {/* Staleness is a dashed ring and a clock, not a fade: fading is
                  what an unrideable ride looks like, and one map cannot say two
                  things with the same ink. */}
              {stale && <circle cx={sx} cy={sy} r={17.5} className="staleRing" />}
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
                <circle
                  cx={sx}
                  cy={sy}
                  r={7}
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
            {callout.height}
          </span>
          {(callout.state === 'no' || callout.state === 'toobig') && (
            <em className="calloutBar">Not this height</em>
          )}
          {callout.state === 'companion' && <em className="calloutAdult">Needs a grown-up</em>}
        </div>
      )}

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
