/**
 * The grounding harvest — a World's real material and colour relationships,
 * read off openly licensed aerial imagery.
 *
 * This is the Visual factory's half of ADR-0020. Imagery reaches the two
 * factories under different contracts and they must not be blurred: for the
 * Map factory imagery is **evidence** (tree positions, surface classes, path
 * edges — truth, with provenance); for the Visual factory it is **grounding**,
 * so that every Skin of Kings Island is recognisably *Kings Island's*. Nothing
 * in this module writes truth, moves a feature, or names a Place. It reads
 * pixels at positions truth already fixed and answers one question: at this
 * park, how do the materials relate to each other?
 *
 * Five walls hold that shape, and each is a test rather than a comment:
 *
 *  1. **Licence.** Only derivation-licensed sources may be harvested
 *     (ADR-0020 clause 2 — viewable is not derivable). `GROUNDING_SOURCES` is
 *     an allowlist rather than a blocklist, so a new basemap is refused until
 *     somebody says otherwise.
 *  2. **Bands.** Grounding covers the overview and mid bands. ADR-0021
 *     clause 8: NAIP's ~1 m GSD is ample for recognition at arm's length and
 *     roughly 7x too coarse to texture a 0.15 m/px close band, whose
 *     specificity comes from kit vocabulary instead.
 *  3. **Truth.** The record carries relationships — orderings, contrasts,
 *     groups — and no geometry, no positions and no names. A group names its
 *     members by `footprintKey`, a hash of the footprint truth already ships,
 *     so a grounding record can be rejoined to truth without carrying any.
 *  4. **Palette.** The harvest measures colours but never hands one to a
 *     painter. Re-expression (`groundKit` in `display-references.mjs`) spends
 *     the Skin's own declared palette: design owns treatment, the venue owns
 *     relationships (ADR-0020 clause 4).
 *  5. **Something to say.** A frame that reads the same everywhere is refused
 *     rather than written. Big Kahuna's newest NAIP quarter-quad is nodata
 *     over the whole park, and the record it produced — six classes of pure
 *     black — validated against all four walls above and would have grounded
 *     every Skin in nothing.
 *
 * Everything relative. A class's `lightness`/`redness`/`warmth` are Lab
 * coordinates *centred on this World's own sample-weighted mean*, so the
 * record states "the lawn is darker than the lot, by this much" rather than
 * "the lawn is #4E7A3C" — the second is a colour override wearing a harvest's
 * clothes, and ADR-0020 rejects it by name. The measured medians ride along
 * under `observed` as provenance for a reviewer, and never leave this module
 * except into the record.
 *
 * The raster arrives through a **probe** — `{ at(lng, lat) -> [r,g,b] | null }`
 * — so the harvest never opens a file, a socket, or a projection library, and
 * never learns which source it is reading. `naipProbe` in
 * `lib/adapters/naip-planetary.mjs` is the one real adapter at that seam; the
 * suite's painted orthophoto is the other.
 */

import { createHash } from 'node:crypto';
import { pointInRing } from './geometry.mjs';
import { rgbToLab, medianColor, deltaE } from './display-style-contract.mjs';

/** ADR-0021 clause 8. Close is not on this list and must not join it. */
export const GROUNDING_BANDS = Object.freeze(['overview', 'mid']);

/**
 * Sources a harvest may derive from. An allowlist, because the failure mode is
 * a source that nobody checked slipping in — Google, Bing and Esri basemaps
 * are rejected outright (ADR-0020 clause 2), and street-level (Mapillary,
 * KartaView) stays out on two counts: ADR-0021 clause 8 puts it beyond the two
 * grounded bands, and its share-alike reach into derived venue data is an open
 * owner decision in ADR-0021's own Open section. A session works around an
 * open decision; it does not settle one.
 */
export const GROUNDING_SOURCES = Object.freeze(['planetary-computer:naip']);

/** Licence classes that permit deriving a new work from the pixels. */
export const DERIVATION_LICENSES = Object.freeze(['public-domain', 'cc0', 'cc-by']);

