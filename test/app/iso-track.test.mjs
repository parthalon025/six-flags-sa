#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  GRADE_THRESHOLD,
  TRACK_SEGMENT_KINDS,
  TURN_THRESHOLD_DEG,
  segmentStats,
  trackSegments,
} from '../../packages/shared/isoTrack.js';

assert.deepEqual(TRACK_SEGMENT_KINDS, ['flat', 'climb', 'drop', 'turn-left', 'turn-right']);
assert.ok(GRADE_THRESHOLD > 0 && TURN_THRESHOLD_DEG > 0);

// A straight line with the lift flattened is one flat segment, end to end.
const straight = [
  [0, 0],
  [10, 0],
  [20, 0],
];
const flatOnly = trackSegments(straight, { heightAmp: 0 });
assert.equal(flatOnly.length, 1, 'one merged flat segment');
assert.equal(flatOnly[0].kind, 'flat');
assert.equal(flatOnly[0].fromM, 0);
assert.equal(flatOnly[0].toM, 20);
assert.equal(flatOnly[0].rise, 0);
assert.deepEqual(flatOnly[0].points, straight, 'segment spans every vertex');

// Degenerate input: nothing to classify.
assert.deepEqual(trackSegments([], {}), []);
assert.deepEqual(trackSegments([[0, 0]], {}), []);

// A long straight run under the rct-classic sin-hill alternates climb and
// drop (short flat crests/valleys between them) with travelled distances
// monotonically increasing.
const longLine = [];
for (let x = 0; x <= 176; x += 4) longLine.push([x, 0]);
const hills = trackSegments(longLine);
const grades = hills.filter((s) => s.kind === 'climb' || s.kind === 'drop');
assert.ok(grades.length >= 4, 'the sin-hill yields repeated climbs and drops');
assert.equal(grades[0].kind, 'climb', 'the lift climbs first');
for (let i = 1; i < grades.length; i += 1) {
  assert.notEqual(grades[i].kind, grades[i - 1].kind, 'climb and drop alternate');
}
for (let i = 1; i < hills.length; i += 1) {
  assert.ok(hills[i].fromM > hills[i - 1].fromM, 'fromM is monotonically increasing');
  assert.equal(hills[i].fromM, hills[i - 1].toM, 'neighbors share their boundary distance');
  assert.deepEqual(hills[i].points[0], hills[i - 1].points[hills[i - 1].points.length - 1], 'neighbors share their boundary vertex');
}
for (const s of hills) {
  if (s.kind === 'climb') assert.ok(s.rise > 0, 'climb rises');
  if (s.kind === 'drop') assert.ok(s.rise < 0, 'drop falls');
}

// An L with a 90° corner reads as exactly one turn of the correct
// handedness — heightAmp 0 so lift grades cannot mask it.
const leftL = [
  [0, 0],
  [50, 0],
  [50, 50],
];
const leftSegs = trackSegments(leftL, { heightAmp: 0 });
assert.equal(leftSegs.filter((s) => s.kind.startsWith('turn')).length, 1, 'exactly one turn');
assert.deepEqual(leftSegs.map((s) => s.kind), ['flat', 'turn-left'], 'CCW corner turns left');

const rightL = [
  [0, 0],
  [50, 0],
  [50, -50],
];
const rightSegs = trackSegments(rightL, { heightAmp: 0 });
assert.equal(rightSegs.filter((s) => s.kind.startsWith('turn')).length, 1, 'exactly one turn');
assert.deepEqual(rightSegs.map((s) => s.kind), ['flat', 'turn-right'], 'CW corner turns right');

// A gently rounded turn (36° total, 6° per vertex) with one collinear
// vertex mid-curve still reads as a turn: a zero heading delta holds the
// accumulator instead of wiping it. heightAmp 0 keeps grades out of the way.
const roundedHeadings = [0, 6, 12, 18, 24, 24, 30, 36];
const rounded = [[0, 0]];
for (const deg of roundedHeadings) {
  const [x, y] = rounded[rounded.length - 1];
  const rad = (deg * Math.PI) / 180;
  rounded.push([x + 10 * Math.cos(rad), y + 10 * Math.sin(rad)]);
}
const roundedSegs = trackSegments(rounded, { heightAmp: 0 });
assert.equal(
  roundedSegs.filter((s) => s.kind === 'turn-left').length,
  1,
  'the accumulated 36° curve survives its collinear vertex',
);
assert.ok(roundedSegs.every((s) => s.kind !== 'turn-right'));

// Turns never outrank climb/drop: the same corner on a steep lift stays a climb.
const steepCorner = trackSegments([[0, 0], [10, 0], [10, 10]]);
assert.ok(steepCorner.every((s) => !s.kind.startsWith('turn')), 'climb wins over turn');

// Deterministic: same input, deeply equal output.
assert.deepEqual(trackSegments(longLine), trackSegments(longLine));
assert.deepEqual(trackSegments(leftL, { heightAmp: 0 }), trackSegments(leftL, { heightAmp: 0 }));

// segmentStats reconciles with the segments it rolls up.
const stats = segmentStats(hills);
assert.equal(stats.total, hills.length);
assert.equal(
  Object.values(stats.byKind).reduce((s, n) => s + n, 0),
  hills.length,
  'byKind counts sum to total',
);
assert.deepEqual(Object.keys(stats.byKind), TRACK_SEGMENT_KINDS, 'every kind reports, zeros included');
const spanSum = hills.reduce((s, seg) => s + (seg.toM - seg.fromM), 0);
assert.ok(Math.abs(stats.lengthM - spanSum) < 0.01, 'lengthM is the sum of segment spans');
assert.ok(Math.abs(stats.lengthM - 176) < 0.05, 'spans cover the whole line');
assert.deepEqual(segmentStats([]), {
  total: 0,
  byKind: { flat: 0, climb: 0, drop: 0, 'turn-left': 0, 'turn-right': 0 },
  lengthM: 0,
});

console.log('iso-track.test: ok');
