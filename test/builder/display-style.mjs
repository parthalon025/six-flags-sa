#!/usr/bin/env node
/**
 * Style contract — truth-derived sampling holds bakes to their profiles.
 * All pure: a synthetic model and fabricated samples, no Chromium.
 *
 *   node test/builder/display-style.mjs
 */
import assert from 'node:assert/strict';

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\nstyle contract\n');

const {
  stylePoints, certifyStyleContract, crossRotationCoverageRow, harvestProfileDraft,
  bandGeneralizationRow, bandNestingRow,
  deltaE, hexToRgb, signature,
} = await import('../../packages/venue-builder/lib/display-style-contract.mjs');
const { bandGeneralization } = await import('../../packages/venue-builder/lib/display-bake.mjs');

// A 12x12 synthetic world: outside frame, ground floor, quadrant patches of
// grass / water / lot / road, one building, one track, two badges.
const T = { outside: 0, ground: 1, grass: 2, wood: 3, water: 4, lot: 5, road: 6, service: 7 };
const COLS = 12;
const ROWS = 12;
const cells = new Array(COLS * ROWS).fill(T.ground);
for (let y = 0; y < ROWS; y += 1) {
  for (let x = 0; x < COLS; x += 1) {
    if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) cells[y * COLS + x] = T.outside;
  }
}
const patch = (x0, y0, x1, y1, t) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) cells[y * COLS + x] = t;
};
// quadrant patches leave a 2-wide ground cross so every class has interior cells
patch(1, 1, 4, 4, T.grass);
patch(7, 1, 10, 4, T.road);
patch(1, 7, 4, 10, T.lot);
patch(7, 7, 10, 10, T.water);
const model = {
  cols: COLS,
  rows: ROWS,
  cells,
  terrains: { 0: 'outside', 1: 'ground', 2: 'grass', 3: 'wood', 4: 'water', 5: 'lot', 6: 'road', 7: 'service' },
  buildings: [{ ring: [[2, 2], [4, 2], [4, 4], [2, 4]], roof: 0 }],
  tracks: [{ kind: 'slide', idx: 0, pts: [[7, 2], [8, 2], [9, 3], [10, 3]] }],
  roads: [{ kind: 'path', pts: [[6, 2], [7, 2], [8, 3], [9, 3]] }],
  badges: [{ kind: 'gate', x: 3, y: 8 }, { kind: 'food', x: 8, y: 8 }],
};

const PALETTE = {
  outside: '#6B4E9B', ground: '#EBD9A4', grass: '#8CBE74', water: '#4FB8D4',
  lot: '#B3AC9D', road: '#5A5F6E', structure: '#CFC2A8', badge: '#D84B4B',
  track: '#F4C542', trackedge: '#FFFFFF', roadline: '#D3D7DE',
};

const paint = (points, overrides = {}) => points.map((p) => {
  const key = overrides[p.cls] !== undefined ? null : p.cls;
  const hex = key ? PALETTE[key] : overrides[p.cls];
  return [...hexToRgb(hex ?? PALETTE[p.cls]), 255];
});

const profile = {
  version: 1,
  id: 'test-profile',
  kit: 'test-kit',
  style: 'test',
  colorFamilies: {
    ground: { anchor: '#EBD9A4', deltaE: 10 },
    grass: { anchor: '#8CBE74', deltaE: 10 },
    water: { anchor: '#4FB8D4', deltaE: 10 },
    lot: { anchor: '#B3AC9D', deltaE: 10 },
    road: { anchor: '#5A5F6E', deltaE: 10 },
    outside: { anchor: '#6B4E9B', deltaE: 10 },
    structure: { anchor: '#CFC2A8', deltaE: 12 },
    badge: { anchor: '#D84B4B', deltaE: 10 },
  },
  roads: { vsGround: { minDeltaE: 15, polarity: 'darker' } },
  ground: { outsideVsInside: { minDeltaE: 15 }, waterVsVegetation: { minDeltaE: 15 } },
  structures: { buildingStyle: 'drop', coasterVsUnderlay: { minDeltaE: 10 } },
  hierarchy: { annotationOnTop: true, oneBadgePerPoi: true },
  agentReview: [{ key: 'style_reference_resemblance', prompt: 'same genre as the reference?' }],
};
const kit = { id: 'test-kit' };

