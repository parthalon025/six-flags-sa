#!/usr/bin/env node
/** footprint-fusion — polygon evidence fusion for footprint geometry. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { iouOf, fuseFootprints } from '../../packages/venue-builder/lib/footprint-fusion.mjs';

const PASS = [];
const FAIL = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\nfootprint-fusion suite\n');

const square = (x, y, size = 1) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
});

// Two unit squares offset by 0.5 overlap exactly a quarter of each — IoU = 0.25/1.75 ≈ 0.143
const A = square(0, 0);
const B_PARTIAL = square(0.5, 0.5);
const C_IDENTICAL = square(0, 0);
const D_FAR = square(100, 100);

check('iouOf is 1 for identical polygons', () => {
  assert.equal(iouOf(A, C_IDENTICAL), 1);
});

check('iouOf is 0 for non-overlapping polygons', () => {
  assert.equal(iouOf(A, D_FAR), 0);
});

check('iouOf is between 0 and 1 for a partial overlap, matching the geometry', () => {
  const iou = iouOf(A, B_PARTIAL);
  // Planar: intersection = 0.5×0.5 = 0.25, union = 1 + 1 - 0.25 = 1.75 → ≈0.1429.
  // turf's area() is geodesic (real m² on the sphere), not planar, so treating
  // these coordinates as degrees introduces a small, expected distortion —
  // tolerance is loose on purpose, this only needs to prove the ratio is right.
  assert.ok(Math.abs(iou - 0.25 / 1.75) < 1e-3);
});

check('fuseFootprints with no candidates returns the unknown band', () => {
  const r = fuseFootprints([]);
  assert.equal(r.geometry, null);
  assert.equal(r.band, 'unknown');
  assert.equal(r.score, 0);
});

check('fuseFootprints drops candidates from unknown sources', () => {
  const r = fuseFootprints([{ source: 'not_a_real_source', geometry: A }]);
  assert.equal(r.geometry, null);
});

check('single-source, single-candidate publishes at that source alone', () => {
  const r = fuseFootprints([{ source: 'osm_footprint', geometry: A }]);
  assert.deepEqual(r.geometry, A);
  assert.equal(r.score, 4); // osm_footprint weight
  assert.equal(r.sources.length, 1);
  assert.equal(r.conflict, false);
});

check('anchor wins outright — the published geometry is never an average of two sources', () => {
  // osm_footprint (4) outranks cv_segmentation (3): the OSM square publishes
  // as-is, not blended with the Overture square that overlaps it.
  const r = fuseFootprints([
    { source: 'osm_footprint', geometry: A },
    { source: 'cv_segmentation', geometry: B_PARTIAL },
  ]);
  assert.deepEqual(r.geometry, A);
  assert.notDeepEqual(r.geometry, B_PARTIAL);
});

check('agreement adds up: two corroborating sources score higher than the anchor alone', () => {
  const r = fuseFootprints([
    { source: 'osm_footprint', geometry: A },
    { source: 'cv_segmentation', geometry: C_IDENTICAL }, // identical footprint, IoU=1 ≥ default 0.5
  ]);
  assert.equal(r.score, 4 + 3); // osm_footprint + cv_segmentation
  assert.deepEqual(r.sources, ['cv_segmentation', 'osm_footprint']);
  assert.equal(r.dissent.length, 0);
});

check('a low-IoU overlap from a lighter source is dissent, not agreement, and does not sink the score', () => {
  const r = fuseFootprints([
    { source: 'osm_footprint', geometry: A }, // weight 4
    { source: 'cv_detection', geometry: B_PARTIAL }, // weight 2, IoU ≈ 0.143 < 0.5 default threshold
  ]);
  assert.deepEqual(r.geometry, A);
  assert.equal(r.score, 4); // only the anchor counts — the weaker, non-agreeing source doesn't add
  assert.equal(r.conflict, false); // outranked, not a real conflict
  assert.equal(r.dissent.length, 1);
  assert.equal(r.dissent[0].source, 'cv_detection');
});

check('a true conflict is two EQUAL-weight sources whose footprints materially disagree', () => {
  const r = fuseFootprints([
    { source: 'osm_footprint', geometry: A }, // weight 4
    { source: 'aerial', geometry: B_PARTIAL }, // weight 4, same standing, low IoU
  ]);
  assert.equal(r.conflict, true);
  assert.equal(r.score, 4); // capped at the anchor's own weight, never averaged
});

check('non-overlapping candidates come back as unclustered, not dissent', () => {
  const r = fuseFootprints([
    { source: 'osm_footprint', geometry: A },
    { source: 'cv_segmentation', geometry: D_FAR }, // a genuinely different structure
  ]);
  assert.equal(r.dissent.length, 0);
  assert.equal(r.unclustered.length, 1);
  assert.equal(r.unclustered[0].source, 'cv_segmentation');
});

check('same-source overlapping polygons are reconciled via union before cross-source fusion', () => {
  // Two OSM ways for one structure (wall + roof), overlapping — the "one
  // ride, four mapped lanes" problem, at the footprint level.
  const r = fuseFootprints([
    { source: 'osm_footprint', geometry: A },
    { source: 'osm_footprint', geometry: B_PARTIAL },
  ]);
  // Reconciled into ONE osm_footprint candidate — not double-counted as two
  // agreeing sources (there's only one source here).
  assert.equal(r.sources.length, 1);
  assert.equal(r.score, 4);
  assert.equal(r.geometry.type, 'Polygon');
  // The union covers strictly more area than either input square alone.
  const coords = r.geometry.coordinates[0];
  assert.ok(coords.length > 5); // A/B_PARTIAL alone are 5-point closed rings; the union isn't
});

check('same-source dedup cascades across a chain of 3+ overlapping polygons', () => {
  // A overlaps B, B overlaps C, but A and C do NOT overlap directly — proves
  // the merge restarts its scan on the updated array rather than only
  // catching pairwise overlaps in a single pass.
  const chainA = square(0, 0);
  const chainB = square(0.5, 0.5);
  const chainC = square(1, 1);
  assert.equal(iouOf(chainA, chainC), 0); // confirms the "not directly overlapping" premise
  const r = fuseFootprints([
    { source: 'osm_footprint', geometry: chainA },
    { source: 'osm_footprint', geometry: chainB },
    { source: 'osm_footprint', geometry: chainC },
  ]);
  assert.equal(r.sources.length, 1); // all three reconciled into one osm_footprint candidate
  assert.equal(r.score, 4);
  assert.equal(r.unclustered.length, 0);
});

check('per-feature-type IoU threshold overrides the 0.5 default', () => {
  const candidates = [
    { source: 'osm_footprint', geometry: A, featureType: 'queue_canopy' },
    { source: 'cv_segmentation', geometry: B_PARTIAL, featureType: 'queue_canopy' }, // IoU ≈ 0.143
  ];
  const strict = fuseFootprints(candidates, { iouThresholds: { queue_canopy: 0.5 } });
  assert.equal(strict.sources.length, 1); // below 0.5 → dissent, not agreement

  const lenient = fuseFootprints(candidates, { iouThresholds: { queue_canopy: 0.1 } });
  assert.equal(lenient.sources.length, 2); // 0.143 ≥ 0.1 → agreement
  assert.equal(lenient.score, 4 + 3);
});

check('publish threshold reuses evidence.mjs BANDS unchanged — moderate (7+) is the bar', () => {
  const belowBar = fuseFootprints([{ source: 'cv_detection', geometry: A }]); // weight 2 alone
  assert.equal(belowBar.band, 'unknown'); // 2 < 4, doesn't even clear "low"

  const atBar = fuseFootprints([
    { source: 'osm_footprint', geometry: A }, // 4
    { source: 'cv_segmentation', geometry: C_IDENTICAL }, // 3
  ]);
  assert.equal(atBar.score, 7);
  assert.equal(atBar.band, 'moderate');
});

// Live proof against the real Overture footprints fetched for Cedar Point
// this session (#497). No second polygon source exists yet to conflate
// against real Overture data (that's exactly what this proposal's "If
// accepted" section said would gate full implementation) — so each building
// is paired with a synthetic near-duplicate of itself (nudged a few
// centimetres) specifically so iouOf()/@turf's intersect+union actually run
// against real, irregular, multi-ring geometry, not just the single-
// candidate identity path. A single-candidate call alone would never reach
// intersect/union at all and would only prove the pass-through works.
check('handles real Overture building geometry from Cedar Point, exercising IoU against it', () => {
  const cache = JSON.parse(
    readFileSync(
      new URL('../../packages/venue-builder/data/venues/cedar-point/overture-buildings-cache.json', import.meta.url),
      'utf8',
    ),
  );
  const nudge = (geometry) => {
    const shift = 0.0000005; // ~5cm — enough to be a distinct ring, not enough to drop the overlap
    const shiftRing = (ring) => ring.map(([x, y]) => [x + shift, y + shift]);
    if (geometry.type === 'Polygon') {
      return { type: 'Polygon', coordinates: geometry.coordinates.map(shiftRing) };
    }
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(shiftRing)) };
  };

  const sample = cache.buildings.slice(0, 25);
  let exercisedIou = 0;
  for (const b of sample) {
    const r = fuseFootprints([
      { source: 'osm_footprint', geometry: b.geometry_json },
      { source: 'cv_segmentation', geometry: nudge(b.geometry_json) },
    ]);
    assert.equal(r.geometry, b.geometry_json); // anchor (osm_footprint, weight 4) wins outright
    assert.ok(r.score >= 4);
    if (r.sources.includes('cv_segmentation') || r.dissent.length || r.unclustered.length) exercisedIou += 1;
  }
  // Every real building's near-duplicate must land in agrees/dissent/unclustered —
  // i.e. iouOf actually ran and returned a real, non-throwing verdict for all 25.
  assert.equal(exercisedIou, sample.length);
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
