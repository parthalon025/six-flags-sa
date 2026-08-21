/**
 * Prop scatter — where trees, benches, planters and stanchions actually go.
 *
 * What this replaces: a per-cell coin flip (`cellHash(x, y) < 0.65` in wood,
 * `< 0.14` on grass). That is cheap and it has three failure modes you can see
 * in a bake — sprites overlap because nothing checks radius, density is a
 * probability rather than a count so it does not track sprite size, and the
 * result is uniform, so a wood reads as wallpaper instead of a thicket.
 *
 * The model here is the standard one: derive a target count from how much area
 * the sprites actually cover, throw darts, reject overlaps, and bias the darts
 * toward noise ridges so clumps emerge without anyone authoring cluster
 *
 * Determinism is not incidental. Every draw comes from a seed derived from the
 * polygon's own position, so the same venue bakes identically forever, and two
 * polygons in the same park do not share a stream. Three specific mistakes are
 * avoided on purpose, each of which would pass review and fail the
 * `style_bake_deterministic` gate later:
 *
 *   - seeding on `x + y` (every point on a diagonal shares one stream, which
 *     shows up as banding across the map)
 *   - shifting a byte by 16 and expecting anything but zero
 *   - shuffling with a process-global RNG, which is reproducible within a run
 *     and not across them
 *
 * That contract also fixes the cost. How many darts get thrown is a function of
 * the seed and of which ones landed, so it is part of the output: for a given
 * input, the dart count is not something an implementation may choose. What a
 * dart costs is. Everything under the dart loop — the neighbour index, the
 * species wheel, the unpacked candidates — exists to make one dart cheap, and
 * is written so the accept/reject decision it feeds is the decision the
 * straightforward version would have made, bit for bit.
 * `test/builder/display-scatter.mjs` pins the placements against frozen
 * fixtures and the cost against the irreducible sampling floor.
 */

import { pointInRing } from './geometry.mjs';
import { makeNoise2D, makeRng } from './terrain/noise.mjs';

/** Random disc packing saturates near 0.55; the optimistic 0.8 just makes the
 *  dart loop give up more often. Tuned down so `itemsToAdd` is reachable. */
export const PACKING = 0.55;

/** Give up on a polygon after this many passes that placed nothing. */
const MAX_UNCHANGED = 10;

/** Ceiling on the neighbour grid, in buckets — about 8 MB of pointers. Candidate
 *  cells normally come from one polygon of a bake grid and land far under it; a
 *  caller scattering over a sparse, far-flung set gets coarser buckets instead
 *  of an allocation the size of its bounding box. */
const MAX_BUCKETS = 1 << 20;

/**
 * Target items per unit area from what the sprites cover.
 * @param {{ radius: number, probability: number }[]} species
 * @param {number} packing
 * @returns {number} items per square cell
 */
export function densityFromSpecies(species, packing = PACKING) {
  const covered = species.reduce(
    (sum, s) => sum + (s.probability ?? 1) * Math.PI * s.radius * s.radius,
    0,
  );
  return covered > 0 ? (1 / covered) * packing : 0;
}

/**
 * Cumulative-probability wheel, summed once instead of once per dart. The
 * partial sums accumulate in species order, so each is the float the per-dart
 * version arrived at.
 * @param {{ probability?: number }[]} species
 */
function speciesWheel(species) {
  const cumulative = new Float64Array(species.length);
  let acc = 0;
  for (let i = 0; i < species.length; i += 1) {
    acc += species[i].probability ?? 1;
    cumulative[i] = acc;
  }
  return { cumulative, total: acc };
}

/** Index of the species `roll` selects. Falls through to the last on rounding. */
function pickIndex({ cumulative, total }, roll) {
  const target = roll * total;
  for (let i = 0; i < cumulative.length; i += 1) if (target <= cumulative[i]) return i;
  return cumulative.length - 1;
}

/**
 * Uniform grid of placed discs — the neighbour query for overlap rejection.
 *
 * A flat array indexed by bucket, not a Map keyed by `"cx:cy"`. The string form
 * built a key and hashed it for every bucket of every query — 25 of them a dart
 * — and got slower as the map filled, because the Map it probed kept growing.
 * In a 240-column kings-island bake it was 44% of all CPU samples, the largest
 * single cost in the bake, and its share rose with the column count.
 *
 * `reach` is how far the scan has to go, and it is one bucket less than the
 * obvious answer. A disc `k` buckets away on an axis is more than `(k - 1) *
 * cellSize` away in that coordinate alone, so at `k = reach + 1` the separation
 * already exceeds `reach * cellSize >= R` and no disc out there can touch a
 * query of radius `R`. Discs only ever go in at positions inside `bounds`, so
 * buckets off the edge of the grid are empty and clamping the scan to it drops
 * nothing.
 *
 * The neighbourhood list this used to build is gone rather than fixed: there is
 * no merge step left to overrun the engine's argument cap, which is what
 * display-bake.mjs's meadow note is about.
 *
 * @param {number} cellSize bucket edge, in cells
 * @param {number} maxRadius largest radius any species can ask about
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds
 * @param {{ x: number, y: number, radius: number }[]} items backing store; buckets hold indices
 */