await check('stylePoints is deterministic, interior-only, class-correct', () => {
  const a = stylePoints(model, { perClass: 8 });
  const b = stylePoints(model, { perClass: 8 });
  assert.deepEqual(a, b, 'same plan every run');
  const at = (x, y) => model.cells[Math.floor(y) * COLS + Math.floor(x)];
  for (const p of a.filter((q) => q.cls in T)) {
    assert.equal(model.terrains[at(p.x, p.y)], p.cls, `point class mismatch at ${p.x},${p.y}`);
  }
  const grassCount = a.filter((p) => p.cls === 'grass').length;
  assert.ok(grassCount > 0 && grassCount <= 8, 'perClass respected');
  assert.ok(a.some((p) => p.cls === 'structure' && p.mode === 'interior'), 'building interior sampled');
  assert.ok(a.some((p) => p.cls === 'track'), 'track sampled');
  assert.ok(a.some((p) => p.cls === 'badge'), 'badge sampled');
  return true;
});

await check('a faithful bake certifies; palette drift fails with the worst class named', () => {
  const points = stylePoints(model, { perClass: 8 });
  const good = certifyStyleContract({ model, points, samples: paint(points), profile, kit });
  assert.equal(good.certified, true, JSON.stringify(good.checks.filter((c) => !c.pass)));
  const drifted = certifyStyleContract({
    model, points, samples: paint(points, { water: '#88CC88' }), profile, kit,
  });
  const palette = drifted.checks.find((c) => c.key === 'style_terrain_palette');
  assert.equal(palette.pass, false);
  assert.match(palette.evidence, /water/);
  return true;
});

// Issue #518, second half: style_terrain_palette only judges classes that
// SURVIVED to the render (medians) — a bake that lost a class entirely (the
// water-erases-the-park bug) sampled cleanly in-family on the three classes
// left and certified. style_terrain_coverage compares against what the
// venue's own truth (map.json) implies instead of what happened to render.
await check('style_terrain_coverage: truth implies a class the render dropped (issue #518 shape)', () => {
  const points = stylePoints(model, { perClass: 8 });
  // Simulate the exact symptom: only water and road survive to the render
  // (plus the non-terrain structure/track/badge samples), even though
  // truth carries grass, wood and a parking lot too.
  const brokenPoints = points.filter((p) => p.cls === 'water' || p.cls === 'road' || !(p.cls in T));
  const brokenSamples = paint(brokenPoints);
  const truthMap = {
    grass: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    wood: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    parking: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    water: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    path: [{ r: [[0, 0], [1, 1]] }],
  };
  const broken = certifyStyleContract({
    model, points: brokenPoints, samples: brokenSamples, profile, kit, map: truthMap,
  });
  const coverage = broken.checks.find((c) => c.key === 'style_terrain_coverage');
  assert.ok(coverage, 'style_terrain_coverage row must ride when a truth map is given');
  assert.equal(coverage.pass, false);
  assert.match(coverage.evidence, /grass/);
  assert.match(coverage.evidence, /wood/);
  assert.match(coverage.evidence, /lot/);
  assert.equal(broken.certified, false, 'a bake missing a truth-implied terrain class must not certify');
  // The stale, pre-fix behavior: style_terrain_palette alone stays green —
  // every class that DID render (water, road) is in-family. Coverage is
  // the row that actually catches the regression.
  const palette = broken.checks.find((c) => c.key === 'style_terrain_palette');
  assert.equal(palette.pass, true, 'palette alone cannot see a class that never rendered — that is the bug');
  return true;
});

await check('style_terrain_coverage passes when the bake covers everything truth implies; is absent without a map', () => {
  const points = stylePoints(model, { perClass: 8 });
  const samples = paint(points);
  const truthMap = {
    grass: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    parking: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    water: [{ r: [[0, 0], [1, 0], [1, 1]] }],
    path: [{ r: [[0, 0], [1, 1]] }],
  };
  const covered = certifyStyleContract({ model, points, samples, profile, kit, map: truthMap });
  const coverage = covered.checks.find((c) => c.key === 'style_terrain_coverage');
  assert.equal(coverage.pass, true, coverage.evidence);
  assert.equal(covered.certified, true, JSON.stringify(covered.checks.filter((c) => !c.pass)));
  const noMap = certifyStyleContract({ model, points, samples, profile, kit });
  assert.ok(!noMap.checks.some((c) => c.key === 'style_terrain_coverage'), 'no map given, no row — never a silent pass either way');
  return true;
});

