#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ISO_ROTATIONS,
  assembleIsoMeshes,
  buildingHeightM,
  buildingHitsLiftedTrack,
  buildingHitsTrack,
  depthKey,
  extrudeBuilding,
  isoInverse,
  isoLocal,
  liftCoaster,
  pickCoasterLines,
  pickWalkways,
  resolveIsoMapTemplate,
  stackIsoItems,
} from '../../packages/shared/isoWorld.js';

const a = isoLocal(10, 0);
assert.equal(a.x, 10);
assert.equal(a.y, 5);

const b = isoLocal(0, 10);
assert.equal(b.x, -10);
assert.equal(b.y, 5);

const back = isoInverse(a.x, a.y);
assert.ok(Math.abs(back.dx - 10) < 1e-9);
assert.ok(Math.abs(back.dy) < 1e-9);

const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const box = extrudeBuilding(square, 8);
assert.equal(box.walls.length, 4);
assert.ok(box.roof.d.includes('M'));
assert.ok(box.walls.every((w) => w.d.includes('Z')));
assert.equal(typeof box.depth, 'number');
assert.ok(box.roof.d.includes('L'));
assert.ok(box.foot.d.startsWith('M0.00 0.00'), 'foot is iso-local, not double-projected');
assert.ok(box.roof.d.startsWith('M0.00 8.00'), 'roof lifts iso y by height metres');

const stall = buildingHeightM([
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]);
const hall = buildingHeightM([
  [0, 0],
  [40, 0],
  [40, 40],
  [0, 40],
]);
assert.ok(hall > stall);

const rideLine = [
  [0, 0],
  [20, 0],
  [40, 0],
  [60, 0],
];
const ride = liftCoaster(
  rideLine,
  { stepM: 20, heightAmp: 10 },
);
assert.ok(ride.track.d.length > 0);
assert.ok(ride.shadow.d.length > 0);
assert.ok(ride.supports.length >= 2);
assert.ok(ride.supports[0].d.startsWith('M'));

const rctTemplate = resolveIsoMapTemplate('rct-classic');
assert.equal(rctTemplate.id, 'rct-classic');
assert.equal(rctTemplate.coasterStepM, 6);
const frisco = resolveIsoMapTemplate('frisco-fields');
assert.equal(frisco.id, 'frisco-fields');
assert.equal(frisco.coasterBaseM, 2);
assert.equal(frisco.coasterHeightAmp, 6);
assert.equal(frisco.coasterStepM, 9);
assert.equal(frisco.buildingTrackPadM, 10, 'unset fields inherit rct-classic');
const watercolor = resolveIsoMapTemplate('watercolor-quest');
assert.equal(watercolor.id, 'watercolor-quest');
assert.equal(watercolor.coasterBaseM, 4);
assert.equal(watercolor.coasterHeightAmp, 5);
assert.equal(watercolor.coasterStepM, 10);
assert.equal(watercolor.buildingTrackPadM, 8);
assert.equal(watercolor.liftedTrackPadM, 6);
const sparseTemplate = resolveIsoMapTemplate({
  id: 'sparse-demo',
  coasterStepM: 30,
  coasterHeightAmp: 4,
});
assert.equal(sparseTemplate.id, 'sparse-demo');
const sparseMeshes = assembleIsoMeshes([], [rideLine], { template: sparseTemplate });
assert.equal(sparseMeshes.tracks[0].supports.length, 3, 'template controls support density');

const near = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
];
const far = [
  [20, 20],
  [22, 20],
  [22, 22],
  [20, 22],
];
const midTrack = [
  [30, 0],
  [40, 0],
  [50, 0],
];
const packed = assembleIsoMeshes([near, far], [midTrack, midTrack, midTrack], {
  maxBuildings: 10,
  maxTracks: 8,
});
assert.equal(packed.buildings[0].i, 1, 'far buildings paint first');
assert.equal(packed.buildings[1].i, 0);
assert.equal(packed.tracks.length, 1, 'duplicate OSM rails collapse to one line');
assert.ok(packed.buildings[0].foot.d.includes('M'));
assert.equal(typeof ride.depth, 'number');