function discIndex(cellSize, maxRadius, bounds, items) {
  const bx0 = Math.floor(bounds.minX / cellSize) - 1;
  const by0 = Math.floor(bounds.minY / cellSize) - 1;
  const width = (Math.floor(bounds.maxX / cellSize) + 2) - bx0;
  const height = (Math.floor(bounds.maxY / cellSize) + 2) - by0;
  const buckets = new Array(width * height).fill(null);
  return {
    /** Record `items[at]`, which must already be in place. */
    add(at) {
      const item = items[at];
      const bx = Math.floor(item.x / cellSize) - bx0;
      const by = Math.floor(item.y / cellSize) - by0;
      const k = by * width + bx;
      const list = buckets[k];
      if (list) list.push(at); else buckets[k] = [at];
    },
    /** True when a disc of `radius` at (x, y) touches nothing already placed. */
    hasRoom(x, y, radius) {
      const reach = Math.ceil((radius + maxRadius) / cellSize);
      const bx = Math.floor(x / cellSize) - bx0;
      const by = Math.floor(y / cellSize) - by0;
      const top = by - reach < 0 ? 0 : by - reach;
      const bottom = by + reach > height - 1 ? height - 1 : by + reach;
      const left = bx - reach < 0 ? 0 : bx - reach;
      const right = bx + reach > width - 1 ? width - 1 : bx + reach;
      for (let cy = top; cy <= bottom; cy += 1) {
        const row = cy * width;
        for (let cx = left; cx <= right; cx += 1) {
          const list = buckets[row + cx];
          if (list === null) continue;
          for (let i = 0; i < list.length; i += 1) {
            const o = items[list[i]];
            // The same comparison, in the same operand order, that
            // `every(o => hypot(o.x - x, o.y - y) > o.radius + radius)` made —
            // negated, and left as soon as one disc answers, instead of
            // collecting the whole neighbourhood into a list first.
            if (!(Math.hypot(o.x - x, o.y - y) > o.radius + radius)) return false;
          }
        }
      }
      return true;
    },
  };
}

/**
 * Scatter sprites across a set of candidate cells.
 *
 * Candidates are cells the caller has already terrain-filtered, so this never
 * needs the terrain array. Positions are continuous within a cell.
 *
 * @param {object} opts
 * @param {[number, number][]} opts.cells candidate cells, integer [x, y]
 * @param {{ id: string, radius: number, probability?: number, big?: boolean }[]} opts.species
 * @param {number} opts.seed integer, derived from the area — not from a clock
 * @param {number} [opts.density] items per square cell; defaults to `densityFromSpecies`
 * @param {{ frequency?: number, samples?: number }|null} [opts.noise] importance sampling
 * @param {(x: number, y: number) => boolean} [opts.reject] veto a position (e.g. under a roof)
 * @returns {{ placed: object[], requested: number, dropped: number }}
 */
