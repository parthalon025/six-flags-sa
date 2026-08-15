/**
 * Pixel tycoon isometric projection — RCT-style 2.5D from OSM footprints.
 *
 * Ground (x east, y north, metres) → iso. Buildings extrude “up” in iso space.
 * Coaster polylines lift with a repeating hill so track reads as structure.
 */

export const ISO_Y = 0.5;

/** Local mercator metres → isometric ground. */
export function isoLocal(dx, dy) {
  return { x: dx - dy, y: (dx + dy) * ISO_Y };
}

/** Inverse of isoLocal. */
export function isoInverse(ix, iy) {
  return {
    dx: (ix + 2 * iy) / 2,
    dy: (2 * iy - ix) / 2,
  };
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
export function extrudeBuilding(ring, heightM) {
  const foot = ring.map(([x, y]) => isoLocal(x, y));
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
      depth: (a.y + b.y) / 2,
    });
  }
  const depth = foot.reduce((s, p) => s + p.y, 0) / Math.max(foot.length, 1);
  return {
    foot: { d: pathFromPts(foot, true) },
    roof: { d: pathFromPts(roof, true) },
    walls,
    depth,
  };
}

/**
 * Extrude local-metre footprints and lift coaster polylines, back-to-front.
 * Caps keep a crowded OSM extract from flooding the SVG.
 */
export function assembleIsoMeshes(
  buildingRings,
  coasterLines,
  { maxBuildings = 220, maxTracks = 40, stepM = 6, heightAmp = 9 } = {},
) {
  const buildings = [];
  (buildingRings || []).forEach((ring, i) => {
    if (!ring || ring.length < 3) return;
    buildings.push({ ...extrudeBuilding(ring, buildingHeightM(ring)), i });
  });
  buildings.sort((a, b) => b.depth - a.depth);
  const tracks = [];
  (coasterLines || []).forEach((line, i) => {
    if (!line || line.length < 2) return;
    tracks.push({ ...liftCoaster(line, { stepM, heightAmp }), i });
  });
  return {
    buildings: buildings.slice(0, maxBuildings),
    tracks: tracks.slice(0, maxTracks),
  };
}

function dist2(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Lift a local-metre polyline into ground shadow, raised track, and posts.
 * @param {number[][]} line [[x,y], ...]
 */
export function liftCoaster(line, { stepM = 18, heightAmp = 12 } = {}) {
  const pts = [];
  let travelled = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (i > 0) travelled += dist2(line[i - 1], line[i]);
    const h = 3 + heightAmp * Math.abs(Math.sin(travelled / 28));
    const g = isoLocal(line[i][0], line[i][1]);
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
  return {
    shadow: { d: pathFromPts(pts.map((p) => p.g), false) },
    track: { d: pathFromPts(pts.map((p) => p.t), false) },
    supports,
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
}) {
  const cam = isoLocal(viewX - originX, viewY - originY);
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
  const iso = isoLocal(dx, dy);
  return [iso.x * view.scale + cx, -iso.y * view.scale + cy];
}

/** Absolute mercator under a screen point (iso camera, no heading spin). */
export function isoScreenToWorld(px, py, view, cx, cy) {
  const isoX = (px - cx) / view.scale;
  const isoY = -(py - cy) / view.scale;
  const { dx, dy } = isoInverse(isoX, isoY);
  return { x: view.x + dx, y: view.y + dy };
}
