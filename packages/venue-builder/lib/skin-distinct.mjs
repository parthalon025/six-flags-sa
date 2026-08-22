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
 *   - Five of the seventeen axes the document defines are not modelled here at
 *     all: A6, A7, B6, C3 and C4, each with its reason in UNMAPPED_AXES.
 *     They are absent from `spec`, so they never enter lowerBound, upperBound
 *     or heavyPossible — a real difference on one of them cannot move the
 *     verdict in either direction. This is a narrower claim than C1's empty
 *     knob list, which asserts the kit schema has no field and earns
 *     NO-KIT-KNOB; UNMAPPED_AXES only says this tool makes no claim.
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

/* ------------------------------------------------------------- the set gate
 *
 * Everything above answers one question: is Skin B a different world from
 * Skin A? ADR-0021 clause 6 asks a different one of the first ship, and is
 * explicit about why the count is load-bearing rather than a round number:
 *
 *   "One Skin cannot fail the beyond-palette distinctness gate, so it cannot
 *    tell you the kit is wrong; three Skins chosen far apart on the design
 *    axes can."
 *
 * and, rejecting the two-Skin near-miss the reviewer recommended:
 *
 *   "Two can fail the distinctness gate, but a pair that passes may be passing
 *    on a single axis; three is the smallest set where that cannot hide."
 *
 * So a set clears only when EVERY unordered pair clears, and a set below the
 * floor cannot clear at all however clean its one pair looks. The floor
 * withholds a PASS; it never launders a proven FAIL into "cannot tell", which
 * would be the same mistake in the other direction.
 */

/** The smallest set of shipped Skins whose distinctness can be decided. */
export const MIN_SHIP_SKINS = 3;

/** Every unordered pair of a shipped set, in declaration order.
 *
 *  Declaration order rather than sorted, so the trio's own ordering — clause 6
 *  puts pixel-tycoon first — survives into the report a human reads. */
export function skinSetPairs(skins = []) {
  const seen = new Set();
  for (const id of skins) {
    if (seen.has(id)) throw new Error(`skin "${id}" appears twice — a Skin is not distinct from itself`);
    seen.add(id);
  }
  const pairs = [];
  for (let i = 0; i < skins.length; i += 1) {
    for (let j = i + 1; j < skins.length; j += 1) pairs.push([skins[i], skins[j]]);
  }
  return pairs;
}

/**
 * Roll per-pair verdicts into one answer for the set.
 *
 * @param {{a: string, b: string, verdict: {outcome: string}}[]} pairs
 * @returns the set outcome, the pairs that proved it wrong (`failing`), the
 *   pairs the instrument could not decide (`unproven`), and — when the set is
 *   too small to decide at all — the `reason` it is being withheld, so a
 *   caller reports the clause rather than a bare unknown.
 */
export function setVerdict(pairs = []) {
  const failing = pairs.filter((p) => p.verdict?.outcome === 'FAIL').map(({ a, b }) => [a, b]);
  const unproven = pairs.filter((p) => p.verdict?.outcome === 'INDETERMINATE').map(({ a, b }) => [a, b]);
  // A pair count below the floor is `MIN_SHIP_SKINS choose 2`. Derived rather
  // than written as 3, so raising the floor cannot leave a stale literal here.
  const enough = pairs.length >= (MIN_SHIP_SKINS * (MIN_SHIP_SKINS - 1)) / 2;
  const outcome = failing.length ? 'FAIL' : (unproven.length || !enough) ? 'INDETERMINATE' : 'PASS';
  return {
    outcome,
    pass: outcome === 'PASS',
    failing,
    unproven,
    reason: enough
      ? ''
      : `a set of fewer than ${MIN_SHIP_SKINS} Skins cannot clear the gate: one cannot fail it, and a `
        + 'pair that passes may be passing on a single axis (ADR-0021 clause 6)',
  };
}

/** Kit-spec paths that move each axis. A leading `!` marks a knob whose mere
 *  presence-or-absence is the difference (wash either exists or it does not).
 *  Wildcard `*` walks every key at that level, so terrain classes stay covered
 *  as the vocabulary grows. */
