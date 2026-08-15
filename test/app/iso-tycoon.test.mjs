#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assembleIsoMeshes,
  buildingHeightM,
  extrudeBuilding,
  isoInverse,
  isoLocal,
  liftCoaster,
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
const packed = assembleIsoMeshes([near, far], [square, square, square], {
  maxBuildings: 10,
  maxTracks: 2,
});
assert.equal(packed.buildings[0].i, 1, 'far buildings paint first');
assert.equal(packed.buildings[1].i, 0);
assert.equal(packed.tracks.length, 2, 'track cap after lift');
assert.ok(packed.buildings[0].foot.d.includes('M'));

console.log('iso-tycoon.test: ok');