await check('road-hierarchy polarity flips fail', () => {
  const points = stylePoints(model, { perClass: 8 });
  const light = certifyStyleContract({
    model,
    points,
    samples: paint(points, { road: '#F8F4E4' }),
    profile: { ...profile, colorFamilies: { ...profile.colorFamilies, road: { anchor: '#F8F4E4', deltaE: 10 } } },
    kit,
  });
  assert.equal(light.checks.find((c) => c.key === 'style_road_hierarchy').pass, false, 'lighter-than-ground road with polarity darker');
  return true;
});

await check('an under-painted badge fails annotation-on-top', () => {
  const points = stylePoints(model, { perClass: 8 });
  const buried = certifyStyleContract({
    model, points, samples: paint(points, { badge: PALETTE.lot }), profile, kit,
  });
  assert.equal(buried.checks.find((c) => c.key === 'style_annotation_on_top').pass, false);
  return true;
});

await check('near-monochrome styles certify via the centerline rule', () => {
  const paper = '#FBF7EC';
  const inkProfile = {
    ...profile,
    colorFamilies: {
      ...profile.colorFamilies,
      ground: { anchor: paper, deltaE: 8 },
      road: { anchor: paper, members: ['#39567E'], deltaE: 8 },
    },
    roads: { centerlineVsPaper: { minDeltaE: 25 } },
    ground: { outsideVsInside: { minDeltaE: 2 }, waterVsVegetation: { minDeltaE: 2 } },
  };
  const points = stylePoints(model, { perClass: 8 });
  const res = certifyStyleContract({
    model,
    points,
    samples: paint(points, { road: paper, ground: paper, roadline: '#39567E', outside: '#EFEAD9' }),
    profile: { ...inkProfile, colorFamilies: { ...inkProfile.colorFamilies, outside: { anchor: '#EFEAD9', deltaE: 8 } } },
    kit,
  });
  const road = res.checks.find((c) => c.key === 'style_road_hierarchy');
  assert.equal(road.pass, true, road.evidence);
  return true;
});

await check('agent items ride review, never checks; certified ignores them', () => {
  const points = stylePoints(model, { perClass: 8 });
  const res = certifyStyleContract({ model, points, samples: paint(points), profile, kit });
  assert.equal(res.review.length, 1);
  assert.equal(res.review[0].key, 'style_reference_resemblance');
  assert.ok(!res.checks.some((c) => c.key === 'style_reference_resemblance'));
  return true;
});

await check('the determinism row demands identical rerender pixels', () => {
  const points = stylePoints(model, { perClass: 8 });
  const samples = paint(points);
  const same = certifyStyleContract({ model, points, samples, rerunSamples: paint(points), profile, kit });
  assert.equal(same.checks.find((c) => c.key === 'style_bake_deterministic').pass, true);
  const drifted = certifyStyleContract({
    model, points, samples, rerunSamples: paint(points, { water: '#88CC88' }), profile, kit,
  });
  assert.equal(drifted.checks.find((c) => c.key === 'style_bake_deterministic').pass, false);
  assert.equal(drifted.certified, false, 'a nondeterministic bake never certifies');
  const absent = certifyStyleContract({ model, points, samples, profile, kit });
  assert.ok(!absent.checks.some((c) => c.key === 'style_bake_deterministic'), 'no rerun, no row');
  return true;
});

