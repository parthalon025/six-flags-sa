#!/usr/bin/env node
import assert from 'node:assert/strict';
import { overlayMarks } from '../../apps/party-tracker/lib/overlayMarks.js';

const overlay = {
  places: {
    features: [
      { id: 'beast', geometry: { coordinates: [-84.26, 39.34] }, properties: { id: 'beast', name: 'The Beast' } },
    ],
  },
  members: {
    features: [
      { id: 'me', geometry: { coordinates: [-84.27, 39.35] }, properties: { id: 'me', name: 'Sam' } },
    ],
  },
  pins: {
    features: [
      { id: 'meet', geometry: { coordinates: [-84.25, 39.33] }, properties: { id: 'meet', kind: 'meet', label: 'Carousel' } },
    ],
  },
};

const marks = overlayMarks(overlay, ({ lng, lat }) => ({ x: lng * -1, y: lat }));
assert.equal(marks.length, 3);
assert.equal(marks.find((m) => m.kind === 'place').className, 'poiMarker');
assert.equal(marks.find((m) => m.kind === 'place').name, 'The Beast');
assert.equal(marks.find((m) => m.self).className, 'memMarker');
assert.equal(marks.find((m) => m.kind === 'meet').className, 'meetPin');
assert.deepEqual(
  overlayMarks(overlay, () => null),
  [],
  'a project that cannot place a point drops the mark rather than inventing 0,0',
);

console.log('overlay-marks: ok');