export function scatterPoints({
  cells,
  species,
  seed,
  density,
  noise = { frequency: 0.09, samples: 8 },
  reject = () => false,
}) {
  if (!cells?.length || !species?.length) {
    return { placed: [], requested: 0, dropped: 0 };
  }
  const rng = makeRng(seed);
  const noiseAt = noise ? makeNoise2D(seed ^ 0x5bf03635) : null;
  const freq = noise?.frequency ?? 0.09;
  const samples = Math.max(1, noise?.samples ?? 8);

  const perCell = density ?? densityFromSpecies(species);
  const requested = Math.ceil(cells.length * perCell);
  if (requested <= 0) return { placed: [], requested: 0, dropped: 0 };

  // A candidate is read once per sample, and by default there are eight samples
  // to a dart, so they are unpacked into typed arrays up front rather than
  // destructured out of an array of pairs a few million times over. The same
  // pass collects the bounds the neighbour grid gets laid out over.
  const count = cells.length;
  const cellX = new Float64Array(count);
  const cellY = new Float64Array(count);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const x = cells[i][0]; const y = cells[i][1];
    cellX[i] = x; cellY[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const maxRadius = Math.max(...species.map((s) => s.radius));
  // A position drawn in cell (x, y) lands in [x, x+1) x [y, y+1), so the grid
  // covers one cell past the far corner of the candidate set.
  const bounds = { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
  const bucketCount = (size) => (
    ((Math.floor(bounds.maxX / size) + 2) - (Math.floor(bounds.minX / size) - 1))
    * ((Math.floor(bounds.maxY / size) + 2) - (Math.floor(bounds.minY / size) - 1))
  );
  // Any bucket size answers the overlap query correctly, because `reach` is
  // derived from it; a coarser one only means more discs to look at per bucket.
  // Doubling is the cheap way to stop a far-flung candidate set from asking for
  // a grid the size of its bounding box.
  let cellSize = Math.max(1, maxRadius * 2);
  while (bucketCount(cellSize) > MAX_BUCKETS) cellSize *= 2;

  const placed = [];
  const index = discIndex(cellSize, maxRadius, bounds, placed);
  const wheel = speciesWheel(species);
  const dartsPerPass = Math.max(10, requested);

  let unchanged = 0;
  while (placed.length < requested && unchanged < MAX_UNCHANGED) {
    const before = placed.length;
    for (let d = 0; d < dartsPerPass && placed.length < requested; d += 1) {
      // Importance sampling: draw a few candidates, keep the one sitting
      // highest on the noise field. Clumps fall out; no cluster centres. Held
      // in scalars rather than a two-element array: every improvement on the
      // running best used to allocate a pair, and all but the last of them
      // became garbage, a few million times a bake.
      let bestX = 0;
      let bestY = 0;
      let bestScore = -Infinity;
      for (let s = 0; s < samples; s += 1) {
        const i = Math.floor(rng() * count);
        const px = cellX[i] + rng();
        const py = cellY[i] + rng();
        const score = noiseAt ? noiseAt(px * freq, py * freq) : 0;
        if (score > bestScore) { bestScore = score; bestX = px; bestY = py; }
        if (!noiseAt) break;
      }
      const x = bestX;
      const y = bestY;
      if (reject(x, y)) continue;

      const pick = species[pickIndex(wheel, rng())];
      if (!index.hasRoom(x, y, pick.radius)) continue;

      placed.push({ x, y, radius: pick.radius, id: pick.id, big: Boolean(pick.big) });
      index.add(placed.length - 1);
    }
    unchanged = placed.length === before ? unchanged + 1 : 0;
  }

  // Stable order so the model is byte-identical regardless of dart order.
  placed.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  return { placed, requested, dropped: requested - placed.length };
}

/**
 * The long axis of a ring, by principal component. Rows run along it.
 * @param {[number, number][]} ring
 * @returns {{ cx: number, cy: number, ax: number, ay: number }}
 */
export function principalAxis(ring) {
  let cx = 0; let cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  let sxx = 0; let syy = 0; let sxy = 0;
  for (const [x, y] of ring) {
    const dx = x - cx; const dy = y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  // Dominant eigenvector of the 2x2 covariance matrix.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { cx, cy, ax: Math.cos(theta), ay: Math.sin(theta) };
}

/**
 * Place items in rows across a polygon — planter rows, lamp posts along a
 * midway, queue-rail stanchions, parking stripes.
 *
 * @param {object} opts
 * @param {[number, number][]} opts.ring polygon in cell coordinates
 * @param {number} opts.rowSpacing cells between rows
 * @param {number} opts.itemSpacing cells between items along a row
 * @param {string} [opts.id] sprite id to stamp on each item
 * @param {(x: number, y: number) => boolean} [opts.reject]
 * @returns {{ placed: object[] }}
 */
export function fillRows({ ring, rowSpacing, itemSpacing, id = 'prop', reject = () => false }) {
  if (!ring?.length || !(rowSpacing > 0) || !(itemSpacing > 0)) return { placed: [] };
  const { cx, cy, ax, ay } = principalAxis(ring);
  // Across-axis is the perpendicular; extent bounds how far rows must reach.
  const px = -ay; const py = ax;
  let alongMin = Infinity; let alongMax = -Infinity;
  let acrossMin = Infinity; let acrossMax = -Infinity;
  for (const [x, y] of ring) {
    const dx = x - cx; const dy = y - cy;
    const a = dx * ax + dy * ay;
    const b = dx * px + dy * py;
    if (a < alongMin) alongMin = a;
    if (a > alongMax) alongMax = a;
    if (b < acrossMin) acrossMin = b;
    if (b > acrossMax) acrossMax = b;
  }
  const placed = [];
  for (let b = acrossMin + rowSpacing / 2; b <= acrossMax; b += rowSpacing) {
    for (let a = alongMin + itemSpacing / 2; a <= alongMax; a += itemSpacing) {
      const x = cx + ax * a + px * b;
      const y = cy + ay * a + py * b;
      if (!pointInRing([x, y], ring)) continue;
      if (reject(x, y)) continue;
      placed.push({ x, y, id });
    }
  }
  placed.sort((p, q) => p.y - q.y || p.x - q.x);
  // The axis comes back with the points: a caller drawing a line through them
  // needs the direction, and re-deriving it from the ring would be a second
  // chance to disagree.
  return { placed, axis: { ax, ay } };
}