await check('cross-kit distinctness compares this invocation, skips explicitly', () => {
  const points = stylePoints(model, { perClass: 8 });
  const samples = paint(points);
  const mySig = signature(samples);
  const twin = certifyStyleContract({
    model, points, samples, siblings: [{ kit: 'copycat', signature: mySig }], profile, kit,
  });
  const twinRow = twin.checks.find((c) => c.key === 'style_cross_kit_distinct');
  assert.equal(twinRow.pass, false);
  assert.match(twinRow.evidence, /copycat/);
  const distinct = certifyStyleContract({
    model, points, samples, siblings: [{ kit: 'other', signature: 'ffffffff' }], profile, kit,
  });
  assert.equal(distinct.checks.find((c) => c.key === 'style_cross_kit_distinct').pass, true);
  const alone = certifyStyleContract({ model, points, samples, siblings: [], profile, kit });
  const aloneRow = alone.checks.find((c) => c.key === 'style_cross_kit_distinct');
  assert.equal(aloneRow.pass, true);
  assert.match(aloneRow.evidence, /no sibling kits/, 'skip is recorded, never silent');
  return true;
});

// ADR-0016 world tier: badges are truth POIs projected into the model; the
// app places the world image on the model's own bounds. The row proves the
// two projections agree (image-on-truth-bounds is exact for painted
// features) and that the kit's declared stroke displacement fits the budget.
await check('style_world_geo: truth anchors project through the world bounds; displacement is budgeted', () => {
  const bounds = { west: 0, south: 0, east: 0.012, north: 0.012 };
  const named = {
    ...model,
    bounds,
    badges: [{ kind: 'gate', name: 'Main Gate', x: 3, y: 8 }, { kind: 'food', name: 'Fries', x: 8, y: 8 }],
  };
  // POIs at exactly the lat/lng whose bounds-projection is the badge cell.
  const pois = [
    { c: 'gate', n: 'Main Gate', lng: 0.003, lat: 0.004 },
    { c: 'food', n: 'Fries', lng: 0.008, lat: 0.004 },
    { c: 'coaster', n: 'Not a badge', lng: 0.001, lat: 0.001 },
  ];
  const points = stylePoints(named, { perClass: 8 });
  const good = certifyStyleContract({ model: named, points, samples: paint(points), profile, kit, pois });
  const row = good.checks.find((c) => c.key === 'style_world_geo');
  assert.ok(row, 'pois + bounds must produce the geo row');
  assert.equal(row.pass, true, row.evidence);
  assert.match(row.evidence, /2 truth anchor/);
  // A badge that no longer derives from truth fails the row.
  const moved = { ...named, badges: [{ ...named.badges[0], x: 3.6 }, named.badges[1]] };
  const movedPoints = stylePoints(moved, { perClass: 8 });
  const bad = certifyStyleContract({ model: moved, points: movedPoints, samples: paint(movedPoints), profile, kit, pois });
  assert.equal(bad.checks.find((c) => c.key === 'style_world_geo').pass, false);
  // A kit declaring displacement past the budget fails even with true anchors.
  const wobbly = certifyStyleContract({
    model: named, points, samples: paint(points), profile, pois,
    kit: { id: 'test-kit', strokes: { displacement: { amplitude: 99 } } },
  });
  assert.equal(wobbly.checks.find((c) => c.key === 'style_world_geo').pass, false);
  // No pois (or no bounds): no row — the flat certification set is unchanged.
  const absent = certifyStyleContract({ model, points: stylePoints(model, { perClass: 8 }), samples: paint(stylePoints(model, { perClass: 8 })), profile, kit });
  assert.ok(!absent.checks.some((c) => c.key === 'style_world_geo'));
  return true;
});

/* Issue #521: per-rotation occlusion starvation withdraws-and-discloses (the
   per-rotation hard-fail was rejected — geometry legitimately starves classes
   at some cameras). The sweep-level rule is where it fails: a class withdrawn
   at EVERY rotation was never held to the contract anywhere. */
const starvedSkip = (classes) => [{
  key: 'occlusion_starved',
  reason: 'fixture',
  count: 10,
  byClass: Object.fromEntries(classes.map((cls) => [cls, { kept: 1, culled: 9 }])),
}];

await check('cross-rotation: a class starved at every rotation fails the sweep, named', () => {
  const row = crossRotationCoverageRow([
    { rotation: 0, skips: starvedSkip(['road', 'water']) },
    { rotation: 1, skips: starvedSkip(['road']) },
    { rotation: 2, skips: starvedSkip(['road', 'water']) },
    { rotation: 3, skips: starvedSkip(['road']) },
  ]);
  assert.equal(row.key, 'style_occlusion_cross_rotation');
  assert.equal(row.pass, false);
  assert.match(row.evidence, /\broad\b/, 'the never-covered class is named');
  assert.ok(!/water[^ ]* starved at every/.test(row.evidence), 'water certifies at r1/r3');
  return true;
});

