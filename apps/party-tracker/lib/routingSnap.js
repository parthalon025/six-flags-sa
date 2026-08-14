/**
 * Snap a GPS fix onto an already-built walk graph.
 *
 * Split from `routing.js` so GPS display (`lib/gps/smooth.js`) can snap without
 * pulling `buildRouteGraph` / `findRoute` into the first-load client chunk.
 * The graph itself is still built via the dynamic `import('@/lib/routing')`.
 */

/** Beyond this, the nearest path is not a path you are standing on. */
export const MAX_SNAP_M = 140;

/** Spatial hash cell used when the graph was welded — must match routing.js. */
const CELL_M = 30;

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

/**
 * The point on the path network closest to a position.
 * @returns {{seg, t, lat, lng, x, y, offset}} or null when nothing is near
 */
export function snapToGraph(graph, lat, lng, maxOffset = MAX_SNAP_M, { excludeSeg } = {}) {
  if (!graph) return null;
  const px = graph.proj.x(lng);
  const py = graph.proj.y(lat);
  let best = null;
  // Rings widen until something is found or the search passes the cap, so a
  // phone in the middle of a car park still gets an answer.
  for (let rings = 1; rings <= Math.ceil(maxOffset / CELL_M) + 1; rings += 1) {
    const seen = new Set(graph.segGrid.around(px, py, rings));
    for (const segIndex of seen) {
      if (excludeSeg?.(segIndex)) continue;
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
