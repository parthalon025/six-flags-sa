// Walking routes along the park's real footpaths.
//
// The map file already carries every midway, queue and service road as an
// OpenStreetMap polyline, so a route does not need tiles or a routing server —
// it needs those polylines welded into a graph and a shortest path across it.
// Everything here is pure: no DOM, no fetch, no clock. `test/unit.mjs` runs it
// against the real `public/parkmap.json`.
//
// Distances are true metres. Web Mercator is what the renderer uses and it
// inflates length by 1/cos(lat) — 29% at Kings Island — so the geometry below
// uses a local equirectangular projection instead, which is accurate to well
// under a metre across a park this size.

const R = 6371000;
const rad = Math.PI / 180;

/** Two vertices this close are the same junction, whatever the source says. */
export const WELD_M = 6;
/** A loose path end this close to another path is a junction nobody drew. */
const STITCH_M = 26;
/** How far apart two otherwise unreachable pieces may be bridged. */
const BRIDGE_M = 70;
/** Two paths this close that need a long walk between them are a mapping gap. */
const MEND_M = 25;
/** …but only if the walk they force is at least this long. */
const MEND_DETOUR_M = 300;
/** Spatial hash cell. Big enough that a snap rarely walks past one ring. */
const CELL_M = 30;
/** Beyond this, the nearest path is not a path you are standing on. */
export const MAX_SNAP_M = 140;
/** Crowded-park walking pace, matching lib/geo's formatWalk. */
export const WALK_MPS = 1.15;

/**
 * Cost multipliers. A route is allowed to leave the guest midways, but only
 * when doing so saves more than these make it cost.
 *   - service roads are back-of-house: legal to draw, rude to send someone down
 *   - a queue is a dead end with a ride at the bottom, never a through-route
 */
const FACTOR = { path: 1, service: 2.6, queue: 4.5, stitch: 1.4, bridge: 2, mend: 2.2 };

const isQueue = (name) => /\b(queue|line)\b/i.test(name || '');

/* ---------------------------------------------------------------- geometry */

function makeProjector(lat0) {
  const kx = R * rad * Math.cos(lat0 * rad);
  const ky = R * rad;
  return {
    x: (lng) => lng * kx,
    y: (lat) => lat * ky,
    lng: (x) => x / kx,
    lat: (y) => y / ky,
  };
}

const hypot = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/** Closest point on segment a→b to p, as a parameter in [0,1]. */
function projectOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/* ------------------------------------------------------------------- graph */

class Grid {
  constructor(cell = CELL_M) {
    this.cell = cell;
    this.buckets = new Map();
  }

  key(cx, cy) {
    return `${cx},${cy}`;
  }