await check('cross-rotation: starved at some rotations but surviving one passes with disclosure', () => {
  const row = crossRotationCoverageRow([
    { rotation: 0, skips: starvedSkip(['road']) },
    { rotation: 1, skips: [] },
    { rotation: 2, skips: starvedSkip(['road']) },
    { rotation: 3, skips: [] },
  ]);
  assert.equal(row.pass, true, row.evidence);
  assert.match(row.evidence, /road withdrawn at r0,r2 only/, 'partial starvation stays on the record');
  const clean = crossRotationCoverageRow([
    { rotation: 0, skips: [] },
    { rotation: 2, skips: [] },
  ]);
  assert.equal(clean.pass, true);
  assert.match(clean.evidence, /no class withdrawn/);
  return true;
});

await check('cross-rotation: one rotation is not a sweep; legacy certs without skips read as nothing withdrawn', () => {
  const single = crossRotationCoverageRow([{ rotation: 0, skips: starvedSkip(['road']) }]);
  assert.equal(single.pass, true, 'demanding sweep coverage of one rotation would be the rejected per-rotation hard-fail');
  assert.match(single.evidence, /not a sweep/);
  const legacy = crossRotationCoverageRow([{ rotation: 0 }, { rotation: 2 }]);
  assert.equal(legacy.pass, true, legacy.evidence);
  return true;
});

await check('iso certs carry their skips structurally for the sweep aggregator', () => {
  const points = stylePoints(model, { perClass: 8 });
  const skips = starvedSkip(['road']);
  const cert = certifyStyleContract({
    model, points, samples: paint(points), profile, kit, target: 'iso', skips,
  });
  assert.deepEqual(cert.skips, skips, 'skips ride the cert JSON, not just evidence strings');
  const flat = certifyStyleContract({ model, points, samples: paint(points), profile, kit });
  assert.ok(!('skips' in flat), 'flat certs stay byte-identical to before');
  return true;
});

/* ------------------------------------ ADR-0019 clause 1 / ADR-0021 clause 3:
 * band-aware rows. A cert that does not say which band it covers cannot hold a
 * band to its own content rule, and the three bands share one cell grid, so
 * "this is the overview" is the only thing separating a generalized bake from
 * an ungeneralized one. Both rows below read the MODEL and re-derive the policy
 * from the band table — they never take the bake's own stamp as the answer. */

const bandModel = (band, over = {}) => ({
  ...model,
  tileMetres: 2.4,
  trees: [{ x: 3.5, y: 3.5, big: true }, { x: 5.25, y: 6.5, big: false }],
  lotRows: [{ x: 2.5, y: 8.5, dx: 1, dy: 0 }],
  band,
  generalization: bandGeneralization(band, { tileMetres: 2.4 }),
  ...over,
});
const generalized = (band) => {
  const m = bandModel(band);
  const policy = m.generalization;
  for (const kind of policy.drops) m[kind] = [];
  if (policy.badgeKinds) m.badges = m.badges.filter((b) => policy.badgeKinds.includes(b.kind));
  return m;
};

await check('style_band_generalization: a band carrying marks it cannot draw fails, named', () => {
  const ok = bandGeneralizationRow(generalized('overview'));
  assert.equal(ok.key, 'style_band_generalization');
  assert.equal(ok.pass, true, ok.evidence);
  assert.match(ok.evidence, /overview/, 'the row says which band it judged');
  // The regression it exists for: the generalization pass silently not running.
  const ungeneralized = bandModel('overview');
  const bad = bandGeneralizationRow(ungeneralized);
  assert.equal(bad.pass, false);
  assert.match(bad.evidence, /trees/, 'the marks that should not be here are named');
  assert.match(bad.evidence, /lotRows/);
  // Landmark thinning is the other half, and fails on its own.
  const pinned = generalized('overview');
  pinned.badges = [...pinned.badges, { kind: 'food', x: 8, y: 8 }];
  const overPinned = bandGeneralizationRow(pinned);
  assert.equal(overPinned.pass, false);
  assert.match(overPinned.evidence, /food/, 'the kind that should have thinned is named');
  return true;
});

