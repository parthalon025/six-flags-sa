/* PROTOTYPE. Walk ways become filled road shapes.
 * Stitch shared ends, then buffer — junctions read as one network, not hairlines. */

const JOIN_PX = 3;

function near(a, b, tol = JOIN_PX) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
}

function dropDup(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.4) out.push(p);
  }
  return out;
}

function tryJoin(a, b) {
  const a0 = a[0];
  const a1 = a[a.length - 1];
  const b0 = b[0];
  const b1 = b[b.length - 1];
  if (near(a1, b0)) return dropDup(a.concat(b.slice(1)));
  if (near(a1, b1)) return dropDup(a.concat(b.slice(0, -1).reverse()));
  if (near(a0, b1)) return dropDup(b.concat(a.slice(1)));
  if (near(a0, b0)) return dropDup(b.slice().reverse().concat(a.slice(1)));
  return null;
}

/** Merge projected polylines that share an endpoint. */
export function stitchWays(ways) {
  const chains = ways.map((pts) => dropDup(pts)).filter((p) => p.length >= 2);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < chains.length; i += 1) {
      if (!chains[i]) continue;
      for (let j = i + 1; j < chains.length; j += 1) {
        if (!chains[j]) continue;
        const joined = tryJoin(chains[i], chains[j]);
        if (!joined) continue;
        chains[i] = joined;
        chains[j] = null;
        changed = true;
      }
    }
  }
  return chains.filter(Boolean);
}

function segNormal(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/** Centerline → closed polygon at half-width `hw` (screen px). */
export function bufferWay(pts, hw) {
  const line = dropDup(pts);
  if (line.length < 2 || hw <= 0) return [];
  const left = [];
  const right = [];
  for (let i = 0; i < line.length; i += 1) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    let [nx, ny] = segNormal(prev, next);
    if (i > 0 && i < line.length - 1) {
      const n0 = segNormal(line[i - 1], line[i]);
      const n1 = segNormal(line[i], line[i + 1]);
      nx = n0[0] + n1[0];
      ny = n0[1] + n1[1];
      const L = Math.hypot(nx, ny) || 1;
      const miter = Math.min(2.2, 1 / Math.max(0.35, L / 2));
      nx = (nx / L) * miter;
      ny = (ny / L) * miter;
    }
    left.push([line[i][0] + nx * hw, line[i][1] + ny * hw]);
    right.push([line[i][0] - nx * hw, line[i][1] - ny * hw]);
  }
  return left.concat(right.reverse());
}

export function polyD(pts) {
  if (pts.length < 3) return '';
  return `${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}Z`;
}

export function projectWays(rows, project) {
  return rows.map((row) => row.ring.map((pair) => project(pair[0], pair[1])));
}

/** Snap + split T-junctions so a way that ends on another way shares a vertex. */
export function nodeWays(ways, snap = 5) {
  const grid = (p) => [Math.round(p[0] / snap) * snap, Math.round(p[1] / snap) * snap];
  const raw = ways.map((w) => dropDup(w.map(grid))).filter((w) => w.length >= 2);
  const nodes = [];
  const seen = new Set();
  for (const w of raw) {
    for (const p of [w[0], w[w.length - 1]]) {
      const k = `${p[0]},${p[1]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      nodes.push(p);
    }
  }
  const split = raw.map((w) => {
    let pts = w.slice();
    for (const n of nodes) {
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        if (near(n, a, snap) || near(n, b, snap)) continue;
        const hit = projectOnSeg(n, a, b);
        if (!hit || hit.d > snap) continue;
        pts.splice(i + 1, 0, n);
        i += 1;
      }
    }
    return dropDup(pts);
  });
  return stitchWays(split);
}

function projectOnSeg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return null;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  if (t <= 0.08 || t >= 0.92) return null;
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return { d: Math.hypot(p[0] - x, p[1] - y), t };
}

/** Endpoints after noding — pour a disc so T-junctions become one pavement. */
export function junctionDiscs(chains) {
  const at = new Map();
  for (const c of chains) {
    for (const p of [c[0], c[c.length - 1]]) {
      at.set(`${p[0]},${p[1]}`, p);
    }
  }
  return [...at.values()];
}

export function railTies(pts, step = 16, half = 2.4) {
  const line = dropDup(pts);
  const ties = [];
  let acc = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    acc += len;
    if (acc < step) continue;
    acc = 0;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    ties.push([
      [mx + nx * half, my + ny * half],
      [mx - nx * half, my - ny * half],
    ]);
  }
  return ties;
}

/** Rank → fill half-width in viewBox px. One pavement grey, like the Google plate. */
export const ROAD_HALF = {
  overview: { arterial: 9, street: 0, foot: 0, service: 0 },
  streets: { arterial: 11, street: 5.5, foot: 0, service: 0 },
  close: { arterial: 13, street: 7, foot: 3.2, service: 3.5 },
};

export const PAVEMENT = '#eceae3';
export const PAVEMENT_EDGE = '#c9c5bb';
export const TRAIL = '#6d8a5c';
