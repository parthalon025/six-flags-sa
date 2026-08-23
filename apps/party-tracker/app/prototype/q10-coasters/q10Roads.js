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

/** Rank → fill half-width in viewBox px. Grows on pinch the way Google roads do. */
export const ROAD_HALF = {
  overview: { arterial: 3.6, street: 0, foot: 0, service: 0 },
  streets: { arterial: 4.4, street: 2.6, foot: 0, service: 0 },
  close: { arterial: 5.2, street: 3.4, foot: 2.0, service: 2.2 },
};

export const ROAD_FILL = {
  arterial: '#f6f1e6',
  street: '#efe8da',
  foot: '#e6dfd2',
  service: '#d7e0cc',
};

export const ROAD_CASE = {
  arterial: '#8a7f70',
  street: '#9a9184',
  foot: '#a39a8e',
  service: '#7d8b72',
};
