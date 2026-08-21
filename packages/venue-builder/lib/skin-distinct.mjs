/** Skin distinctness — is Skin B genuinely a different world from Skin A, or
 *  the same drawing recoloured?
 *
 * The gate lives in docs/goals/design-language-axes.md: two shipped looks must
 * differ on >= 6 axes, of which >= 3 come from the heavy set. This module
 * decides that from BOTH sides and requires them to agree:
 *
 *   spec side  — which kit knobs differ, mapped to the axis each one moves.
 *   pixel side — what actually came out of the bake.
 *
 * An axis is earned only when both sides move together. Neither alone counts,
 * and the two disagreement states are the point of the instrument:
 *
 *   DECLARED-NOT-PAINTED — the kit claims a difference the bake does not show.
 *     This is the #577 shape. A spec-only gate would have waved it through.
 *   PAINTED-NOT-DECLARED — the bakes differ with nothing in the kit to explain
 *     it. Real, but unattributable and unreproducible, so it earns nothing.
 *
 * Everything here is deterministic: no sampling, no RNG, no wall clock.
 *
 * Known limitations, stated rather than discovered later:
 *   - Only A1-A4 are measured in pixels. B1-B5, C1 and C2 need per-class
 *     segmentation against the venue truth and are spec-side only, so they can
 *     never be *earned*. B4 and C1 are heavy axes, which means the gate is
 *     currently stricter than the document intends: a pair could genuinely
 *     differ on built form and get no credit for it.
 *   - A2 is a luma-histogram distance and is unreliable for art with a
 *     near-degenerate histogram (large exactly-flat regions). Real bakes null
 *     at ~0.03 under lossy re-encode; a two-value synthetic image nulls at
 *     ~0.38. See the pinned case in test/builder/skin-distinct.mjs.
 *   - Knob liveness is not proven here. A knob can differ between kits and be
 *     inert in the painter; this instrument sees that as DECLARED-NOT-PAINTED
 *     at the axis level but cannot say which knob is the dead one. Establishing
 *     that needs the ablation census (re-bake each knob at its antipode and
 *     count changed pixels), which is deliberately not run per-PR.
 */
import sharp from 'sharp';

/** The axes that dominate perceived style distance (design-language-axes.md). */
export const HEAVY_AXES = ['A1', 'A2', 'A3', 'A4', 'B4', 'C1'];

/** Axes a look must differ on, and how many of those must be heavy. */
export const REQUIRED_AXES = 6;
export const REQUIRED_HEAVY = 3;

/** Kit-spec paths that move each axis. A leading `!` marks a knob whose mere
 *  presence-or-absence is the difference (wash either exists or it does not).
 *  Wildcard `*` walks every key at that level, so terrain classes stay covered
 *  as the vocabulary grows. */
export const AXIS_KNOBS = {
  A1: ['palette', 'terrain.*.base', 'terrain.*.texture.color', 'sprites.building.roofs', 'sprites.tree.canopy', 'sprites.slide.colors', 'sprites.badge.*'],
  A2: ['terrain.*.base', 'sprites.building.wall', 'sprites.building.drop'],
  A3: ['!wash', 'strokes.displacement.amplitude', 'strokes.displacement.wavelength', 'sprites.building.edge', 'terrain.road.style', 'terrain.service.style'],
  A4: ['!wash', 'terrain.*.texture.kind', 'terrain.*.texture.density', 'terrain.*.tiles.asset', 'terrain.*.material.id', 'terrain.*.material.mix', 'sprites.building.material.id'],
  B1: ['terrain.*.base', 'terrain.*.tiles.asset', 'terrain.*.material.id'],
  B2: ['terrain.water.base', 'terrain.water.texture.kind', 'terrain.water.texture.color'],
  B3: ['sprites.tree.style', 'sprites.tree.sprite.asset', 'sprites.tree.canopy', 'sprites.tree.scale'],
  B4: ['sprites.building.style', 'sprites.building.roofs', 'sprites.building.material.id', 'sprites.building.drop'],
  B5: ['sprites.coaster.style', 'sprites.slide.style', 'terrain.road.style', 'terrain.service.style'],
  C1: ['landmarks', 'sprites.landmark.asset'],
  C2: ['sprites.badge.icons.*.asset', 'sprites.badge.*'],
};

