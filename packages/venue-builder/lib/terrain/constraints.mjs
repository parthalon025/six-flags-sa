/**
 * Make man-made things sit properly on measured ground.
 *
 * A DEM is sampled every 10 metres and a midway is 6 metres wide, so dropping
 * a path onto raw elevation gives it a ripple it does not have in life — the
 * path inherits the interpolation between posts. The same sampling makes a
 * lazy river run uphill in places and a levelled ride pad tilt.
 *
 * The fix is not to smooth the whole heightfield, which would flatten the
 * relief that made terrain worth having. It is to state what must be true —
 * *this path is level across its width*, *each stretch of this watercourse is
 * no higher than the one above it*, *this pad is flat*, *this bridge keeps the
 * ground it was surveyed on* — solve those together, and write only the
 * results back.
 *
 * Two kinds of node. **Hard** nodes (paths, pads, roads) get a tight radius and
 * drive a plane fit, so their neighbourhood takes their value. **Soft** nodes
 * (watercourses) get a wider radius and only nudge, so a stream shapes its
 * valley without carving a trench. Cycles do not throw: a node that cannot be
 * ordered falls back to its own measured elevation, which is wrong in the same
 * way the input was wrong rather than in a new way.
 *
 * Independent of any renderer, any game, and any particular DEM.
 */

/** Nodes closer than this (in grid cells) are the same node. */
const MERGE_RADIUS = 0.1;

/** Guard against a pathological chain of lower-than links. */
const MAX_PROPAGATION = 750;

let nextId = 0;

class Node {
  constructor(x, y, initial, soft) {
    this.id = nextId += 1;
    this.x = x;
    this.y = y;
    this.initial = initial;
    this.elevation = null;
    this.soft = soft;
    this.sameAs = new Set();
    this.lowerThan = new Set();
    this.wantedDelta = 0;
    this.floor = null;
    this.pinned = false;
    this.protectedFloor = null;
  }

  get solved() {
    return this.elevation !== null;
  }

  /** Freeze at the measured value — bridges and embankment ends. */
  pinToInitial() {
    this.pinned = true;
    return this;
  }

  /** Two nodes at one elevation, whatever that turns out to be. */
  mustEqual(other) {
    if (other === this) return this;
    this.sameAs.add(other);
    other.sameAs.add(this);
    return this;
  }

  /** Water runs downhill: `this` never sits above `other`. */
  mustBeLowerThan(other) {
    if (other !== this) this.lowerThan.add(other);
    return this;
  }

  setNotBelow(min, depth = 0) {
    if (depth > MAX_PROPAGATION) return;
    if (this.floor === null || min > this.floor) this.floor = min;
  }
}

export class ConstraintGrid {
  /**
   * @param {import('./elevation-grid.mjs').ElevationGrid} grid
   */
  constructor(grid) {
    this.grid = grid;
    this.nodes = [];
    this.buckets = new Map();
    this.segments = [];
  }