/**
 * The most groups one class may split into. Three, because that is the widest
 * palette any shipped kit declares for a single class (`sprites.building.roofs`),
 * and a distinction no Skin can express is a distinction the guest never sees.
 */
export const MAX_GROUPS = 3;

/**
 * Lab units between two group means before they are called different
 * materials. Below this the "two roof families" claim is measurement noise,
 * and the harvest's job is to find the relationships a park has, never to
 * invent one.
 */
export const MIN_SPLIT = 8;

/**
 * The smallest share of a class a group may hold. A Skin has three roof
 * colours to spend; handing one of them to two footpaths out of four hundred
 * is not the distinction a visitor makes, and it costs the distinction they
 * do make. Measured at kings-island, where two unusually bright paths would
 * otherwise have taken a slot from four hundred ordinary ones.
 */
export const MIN_GROUP_SHARE = 0.05;

/**
 * The largest contrast a World must show somewhere before its harvest counts
 * as grounding at all. A frame that reads the same everywhere has not
 * described this park — it has described a nodata collar, a cloud, or a
 * misregistration — and a record of seven identical classes is worse than no
 * record, because it validates, ships, and grounds every Skin in nothing.
 */
export const MIN_WORLD_CONTRAST = 2;

/** Samples per region. Enough to median away a car or a shadow; cheap enough
 *  to run every region of a 1,400-way park. */
export const PER_REGION = 48;

/**
 * Map layers to grounding classes, in the painter's own vocabulary
 * (`display-bake.mjs`'s AREA_TERRAIN / LINE_TERRAIN). Kept as its own table
 * rather than imported so the harvest does not depend on the painter's
 * internals — `test/builder/display-grounding.mjs` holds the two to the same
 * answer via `impliedTerrainClasses`, so a drift is a failing test rather than
 * a silently unharvested class.
 */
const AREA_LAYERS = Object.freeze([
  ['park', 'grass'], ['grass', 'grass'], ['wood', 'wood'], ['parking', 'lot'],
  ['sea', 'water'], ['water', 'water'], ['pool', 'water'],
]);
const LINE_LAYERS = Object.freeze([['service', 'service'], ['path', 'road']]);

/** Every class a harvest may report. Buildings are a class of their own:
 *  roofs are the single most recognisable thing about a park from above. */
export const GROUNDING_CLASSES = Object.freeze([
  ...new Set([...AREA_LAYERS, ...LINE_LAYERS].map(([, cls]) => cls)), 'structure',
]);

/** The three axes a class is placed on, in Lab order. */
export const AXES = Object.freeze(['lightness', 'redness', 'warmth']);

/**
 * A stable name for one footprint, derived from the geometry truth already
 * ships. This is how a group says *which* roofs are the blue ones without the
 * record carrying a single coordinate: the painter hashes the same ring and
 * looks its slot up. Geometry that moves re-keys, which is correct — a
 * building that moved was not the building this grounding measured.
 */
export function footprintKey(coords) {
  const canon = (coords || []).map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  return createHash('sha1').update(canon).digest('hex').slice(0, 12);
}

/**
 * The regions a harvest reads, from a built `map.json`. Areas are sampled
 * inside their ring; lines are sampled along themselves, which is both simpler
 * than buffering a polyline and truer — the middle of a path is the path, and
 * its edge is half kerb.
 *
 * One footprint is one region even when truth carries it more than once.
 * six-flags-fiesta-texas ships five ways with byte-identical geometry, and a
 * harvest that took them at face value would sample that ground twice, weight
 * it twice in the World's mean, and — because a group names its members by
 * footprint — put one key in two groups, which is a roof that is its own two
 * roof families. Truth's duplicates are truth's business; the harvest reads
 * ground, and that is one piece of ground.
 */
