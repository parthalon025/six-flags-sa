#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assembleIsoMeshes,
  buildingHeightM,
  buildingHitsTrack,
  extrudeBuilding,
  isoInverse,
  isoLocal,
  liftCoaster,
  pickCoasterLines,
  pickWalkways,
  stackIsoItems,
} from '../../apps/party-tracker/lib/isoTycoon.js';

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

const ride = liftCoaster(
  [
    [0, 0],
    [20, 0],
    [40, 0],
    [60, 0],
  ],
  { stepM: 20, heightAmp: 10 },
);
assert.ok(ride.track.d.length > 0);
assert.ok(ride.shadow.d.length > 0);
assert.ok(ride.supports.length >= 2);
assert.ok(ride.supports[0].d.startsWith('M'));

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

console.log('iso-tycoon.test: ok');