const envelope = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];
const covered = [
  [10, 10],
  [20, 10],
  [30, 10],
  [40, 10],
  [50, 10],
];
const stallBeside = [
  [200, 200],
  [204, 200],
  [204, 204],
  [200, 204],
];
const culled = assembleIsoMeshes([envelope, stallBeside], [covered]);
assert.equal(culled.buildings.length, 1, 'ride-envelope rectangle is not a building');
assert.equal(culled.buildings[0].i, 1);

const stacked = stackIsoItems(
  [{ i: 0, depth: 12, foot: { d: 'M' }, walls: [], roof: { d: 'M' } }],
  [{ i: 0, depth: 4, shadow: { d: '' }, track: { d: '' }, supports: [] }],
);
assert.equal(stacked[0].type, 'building', 'farther item paints first');
assert.equal(stacked[1].type, 'track');
assert.equal(typeof culled.tracks[0].depth, 'number');

const longBeast = [
  [0, 0],
  [40, 0],
  [80, 0],
];
const shortBeast = [
  [0, 1],
  [40, 1],
];
const farBeast = [
  [200, 0],
  [240, 0],
  [280, 0],
];
const picked = pickCoasterLines([
  { r: shortBeast, n: 'The Beast', i: 0 },
  { r: longBeast, n: 'The Beast', i: 1 },
  { r: farBeast, n: 'The Beast', i: 2 },
]);
assert.equal(picked.length, 2, 'parallel rail dropped; far stretch kept');
assert.ok(picked.some((p) => p.i === 1));
assert.ok(picked.some((p) => p.i === 2));
assert.ok(!picked.some((p) => p.i === 0));

const clip = [
  [8, 8],
  [12, 8],
  [12, 12],
  [8, 12],
];
const grazes = [
  [0, 10],
  [20, 10],
];
assert.equal(buildingHitsTrack(clip, grazes), true);
const afterHit = assembleIsoMeshes([clip, stallBeside], [grazes]);
assert.equal(afterHit.buildings.length, 1, 'building that the rail crosses is dropped');
assert.equal(afterHit.buildings[0].i, 1);

const hallOffRail = [
  [0, 8],
  [40, 8],
  [40, 24],
  [0, 24],
];
const railBelow = [
  [0, 0],
  [40, 0],
];
assert.equal(buildingHitsTrack(hallOffRail, railBelow, 6), false);
assert.equal(buildingHitsTrack(hallOffRail, railBelow, 10), true);

const hallAlong = [
  [20, 3],
  [40, 3],
  [40, 20],
  [20, 20],
];
const longRail = [
  [0, 0],
  [100, 0],
];
assert.equal(buildingHitsTrack(hallAlong, longRail), true, 'wall a few metres off a long rail shares ground');
const afterAlong = assembleIsoMeshes([hallAlong, stallBeside], [longRail]);
assert.equal(afterAlong.buildings.length, 1, 'building beside a rail is dropped');
assert.equal(afterAlong.buildings[0].i, 1);

const walkA = [
  [0, 0],
  [50, 0],
];
const walkTwin = [
  [0, 1],
  [50, 1],
];
const walkFar = [
  [0, 30],
  [50, 30],
];
const walks = pickWalkways([walkA, walkTwin, walkFar]);
assert.equal(walks.length, 2, 'parallel footways collapse to one line');
assert.ok(walks.some((w) => w.i === 0));
assert.ok(walks.some((w) => w.i === 2));
assert.ok(!walks.some((w) => w.i === 1));

const tallHall = [
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
];
const railPastRoof = [
  [31, 10],
  [50, 10],
];
assert.equal(buildingHitsTrack(tallHall, railPastRoof, 10), false, 'ground pad misses a rail 11m off the wall');
const afterRoof = assembleIsoMeshes([tallHall, stallBeside], [railPastRoof]);
assert.equal(afterRoof.buildings.length, 1, 'lifted rail through the roof still drops the hall');
assert.equal(afterRoof.buildings[0].i, 1);