await check('style_band_generalization: mid and close draw everything; a stale stamp fails', () => {
  for (const band of ['mid', 'close']) {
    const row = bandGeneralizationRow(generalized(band));
    assert.equal(row.pass, true, `${band}: ${row.evidence}`);
    assert.equal(generalized(band).trees.length, 2, `${band} keeps its trees`);
  }
  // A model stamped with one band's policy and labelled another's: the row
  // re-derives from the band table, so the disagreement surfaces rather than
  // the stamp being believed.
  const mislabelled = generalized('overview');
  mislabelled.generalization = bandGeneralization('mid', { tileMetres: 2.4 });
  const row = bandGeneralizationRow(mislabelled);
  assert.equal(row.pass, false);
  assert.match(row.evidence, /stamp|declared/i, 'the disagreement is what the evidence reports');
  return true;
});

await check('style_band_generalization: over-removal fails too — a kept kind that is not there', () => {
  // The failure the drops check cannot see, and the nesting row cannot either:
  // a band that removed a kind it was supposed to DRAW agrees with a stamp
  // saying it removed it, and the coarser band it nests in is missing the kind
  // as well, so no orphan turns up. Presence is asked of the venue's ground
  // rather than of the policy, because the policy is the thing lying.
  const mid = generalized('mid');
  assert.equal(bandGeneralizationRow(mid).pass, true, 'the fixture draws trees and aisle marks');
  const noTrees = bandGeneralizationRow({ ...mid, trees: [] });
  assert.equal(noTrees.pass, false, noTrees.evidence);
  assert.match(noTrees.evidence, /trees: none drawn/, noTrees.evidence);
  assert.match(noTrees.evidence, /grass/, 'the ground that should have grown them is the witness');
  const noAisles = bandGeneralizationRow({ ...mid, lotRows: [] });
  assert.equal(noAisles.pass, false, noAisles.evidence);
  assert.match(noAisles.evidence, /lotRows: none drawn/, noAisles.evidence);
  // ...and a venue with no such ground is not failed for having none: repaint
  // the lot patch as plain ground and an empty lotRows is simply the truth,
  // which is big-kahunas, a shipped venue with no car park at all.
  const noLot = { ...mid, lotRows: [], cells: mid.cells.map((c) => (c === T.lot ? T.ground : c)) };
  const paved = bandGeneralizationRow(noLot);
  assert.equal(paved.pass, true, paved.evidence);
  return true;
});

await check('style_band_removes_never_moves: a coarse mark with no twin in its child fails', () => {
  const fine = generalized('mid');
  const coarse = generalized('overview');
  const ok = bandNestingRow({ coarse, fine });
  assert.equal(ok.key, 'style_band_removes_never_moves');
  assert.equal(ok.pass, true, ok.evidence);
  assert.match(ok.evidence, /overview/);
  assert.match(ok.evidence, /mid/);
  // Moved, not removed: one pixel of drift in the one tier routing draws over.
  // Asked of mid-in-close, because those are the two bands ADR-0021 clause 3
  // holds to a position (≤ 1 px each); the case below is the one it exempts.
  const budgeted = { coarse: generalized('mid'), fine: generalized('close') };
  assert.equal(bandNestingRow(budgeted).pass, true, 'mid nests in close untouched');
  const nudged = { ...budgeted.coarse, badges: budgeted.coarse.badges.map((b) => ({ ...b, x: b.x + 1 })) };
  const moved = bandNestingRow({ coarse: nudged, fine: budgeted.fine });
  assert.equal(moved.pass, false);
  assert.match(moved.evidence, /badges/, 'the kind that moved is named');
  // Invented: a coarse band may only ever be a subset of its child.
  const invented = { ...coarse, buildings: [...coarse.buildings, { ring: [[1, 1], [2, 1], [2, 2]], roof: 0 }] };
  assert.equal(bandNestingRow({ coarse: invented, fine }).pass, false);
  // The grid itself: bands stack pixel-for-pixel, so a cell that moved or
  // reclassified between them is a seam the parent-band placeholder upscales.
  const regridded = bandNestingRow({ coarse, fine: { ...fine, cols: fine.cols + 1 } });
  assert.equal(regridded.pass, false);
  assert.match(regridded.evidence, /grid/, 'a band on a different grid says so');
  const reclassified = { ...fine, cells: fine.cells.map((c, i) => (i === 40 ? (c + 1) % 8 : c)) };
  const shifted = bandNestingRow({ coarse, fine: reclassified });
  assert.equal(shifted.pass, false);
  assert.match(shifted.evidence, /terrain: 1 cell/, 'the count of disagreeing cells is the evidence');
  // And a band with no coarser neighbour has nothing to nest in.
  const none = bandNestingRow({ coarse: null, fine: generalized('overview') });
  assert.equal(none.pass, true);
  assert.match(none.evidence, /coarsest|no parent/i);
  return true;
});