  add(x, y, value) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const bucket = this.buckets.get(k);
    if (bucket) bucket.push(value);
    else this.buckets.set(k, [value]);
  }

  /** Every value in the (2r+1)² block of cells centred on (x, y). */
  around(x, y, rings = 1) {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const out = [];
    for (let i = cx - rings; i <= cx + rings; i += 1) {
      for (let j = cy - rings; j <= cy + rings; j += 1) {
        const bucket = this.buckets.get(this.key(i, j));
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }
}

/**
 * Weld every walkable polyline in the park map into a routing graph.
 *
 * Ways in OpenStreetMap share a node id where they meet, and this map file
 * keeps five decimal places, so most junctions land on identical coordinates.
 * The ones that don't — a path drawn twice by two mappers, a midway that
 * touches a plaza without being noded into it — are welded by proximity, which
 * is what `WELD_M` is for. Without that pass the graph looks complete and is
 * quietly in a hundred pieces.
 *
 * @param map the parsed public/parkmap.json
 * @returns a graph, or null if the file carries no paths
 */
export function buildRouteGraph(map, { includeService = true } = {}) {
  const ways = [];
  (map?.path || []).forEach((w) => {
    const ring = Array.isArray(w) ? w : w?.r;
    if (Array.isArray(ring) && ring.length > 1) {
      ways.push({ ring, name: w?.n || '', kind: isQueue(w?.n) ? 'queue' : 'path' });
    }
  });
  if (includeService) {
    (map?.service || []).forEach((w) => {
      const ring = Array.isArray(w) ? w : w?.r;
      if (Array.isArray(ring) && ring.length > 1) {
        ways.push({ ring, name: w?.n || '', kind: 'service' });
      }
    });
  }
  if (ways.length === 0) return null;

  // Centre the local projection on the geometry itself so the graph is not
  // pinned to one park's latitude.
  let latSum = 0;
  let latCount = 0;
  ways.forEach((w) => w.ring.forEach(([, lat]) => { latSum += lat; latCount += 1; }));
  const proj = makeProjector(latSum / latCount);

  const nodes = [];
  const weld = new Grid(WELD_M * 2);

  // Callers either have a lat/lng from the map file or a projected point from
  // an intersection they just computed; both weld into the same node table.
  const nodeAt = (lng, lat, atX, atY) => {
    const x = atX ?? proj.x(lng);
    const y = atY ?? proj.y(lat);
    let best = -1;
    let bestD = WELD_M;
    for (const idx of weld.around(x, y)) {
      const n = nodes[idx];
      const d = hypot(x, y, n.x, n.y);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
    if (best >= 0) return best;
    const idx = nodes.length;
    nodes.push({ lat: proj.lat(y), lng: proj.lng(x), x, y, edges: [] });
    weld.add(x, y, idx);
    return idx;
  };

  // Phase 1 — every drawn segment, welded at its shared vertices.
  const raw = [];
  ways.forEach((way) => {
    let prev = nodeAt(way.ring[0][0], way.ring[0][1]);
    for (let i = 1; i < way.ring.length; i += 1) {
      const next = nodeAt(way.ring[i][0], way.ring[i][1]);
      if (next !== prev) {
        raw.push({ a: prev, b: next, name: way.name, kind: way.kind });
        prev = next;
      }
    }
  });

  // Phase 2 — cut every place two ways cross. OSM notes a junction by sharing
  // a node, and a mapper who forgets leaves two midways that visibly meet on
  // screen and are unreachable from each other in the graph.
  const segments = splitAtCrossings(nodes, raw, nodeAt);

  const graph = { nodes, segments, segGrid: new Grid(CELL_M), proj };
  index(graph);

  // Phase 3 — a path that stops 15 m short of the midway it obviously joins is
  // the other half of the same problem: nothing crosses, so nothing welds.
  stitchLooseEnds(graph, nodeAt);
  // Phase 4 — whatever is still marooned gets one bridge to the mainland, if
  // one that short exists. Anything further out stays unreachable on purpose.
  bridgeIslands(graph);
  // Phase 5 — the subtler failure: connected, but only the long way round.
  mendGaps(graph, map);

  return graph;
}

/** (Re)build adjacency and the segment lookup grid from `graph.segments`. */
function index(graph) {
  const { nodes, segments } = graph;
  nodes.forEach((n) => {
    n.edges = [];
  });
  graph.segGrid = new Grid(CELL_M);
  segments.forEach((seg, segIndex) => {
    const a = nodes[seg.a];
    const b = nodes[seg.b];
    seg.len = hypot(a.x, a.y, b.x, b.y);
    seg.factor = FACTOR[seg.kind] ?? 1;
    const cost = seg.len * seg.factor;
    a.edges.push({ to: seg.b, cost, len: seg.len, seg: segIndex });
    b.edges.push({ to: seg.a, cost, len: seg.len, seg: segIndex });
    // A segment is registered in every cell its bounding box touches, so a
    // long midway is still found from a point standing in its middle.
    const cx0 = Math.floor(Math.min(a.x, b.x) / CELL_M);
    const cx1 = Math.floor(Math.max(a.x, b.x) / CELL_M);
    const cy0 = Math.floor(Math.min(a.y, b.y) / CELL_M);
    const cy1 = Math.floor(Math.max(a.y, b.y) / CELL_M);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        graph.segGrid.add(cx * CELL_M, cy * CELL_M, segIndex);
      }
    }
  });
}