// A lifted rail that clips the hall's silhouette only at a non-zero rotation
// must still be culled — the rotation-0-only check missed this class of clip
// (#522). Verified against a fixed lift height (heightAmp 0) so per-point
// height doesn't shift between rotations, isolating the projection effect:
// this rail's screen silhouette clears the hall at r0/r2 but punches through
// it at r1/r3 (confirmed by direct isoLocal/convexHull probing at each
// rotation), so the any-of-4-rotations union is required to catch it.
const skewRail = [
  [15, -13],
  [16, -13],
];
const skewLift = { heightAmp: 0, baseHeight: 8 };
const skewHeightM = buildingHeightM(tallHall);
assert.equal(
  buildingHitsLiftedTrack(tallHall, skewRail, skewHeightM, 8, skewLift),
  true,
  'lifted rail that only clips at r1/r3 is still culled (#522)',
);
const afterSkew = assembleIsoMeshes([tallHall, stallBeside], [skewRail], {
  heightAmp: skewLift.heightAmp,
  baseHeight: skewLift.baseHeight,
  liftedTrackPadM: 8,
});
assert.equal(afterSkew.buildings.length, 1, 'building culled via assembleIsoMeshes regardless of render rotation');
assert.equal(afterSkew.buildings[0].i, 1, 'the hall (not the stall) is the one dropped');

// No-collision control: shifting the rail well clear of the hall at every
// rotation must not over-cull.
const clearRail = [
  [100, 100],
  [101, 100],
];
assert.equal(
  buildingHitsLiftedTrack(tallHall, clearRail, skewHeightM, 8, skewLift),
  false,
  'a rail nowhere near the hall at any rotation is not culled',
);


// Four quarter-turn views: isoInverse is the exact inverse of isoLocal.
assert.equal(ISO_ROTATIONS, 4);
const asymmetric = [
  [3, 7],
  [-5, 2],
  [11, -4],
];
for (let r = 0; r < ISO_ROTATIONS; r += 1) {
  for (const [dx, dy] of asymmetric) {
    const iso = isoLocal(dx, dy, r);
    const round = isoInverse(iso.x, iso.y, r);
    assert.ok(Math.abs(round.dx - dx) < 1e-9, `rotation ${r} recovers dx`);
    assert.ok(Math.abs(round.dy - dy) < 1e-9, `rotation ${r} recovers dy`);
  }
}

// depthKey: larger is farther (paints first); height paints after its ground.
assert.ok(depthKey({ x: 20, y: 20 }) > depthKey({ x: 0, y: 0 }), 'farther ground point gets a larger key');
assert.ok(
  depthKey({ x: 10, y: 10, z: 5 }) < depthKey({ x: 10, y: 10, z: 0 }),
  'elevated item at the same ground point paints after the ground',
);
assert.equal(depthKey({ x: 3, y: 7 }), isoLocal(3, 7).y, 'ground-level key is the iso y');

// Rotation 0 is the un-rotated projection, byte for byte.
for (const [dx, dy] of asymmetric) {
  assert.deepEqual(isoLocal(dx, dy, 0), isoLocal(dx, dy));
}

// Wall shading classification uses projected iso x, so it rotates with the
// view — a "fix" back to raw ring coordinates would break these.
const sides0 = extrudeBuilding(square, 8).walls.map((w) => w.side);
assert.deepEqual(sides0, ['R', 'R', 'L', 'L'], 'rotation-0 side baseline (ported behavior)');
const sides1 = extrudeBuilding(square, 8, { rotation: 1 }).walls.map((w) => w.side);
assert.equal(sides0[2], 'L');
assert.equal(sides1[2], 'R', 'the same physical wall flips L→R when the view rotates');

console.log('iso-world.test: ok');