await check('style_band_removes_never_moves: overview may depart from Truth, but not invent', () => {
  // ADR-0021 clause 3's alignment budget is close ≤ 1 px, mid ≤ 1 px, and
  // "overview unconstrained because departing from Truth is that band's job".
  // So an overview mark is judged on what it IS, not where it sits — the row
  // must not demand of the coarsest band a bit-exact position the ADR
  // deliberately does not ask for.
  const fine = generalized('mid');
  const coarse = generalized('overview');
  const nudged = { ...coarse, badges: coarse.badges.map((b) => ({ ...b, x: b.x + 1, y: b.y + 3 })) };
  const drifted = bandNestingRow({ coarse: nudged, fine });
  assert.equal(drifted.pass, true, drifted.evidence);
  assert.match(drifted.claim, /unconstrained/, 'the row says which of the two rules it applied');
  // Invention is still invention, at every band: containment counts marks, so
  // a gate the mid band does not pin is one gate too many however it is placed.
  const invented = { ...coarse, badges: [...coarse.badges, { kind: 'gate', x: 9, y: 2 }] };
  const grew = bandNestingRow({ coarse: invented, fine });
  assert.equal(grew.pass, false, grew.evidence);
  assert.match(grew.evidence, /badges: 1 of 2/, grew.evidence);
  return true;
});

await check('a band bake certifies as that band; a band-less bake is unchanged', () => {
  const points = stylePoints(model, { perClass: 8 });
  const samples = paint(points);
  const banded = certifyStyleContract({
    model: generalized('overview'), points, samples, profile, kit,
  });
  assert.equal(banded.band, 'overview', 'the cert records which band it covers');
  assert.ok(banded.checks.some((c) => c.key === 'style_band_generalization'));
  // Every band cert carries both rows. At the coarsest band the nesting row is
  // a recorded decision rather than a missing row: a shrinking row set is how a
  // check disappears without anyone deciding it should.
  const coarsest = banded.checks.find((c) => c.key === 'style_band_removes_never_moves');
  assert.ok(coarsest, 'the coarsest band still carries the nesting row');
  assert.match(coarsest.evidence, /coarsest band/, coarsest.evidence);
  const flat = certifyStyleContract({ model, points, samples, profile, kit });
  assert.ok(!('band' in flat), 'an unbanded cert stays byte-identical to before');
  assert.ok(!flat.checks.some((c) => c.key.startsWith('style_band_')));
  // The nesting row rides along only when the caller has the coarser model.
  const nested = certifyStyleContract({
    model: generalized('mid'), points, samples, profile, kit, coarserModel: generalized('overview'),
  });
  assert.ok(nested.checks.some((c) => c.key === 'style_band_removes_never_moves'));
  return true;
});

await check('signature and harvest are stable and honest', () => {
  const points = stylePoints(model, { perClass: 8 });
  const samples = paint(points);
  assert.equal(signature(samples), signature(paint(points)), 'same pixels, same signature');
  assert.notEqual(signature(samples), signature(paint(points, { water: '#88CC88' })));
  const draft = harvestProfileDraft({ points, samples });
  assert.equal(draft.draft, true);
  assert.ok(deltaE(hexToRgb(draft.water.anchor), hexToRgb(PALETTE.water)) < 1, 'harvested anchor is the measured median');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
