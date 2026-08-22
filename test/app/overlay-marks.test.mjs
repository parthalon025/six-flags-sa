#!/usr/bin/env node
import assert from 'node:assert/strict';
import { overlayChrome, overlayMarks } from '../../apps/party-tracker/lib/overlayMarks.js';

const overlay = {
  places: {
    features: [
      { id: 'beast', geometry: { coordinates: [-84.26, 39.34] }, properties: { id: 'beast', name: 'The Beast' } },
    ],
  },
  members: {
    features: [
      { id: 'phone-a', geometry: { coordinates: [-84.27, 39.35] }, properties: { id: 'phone-a', name: 'Sam', self: true } },
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
assert.equal(marks.find((m) => m.self).id, 'phone-a');
assert.equal(marks.find((m) => m.kind === 'meet').className, 'meetPin');
assert.deepEqual(
  overlayMarks(overlay, () => null),
  [],
  'a project that cannot place a point drops the mark rather than inventing 0,0',
);

{
  const overlay = {
    route: {
      features: [{
        geometry: { coordinates: [[-84.27, 39.35], [-84.26, 39.34], [-84.25, 39.33]] },
        properties: { mode: 'path' },
      }],
    },
  };
  const project = ({ lng, lat }) => ({ x: lng * -1, y: lat });
  const chrome = overlayChrome(overlay, project, {
    alternatives: [{ index: 1, points: [[39.35, -84.27], [39.34, -84.26]] }],
    routeDone: [[39.35, -84.27], [39.345, -84.265]],
    puck: { lat: 39.35, lng: -84.27, course: 90 },
    rotation: 90,
  });
  assert.equal(chrome.paths.find((p) => p.className === 'routeLine').d.startsWith('M'), true);
  assert.equal(chrome.paths.some((p) => p.className === 'routeDone'), true);
  assert.equal(chrome.paths.some((p) => p.className === 'altLine'), true);
  /* Same wrap as test/app/functional.mjs "the map turns so the route runs up
     the screen": rotate 0 is straight ahead; rotate 180 is ~180° off. */
  const offAhead = (deg) => Math.abs(((deg + 540) % 360) - 180);
  assert.ok(offAhead(chrome.cone.rotate) <= 12, `course-up cone is ${chrome.cone.rotate}°, want ~0`);
  const noCourse = overlayChrome(overlay, project, {
    puck: { lat: 39.35, lng: -84.27 },
    rotation: 217,
  });
  assert.ok(offAhead(noCourse.cone.rotate) <= 12, `no-course cone is ${noCourse.cone.rotate}°, want ~0`);
  const compassWins = overlayChrome(overlay, project, {
    puck: { lat: 39.35, lng: -84.27, course: 200 },
    heading: 0,
    rotation: 0,
  });
  assert.ok(offAhead(compassWins.cone.rotate) <= 12, `compass cone is ${compassWins.cone.rotate}°, want ~0`);
  const direct = overlayChrome({
    route: { features: [{ geometry: { coordinates: [[-84.27, 39.35], [-84.26, 39.34]] }, properties: { mode: 'direct' } }] },
  }, project);
  assert.equal(direct.paths[0].className, 'routeLine direct');
  const two = overlayChrome({
    route: {
      features: [
        { id: 'a', geometry: { coordinates: [[-84.27, 39.35], [-84.26, 39.34]] }, properties: { id: 'a' } },
        { id: 'b', geometry: { coordinates: [[-84.26, 39.34], [-84.25, 39.33]] }, properties: { id: 'b' } },
      ],
    },
  }, project);
  assert.deepEqual(two.paths.map((p) => p.id), ['a', 'b']);
}

console.log('overlay-marks: ok');