export const AXIS_KNOBS = {
  A1: ['terrain.*.base', 'terrain.*.texture.color', 'sprites.building.roofs', 'sprites.tree.canopy', 'sprites.slide.colors', 'sprites.badge.*'],
  A2: ['terrain.*.base', 'sprites.building.wall', 'sprites.building.drop'],
  A3: ['!wash', 'strokes.displacement.amplitude', 'strokes.displacement.wavelength', 'sprites.building.edge', 'terrain.road.style', 'terrain.service.style'],
  A4: ['!wash', 'terrain.*.texture.kind', 'terrain.*.texture.density', 'terrain.*.tiles.asset', 'terrain.*.material.id', 'terrain.*.material.mix', 'sprites.building.material.id'],
  // Only the relief-variant half of A5 is kit-expressible. The light direction
  // is DEFAULT_LIGHT in terrain/hillshade.mjs and the hillshade itself is
  // recorded per skin in <skin>.visual.json — neither is a kit field. What a kit
  // can say is how a steep surface reads, which is A5's "how height reads".
  A5: ['terrain.*.steep.base'],
  B1: ['terrain.*.base', 'terrain.*.tiles.asset', 'terrain.*.material.id'],
  B2: ['terrain.water.base', 'terrain.water.texture.kind', 'terrain.water.texture.color'],
  B3: ['sprites.tree.style', 'sprites.tree.sprite.asset', 'sprites.tree.canopy', 'sprites.tree.scale'],
  B4: ['sprites.building.style', 'sprites.building.roofs', 'sprites.building.material.id', 'sprites.building.drop'],
  B5: ['sprites.coaster.style', 'sprites.slide.style', 'terrain.road.style', 'terrain.service.style'],
  // C1 (landmark iconography and salience) has NO kit-level field today. It is
  // not "no kit sets it" — the builder has no such concept: `landmark` appears
  // nowhere in display-bake.mjs, and in this codebase it is a venue-truth POI
  // category, not style vocabulary. An empty list is the honest encoding, and
  // verdict() reports it as NO-KIT-KNOB rather than SAME so the gate cannot
  // quietly treat an inexpressible heavy axis as "checked, identical".
  C1: [],
  C2: ['sprites.badge.icons.*.asset', 'sprites.badge.*'],
};

/** Paths the builder genuinely reads that no shipped kit sets — real vocabulary
 *  the painter consults, not invented paths. Anything mapped in AXIS_KNOBS that
 *  neither resolves on a kit nor appears here is invented, and the suite fails
 *  on it. The suite also fails an entry here that DOES resolve on a kit: this
 *  list exempts paths no kit sets, and a stale entry silences the invented-knob
 *  check for one that no longer needs exempting.
 *
 *  `terrain.*.tiles.asset` used to sit here and was wrong — island-brochure and
 *  rpg-overworld both bind ground/grass/wood/water to kenney-roguelike-sheet.
 *  It resolves live and needs no exemption.
 *
 *  The three below are unset for two different reasons, and the distinction
 *  matters to anyone deciding what to build next:
 *    - `sprites.tree.sprite.asset` is an empty slot awaiting art (#578).
 *    - `sprites.badge.icons.*.asset` is NOT empty — display-bake.mjs binds all
 *      six badge kinds to parkbound-badge-* by default and the painter draws
 *      them. What no kit does is override that default.
 *    - `terrain.*.steep.base` likewise ships defaults for the natural surfaces;
 *      no kit overrides them, so A5 reads SAME rather than differing.
 *  None of that makes their axes dead: B3 and C2 differ on all 15 pairs of the
 *  six shipped kits through their other knobs, and the suite pins that. */
export const SCHEMA_ONLY_KNOBS = [
  'sprites.tree.sprite.asset',
  'sprites.badge.icons.*.asset',
  'terrain.*.steep.base',
];

/** Axes `docs/goals/design-language-axes.md` defines that this instrument does
 *  not model at all — distinct from an axis mapped to `[]` (C1), which asserts
 *  the kit schema has no field for it and earns the NO-KIT-KNOB verdict state.
 *  These are weaker: the tool makes no claim either way, so it must not let
 *  them pass unmentioned. `display-distinct` prints this on every run, and the
 *  suite asserts these keys plus AXIS_KNOBS' cover the document exactly, so the
 *  two can never drift apart in silence again.
 *
 *  Wiring any of them is a decision about what a kit should be able to say, not
 *  a mechanical mapping — inventing knob paths to fill the table is the exact
 *  defect #578 corrected. A6 is the one the document itself calls
 *  machine-checkable, so it is the first worth having. */
