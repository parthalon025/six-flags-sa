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
 */

import { makeNoise2D, makeRng } from './terrain/noise.mjs';

/** Random disc packing saturates near 0.55; the optimistic 0.8 just makes the
 *  dart loop give up more often. Tuned down so `itemsToAdd` is reachable. */
export const PACKING = 0.55;

/** Give up on a polygon after this many passes that placed nothing. */
const MAX_UNCHANGED = 10;

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

/** Cumulative-probability wheel. Falls through to the last entry on rounding. */
function pickSpecies(species, roll) {
  const total = species.reduce((s, x) => s + (x.probability ?? 1), 0);
  let acc = 0;
  const target = roll * total;
  for (const s of species) {
    acc += s.probability ?? 1;
    if (target <= acc) return s;
  }
  return species[species.length - 1];
}

/** Uniform grid of placed discs — the neighbour query for overlap rejection. */
function discIndex(cellSize) {
  const buckets = new Map();
  const key = (cx, cy) => `${cx}:${cy}`;
  return {
    add(item) {
      const cx = Math.floor(item.x / cellSize);
      const cy = Math.floor(item.y / cellSize);
      const k = key(cx, cy);
      const list = buckets.get(k);
      if (list) list.push(item); else buckets.set(k, [item]);
    },
    /** Every placed disc whose bucket could hold an overlap with `radius` at (x,y). */
    near(x, y, radius) {
      const reach = Math.ceil((radius + cellSize) / cellSize);
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const out = [];
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const list = buckets.get(key(cx + dx, cy + dy));
          if (list) out.push(...list);
        }
      }
      return out;
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

  const maxRadius = Math.max(...species.map((s) => s.radius));
  const index = discIndex(Math.max(1, maxRadius * 2));
  const placed = [];
  const dartsPerPass = Math.max(10, requested);

  let unchanged = 0;
  while (placed.length < requested && unchanged < MAX_UNCHANGED) {
    const before = placed.length;
    for (let d = 0; d < dartsPerPass && placed.length < requested; d += 1) {
      // Importance sampling: draw a few candidates, keep the one sitting
      // highest on the noise field. Clumps fall out; no cluster centres.
      let best = null;
      let bestScore = -Infinity;
      for (let s = 0; s < samples; s += 1) {
        const [cx, cy] = cells[Math.floor(rng() * cells.length)];
        const px = cx + rng();
        const py = cy + rng();
        const score = noiseAt ? noiseAt(px * freq, py * freq) : 0;
        if (score > bestScore) { bestScore = score; best = [px, py]; }
        if (!noiseAt) break;
      }
      const [x, y] = best;
      if (reject(x, y)) continue;

      const pick = pickSpecies(species, rng());
      const room = index
        .near(x, y, pick.radius + maxRadius)
        .every((o) => Math.hypot(o.x - x, o.y - y) > o.radius + pick.radius);
      if (!room) continue;

      const item = { x, y, radius: pick.radius, id: pick.id, big: Boolean(pick.big) };
      index.add(item);
      placed.push(item);
    }
    unchanged = placed.length === before ? unchanged + 1 : 0;
  }

  // Stable order so the model is byte-identical regardless of dart order.
  placed.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  return { placed, requested, dropped: requested - placed.length };
}