export function regionsFromMap(map) {
  const out = [];
  const seen = new Set();
  const push = (cls, kind, way, min) => {
    if (!(way?.r?.length >= min)) return;
    const key = footprintKey(way.r);
    if (seen.has(`${cls}:${key}`)) return;
    seen.add(`${cls}:${key}`);
    out.push({ cls, kind, key, coords: way.r });
  };
  for (const [layer, cls] of AREA_LAYERS) for (const way of map?.[layer] || []) push(cls, 'area', way, 3);
  for (const [layer, cls] of LINE_LAYERS) for (const way of map?.[layer] || []) push(cls, 'line', way, 2);
  for (const way of map?.building || []) push('structure', 'area', way, 3);
  return out;
}

/** Points to read for one region. Area points are filtered to the ring before
 *  the probe ever sees them, so a harvest cannot read its neighbour's ground. */
export function samplePointsFor(region, perRegion = PER_REGION) {
  const pts = region.coords || [];
  if (region.kind === 'line') {
    const lengths = [];
    let total = 0;
    for (let i = 1; i < pts.length; i += 1) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lengths.push(total);
    }
    if (!(total > 0)) return [];
    const out = [];
    for (let i = 0; i < perRegion; i += 1) {
      const target = ((i + 0.5) / perRegion) * total;
      let seg = lengths.findIndex((l) => l >= target);
      if (seg < 0) seg = lengths.length - 1;
      const before = seg === 0 ? 0 : lengths[seg - 1];
      const span = lengths[seg] - before || 1;
      const t = (target - before) / span;
      const [ax, ay] = pts[seg];
      const [bx, by] = pts[seg + 1];
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    return out;
  }
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const [w, e, s, n] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const g = Math.max(3, Math.ceil(Math.sqrt(perRegion * 2)));
  const out = [];
  for (let iy = 0; iy < g && out.length < perRegion; iy += 1) {
    for (let ix = 0; ix < g && out.length < perRegion; ix += 1) {
      const p = [w + ((ix + 0.5) / g) * (e - w), s + ((iy + 0.5) / g) * (n - s)];
      if (pointInRing(p, pts)) out.push(p);
    }
  }
  return out;
}

const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Spread between the 5th and 95th percentile. Robust on purpose: one white
 *  marquee roof must not decide that a park's roofs vary by lightness. */
function spreadOf(values) {
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.floor(p * (s.length - 1))];
  return at(0.95) - at(0.05);
}

/**
 * The partition of `values` (ascending) into `k` contiguous runs with the
 * least total squared deviation — Fisher's exact 1-D clustering, by dynamic
 * programme. Exact rather than iterative because a park is re-harvested and
 * the two runs must agree: k-means from a random seed does not promise that,
 * and a grounding record that reshuffles its roof families between runs is
 * worse than none. Returns the start index of each run after the first.
 */
function fisherCuts(values, k) {
  const n = values.length;
  const sum = [0];
  const sumSq = [0];
  for (let i = 0; i < n; i += 1) {
    sum.push(sum[i] + values[i]);
    sumSq.push(sumSq[i] + values[i] * values[i]);
  }
  const sse = (i, j) => {
    const count = j - i + 1;
    const total = sum[j + 1] - sum[i];
    return (sumSq[j + 1] - sumSq[i]) - (total * total) / count;
  };
  let best = Array.from({ length: n }, (_, j) => sse(0, j));
  const backs = [];
  for (let g = 2; g <= k; g += 1) {
    const next = new Array(n).fill(Infinity);
    const back = new Array(n).fill(g - 1);
    for (let j = g - 1; j < n; j += 1) {
      for (let i = g - 1; i <= j; i += 1) {
        const cost = best[i - 1] + sse(i, j);
        if (cost < next[j]) {
          next[j] = cost;
          back[j] = i;
        }
      }
    }
    backs.push(back);
    best = next;
  }
  const cuts = [];
  let end = n - 1;
  for (let g = k; g >= 2; g -= 1) {
    const start = backs[g - 2][end];
    cuts.unshift(start);
    end = start - 1;
  }
  return cuts;
}

