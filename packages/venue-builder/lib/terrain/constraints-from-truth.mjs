/**
 * Translate a venue's published geometry into elevation constraints.
 *
 * This is the only file that knows both vocabularies — Parkbound's map layers
 * on one side, the solver's nodes on the other — so the solver stays a general
 * thing and the layer names stay in one place.
 *
 * What each layer asserts about the ground:
 *   path, service   level across the width, straight along the length
 *   water, pool     a still surface: every node at one elevation
 *   coaster, slide  nothing. Track height is structure, not terrain, and a
 *                   lift hill is not a mountain
 *   building        a level pad under the footprint
 *
 * Nothing here writes to truth. It reads `map.json` and mutates only the
 * display layer's heightfield.
 */

import { ConstraintGrid } from './constraints.mjs';
import { pointInRing } from '../geometry.mjs';

/** Half-width of a walkway, in cells, used for the level cross-section. */
const PATH_HALF_WIDTH = 0.75;

/** Smoothing window along a path, in cells. */
const PATH_SMOOTH_WINDOW = 6;

/** Resample paths at this spacing so constraints track the grid, not the way. */
const STEP = 0.5;

function resample(points, step) {
  if (points.length < 2) return points;
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1e-9) continue;
    let t = (step - carry) / d;
    while (t <= 1) {
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      t += step / d;
    }
    carry = (carry + d) % step;
  }
  return out;
}

/**
 * @param {import('./elevation-grid.mjs').ElevationGrid} grid
 * @param {object} map map.json body
 * @param {(lngLat: [number, number]) => [number, number]} toCell truth → grid cells
 * @param {object} [opts]
 * @returns {{ constraints: ConstraintGrid, applied: object }}
 */
export function constrainFromTruth(grid, map, toCell, opts = {}) {
  const cg = new ConstraintGrid(grid);
  const counts = { paths: 0, water: 0, pads: 0 };

  // Walkways and service roads: level across, straight along.
  for (const layer of ['path', 'service']) {
    for (const way of map[layer] || []) {
      if (!(way.r?.length >= 2)) continue;
      const pts = resample(way.r.map(toCell), STEP);
      if (pts.length < 2) continue;
      const chain = [];
      for (const [x, y] of pts) {
        const centre = cg.nodeHard(x, y);
        chain.push(centre);
        for (const d of [-PATH_HALF_WIDTH, PATH_HALF_WIDTH]) {
          centre.mustEqual(cg.nodeHard(x, y + d));
          centre.mustEqual(cg.nodeHard(x + d, y));
        }
      }
      // A bridge keeps the ground it was surveyed on; only the deck is level.
      if (way.f & 2) {
        chain[0].pinToInitial();
        chain[chain.length - 1].pinToInitial();
      }
      cg.addSmoothSegment(chain, opts.pathWindow ?? PATH_SMOOTH_WINDOW);
      counts.paths += 1;
    }
  }

  // Standing water is flat by definition — one elevation for the whole body.
  for (const layer of ['water', 'pool']) {
    for (const way of map[layer] || []) {
      if (!(way.r?.length >= 3)) continue;
      const ring = way.r.map(toCell);
      const nodes = ring.map(([x, y]) => cg.nodeSoft(x, y));
      for (let i = 1; i < nodes.length; i += 1) nodes[0].mustEqual(nodes[i]);
      // Never let the solver pull a water body above its own shoreline.
      const level = Math.min(...nodes.map((n) => n.initial));
      for (const n of nodes) n.protectedFloor = level;
      counts.water += 1;
    }
  }

  // Buildings and ride footprints stand on level pads.
  for (const way of map.building || []) {
    if (!(way.r?.length >= 3)) continue;
    const ring = way.r.map(toCell);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // Skip the very large: a themed hall spanning real grade should follow it.
    if ((maxX - minX) * (maxY - minY) > (opts.maxPadCells ?? 400)) continue;
    const inside = [];
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y += 1) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += 1) {
        if (pointInRing([x + 0.5, y + 0.5], ring)) inside.push(cg.nodeHard(x + 0.5, y + 0.5));
      }
    }
    if (inside.length < 2) continue;
    for (let i = 1; i < inside.length; i += 1) inside[0].mustEqual(inside[i]);
    counts.pads += 1;
  }

  return { constraints: cg, applied: counts };
}
