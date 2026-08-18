/**
 * Polygon evidence fusion — the sibling `evidence.mjs` doesn't have.
 *
 * `evidence.mjs`'s `fuse()`/`pointOf()` answer "where is this entrance" from
 * point claims. This module answers the equivalent question for a
 * structure's footprint: given polygons from more than one source (an OSM
 * way, an Overture Maps footprint), which boundary actually publishes, and
 * how much do the other sources corroborate it?
 *
 * Ported from `evidence.mjs`'s design, not copied wholesale — see
 * docs/research/2026-08-18-footprint-conflation-proposal.md for the full
 * reasoning on where this follows the point-fusion philosophy and where it
 * deliberately diverges:
 *
 * - **The scored `WEIGHTS` table is reused as-is**, not a fixed vendor-tier
 *   order. `osm_footprint` (4) outranks `cv_segmentation` (3) — a mapper who
 *   traced the shape by hand outranks an ML model that looked at a pixel,
 *   for footprints exactly as it already does for entrances.
 * - **The heaviest source's boundary wins outright.** No cross-source
 *   attribute/geometry averaging on a match — that is the exact failure
 *   mode `evidence.mjs`'s own comments describe having already fixed once
 *   for points ("an average of a survey and a guess is a third thing that
 *   neither source supports").
 * - **No overlap is not dissent.** Two non-overlapping footprints most
 *   likely describe two different structures (a queue canopy standing next
 *   to, not on top of, a building) — they come back as `unclustered`
 *   candidates for the caller to fuse separately, not folded into one
 *   result's dissent list.
 * - **The IoU threshold is per feature type, not one global constant.**
 *   Ride/venue footprints are smaller and more irregular than typical urban
 *   buildings; every type defaults to Overture's own 0.5 until real venue
 *   data shows a type needs tuning.
 */

import { intersect } from '@turf/intersect';
import { union } from '@turf/union';
import { area } from '@turf/area';
import { WEIGHTS, BANDS, PUBLISH_AT, bandOf, atLeast } from './evidence.mjs';

export { BANDS, PUBLISH_AT, atLeast };

const DEFAULT_IOU_THRESHOLD = 0.5;

const asFeature = (geometry) => ({ type: 'Feature', properties: {}, geometry });
const pairFC = (a, b) => ({ type: 'FeatureCollection', features: [asFeature(a), asFeature(b)] });

/** Intersection-over-union of two GeoJSON polygon/multipolygon geometries. 0 when they don't overlap at all. */
export function iouOf(geomA, geomB) {
  const inter = intersect(pairFC(geomA, geomB));
  if (!inter) return 0;
  const uni = union(pairFC(geomA, geomB));
  const uniArea = area(uni);
  if (!uniArea) return 0;
  return area(inter) / uniArea;
}

const thresholdFor = (featureType, iouThresholds) => {
  if (!iouThresholds) return DEFAULT_IOU_THRESHOLD;
  return iouThresholds[featureType] ?? iouThresholds.default ?? DEFAULT_IOU_THRESHOLD;
};

/**
 * One source producing multiple overlapping polygons for a single structure
 * (a building drawn as separate wall/roof ways) — the polygon-evidence
 * version of "one ride, four mapped lanes" — gets reconciled *within* that
 * source, via union, before cross-source conflation ever runs.
 */
function dedupeSameSource(candidates) {
  const bySource = new Map();
  for (const c of candidates) {
    if (!bySource.has(c.source)) bySource.set(c.source, []);
    bySource.get(c.source).push(c);
  }

  const reconciled = [];
  for (const group of bySource.values()) {
    let merged = group;
    let mergedAny = true;
    while (mergedAny) {
      mergedAny = false;
      for (let i = 0; i < merged.length && !mergedAny; i++) {
        for (let j = i + 1; j < merged.length; j++) {
          if (iouOf(merged[i].geometry, merged[j].geometry) === 0) continue;
          const unioned = union(pairFC(merged[i].geometry, merged[j].geometry));
          // Keeps merged[i]'s non-geometry fields (date, featureType, ...) and
          // silently drops merged[j]'s — fine today since fuseFootprints never
          // surfaces `date` in its return value (same as evidence.mjs's fuse(),
          // which expects callers to run staleness() on the raw list, not a
          // reduced one). A future field that DOES need to survive a same-
          // source merge would need an explicit rule here, not this default.
          const combined = { ...merged[i], geometry: unioned.geometry };
          merged = [...merged.slice(0, i), combined, ...merged.slice(i + 1, j), ...merged.slice(j + 1)];
          mergedAny = true;
          break;
        }
      }
    }
    reconciled.push(...merged);
  }
  return reconciled;
}

/**
 * Fuse a structure's footprint evidence into one published boundary + score.
 *
 * @param {{source: string, geometry: object, date?: string, featureType?: string}[]} candidates
 * @param {{iouThresholds?: Record<string, number>}} [opts] iouThresholds is
 *   keyed by featureType (e.g. `building`, `queue_canopy`); an entry named
 *   `default` (or the DEFAULT_IOU_THRESHOLD constant) covers everything else.
 * @returns {{geometry: object|null, score: number, band: string, sources: string[], dissent: {source:string, iou:number}[], conflict: boolean, unclustered: object[]}}
 */
export function fuseFootprints(candidates = [], { iouThresholds } = {}) {
  const used = candidates.filter((c) => c.source in WEIGHTS && c.geometry);
  if (!used.length) {
    return { geometry: null, score: 0, band: 'unknown', sources: [], dissent: [], conflict: false, unclustered: [] };
  }

  const deduped = dedupeSameSource(used);
  const anchor = deduped.reduce((a, b) => (WEIGHTS[b.source] > WEIGHTS[a.source] ? b : a));
  const top = WEIGHTS[anchor.source];
  const threshold = thresholdFor(anchor.featureType, iouThresholds);

  const agrees = [];
  const dissent = [];
  const unclustered = [];
  for (const c of deduped) {
    if (c === anchor) {
      agrees.push(c);
      continue;
    }
    const iou = iouOf(anchor.geometry, c.geometry);
    if (iou === 0) {
      unclustered.push(c);
    } else if (iou >= threshold) {
      agrees.push(c);
    } else {
      dissent.push({ source: c.source, iou: Number(iou.toFixed(3)) });
    }
  }

  // A real conflict is two sources of equal standing whose footprints don't
  // agree — the same rule fuse() uses for points: being outranked by a
  // stronger source is not a conflict.
  const conflict = dissent.some((d) => WEIGHTS[d.source] >= top);
  const score = agrees.reduce((s, c) => s + WEIGHTS[c.source], 0);
  const finalScore = conflict ? top : score;

  return {
    geometry: anchor.geometry,
    score: finalScore,
    band: bandOf(finalScore),
    sources: agrees.map((c) => c.source).sort(),
    dissent: dissent.sort((a, b) => WEIGHTS[b.source] - WEIGHTS[a.source]),
    conflict,
    unclustered,
  };
}