/** What an identical world scores against a lossy re-encode of itself —
 *  encoding noise and nothing else. Measured on kings-island/watercolor-quest
 *  at webp q90; reproduce with the --null flag on the CLI. A threshold below
 *  its own null is worse than no threshold: it reports encoding as style.
 *  A3's was originally set to 0.02, *under* its 0.0232 null, which this table
 *  exists to make impossible to do again silently. */
export const ENCODE_NULL = { A1: 0.0104, A2: 0.0283, A3: 0.0232, A4: 0.0057 };

/** The bar a measured difference must clear to count as painted: 3x the null,
 *  rounded up. Raising A2 and A3 to their honest values does not change the
 *  shipped pair's verdict — it makes it defensible. */
export const THRESHOLDS = { A1: 0.05, A2: 0.09, A3: 0.07, A4: 0.02 };

/** Axes this version measures in pixels. The rest are spec-side only and can
 *  never be earned — stated rather than silently skipped, because a gate that
 *  quietly cannot see an axis reads as that axis being fine. */
export const PIXEL_MEASURED = ['A1', 'A2', 'A3', 'A4'];

function readPath(obj, path) {
  const parts = path.replace(/^!/, '').split('.');
  let node = obj;
  for (let i = 0; i < parts.length; i += 1) {
    if (node === undefined || node === null) return undefined;
    const key = parts[i];
    if (key === '*') {
      const rest = parts.slice(i + 1).join('.');
      if (typeof node !== 'object') return undefined;
      // A wildcard collapses to the sorted map of its branches, so two kits
      // agree only when every branch agrees.
      return Object.keys(node).sort().map((k) => `${k}=${JSON.stringify(rest ? readPath(node[k], rest) : node[k])}`).join('|');
    }
    node = node[key];
  }
  return node;
}

/** Per axis: does any mapped knob differ between the two kits, and which. */
export function specAxesDiffering(kitA, kitB) {
  const out = {};
  for (const [axis, paths] of Object.entries(AXIS_KNOBS)) {
    const knobs = [];
    for (const path of paths) {
      const presenceOnly = path.startsWith('!');
      const a = readPath(kitA, path);
      const b = readPath(kitB, path);
      const differs = presenceOnly
        ? (a !== undefined) !== (b !== undefined)
        : JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
      if (differs) knobs.push(path.replace(/^!/, ''));
    }
    out[axis] = { differs: knobs.length > 0, knobs };
  }
  return out;
}

/** Decode to a fixed width so two bakes of different pixel size still compare,
 *  and so the cost does not scale with the close band. */
const SAMPLE_W = 512;

