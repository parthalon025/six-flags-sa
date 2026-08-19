/**
 * Pixel tycoon isometric projection — RCT-style 2.5D from OSM footprints.
 *
 * Ground (x east, y north, metres) → iso. Buildings extrude “up” in iso space.
 * Coaster polylines lift with a repeating hill so track reads as structure.
 *
 * Four OpenRCT2-style quarter-turn views: rotation r ∈ {0..3} spins the ground
 * plane before projection. Culling is rotation-invariant: the ground-space
 * checks are so structurally, and buildingHitsLiftedTrack (a screen-space
 * check) is pinned to rotation 0 — see its JSDoc for the trade-off. Paint
 * order comes from depthKey — larger is farther from the camera and paints
 * first.
 */

export const ISO_Y = 0.5;

/** Sin-hill wavelength divisor (metres) — travelled/28 gives ~88 m crest-to-crest at ride scale. */
export const LIFT_HILL_PERIOD_M = 28;

/**
 * Lift-profile height (metres) at a travelled distance along a track.
 * The single sin-hill implementation — liftCoaster's geometry and
 * isoTrack.js's segment classification must agree on it.
 * The bare defaults (12/3) are liftCoaster's legacy fallback, not
 * rct-classic's resolved values — real callers resolve explicit values
 * from a template and pass them in.
 */
export function liftHeightAt(travelled, { heightAmp = 12, baseHeight = 3 } = {}) {
  return baseHeight + heightAmp * Math.abs(Math.sin(travelled / LIFT_HILL_PERIOD_M));
}

/** Quarter-turn view count (OpenRCT2 convention). */
export const ISO_ROTATIONS = 4;

const RCT_CLASSIC_TEMPLATE = Object.freeze({
  id: 'rct-classic',
  buildingHeightM,
  coasterBaseM: 3,
  coasterHeightAmp: 9,
  coasterStepM: 6,
  buildingTrackPadM: 10,
  liftedTrackPadM: 8,
});
export const ISO_MAP_TEMPLATES = Object.freeze({
  'rct-classic': RCT_CLASSIC_TEMPLATE,
});

/**
 * Shared isometric map recipe. A Skin selects a recipe by id; it does not
 * fork the projection or painter. Future Iso maps can change palette and
 * geometry policy at their adapter seam while sharing the core renderer.
 */
export function resolveIsoMapTemplate(template = 'rct-classic') {
  if (template && typeof template === 'object') {
    return { ...RCT_CLASSIC_TEMPLATE, ...template };
  }
  return ISO_MAP_TEMPLATES[template] || RCT_CLASSIC_TEMPLATE;
}

/** Ground-plane quarter turn applied before projection. */
function rotateGround(dx, dy, rotation) {
  switch (rotation & 3) {
    case 1: return { x: dy, y: -dx };
    case 2: return { x: -dx, y: -dy };
    case 3: return { x: -dy, y: dx };
    default: return { x: dx, y: dy };
  }
}

/** Local mercator metres → isometric ground, spun by a quarter-turn view. */
export function isoLocal(dx, dy, rotation = 0) {
  const r = rotateGround(dx, dy, rotation);
  return { x: r.x - r.y, y: (r.x + r.y) * ISO_Y };
}

/** Inverse of isoLocal for the same rotation. */
export function isoInverse(ix, iy, rotation = 0) {
  const rx = (ix + 2 * iy) / 2;
  const ry = (2 * iy - ix) / 2;
  const g = rotateGround(rx, ry, 4 - (rotation & 3));
  return { dx: g.x, dy: g.y };
}

/**
 * OpenRCT2-style paint-order key. LARGER means FARTHER from the camera
 * (paints first). The key is the rotated ground point's iso y; height
 * subtracts a hair so an elevated item at the same ground point paints
 * after the ground it stands over.
 */
export function depthKey({ x, y, z = 0 }, rotation = 0) {
  const r = rotateGround(x, y, rotation);
  return (r.x + r.y) * ISO_Y - z * 1e-3;
}

function meanDepth(pts, rotation) {
  const n = Math.max(pts.length, 1);
  return pts.reduce((s, [x, y]) => s + depthKey({ x, y }, rotation), 0) / n;
}