export const UNMAPPED_AXES = {
  A6: 'projection and camera — no kit field; projection is recorded per baked world '
    + '(*.world.json) and the pitch/zoom preset lives in mapCamera, not the kit. '
    + 'Named machine-checkable by the document',
  A7: 'framing and edge-of-world — no kit field of any kind',
  B6: 'props and ornament density — kits express density only for terrain texture '
    + '(already A4); there is no prop class to budget',
  C3: 'typography and labeling — no kit field; a kit\'s `label` is its own display '
    + 'name, and the app draws labels from venue truth, not from the kit',
  C4: 'mood signature and pillar fidelity — the document defines this as the axis '
    + 'the other sixteen must add up to, so it is an eye-pass by construction',
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

/** Axes this version measures in pixels. Derived from the one function that
 *  decides it, so the CLI's "not measured, so never earned" banner and
 *  verdict()'s notion of measurable cannot drift apart. The rest are spec-side
 *  only and can never be earned — stated rather than silently skipped, because
 *  a gate that quietly cannot see an axis reads as that axis being fine. */
export const PIXEL_MEASURED = Object.freeze(['A1', 'A2', 'A3', 'A4']);

/** Guard for the above: pixelAxisDeltas is the authority, and this asserts the
 *  published list still matches what it returns. */
export function assertPixelMeasuredMatches(deltas) {
  const actual = Object.keys(deltas).sort().join(',');
  const declared = [...PIXEL_MEASURED].sort().join(',');
  if (actual !== declared) {
    throw new Error(`PIXEL_MEASURED says ${declared} but pixelAxisDeltas returned ${actual}`);
  }
}

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
    // An axis with no mapped knob cannot be expressed by a kit at all, which is
    // a different fact from "expressed and identical".
    out[axis] = { differs: knobs.length > 0, knobs, representable: paths.length > 0 };
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
      // 64 on a 0..~1442 Sobel magnitude: about a 16/255 step across a pixel
      // pair, which is the smallest luma step that survives the bake's own
      // quantisation and reads as a drawn edge rather than a gradient. The
      // epsilon matters because the luma weights do not sum to exactly 1 in
      // IEEE754 — an intended-64 step computes to 64.00000000000009, so a
      // strict comparison would classify neighbouring integer colours on
      // rounding noise rather than on the boundary.
      if (Math.hypot(gx, gy) >= EDGE_MAGNITUDE - 1e-9) strong += 1;
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

/** Sobel magnitude above which a pixel counts as sitting on a drawn edge. */
const EDGE_MAGNITUDE = 64;

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

/** Roll spec and pixel evidence into per-axis states and a provable outcome.
 *
 *  Only A1-A4 are measured in pixels, so a verdict phrased as pass/fail would
 *  be wrong in both directions: it could never reach the 6 distinct axes the
 *  document asks for, and it would report FAIL on pairs that are obviously
 *  different worlds. Proven on watercolor-quest vs midnight-carnival, which
 *  clears all three heavy axes and still cannot reach 6.
 *
 *  So this reports bounds instead:
 *    lower — axes where spec and pixels agree. Proven distinct.
 *    upper — lower, plus every unmeasured axis whose spec declares a
 *            difference, since those could turn out painted.
 *  PASS when the lower bound already satisfies the gate, FAIL when the upper
 *  bound cannot, INDETERMINATE when the measurement cannot decide. An
 *  INDETERMINATE is a statement about the instrument, not about the art.
 */
export function verdict({ spec, pixel, thresholds }) {
  const states = {};
  const distinct = [];
  const couldBeDistinct = [];
  for (const axis of Object.keys(spec)) {
    const declared = spec[axis]?.differs === true;
    const representable = spec[axis]?.representable !== false;
    const measurable = Object.prototype.hasOwnProperty.call(pixel, axis);
    const painted = measurable && pixel[axis] >= (thresholds[axis] ?? Infinity);
    let state;
    if (!representable) state = 'NO-KIT-KNOB';
    else if (!measurable) state = declared ? 'DECLARED-UNMEASURED' : 'SAME';
    else if (declared && painted) state = 'DISTINCT';
    else if (declared && !painted) state = 'DECLARED-NOT-PAINTED';
    else if (!declared && painted) state = 'PAINTED-NOT-DECLARED';
    else state = 'SAME';
    states[axis] = state;
    if (state === 'DISTINCT') distinct.push(axis);
    // An unmeasured axis that declares a difference is the only kind that
    // might still be earned once the instrument can see it. A measured axis
    // has already had its chance.
    if (state === 'DISTINCT' || state === 'DECLARED-UNMEASURED') couldBeDistinct.push(axis);
  }
  const heavy = (list) => list.filter((a) => HEAVY_AXES.includes(a));
  const lowerBound = distinct.length;
  const upperBound = couldBeDistinct.length;
  const heavyDistinct = heavy(distinct);
  const heavyPossible = heavy(couldBeDistinct);

  const provablePass = lowerBound >= REQUIRED_AXES && heavyDistinct.length >= REQUIRED_HEAVY;
  const provableFail = upperBound < REQUIRED_AXES || heavyPossible.length < REQUIRED_HEAVY;
  const outcome = provablePass ? 'PASS' : provableFail ? 'FAIL' : 'INDETERMINATE';

  return {
    states,
    distinct,
    heavyDistinct,
    lowerBound,
    upperBound,
    heavyPossible,
    outcome,
    /** Kept for callers that only care whether the gate is definitely cleared. */
    pass: outcome === 'PASS',
  };
}