/**
 * Split one class's regions into at most `MAX_GROUPS` groups along the axis
 * they actually differ on — b* for blue roofs against beige ones, L* for
 * asphalt against gravel. Splitting on the widest axis is what lets one rule
 * find both; splitting only on lightness would call two roof families one.
 *
 * The split itself is a least-squares partition rather than a hunt for gaps,
 * because real parks do not leave gaps. Kings Island's 266 roofs span 43 L*
 * points between the 5th and 95th percentile with no hole of 8 anywhere in
 * them: a gap-finder reports one roof family and a guest sees three. What
 * makes a partition *real* is checked afterwards instead — adjacent group
 * means must clear `MIN_SPLIT`, and no group may be smaller than
 * `MIN_GROUP_SHARE` — and the widest k that survives both wins, down to one
 * group when none does.
 */
function splitIntoGroups(regions) {
  const axis = AXES.reduce(
    (best, name, i) => {
      const s = spreadOf(regions.map((r) => r.lab[i]));
      return s > best.spread ? { name, index: i, spread: s } : best;
    },
    { name: AXES[0], index: 0, spread: -Infinity },
  );
  const sorted = [...regions].sort(
    (a, b) => a.lab[axis.index] - b.lab[axis.index] || (a.key < b.key ? -1 : 1),
  );
  const values = sorted.map((r) => r.lab[axis.index]);
  const samples = sorted.reduce((s, r) => s + r.samples, 0);

  for (let k = Math.min(MAX_GROUPS, sorted.length); k >= 2; k -= 1) {
    const chunks = [];
    let from = 0;
    for (const at of [...fisherCuts(values, k), sorted.length]) {
      chunks.push(sorted.slice(from, at));
      from = at;
    }
    if (chunks.some((c) => !c.length)) continue;
    const means = chunks.map((c) => c.reduce((s, r) => s + r.lab[axis.index], 0) / c.length);
    const separated = means.every((m, i) => i === 0 || m - means[i - 1] >= MIN_SPLIT);
    const substantial = chunks.every(
      (c) => c.reduce((s, r) => s + r.samples, 0) / samples >= MIN_GROUP_SHARE,
    );
    if (separated && substantial) return { axis: axis.name, chunks };
  }
  return { axis: axis.name, chunks: [sorted] };
}

const licenceCheck = (provenance) => {
  const src = provenance?.source;
  if (!GROUNDING_SOURCES.includes(src)) {
    throw new Error(
      `"${src}" is not a derivation-licensed grounding source — grounding may only be derived from `
        + `${GROUNDING_SOURCES.join(', ')} (ADR-0020 clause 2; viewable is not derivable)`,
    );
  }
  if (!DERIVATION_LICENSES.includes(provenance?.license)) {
    throw new Error(
      `licence "${provenance?.license}" does not permit derivation — expected one of `
        + DERIVATION_LICENSES.join(', '),
    );
  }
  if (!/^[0-9a-f]{64}$/.test(String(provenance?.sha256 || ''))) {
    throw new Error('grounding needs the sha256 of the raster it read — an unpinned harvest is unrepeatable');
  }
};

/**
 * Harvest one World's grounding from a raster.
 *
 * @param venue      the World's builder id
 * @param regions    from `regionsFromMap`
 * @param probe      `{ at(lng, lat) -> [r,g,b] | null }`
 * @param provenance the adapter's ledger row (`provenanceFor` + the raster sha256)
 * @returns the grounding section of that World's reference profile
 * @throws if the source, its licence or its pin will not carry a derivation
 */