function ringAreaAbs(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Stall vs hall height from footprint area (metres). */
export function buildingHeightM(ring) {
  const area = ringAreaAbs(ring);
  if (area < 50) return 6;
  if (area < 250) return 10;
  return 14;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** True when a building ring is the ride envelope (most of a track sits inside it). */
export function buildingCoversTrack(ring, line, frac = 0.35) {
  if (!ring || ring.length < 3 || !line || line.length < 2) return false;
  let inside = 0;
  for (const pt of line) {
    if (pointInRing(pt[0], pt[1], ring)) inside += 1;
  }
  return inside / line.length >= frac;
}

function orient(ax, ay, bx, by, cx, cy) {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function segsCross(a, b, c, d) {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function distToRing(pt, ring) {
  if (pointInRing(pt[0], pt[1], ring)) return 0;
  let best = Infinity;
  for (let e = 0; e < ring.length; e += 1) {
    const a = ring[e];
    const b = ring[(e + 1) % ring.length];
    best = Math.min(best, distToSeg(pt[0], pt[1], a[0], a[1], b[0], b[1]));
  }
  return best;
}

function segDist(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(
    distToSeg(a[0], a[1], c[0], c[1], d[0], d[1]),
    distToSeg(b[0], b[1], c[0], c[1], d[0], d[1]),
    distToSeg(c[0], c[1], a[0], a[1], b[0], b[1]),
    distToSeg(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

function convexHull(pts) {
  const p = pts.map((q) => ({ x: q.x, y: q.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function liftedPts(line, stepM, heightAmp, baseHeight) {
  const pts = [];
  let travelled = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (i > 0) travelled += dist2(line[i - 1], line[i]);
    const h = liftHeightAt(travelled, { heightAmp, baseHeight });
    const g = isoLocal(line[i][0], line[i][1]);
    pts.push({ x: g.x, y: g.y + h });
  }
  return pts;
}

function distToHull(pt, hull) {
  const ring = hull.map((p) => [p.x, p.y]);
  if (pointInRing(pt.x, pt.y, ring)) return 0;
  return distToRing([pt.x, pt.y], ring);
}

/**
 * True when a lifted rail punches through the extruded hall on screen.
 * Deliberately checked at rotation 0 so culling never varies per view.
 */
export function buildingHitsLiftedTrack(ring, line, heightM, padM = 8, lift = {}) {
  if (!ring || ring.length < 3 || !line || line.length < 2) return false;
  const foot = ring.map(([x, y]) => isoLocal(x, y));
  const roof = foot.map((p) => ({ x: p.x, y: p.y + heightM }));
  const hull = convexHull([...foot, ...roof]);
  if (hull.length < 3) return false;
  const { stepM = 6, heightAmp = 9, baseHeight = 3 } = lift;
  return liftedPts(line, stepM, heightAmp, baseHeight).some((pt) => distToHull(pt, hull) <= padM);
}

/** True when a stall and a rail share ground — they must not both draw. */
export function buildingHitsTrack(ring, line, padM = 10) {
  if (!ring || ring.length < 3 || !line || line.length < 2) return false;
  for (const pt of line) {
    if (distToRing(pt, ring) <= padM) return true;
  }
  for (let i = 0; i < line.length - 1; i += 1) {
    for (let e = 0; e < ring.length; e += 1) {
      if (segDist(line[i], line[i + 1], ring[e], ring[(e + 1) % ring.length]) <= padM) return true;
    }
  }
  return false;
}

function lineLength(line) {
  let n = 0;
  for (let i = 1; i < (line || []).length; i += 1) n += dist2(line[i - 1], line[i]);
  return n;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToLine(pt, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    best = Math.min(best, distToSeg(pt[0], pt[1], line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
  }
  return best;
}

function nearFrac(from, to, nearM) {
  if (!from.length || !to.length) return 0;
  let n = 0;
  for (const p of from) {
    if (distToLine(p, to) <= nearM) n += 1;
  }
  return n / from.length;
}

function linesNear(a, b, nearM) {
  return Math.max(nearFrac(a, b, nearM), nearFrac(b, a, nearM)) >= 0.55;
}

function asCoaster(item, i) {
  if (Array.isArray(item)) return { r: item, n: '', i };
  return { r: item?.r || [], n: item?.n || '', i: item?.i ?? i };
}

function closePt(a, b, m) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= m;
}

function tryJoin(chain, piece, joinM) {
  const c0 = chain[0];
  const c1 = chain[chain.length - 1];
  const p0 = piece[0];
  const p1 = piece[piece.length - 1];
  const rev = piece.slice().reverse();
  if (closePt(c1, p0, joinM)) return chain.concat(piece.slice(1));
  if (closePt(c1, p1, joinM)) return chain.concat(rev.slice(1));
  if (closePt(c0, p1, joinM)) return piece.concat(chain.slice(1));
  if (closePt(c0, p0, joinM)) return rev.concat(chain.slice(1));
  return null;
}

function collapseGroup(bucket, { nearM, joinM }) {
  const leftover = [...bucket].sort((a, b) => b.len - a.len);
  const chains = [];
  while (leftover.length) {
    const seed = leftover.shift();
    let chain = seed.r.slice();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = leftover.length - 1; i >= 0; i -= 1) {
        const rec = leftover[i];
        if (linesNear(rec.r, chain, nearM)) {
          leftover.splice(i, 1);
          continue;
        }
        const joined = tryJoin(chain, rec.r, joinM);
        if (!joined) continue;
        chain = joined;
        leftover.splice(i, 1);
        changed = true;
      }
    }
    chains.push({ r: chain, n: seed.n, i: seed.i, len: lineLength(chain) });
  }
  return chains;
}

/**
 * OSM stores many ways per ride (rails, splits). Merge connected pieces
 * into one ribbon and drop a rail that hugs another.
 */
export function pickCoasterLines(items, { nearM = 8, joinM = 14 } = {}) {
  const recs = (items || []).map((item, i) => {
    const c = asCoaster(item, i);
    return { ...c, len: lineLength(c.r) };
  }).filter((c) => c.r && c.r.length >= 2);

  const named = new Map();
  const unnamed = [];
  for (const rec of recs) {
    const key = String(rec.n || '').trim().toLowerCase();
    if (!key) {
      unnamed.push(rec);
      continue;
    }
    const bucket = named.get(key) || [];
    bucket.push(rec);
    named.set(key, bucket);
  }

  const kept = [];
  for (const bucket of named.values()) {
    kept.push(...collapseGroup(bucket, { nearM, joinM }));
  }
  unnamed.sort((a, b) => b.len - a.len);
  for (const rec of unnamed) {
    if (kept.some((k) => linesNear(rec.r, k.r, nearM))) continue;
    kept.push(rec);
  }
  return kept;
}

/**
 * OSM often stores two or three ways for one midway. Keep the longest
 * and drop a footway that hugs it so markers sit on one line.
 */
export function pickWalkways(items, { nearM = 8 } = {}) {
  const recs = (items || []).map((item, i) => {
    const c = asCoaster(item, i);
    return { ...c, len: lineLength(c.r) };
  }).filter((c) => c.r && c.r.length >= 2);
  recs.sort((a, b) => b.len - a.len);
  const kept = [];
  for (const rec of recs) {
    if (kept.some((k) => linesNear(rec.r, k.r, nearM))) continue;
    kept.push(rec);
  }
  return kept;
}

function pathFromPts(pts, close) {
  if (!pts.length) return '';
  let d = '';
  for (let i = 0; i < pts.length; i += 1) {
    d += `${i === 0 ? 'M' : 'L'}${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  }
  return close ? `${d}Z` : d;
}

/**
 * Extrude a local-metre ring into roof + wall faces (iso space).
 * @param {number[][]} ring [[x,y], ...] local mercator metres
 * @param {number} heightM
 */
export function extrudeBuilding(ring, heightM, { rotation = 0 } = {}) {
  const foot = ring.map(([x, y]) => isoLocal(x, y, rotation));
  const roof = foot.map((p) => ({ x: p.x, y: p.y + heightM }));
  const walls = [];
  for (let i = 0; i < foot.length; i += 1) {
    const a = foot[i];
    const b = foot[(i + 1) % foot.length];
    const at = roof[i];
    const bt = roof[(i + 1) % roof.length];
    const leftish = a.x + b.x < 0;
    walls.push({
      side: leftish ? 'L' : 'R',
      d: pathFromPts([a, b, bt, at], true),
      depth: meanDepth([ring[i], ring[(i + 1) % ring.length]], rotation),
    });
  }
  const depth = meanDepth(ring, rotation);
  return {
    foot: { d: pathFromPts(foot, true) },
    roof: { d: pathFromPts(roof, true) },
    walls,
    depth,
  };
}

/**
 * Extrude local-metre footprints and lift coaster polylines, back-to-front.
 * Caps keep a crowded OSM extract from flooding the SVG. Culling runs in
 * ground space, so the kept set is identical across all four rotations.
 */
export function assembleIsoMeshes(
  buildingRings,
  coasterLines,
  {
    maxBuildings = 220,
    maxTracks = 40,
    stepM,
    heightAmp,
    baseHeight,
    buildingTrackPadM,
    liftedTrackPadM,
    template = 'rct-classic',
    rotation = 0,
  } = {},
) {
  const recipe = resolveIsoMapTemplate(template);
  const trackStepM = stepM ?? recipe.coasterStepM;
  const trackHeightAmp = heightAmp ?? recipe.coasterHeightAmp;
  const trackBaseHeight = baseHeight ?? recipe.coasterBaseM;
  const groundPadM = buildingTrackPadM ?? recipe.buildingTrackPadM;
  const liftedPadM = liftedTrackPadM ?? recipe.liftedTrackPadM;
  const picked = pickCoasterLines(coasterLines);
  const tracks = [];
  picked.forEach((rec) => {
    tracks.push({
      ...liftCoaster(rec.r, {
        stepM: trackStepM,
        heightAmp: trackHeightAmp,
        baseHeight: trackBaseHeight,
        rotation,
      }),
      i: rec.i,
    });
  });
  const pickedLines = picked.map((rec) => rec.r);
  const buildings = [];
  (buildingRings || []).forEach((ring, i) => {
    if (!ring || ring.length < 3) return;
    const heightM = recipe.buildingHeightM(ring);
    if (
      pickedLines.some(
        (line) =>
          buildingHitsTrack(ring, line, groundPadM) ||
          buildingCoversTrack(ring, line) ||
          buildingHitsLiftedTrack(ring, line, heightM, liftedPadM, {
            stepM: trackStepM,
            heightAmp: trackHeightAmp,
            baseHeight: trackBaseHeight,
          }),
      )
    ) {
      return;
    }
    buildings.push({ ...extrudeBuilding(ring, heightM, { rotation }), i });
  });
  buildings.sort((a, b) => b.depth - a.depth);
  return {
    buildings: buildings.slice(0, maxBuildings),
    tracks: tracks.slice(0, maxTracks),
  };
}

/** Back-to-front paint list so stalls and track interleave instead of two slabs. */
export function stackIsoItems(buildings = [], tracks = []) {
  const items = [
    ...buildings.map((item) => ({ type: 'building', depth: item.depth, item })),
    ...tracks.map((item) => ({ type: 'track', depth: item.depth, item })),
  ];
  items.sort((a, b) => b.depth - a.depth);
  return items;
}

function dist2(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Lift a local-metre polyline into ground shadow, raised track, and posts.
 * @param {number[][]} line [[x,y], ...]
 */
export function liftCoaster(line, { stepM = 18, heightAmp = 12, baseHeight = 3, rotation = 0 } = {}) {
  const pts = [];
  let travelled = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (i > 0) travelled += dist2(line[i - 1], line[i]);
    const h = liftHeightAt(travelled, { heightAmp, baseHeight });
    const g = isoLocal(line[i][0], line[i][1], rotation);
    pts.push({ g, t: { x: g.x, y: g.y + h }, h, travelled });
  }
  const supports = [];
  let next = 0;
  for (const p of pts) {
    if (p.travelled + 1e-6 < next) continue;
    supports.push({
      d: `M${p.g.x.toFixed(2)} ${p.g.y.toFixed(2)}L${p.t.x.toFixed(2)} ${p.t.y.toFixed(2)}`,
    });
    next += stepM;
  }
  const depth = meanDepth(line, rotation);
  return {
    shadow: { d: pathFromPts(pts.map((p) => p.g), false) },
    track: { d: pathFromPts(pts.map((p) => p.t), false) },
    supports,
    depth,
  };
}

/**
 * SVG transform for iso-local geometry (same units as isoLocal).
 */
export function isoViewTransform({
  cx,
  cy,
  scale,
  viewX,
  viewY,
  originX = 0,
  originY = 0,
  pixelRatio = 1,
  rotation = 0,
}) {
  const cam = isoLocal(viewX - originX, viewY - originY, rotation);
  const pr = Math.max(1, pixelRatio || 1);
  const snap = (metres) => {
    const px = metres * scale * pr;
    if (!Number.isFinite(px)) return metres;
    return Math.round(px) / (scale * pr);
  };
  return `translate(${cx} ${cy}) scale(${scale} ${-scale}) translate(${-snap(cam.x)} ${-snap(cam.y)})`;
}

/** Screen from absolute mercator when the world is drawn in iso-local. */
export function isoToScreen(wx, wy, view, cx, cy) {
  const dx = wx - view.x;
  const dy = wy - view.y;
  const iso = isoLocal(dx, dy, view.rotation ?? 0);
  return [iso.x * view.scale + cx, -iso.y * view.scale + cy];
}

/** Absolute mercator under a screen point (iso camera, no heading spin). */
export function isoScreenToWorld(px, py, view, cx, cy) {
  const isoX = (px - cx) / view.scale;
  const isoY = -(py - cy) / view.scale;
  const { dx, dy } = isoInverse(isoX, isoY, view.rotation ?? 0);
  return { x: view.x + dx, y: view.y + dy };
}
