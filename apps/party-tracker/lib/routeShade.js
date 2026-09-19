// Optional tree-cover shade hint for a walking route (#356).
//
// Post-route annotation only — no clock, no routing cost change, no solar
// geometry. "Within ~15 m of a mapped wood ring" is the cheap heuristic the
// park-intelligence review prescribes; it is honestly labelled, not a guarantee.

export const SHADE_BUFFER_M = 15;
export const SHADE_DISCLAIMER = 'Near mapped tree cover, not a shade guarantee.';

const CELL_M = 30;
const SAMPLE_STEP_M = 10;

const hypot = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function projectOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function pointInRing(px, py, ring, proj) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = proj.x(ring[i][0]);
    const yi = proj.y(ring[i][1]);
    const xj = proj.x(ring[j][0]);
    const yj = proj.y(ring[j][1]);
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const t = projectOnSegment(px, py, ax, ay, bx, by);
  return hypot(px, py, ax + t * (bx - ax), ay + t * (by - ay));
}

class EdgeGrid {
  constructor(cell = CELL_M) {
    this.cell = cell;
    this.buckets = new Map();
  }

  key(cx, cy) {
    return `${cx},${cy}`;
  }

  addEdge(a, b) {
    const cx0 = Math.floor(Math.min(a.x, b.x) / this.cell);
    const cx1 = Math.floor(Math.max(a.x, b.x) / this.cell);
    const cy0 = Math.floor(Math.min(a.y, b.y) / this.cell);
    const cy1 = Math.floor(Math.max(a.y, b.y) / this.cell);
    const edge = { a, b };
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const k = this.key(cx, cy);
        const bucket = this.buckets.get(k);
        if (bucket) bucket.push(edge);
        else this.buckets.set(k, [edge]);
      }
    }
  }

  around(x, y, rings = 1) {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const out = [];
    for (let dx = -rings; dx <= rings; dx += 1) {
      for (let dy = -rings; dy <= rings; dy += 1) {
        const bucket = this.buckets.get(this.key(cx + dx, cy + dy));
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }
}

function woodGeometry(wood, proj) {
  const grid = new EdgeGrid();
  const polygons = [];
  for (const feature of wood || []) {
    const ring = Array.isArray(feature) ? feature : feature?.r;
    if (!Array.isArray(ring) || ring.length < 3) continue;
    polygons.push(ring);
    for (let i = 1; i < ring.length; i += 1) {
      const a = { x: proj.x(ring[i - 1][0]), y: proj.y(ring[i - 1][1]) };
      const b = { x: proj.x(ring[i][0]), y: proj.y(ring[i][1]) };
      grid.addEdge(a, b);
    }
  }
  return { grid, polygons, proj };
}

function minDistToWood(px, py, cache, bufferM) {
  for (const ring of cache.polygons) {
    if (pointInRing(px, py, ring, cache.proj)) return 0;
  }
  let best = Infinity;
  const ringCount = Math.ceil(bufferM / CELL_M) + 1;
  for (const edge of cache.grid.around(px, py, ringCount)) {
    const d = distToSegment(px, py, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

/** Sample the polyline at roughly `stepM` intervals for shade accounting. */
function samplePolyline(points, proj, stepM = SAMPLE_STEP_M) {
  if (!points?.length) return [];
  const samples = [[points[0][0], points[0][1]]];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    let ax = proj.x(from[1]);
    let ay = proj.y(from[0]);
    const bx = proj.x(to[1]);
    const by = proj.y(to[0]);
    let segLen = hypot(ax, ay, bx, by);
    let t0 = 0;
    while (carry + segLen >= stepM) {
      const need = stepM - carry;
      const t = t0 + need / segLen;
      samples.push([from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]);
      segLen -= need;
      t0 = t;
      carry = 0;
      ax = proj.x(samples.at(-1)[1]);
      ay = proj.y(samples.at(-1)[0]);
    }
    carry += segLen;
  }
  if (samples.length === 1 && points.length > 1) {
    samples.push([points.at(-1)[0], points.at(-1)[1]]);
  }
  return samples;
}

/**
 * Tree-cover shade hint for a route polyline.
 *
 * @returns {null | { source, buffer_m, near_m, fraction, label, disclaimer }}
 */
export function shadeHintForRoute({ points, wood, proj, bufferM = SHADE_BUFFER_M } = {}) {
  if (!points?.length || !wood?.length || !proj) return null;
  const cache = woodGeometry(wood, proj);
  if (!cache.polygons.length) return null;

  const samples = samplePolyline(points, proj);
  let nearM = 0;
  let totalM = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    const ax = proj.x(a[1]);
    const ay = proj.y(a[0]);
    const bx = proj.x(b[1]);
    const by = proj.y(b[0]);
    const segM = hypot(ax, ay, bx, by);
    totalM += segM;
    const near =
      minDistToWood(ax, ay, cache, bufferM) <= bufferM ||
      minDistToWood(bx, by, cache, bufferM) <= bufferM;
    if (near) nearM += segM;
  }

  if (totalM <= 0) return null;
  const fraction = nearM / totalM;
  let label = null;
  if (fraction >= 0.5) label = 'mostly_near_trees';
  else if (fraction >= 0.15) label = 'partly_near_trees';
  if (!label) return null;

  return {
    source: 'tree_cover_heuristic',
    buffer_m: bufferM,
    near_m: Math.round(nearM),
    fraction: Math.round(fraction * 100) / 100,
    label,
    disclaimer: SHADE_DISCLAIMER,
  };
}

/** Human copy for the route preview card. */
export function shadeNote(shade) {
  if (!shade?.label) return null;
  const pct = Math.round(shade.fraction * 100);
  if (shade.label === 'mostly_near_trees') {
    return `Much of this walk passes near mapped trees (within ${shade.buffer_m} m, ~${pct}%). ${shade.disclaimer}`;
  }
  return `Part of this walk passes near mapped trees (within ${shade.buffer_m} m, ~${pct}%). ${shade.disclaimer}`;
}

/** Attach a shade hint to a route without changing its geometry or cost. */
export function annotateRouteShade(route, map, proj) {
  if (!route || route.mode === 'direct' || !map?.wood?.length || !proj) return route;
  const shade = shadeHintForRoute({ points: route.points, wood: map.wood, proj });
  return shade ? { ...route, shade } : route;
}