async function sample(input) {
  const { data, info } = await sharp(input)
    .resize(SAMPLE_W, null, { kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { px: data, w: info.width, h: info.height };
}

function greyscale({ px, w, h }) {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    g[i] = 0.2126 * px[i * 3] + 0.7152 * px[i * 3 + 1] + 0.0722 * px[i * 3 + 2];
  }
  return g;
}

/** Chromaticity histogram, L1 distance — hue and tint with luma divided out.
 *
 *  Deliberately not a raw RGB histogram: binning on RGB lets achromatic grain
 *  scatter pixels across bin boundaries and read as a palette change (measured
 *  0.17 between two mid-greys differing only in noise amplitude, which is a
 *  false A1). Dividing by r+g+b leaves hue and tint, so grain moves A4 and
 *  leaves A1 alone. A near-black pixel has no meaningful chromaticity and gets
 *  its own bin rather than amplifying rounding noise. */
function paletteHistogram({ px, w, h }) {
  const BINS = 8;
  const bins = new Float64Array(BINS * BINS + 1);
  for (let i = 0; i < w * h; i += 1) {
    const r = px[i * 3]; const g = px[i * 3 + 1]; const b = px[i * 3 + 2];
    const sum = r + g + b;
    if (sum < 24) { bins[BINS * BINS] += 1; continue; }
    const rb = Math.min(BINS - 1, Math.floor((r / sum) * BINS * 1.5));
    const gb = Math.min(BINS - 1, Math.floor((g / sum) * BINS * 1.5));
    bins[rb * BINS + gb] += 1;
  }
  for (let i = 0; i < bins.length; i += 1) bins[i] /= w * h;
  return bins;
}

/** Luma histogram — the greyscale skeleton, independent of hue. */
function valueHistogram(g) {
  const bins = new Float64Array(32);
  for (let i = 0; i < g.length; i += 1) bins[Math.min(31, Math.floor(g[i] / 8))] += 1;
  for (let i = 0; i < bins.length; i += 1) bins[i] /= g.length;
  return bins;
}

/** Sobel by hand on the raw buffer. sharp.convolve() clips into uint8 and
 *  destroys the strong-edge tail, which is exactly the signal A3 needs. */
function edgeDensity(g, w, h) {
  let strong = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      if (Math.hypot(gx, gy) > 64) strong += 1;
    }
  }
  return strong / ((w - 2) * (h - 2));
}

/** Mean within-block standard deviation — grain and detail frequency, with
 *  large-scale composition differences factored out by the blocking. */
function grain(g, w, h, block = 8) {
  let total = 0; let blocks = 0;
  for (let by = 0; by + block <= h; by += block) {
    for (let bx = 0; bx + block <= w; bx += block) {
      let sum = 0; let sumSq = 0;
      for (let y = by; y < by + block; y += 1) {
        for (let x = bx; x < bx + block; x += 1) {
          const v = g[y * w + x]; sum += v; sumSq += v * v;
        }
      }
      const n = block * block;
      total += Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
      blocks += 1;
    }
  }
  return blocks ? total / blocks / 128 : 0; // normalised into roughly 0..1
}

const l1 = (a, b) => a.reduce((acc, v, i) => acc + Math.abs(v - b[i]), 0) / 2;

/** Per-axis pixel distance in 0..1, for the axes this version can measure. */
export async function pixelAxisDeltas(bakeA, bakeB) {
  const [a, b] = [await sample(bakeA), await sample(bakeB)];
  const [ga, gb] = [greyscale(a), greyscale(b)];
  return {
    A1: l1(paletteHistogram(a), paletteHistogram(b)),
    A2: l1(valueHistogram(ga), valueHistogram(gb)),
    A3: Math.abs(edgeDensity(ga, a.w, a.h) - edgeDensity(gb, b.w, b.h)),
    A4: Math.abs(grain(ga, a.w, a.h) - grain(gb, b.w, b.h)),
  };
}

/** Roll spec and pixel evidence into per-axis states and a pass/fail.
 *  An axis is DISTINCT only when both sides moved. */
export function verdict({ spec, pixel, thresholds }) {
  const states = {};
  const distinct = [];
  for (const axis of Object.keys(spec)) {
    const declared = spec[axis]?.differs === true;
    const measurable = Object.prototype.hasOwnProperty.call(pixel, axis);
    const painted = measurable && pixel[axis] >= (thresholds[axis] ?? Infinity);
    let state;
    if (!measurable) state = declared ? 'DECLARED-UNMEASURED' : 'SAME';
    else if (declared && painted) state = 'DISTINCT';
    else if (declared && !painted) state = 'DECLARED-NOT-PAINTED';
    else if (!declared && painted) state = 'PAINTED-NOT-DECLARED';
    else state = 'SAME';
    states[axis] = state;
    if (state === 'DISTINCT') distinct.push(axis);
  }
  const heavyDistinct = distinct.filter((a) => HEAVY_AXES.includes(a));
  return {
    states,
    distinct,
    heavyDistinct,
    pass: distinct.length >= REQUIRED_AXES && heavyDistinct.length >= REQUIRED_HEAVY,
  };
}