export function harvestGrounding({ venue, regions, probe, provenance, perRegion = PER_REGION }) {
  licenceCheck(provenance);

  const byClass = new Map();
  for (const region of regions || []) {
    if (!GROUNDING_CLASSES.includes(region.cls)) continue;
    const colors = [];
    for (const [lng, lat] of samplePointsFor(region, perRegion)) {
      const rgb = probe.at(lng, lat);
      if (rgb) colors.push(rgb);
    }
    if (!colors.length) continue;
    const bucket = byClass.get(region.cls) || { colors: [], regions: [] };
    bucket.colors.push(...colors);
    const rgb = medianColor(colors);
    bucket.regions.push({ key: region.key, samples: colors.length, rgb, lab: rgbToLab(rgb) });
    byClass.set(region.cls, bucket);
  }

  const total = [...byClass.values()].reduce((s, b) => s + b.colors.length, 0);
  const measured = [...byClass.entries()].map(([cls, bucket]) => ({
    cls,
    bucket,
    rgb: medianColor(bucket.colors),
    lab: rgbToLab(medianColor(bucket.colors)),
    share: bucket.colors.length / (total || 1),
  }));

  // The World's own centre of gravity. Subtracting it is what turns measured
  // colour into a relationship: two captures of the same park in different
  // light agree here and disagree on the raw medians.
  const mean = AXES.map((_, i) => measured.reduce((s, m) => s + m.share * m.lab[i], 0));
  const relative = (lab) => Object.fromEntries(AXES.map((name, i) => [name, lab[i] - mean[i]]));

  const classes = {};
  for (const m of measured) {
    classes[m.cls] = {
      sampleShare: m.share,
      samples: m.bucket.colors.length,
      ...relative(m.lab),
      observed: hex(m.rgb),
    };
  }

  const order = Object.fromEntries(AXES.map((name) => [
    name,
    [...measured].sort((a, b) => (classes[a.cls][name] - classes[b.cls][name]) || (a.cls < b.cls ? -1 : 1))
      .map((m) => m.cls),
  ]));

  const contrasts = [];
  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const [a, b] = [measured[i], measured[j]].sort((x, y) => (x.cls < y.cls ? -1 : 1));
      contrasts.push({ a: a.cls, b: b.cls, deltaE: deltaE(a.rgb, b.rgb) });
    }
  }
  contrasts.sort((x, y) => y.deltaE - x.deltaE || (x.a < y.a ? -1 : 1));

  // A harvest that measured nothing must fail rather than ship. Both halves
  // are real: big-kahunas' best NAIP frame is nodata over the park (no ground
  // read at all), and a probe that hands back one colour everywhere would
  // otherwise produce a record that passes every other wall in this file.
  if (!measured.length) {
    throw new Error(`no usable ground was read for ${venue} — every sample came back empty`);
  }
  const widest = contrasts[0]?.deltaE ?? 0;
  if (measured.length > 1 && widest < MIN_WORLD_CONTRAST) {
    throw new Error(
      `this frame told this harvest nothing about ${venue}: its widest contrast across `
        + `${measured.length} classes is ΔE ${widest.toFixed(2)}, under ${MIN_WORLD_CONTRAST}`,
    );
  }

  const groups = {};
  for (const m of measured) {
    const { axis, chunks } = splitIntoGroups(m.bucket.regions);
    groups[m.cls] = {
      axis,
      groups: chunks.map((chunk, rank) => {
        const samples = chunk.reduce((s, r) => s + r.samples, 0);
        const lab = AXES.map((_, i) => chunk.reduce((s, r) => s + r.lab[i] * r.samples, 0) / samples);
        return {
          rank,
          sampleShare: samples / m.bucket.colors.length,
          samples,
          ...relative(lab),
          observed: hex(medianColor(chunk.map((r) => r.rgb))),
          members: chunk.map((r) => r.key),
        };
      }),
    };
  }

  return {
    version: 1,
    venue,
    bands: [...GROUNDING_BANDS],
    source: {
      source: provenance.source,
      tile: provenance.tile ?? null,
      captured: provenance.captured ?? null,
      gsd: provenance.gsd ?? null,
      license: provenance.license,
      attribution: provenance.attribution ?? null,
      sha256: provenance.sha256,
    },
    classes,
    order,
    contrasts,
    groups,
  };
}