/** Split every pair of segments that cross without sharing a node. */
function splitAtCrossings(nodes, raw, nodeAt) {
  const grid = new Grid(CELL_M);
  raw.forEach((seg, i) => {
    const a = nodes[seg.a];
    const b = nodes[seg.b];
    const cx0 = Math.floor(Math.min(a.x, b.x) / CELL_M);
    const cx1 = Math.floor(Math.max(a.x, b.x) / CELL_M);
    const cy0 = Math.floor(Math.min(a.y, b.y) / CELL_M);
    const cy1 = Math.floor(Math.max(a.y, b.y) / CELL_M);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) grid.add(cx * CELL_M, cy * CELL_M, i);
    }
  });

  const cuts = raw.map(() => []);
  const pairs = new Set();
  for (const bucket of grid.buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const [p, q] = bucket[i] < bucket[j] ? [bucket[i], bucket[j]] : [bucket[j], bucket[i]];
        const key = p * raw.length + q;
        if (pairs.has(key)) continue;
        pairs.add(key);
        const s1 = raw[p];
        const s2 = raw[q];
        if (s1.a === s2.a || s1.a === s2.b || s1.b === s2.a || s1.b === s2.b) continue;
        const hit = crossing(nodes[s1.a], nodes[s1.b], nodes[s2.a], nodes[s2.b]);
        if (!hit) continue;
        const node = nodeAt(0, 0, hit.x, hit.y);
        cuts[p].push({ t: hit.t, node });
        cuts[q].push({ t: hit.u, node });
      }
    }
  }

  const out = [];
  raw.forEach((seg, i) => {
    if (cuts[i].length === 0) {
      out.push({ ...seg });
      return;
    }
    const ordered = cuts[i].sort((m, n) => m.t - n.t);
    let from = seg.a;
    ordered.forEach(({ node }) => {
      if (node !== from) out.push({ ...seg, a: from, b: node });
      from = node;
    });
    if (from !== seg.b) out.push({ ...seg, a: from, b: seg.b });
  });
  return out;
}

/** Proper intersection of two segments, strictly inside both, or null. */
function crossing(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { t, u, x: a.x + rx * t, y: a.y + ry * t };
}

/** Join dangling path ends to whatever they visibly run up against. */
function stitchLooseEnds(graph, nodeAt) {
  const { nodes, segments } = graph;
  const added = [];
  nodes.forEach((node, idx) => {
    if (node.edges.length !== 1) return;
    let best = null;
    for (const segIndex of graph.segGrid.around(node.x, node.y, 1)) {
      const seg = segments[segIndex];
      if (seg.a === idx || seg.b === idx) continue;
      const a = nodes[seg.a];
      const b = nodes[seg.b];
      const t = projectOnSegment(node.x, node.y, a.x, a.y, b.x, b.y);
      const sx = a.x + (b.x - a.x) * t;
      const sy = a.y + (b.y - a.y) * t;
      const d = hypot(node.x, node.y, sx, sy);
      if (d < STITCH_M && (!best || d < best.d)) best = { d, segIndex, t, x: sx, y: sy };
    }
    if (!best || best.d < 0.01) return;
    const seg = segments[best.segIndex];
    // Land the connector on the segment's own end when the projection is
    // effectively there, rather than minting a node a centimetre away.
    // Measured live: an earlier stitch may already have shortened this segment.
    const segLen = hypot(nodes[seg.a].x, nodes[seg.a].y, nodes[seg.b].x, nodes[seg.b].y);
    let target;
    if (best.t * segLen < WELD_M) target = seg.a;
    else if ((1 - best.t) * segLen < WELD_M) target = seg.b;
    else {
      target = nodeAt(0, 0, best.x, best.y);
      if (target !== seg.a && target !== seg.b) {
        segments.push({ ...seg, a: target, b: seg.b });
        seg.b = target;
      }
    }
    if (target !== idx) added.push({ a: idx, b: target, kind: 'stitch', name: '' });
  });
  if (added.length) {
    segments.push(...added);
    index(graph);
  }
}