  #key(x, y) {
    return `${Math.round(x)}:${Math.round(y)}`;
  }

  /** Create or reuse a node. Merging keeps a junction one node, not two. */
  node(x, y, { soft = false } = {}) {
    const k = this.#key(x, y);
    const near = this.buckets.get(k) || [];
    for (const n of near) {
      if (Math.hypot(n.x - x, n.y - y) <= MERGE_RADIUS) {
        // A node any hard constraint touches is hard from then on.
        n.soft = n.soft && soft;
        return n;
      }
    }
    const n = new Node(x, y, this.grid.elevationAt(x, y), soft);
    this.nodes.push(n);
    if (near.length) near.push(n); else this.buckets.set(k, [n]);
    return n;
  }

  nodeHard(x, y) { return this.node(x, y, { soft: false }); }

  nodeSoft(x, y) { return this.node(x, y, { soft: true }); }

  /**
   * A run of nodes whose elevation should follow a straight line over
   * `window` cells of travel — what stops a path undulating lengthwise.
   */
  addSmoothSegment(nodes, window) {
    if (nodes.length >= 2) this.segments.push({ nodes, window });
  }

  /** Level a cross-section: every node across the width shares one elevation. */
  addFlatSpan(centre, points) {
    for (const p of points) centre.mustEqual(p);
  }

  #baseElevation(node) {
    const group = [node, ...node.sameAs];
    if (node.pinned) {
      return group.reduce((s, n) => s + n.initial, 0) / group.length;
    }
    let base = group.reduce((s, n) => s + n.initial, 0) / group.length;
    base += group.reduce((s, n) => s + n.wantedDelta, 0) / group.length;
    for (const n of group) {
      for (const other of n.lowerThan) {
        if (other.solved && base > other.elevation) base = other.elevation;
      }
      if (n.floor !== null && base < n.floor) base = n.floor;
    }
    return base;
  }

  #assign(node, value) {
    node.elevation = value;
    for (const peer of node.sameAs) peer.elevation = value;
  }

  /** Relax to a fixpoint; anything left in a cycle takes its own measurement. */
  solve() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of this.nodes) {
        if (n.solved) continue;
        const group = [n, ...n.sameAs];
        const ready = group.every((g) => [...g.lowerThan].every((o) => o.solved));
        if (!ready) continue;
        this.#assign(n, this.#baseElevation(n));
        changed = true;
      }
    }
    for (const n of this.nodes) {
      if (!n.solved) this.#assign(n, this.#baseElevation(n));
    }
    return this;
  }

  /** Least-squares straight line per window of travel along each segment. */
  smooth() {
    for (const { nodes, window } of this.segments) {
      let start = 0;
      let travelled = 0;
      const dists = [0];
      for (let i = 1; i < nodes.length; i += 1) {
        travelled += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
        dists.push(travelled);
      }
      while (start < nodes.length) {
        let end = start;
        while (end + 1 < nodes.length && dists[end + 1] - dists[start] < window) end += 1;
        if (end > start) {
          let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
          const n = end - start + 1;
          for (let i = start; i <= end; i += 1) {
            const d = dists[i];
            const z = nodes[i].elevation ?? nodes[i].initial;
            sx += d; sy += z; sxx += d * d; sxy += d * z;
          }
          const denom = n * sxx - sx * sx;
          if (Math.abs(denom) > 1e-9) {
            const slope = (n * sxy - sx * sy) / denom;
            const intercept = (sy - slope * sx) / n;
            for (let i = start; i <= end; i += 1) {
              if (nodes[i].pinned) continue;
              this.#assign(nodes[i], intercept + slope * dists[i]);
            }
          }
        }
        if (end + 1 >= nodes.length) break;
        start = end + 1;
      }
    }
    return this;
  }

  /**
   * Write the solved constraints back into the heightfield.
   *
   * Hard cells take a plane fitted through nearby constraints, anchored by the
   * cell's current elevation so a lone constraint cannot tip the neighbourhood
   * over. Soft cells only get averaged toward their constraints.
   */
  applyOnGrid({ iterations = 20, hardRadius = 1, softRadius = 2 } = {}) {
    const { grid } = this;
    const solved = this.nodes.filter((n) => n.solved);
    if (!solved.length) return this;

    const index = new Map();
    const bucketKey = (x, y) => `${Math.floor(x)}:${Math.floor(y)}`;
    for (const n of solved) {
      const k = bucketKey(n.x, n.y);
      const list = index.get(k);
      if (list) list.push(n); else index.set(k, [n]);
    }
    const near = (cx, cy, radius) => {
      const out = [];
      const r = Math.ceil(radius);
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const list = index.get(bucketKey(cx + dx, cy + dy));
          if (!list) continue;
          for (const n of list) {
            if (Math.hypot(n.x - cx, n.y - cy) <= radius) out.push(n);
          }
        }
      }
      return out;
    };

    const hard = [];
    const soft = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const cx = col + 0.5;
        const cy = row + 0.5;
        const h = near(cx, cy, hardRadius).filter((n) => !n.soft);
        if (h.length) { hard.push([col, row, h]); continue; }
        const s = near(cx, cy, softRadius);
        if (s.length) soft.push([col, row, s]);
      }
    }

    for (let pass = 0; pass < iterations; pass += 1) {
      for (const [col, row, constraints] of hard) {
        grid.values[row * grid.cols + col] = planeAt(
          col + 0.5, row + 0.5, constraints, grid.values[row * grid.cols + col],
        );
      }
      for (const [col, row, constraints] of soft) {
        const i = row * grid.cols + col;
        const want = constraints.reduce((s, n) => s + n.elevation, 0) / constraints.length;
        let next = (grid.values[i] * 3 + want) / 4;
        const floor = Math.max(...constraints.map((n) => n.protectedFloor ?? -Infinity));
        if (Number.isFinite(floor) && next < floor) next = floor;
        grid.values[i] = next;
      }
    }
    return this;
  }

  solveAndApply(opts) {
    return this.solve().smooth().applyOnGrid(opts);
  }
}

/**
 * Fit z = a + b·dx + c·dy through the constraints and read it at the centre.
 *
 * The current surface is included as four weak anchors so a single constraint
 * cannot swing the whole cell, and an implausible gradient is discarded in
 * favour of a plain average — a near-vertical fit is almost always two
 * constraints that should not have been in the same neighbourhood.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {{x:number,y:number,elevation:number}[]} constraints
 * @param {number} current
 * @returns {number}
 */
export function planeAt(cx, cy, constraints, current) {
  if (constraints.length === 1) return constraints[0].elevation;
  const rows = [];
  for (const n of constraints) {
    // Real constraints outweigh the anchors.
    for (let w = 0; w < 4; w += 1) rows.push([n.x - cx, n.y - cy, n.elevation]);
  }
  for (const [dx, dy] of [[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) {
    rows.push([dx, dy, current]);
  }
  // Normal equations for [1, dx, dy].
  let s11 = 0; let s1x = 0; let s1y = 0; let sxx = 0; let sxy = 0; let syy = 0;
  let b1 = 0; let bx = 0; let by = 0;
  for (const [dx, dy, z] of rows) {
    s11 += 1; s1x += dx; s1y += dy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    b1 += z; bx += dx * z; by += dy * z;
  }
  const m = [[s11, s1x, s1y], [s1x, sxx, sxy], [s1y, sxy, syy]];
  const b = [b1, bx, by];
  const sol = solve3(m, b);
  if (!sol) return constraints.reduce((s, n) => s + n.elevation, 0) / constraints.length;
  const [a, gx, gy] = sol;
  if (Math.abs(gx) >= 1.5 || Math.abs(gy) >= 1.5) {
    return constraints.reduce((s, n) => s + n.elevation, 0) / constraints.length;
  }
  return a;
}

/** Gaussian elimination with partial pivoting. Null when singular. */
function solve3(m, b) {
  const a = m.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 3; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = col + 1; r < 3; r += 1) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 4; c += 1) a[r][c] -= f * a[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r -= 1) {
    let sum = a[r][3];
    for (let c = r + 1; c < 3; c += 1) sum -= a[r][c] * x[c];
    x[r] = sum / a[r][r];
  }
  return x;
}
