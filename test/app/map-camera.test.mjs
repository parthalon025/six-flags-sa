#!/usr/bin/env node
/* Camera curve (ADR-0019 clause 2, ADR-0021 clause 4). Flat top-down when
   zoomed out, easing toward a tilt as the guest zooms in — with the ease
   staged so it never overlaps a Zoom band handoff, or one pinch would tilt
   the world and restyle it in the same instant. */
import assert from 'node:assert/strict';
import { bandBoundaryZooms } from '../../packages/shared/zoomBands.js';
import { pitchEaseRange, pitchForZoom } from '../../packages/shared/mapCamera.js';

// The clause 4 invariant, at several latitudes because the boundaries move.
for (const latitude of [0, 39.34, 60]) {
  const { startZoom, endZoom } = pitchEaseRange({ latitude });
  assert.ok(startZoom < endZoom, `ease has width at ${latitude}deg`);
  for (const boundary of bandBoundaryZooms({ latitude })) {
    assert.ok(
      boundary <= startZoom || boundary >= endZoom,
      `band boundary z${boundary.toFixed(2)} must sit outside the pitch ease ` +
        `${startZoom.toFixed(2)}..${endZoom.toFixed(2)} at ${latitude}deg`,
    );
  }
}

// Flat when zoomed out, fully tilted when zoomed in, nothing beyond.
const at = (z) => pitchForZoom(z, { latitude: 0, maxPitch: 45 });
const { startZoom, endZoom } = pitchEaseRange({ latitude: 0 });
assert.equal(at(startZoom - 2), 0, 'flat well before the ease');
assert.equal(at(startZoom), 0, 'still flat at the ease start');
assert.equal(at(endZoom), 45, 'fully tilted at the ease end');
assert.equal(at(endZoom + 3), 45, 'never past the maximum');

// Monotonic: zooming in never tips the world back up.
let previous = -1;
for (let z = 10; z <= 22; z += 0.25) {
  const pitch = at(z);
  assert.ok(pitch >= previous, `pitch never decreases (z${z})`);
  previous = pitch;
}

// It eases rather than ramps. Smoothstep is symmetric about the midpoint and
// flatter than a straight line near the start — a linear ramp would put a
// quarter of the way through at exactly a quarter of the tilt.
const mid = (startZoom + endZoom) / 2;
const quarter = startZoom + (endZoom - startZoom) / 4;
assert.ok(Math.abs(at(mid) - 22.5) < 1e-9, 'half way through the ease is half the tilt');
assert.ok(at(quarter) < 45 * 0.25, 'the ease starts gently, unlike a linear ramp');

console.log('map-camera: ok');