/** Label every node with the connected piece it belongs to. */
function components(graph) {
  const label = new Int32Array(graph.nodes.length).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < graph.nodes.length; i += 1) {
    if (label[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const v = stack.pop();
      size += 1;
      for (const e of graph.nodes[v].edges) {
        if (label[e.to] < 0) {
          label[e.to] = id;
          stack.push(e.to);
        }
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** Bridge the short gaps that keep whole pockets of the park unreachable. */
function bridgeIslands(graph) {
  const { nodes } = graph;
  for (let pass = 0; pass < 4; pass += 1) {
    const { label, sizes } = components(graph);
    if (sizes.length < 2) return;
    const grid = new Grid(BRIDGE_M);
    nodes.forEach((n, i) => grid.add(n.x, n.y, i));

    // One bridge per island per pass: the shortest hop to anything not itself.
    const best = new Map();
    nodes.forEach((n, i) => {
      const mine = label[i];
      for (const j of grid.around(n.x, n.y, 1)) {
        if (label[j] === mine) continue;
        const d = hypot(n.x, n.y, nodes[j].x, nodes[j].y);
        if (d > BRIDGE_M) continue;
        const held = best.get(mine);
        if (!held || d < held.d) best.set(mine, { d, a: i, b: j });
      }
    });
    if (best.size === 0) return;

    const seen = new Set();
    let added = 0;
    for (const [id, link] of best) {
      const other = label[link.b];
      const key = id < other ? `${id}:${other}` : `${other}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      graph.segments.push({ a: link.a, b: link.b, kind: 'bridge', name: '' });
      added += 1;
    }
    if (!added) return;
    index(graph);
  }
}

/**
 * The point on the path network closest to a position.
 * @returns {{seg, t, lat, lng, x, y, offset}} or null when nothing is near
 */
export function snapToGraph(graph, lat, lng, maxOffset = MAX_SNAP_M) {
  if (!graph) return null;
  const px = graph.proj.x(lng);
  const py = graph.proj.y(lat);
  let best = null;
  // Rings widen until something is found or the search passes the cap, so a
  // phone in the middle of a car park still gets an answer.
  for (let rings = 1; rings <= Math.ceil(maxOffset / CELL_M) + 1; rings += 1) {
    const seen = new Set(graph.segGrid.around(px, py, rings));
    for (const segIndex of seen) {
      const seg = graph.segments[segIndex];
      const a = graph.nodes[seg.a];
      const b = graph.nodes[seg.b];
      const t = projectOnSegment(px, py, a.x, a.y, b.x, b.y);
      const sx = a.x + (b.x - a.x) * t;
      const sy = a.y + (b.y - a.y) * t;
      const offset = hypot(px, py, sx, sy);
      if (!best || offset < best.offset) {
        best = {
          seg: segIndex,
          t,
          x: sx,
          y: sy,
          lat: graph.proj.lat(sy),
          lng: graph.proj.lng(sx),
          offset,
        };
      }
    }
    if (best && best.offset <= rings * CELL_M) break;
  }
  if (!best || best.offset > maxOffset) return null;
  return best;
}

/**
 * Close the gaps that leave two paths a few paces apart and a quarter mile
 * of walking from each other.
 *
 * These are the expensive ones to leave alone: the graph is connected, so
 * nothing above notices, and the route quietly sends someone the long way
 * round a coaster. They are almost always a way that was drawn up to another
 * way without being joined to it.
 *
 * The mend is only made when the detour it saves is large, and never across
 * water or through a building — those are the cases where the gap is the
 * mapper being right and this pass being wrong.
 */
function mendGaps(graph, map) {
  const { nodes } = graph;
  const grid = new Grid(MEND_M);
  nodes.forEach((n, i) => grid.add(n.x, n.y, i));
  const walls = obstacleEdges(graph, map);

  const links = [];
  const linked = new Set();
  for (let i = 0; i < nodes.length; i += 1) {
    const here = nodes[i];
    const partners = new Map();
    for (const j of grid.around(here.x, here.y, 1)) {
      if (j <= i) continue;
      const d = hypot(here.x, here.y, nodes[j].x, nodes[j].y);
      if (d <= MEND_M) partners.set(j, d);
    }
    if (partners.size === 0) continue;

    // Whatever this short search can still reach is not gapped from here.
    let left = partners.size;
    const dist = new Map([[i, 0]]);
    const open = new Heap();
    open.push({ node: i, f: 0 });
    while (open.size && left > 0) {
      const { node, f } = open.pop();
      if (f > MEND_DETOUR_M) break;
      if (f > (dist.get(node) ?? Infinity)) continue;
      if (partners.delete(node)) left -= 1;
      for (const e of nodes[node].edges) {
        const next = f + e.len;
        if (next <= MEND_DETOUR_M && next < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, next);
          open.push({ node: e.to, f: next });
        }
      }
    }

    for (const [j, d] of partners) {
      if (linked.has(i) || linked.has(j)) continue;
      if (blocked(walls, here, nodes[j])) continue;
      links.push({ a: i, b: j, d });
      linked.add(i);
      linked.add(j);
    }
  }

  if (!links.length) return;
  links.forEach((l) => graph.segments.push({ a: l.a, b: l.b, kind: 'mend', name: '' }));
  index(graph);
}

/** Every wall a mended link is not allowed to cross, in a lookup grid. */
function obstacleEdges(graph, map) {
  const grid = new Grid(CELL_M);
  const rings = [...(map?.water || []), ...(map?.pool || []), ...(map?.building || [])];
  rings.forEach((f) => {
    const ring = Array.isArray(f) ? f : f?.r;
    if (!Array.isArray(ring) || ring.length < 2) return;
    for (let i = 1; i < ring.length; i += 1) {
      const a = { x: graph.proj.x(ring[i - 1][0]), y: graph.proj.y(ring[i - 1][1]) };
      const b = { x: graph.proj.x(ring[i][0]), y: graph.proj.y(ring[i][1]) };
      const edge = { a, b };
      const cx0 = Math.floor(Math.min(a.x, b.x) / CELL_M);
      const cx1 = Math.floor(Math.max(a.x, b.x) / CELL_M);
      const cy0 = Math.floor(Math.min(a.y, b.y) / CELL_M);
      const cy1 = Math.floor(Math.max(a.y, b.y) / CELL_M);
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) grid.add(cx * CELL_M, cy * CELL_M, edge);
      }
    }
  });
  return grid;
}

function blocked(walls, a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  for (const edge of walls.around(mx, my, 1)) {
    if (crossing(a, b, edge.a, edge.b)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------- A* */

class Heap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].f <= a[i].f) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < a.length && a[l].f < a[small].f) small = l;
        if (r < a.length && a[r].f < a[small].f) small = r;
        if (small === i) break;
        [a[small], a[i]] = [a[i], a[small]];
        i = small;
      }
    }
    return top;
  }
}

/** Shortest walk between two snapped points, as a list of node indices. */
function search(graph, from, to) {
  const { nodes, segments } = graph;
  const startSeg = segments[from.seg];
  const endSeg = segments[to.seg];

  // Cost of the walk from a snap point to each end of the segment it sits on.
  const tailsOf = (snap, seg) => {
    const s = segments[seg];
    return [
      { node: s.a, cost: s.len * snap.t * s.factor },
      { node: s.b, cost: s.len * (1 - snap.t) * s.factor },
    ];
  };

  const endTails = new Map();
  tailsOf(to, to.seg).forEach(({ node, cost }) => {
    endTails.set(node, Math.min(endTails.get(node) ?? Infinity, cost));
  });

  let bestTotal = Infinity;
  let bestPath = null;

  // Standing on the same segment as the destination: walking straight along it
  // is a candidate no graph search would ever produce.
  if (from.seg === to.seg) {
    bestTotal = Math.abs(to.t - from.t) * startSeg.len * startSeg.factor;
    bestPath = [];
  }

  const dist = new Map();
  const prev = new Map();
  const open = new Heap();
  const h = (node) => hypot(nodes[node].x, nodes[node].y, to.x, to.y);

  tailsOf(from, from.seg).forEach(({ node, cost }) => {
    if ((dist.get(node) ?? Infinity) <= cost) return;
    dist.set(node, cost);
    prev.set(node, -1);
    open.push({ node, f: cost + h(node) });
  });

  const settled = new Set();
  while (open.size) {
    const { node, f } = open.pop();
    if (settled.has(node)) continue;
    if (f >= bestTotal) break; // nothing left can beat what we already hold
    settled.add(node);
    const d = dist.get(node);

    const tail = endTails.get(node);
    if (tail != null && d + tail < bestTotal) {
      bestTotal = d + tail;
      const path = [];
      for (let at = node; at !== -1 && at != null; at = prev.get(at)) path.push(at);
      bestPath = path.reverse();
    }

    for (const edge of nodes[node].edges) {
      if (settled.has(edge.to)) continue;
      const next = d + edge.cost;
      if (next >= (dist.get(edge.to) ?? Infinity)) continue;
      dist.set(edge.to, next);
      prev.set(edge.to, node);
      open.push({ node: edge.to, f: next + h(edge.to) });
    }
  }

  return bestPath;
}

/* --------------------------------------------------------------- narration */

function bearingOf(ax, ay, bx, by) {
  return (Math.atan2(bx - ax, by - ay) / rad + 360) % 360;
}

const CARDINALS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const cardinalName = (deg) => CARDINALS[Math.round(deg / 45) % 8];

function turnFor(delta) {
  const d = ((delta + 540) % 360) - 180; // signed, -180..180
  const a = Math.abs(d);
  if (a < 22) return { turn: 'straight', text: 'Keep going' };
  const side = d > 0 ? 'right' : 'left';
  if (a < 55) return { turn: side, text: `Bear ${side}` };
  if (a < 130) return { turn: side, text: `Turn ${side}` };
  return { turn: side, text: `Turn sharply ${side}` };
}

/**
 * A landmark for a turn. Way names are nearly all empty in the park's OSM
 * geometry — "turn left onto <blank>" helps nobody — so instructions are
 * anchored to the thing you can see instead.
 */
function landmarkNear(landmarks, proj, x, y, radius = 55) {
  if (!landmarks?.length) return null;
  let best = null;
  for (const p of landmarks) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const d = hypot(x, y, proj.x(p.lng), proj.y(p.lat));
    if (d < radius && (!best || d < best.d)) best = { d, poi: p };
  }
  return best?.poi ?? null;
}

/** The shortest step worth its own line on a phone. */
const MIN_STEP_M = 35;
/** How far the drawn line may be smoothed before the turns are read off it. */
const SIMPLIFY_M = 11;

/**
 * Douglas–Peucker, returning the indices that survive.
 *
 * A midway drawn from survey data bends every few metres. Reading turns
 * straight off that geometry produces "bear right, bear left, bear right" for
 * what a walker experiences as one gentle curve, so the narration is taken
 * from a smoothed copy while the drawn line keeps every vertex.
 */
function simplify(xy, tolerance) {
  const keep = new Uint8Array(xy.length);
  keep[0] = 1;
  keep[xy.length - 1] = 1;
  const stack = [[0, xy.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    const [ax, ay] = xy[first];
    const [bx, by] = xy[last];
    let worst = -1;
    let worstAt = -1;
    for (let i = first + 1; i < last; i += 1) {
      const t = projectOnSegment(xy[i][0], xy[i][1], ax, ay, bx, by);
      const d = hypot(xy[i][0], xy[i][1], ax + (bx - ax) * t, ay + (by - ay) * t);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > tolerance) {
      keep[worstAt] = 1;
      stack.push([first, worstAt], [worstAt, last]);
    }
  }
  const out = [];
  keep.forEach((v, i) => {
    if (v) out.push(i);
  });
  return out;
}

function narrate(points, proj, { landmarks, destination }) {
  const xy = points.map(([lat, lng]) => [proj.x(lng), proj.y(lat)]);
  if (xy.length < 2) return [];

  // Distance from the start to each vertex of the drawn line.
  const cum = [0];
  for (let i = 1; i < xy.length; i += 1) {
    cum.push(cum[i - 1] + hypot(xy[i - 1][0], xy[i - 1][1], xy[i][0], xy[i][1]));
  }

  const kept = simplify(xy, SIMPLIFY_M);
  const brg = [];
  for (let i = 1; i < kept.length; i += 1) {
    const a = xy[kept[i - 1]];
    const b = xy[kept[i]];
    brg.push(bearingOf(a[0], a[1], b[0], b[1]));
  }

  const steps = [];
  const push = (turn, text, atIndex, landmark = null) => {
    steps.push({ turn, text, metres: 0, at: points[atIndex], atIndex, landmark });
  };

  push('depart', `Head ${cardinalName(brg[0])}`, 0);

  for (let i = 1; i < brg.length; i += 1) {
    const { turn, text } = turnFor(brg[i] - brg[i - 1]);
    if (turn === 'straight') continue;
    const at = kept[i];
    // Two bends inside a few paces are one instruction to the person walking.
    if (cum[at] - cum[steps[steps.length - 1].atIndex] < MIN_STEP_M) continue;
    const mark = landmarkNear(landmarks, proj, xy[at][0], xy[at][1]);
    push(turn, mark ? `${text} at ${mark.n}` : text, at, mark?.n ?? null);
  }

  const endIndex = points.length - 1;
  // A turn taken within sight of the destination is not worth announcing.
  while (steps.length > 1 && cum[endIndex] - cum[steps[steps.length - 1].atIndex] < MIN_STEP_M) {
    steps.pop();
  }
  push('arrive', destination ? `Arrive at ${destination}` : 'Arrive', endIndex);

  steps.forEach((s, i) => {
    s.fromStart = cum[s.atIndex];
    // `metres` is the leg this instruction starts — the number the banner
    // shows as "in 300 ft, turn left".
    s.metres = i === steps.length - 1 ? 0 : cum[steps[i + 1].atIndex] - cum[s.atIndex];
  });
  return steps;
}

/* ------------------------------------------------------------------- route */

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/**
 * A walking route from one lat/lng to another, along the park's paths.
 *
 * The two ends are almost never *on* a path — you are standing in a queue, the
 * ride marker is in the middle of its footprint — so the route is a path walk
 * with a short connector at each end, and both connectors count towards the
 * distance. When either end is nowhere near a path, or the network genuinely
 * does not join the two, this returns a `direct` route so the caller always has
 * something to draw.
 *
 * @returns {{points, metres, seconds, steps, mode, snapFrom, snapTo}}
 */
export function findRoute(graph, from, to, { landmarks, destination, maxSnap = MAX_SNAP_M } = {}) {
  if (!from || !to || !Number.isFinite(from.lat) || !Number.isFinite(to.lat)) return null;

  const direct = () => {
    const proj = graph?.proj ?? makeProjector(from.lat);
    const points = [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ];
    const metres = hypot(proj.x(from.lng), proj.y(from.lat), proj.x(to.lng), proj.y(to.lat));
    return {
      points,
      metres,
      seconds: metres / WALK_MPS,
      steps: narrate(points, proj, { landmarks, destination }),
      mode: 'direct',
      snapFrom: null,
      snapTo: null,
    };
  };

  if (!graph) return direct();

  const snapFrom = snapToGraph(graph, from.lat, from.lng, maxSnap);
  const snapTo = snapToGraph(graph, to.lat, to.lng, maxSnap);
  if (!snapFrom || !snapTo) return direct();

  const path = search(graph, snapFrom, snapTo);
  if (!path) return direct();

  const points = [[from.lat, from.lng], [snapFrom.lat, snapFrom.lng]];
  path.forEach((idx) => {
    const n = graph.nodes[idx];
    points.push([n.lat, n.lng]);
  });
  points.push([snapTo.lat, snapTo.lng], [to.lat, to.lng]);

  const clean = points.filter((p, i) => i === 0 || !same(p, points[i - 1]));

  let metres = 0;
  for (let i = 1; i < clean.length; i += 1) {
    metres += hypot(
      graph.proj.x(clean[i - 1][1]),
      graph.proj.y(clean[i - 1][0]),
      graph.proj.x(clean[i][1]),
      graph.proj.y(clean[i][0]),
    );
  }

  // A route that costs far more than walking straight there means the network
  // is broken between these two points, not that the walk is genuinely that
  // long. Say so rather than sending someone the long way round a lake.
  const crow = hypot(
    graph.proj.x(from.lng),
    graph.proj.y(from.lat),
    graph.proj.x(to.lng),
    graph.proj.y(to.lat),
  );
  if (metres > Math.max(180, crow * 3.5)) return direct();

  return {
    points: clean,
    metres,
    seconds: metres / WALK_MPS,
    steps: narrate(clean, graph.proj, { landmarks, destination }),
    mode: 'path',
    snapFrom,
    snapTo,
  };
}

/**
 * Where a live position sits on a route it is already following.
 *
 * The nav banner asks this on every fix: how far is left, which instruction is
 * next, and has the walker wandered off the line far enough that the route
 * should be recomputed.
 */
export function routeProgress(route, lat, lng) {
  if (!route?.points?.length || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const proj = makeProjector(route.points[0][0]);
  const px = proj.x(lng);
  const py = proj.y(lat);

  const xy = route.points.map(([la, ln]) => [proj.x(ln), proj.y(la)]);
  let best = { leg: 0, t: 0, offset: Infinity, x: xy[0][0], y: xy[0][1] };
  for (let i = 1; i < xy.length; i += 1) {
    const [ax, ay] = xy[i - 1];
    const [bx, by] = xy[i];
    const t = projectOnSegment(px, py, ax, ay, bx, by);
    const sx = ax + (bx - ax) * t;
    const sy = ay + (by - ay) * t;
    const offset = hypot(px, py, sx, sy);
    if (offset < best.offset) best = { leg: i - 1, t, offset, x: sx, y: sy };
  }

  let remaining = hypot(best.x, best.y, xy[best.leg + 1][0], xy[best.leg + 1][1]);
  for (let i = best.leg + 2; i < xy.length; i += 1) {
    remaining += hypot(xy[i - 1][0], xy[i - 1][1], xy[i][0], xy[i][1]);
  }

  // The next instruction is the first one still ahead of the walker.
  const steps = route.steps || [];
  let stepIndex = steps.length - 1;
  for (let i = 0; i < steps.length; i += 1) {
    if (steps[i].atIndex > best.leg) {
      stepIndex = i;
      break;
    }
  }
  const step = steps[stepIndex] ?? null;
  let toStep = hypot(best.x, best.y, xy[best.leg + 1][0], xy[best.leg + 1][1]);
  const stopAt = step ? Math.min(step.atIndex, xy.length - 1) : xy.length - 1;
  for (let i = best.leg + 2; i <= stopAt; i += 1) {
    toStep += hypot(xy[i - 1][0], xy[i - 1][1], xy[i][0], xy[i][1]);
  }

  return {
    offset: best.offset,
    leg: best.leg,
    remaining,
    seconds: remaining / WALK_MPS,
    stepIndex,
    step,
    toStep: Math.max(0, toStep),
    travelled: Math.max(0, route.metres - remaining),
    arrived: remaining < 18,
  };
}

/** How far off the line counts as "you are not on this route any more". */
export const OFF_ROUTE_M = 32;

/**
 * A stable identity for somewhere you are walking to.
 *
 * A party member is a moving target and a meet-up can be dropped again, so the
 * destination is held as a reference rather than a pair of coordinates, and
 * this is what the UI compares to know which card is the live one.
 */
export const navKeyOf = (nav) => {
  if (!nav) return null;
  if (nav.kind === 'member') return `member:${nav.id}`;
  if (nav.kind === 'meet') return 'meet';
  return `poi:${nav.label}`;
};
