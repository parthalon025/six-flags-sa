/* Plane geometry for venue building. Everything here works in degrees and
   accepts the small-angle error that comes with it: a venue is at most a couple
   of kilometres across, so a local equirectangular approximation is accurate to
   well under the metre these numbers are rounded to anyway. */

const R = 6371000;
const rad = Math.PI / 180;

/* Ring coordinates are stored [lng, lat] to match GeoJSON and the renderer. */
export const metresPerDegLat = () => R * rad;
export const metresPerDegLng = (lat) => R * rad * Math.cos(lat * rad);

export function centroidOf(ring) {
  // Area-weighted centroid, falling back to the vertex mean for degenerate
  // rings — a land label sitting slightly off is better than one at NaN.
  //
  // The shoelace terms are differences of products of numbers near -84 and 39
  // over a ring a few hundred metres wide, which is where double precision
  // starts throwing away the digits that matter. Working relative to the first
  // vertex keeps the arithmetic small and the answer to the metre.
  const [ox, oy] = ring[0] || [0, 0];
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const x0 = ring[j][0] - ox;
    const y0 = ring[j][1] - oy;
    const x1 = ring[i][0] - ox;
    const y1 = ring[i][1] - oy;
    const f = x0 * y1 - x1 * y0;
    twiceArea += f;
    x += (x0 + x1) * f;
    y += (y0 + y1) * f;
  }
  if (Math.abs(twiceArea) < 1e-14) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [ox + x / (3 * twiceArea), oy + y / (3 * twiceArea)];
}

/** Square metres, signed area made positive. */
export function areaOf(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat = ring[0][1];
  const mx = metresPerDegLng(lat);
  const my = metresPerDegLat();
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] * mx) * (ring[i][1] * my) - (ring[i][0] * mx) * (ring[j][1] * my);
  }
  return Math.abs(sum) / 2;
}

export function pointInRing([lng, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > lat !== yj > lat;
    if (straddles && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const sameSpot = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Ramer–Douglas–Peucker, with the tolerance given in metres.
 *
 * A closed ring has to be cut before it can be simplified: the algorithm
 * measures every vertex against the line from the first point to the last, and
 * on a ring those are the same point, so that line has no length and every
 * vertex measures as zero away from it — the whole polygon collapses to a dot.
 * Splitting at the vertex furthest from the start gives two open chains that
 * behave, and rejoining them closes the ring again.
 */
export function simplify(ring, tolerance) {
  if (!ring || ring.length < 3 || tolerance <= 0) return ring;

  if (sameSpot(ring[0], ring[ring.length - 1])) {
    if (ring.length < 5) return ring;
    const [x0, y0] = ring[0];
    let cut = 1;
    let far = -1;
    for (let i = 1; i < ring.length - 1; i += 1) {
      const d = (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2;
      if (d > far) {
        far = d;
        cut = i;
      }
    }
    const head = simplifyOpen(ring.slice(0, cut + 1), tolerance);
    const tail = simplifyOpen(ring.slice(cut), tolerance);
    const joined = head.concat(tail.slice(1));
    // Under a coarse tolerance a small ring can simplify down to a sliver;
    // below a triangle there is no polygon left to fill.
    return joined.length >= 4 ? joined : ring;
  }
  return simplifyOpen(ring, tolerance);
}

function simplifyOpen(ring, tolerance) {
  if (!ring || ring.length < 3) return ring;
  const lat = ring[0][1];
  const mx = metresPerDegLng(lat);
  const my = metresPerDegLat();
  const pts = ring.map(([lng, la]) => [lng * mx, la * my]);

  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let far = tolerance;
    const [x1, y1] = pts[first];
    const [x2, y2] = pts[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = pts[i];
      const d = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
      if (d > far) {
        far = d;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out = [];
  for (let i = 0; i < ring.length; i += 1) if (keep[i]) out.push(ring[i]);
  return out;
}

/**
 * Sutherland–Hodgman: cut a filled ring down to the venue's own box.
 *
 * Overpass returns whole ways and relations that so much as touch the query
 * box, at whatever detail they were surveyed with. Inland that costs nothing —
 * a pond is a pond. On a waterfront it is the difference between a venue file
 * and a geography lesson: Cedar Point sits on a peninsula, and the first build
 * of it carried Lake Erie as one 47,937-point ring reaching from Toledo into
 * Canada. That single ring was 984 KB of a 1.5 MB file, and not one of its
 * vertices was inside the park.
 *
 * Dropping the outside points cannot work, because a venue can sit in a bay
 * whose every vertex is elsewhere — delete them and the water the place stands
 * in disappears. Clipping is the operation that actually means "the part of
 * this shape that is here": the lake comes back as the handful of corners where
 * it meets the box, still filled, still drawn, three orders of magnitude
 * smaller.
 *
 * Rings only. An open line clipped this way would have its ends joined across
 * the box, and the layers drawn as lines are small enough not to need it.
 */
export function clipToBounds(ring, bounds) {
  if (!ring || ring.length < 3 || !bounds) return ring;
  const { north, south, east, west } = bounds;
  // Each edge in turn, keeping whatever falls on the inside of it. A rectangle
  // is convex, so four passes leave exactly the intersection.
  const edges = [
    [(p) => p[0] >= west, (a, b) => lerpX(a, b, west)],
    [(p) => p[0] <= east, (a, b) => lerpX(a, b, east)],
    [(p) => p[1] >= south, (a, b) => lerpY(a, b, south)],
    [(p) => p[1] <= north, (a, b) => lerpY(a, b, north)],
  ];

  // A ring arrives with its first point repeated at the end; the algorithm
  // wants the cycle without that duplicate, and it is put back at the end.
  let out = ring.slice();
  if (sameSpot(out[0], out[out.length - 1])) out.pop();

  for (const [inside, cross] of edges) {
    if (!out.length) return [];
    const next = [];
    for (let i = 0; i < out.length; i += 1) {
      const cur = out[i];
      const prev = out[(i + out.length - 1) % out.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) next.push(cross(prev, cur));
        next.push(cur);
      } else if (prevIn) {
        next.push(cross(prev, cur));
      }
    }
    out = next;
  }

  if (out.length < 3) return [];
  out.push([out[0][0], out[0][1]]);
  return out;
}

const lerpX = (a, b, x) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1e-12)];
const lerpY = (a, b, y) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12), y];

/** Five decimal places is roughly a metre, and halves the file size. */
export function round(ring, dp = 5) {
  const f = 10 ** dp;
  const out = [];
  let prev = null;
  for (const [lng, lat] of ring) {
    const p = [Math.round(lng * f) / f, Math.round(lat * f) / f];
    if (prev && p[0] === prev[0] && p[1] === prev[1]) continue;
    out.push(p);
    prev = p;
  }
  return out;
}

export function distanceMetres(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
