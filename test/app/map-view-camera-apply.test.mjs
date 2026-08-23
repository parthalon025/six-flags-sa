#!/usr/bin/env node
/* MapLibre camera writes during a pinch (the lag in the pitch-ease window).
 *
 * Symptom: a guest pinches through the World and hits a spot that feels slow,
 * then the zoom speeds up again. That spot is the staged pitch ease
 * (ADR-0021 clause 4): at kings-island, z15.02–16.22.
 *
 * Cause: MapLibre's public setters — setPitch, setZoom, setCenter, setBearing
 * — all go through jumpTo(), and jumpTo() begins with this.stop(). stop()
 * kills the in-flight pinch. The adapter used to apply derived pitch with
 * setPitch on every move event inside the ease, so every frame of that
 * window stopped the gesture. Outside the ease, pitch is constant (0 or
 * max) and setPitch was skipped — which is why the lag has a beginning and
 * an end, then "speeds up to normal".
 *
 * The adapter's job is therefore: never jumpTo when the gesture already
 * applied zoom/center/bearing. Pitch folds into the same transform via
 * transformCameraUpdate, which MapLibre runs before the frame, not after.
 */
import assert from 'node:assert/strict';
import { pitchForZoom } from '../../packages/shared/mapCamera.js';
import {
  constrainCameraPitch,
  mapWritesForCamera,
} from '../../apps/party-tracker/lib/mapViewCameraApply.js';

const KI = 39.3422;
const CENTRE = { lng: -84.2678, lat: 39.3422 };
const EASE_MID = 15.622402608729476;

const held = (over = {}) => ({
  center: CENTRE,
  zoom: 15,
  bearing: 0,
  pitch: 0,
  ...over,
});

const wanted = (over = {}) => ({
  center: CENTRE,
  zoom: 15,
  bearing: 0,
  pitch: 0,
  ease: null,
  ...over,
});

// A pinch already wrote zoom/center/bearing. The seam echoes that camera
// back with a derived pitch. Jumping to apply the pitch is the lag.
assert.deepEqual(
  mapWritesForCamera(
    held({ zoom: EASE_MID, pitch: 0 }),
    wanted({ zoom: EASE_MID, pitch: 22.5 }),
  ),
  { kind: 'none' },
  'a pinch echo must not jumpTo just to apply derived pitch',
);

// A caller that actually moved the camera still jumps — one write, with
// pitch included, rather than setZoom then setPitch (two stops).
assert.deepEqual(
  mapWritesForCamera(held(), wanted({ zoom: 16, pitch: 45 })),
  { kind: 'jump' },
  'a real camera move is one jump, not a chain of setters',
);

assert.deepEqual(
  mapWritesForCamera(held(), wanted({ zoom: 16, pitch: 45, ease: { durationMs: 480 } })),
  { kind: 'ease' },
  'an eased move stays an ease',
);

// The guest-facing regression: a constant-rate pinch through the park must
// not produce a cluster of stopping writes in the ease window. That cluster
// *is* the slow spot.
const stops = [];
let previousPitch = pitchForZoom(14, { latitude: KI });
for (let z = 14; z <= 18.0001; z += 0.05) {
  const pitch = pitchForZoom(z, { latitude: KI });
  const write = mapWritesForCamera(
    held({ zoom: z, pitch: previousPitch }),
    wanted({ zoom: z, pitch }),
  );
  if (write.kind !== 'none') stops.push(Number(z.toFixed(2)));
  previousPitch = pitch;
}
assert.deepEqual(
  stops,
  [],
  `a pinch must not jumpTo at any zoom; stopping writes at ${stops.join(', ') || '—'}`,
);

// Pitch still tracks zoom — it just does so in the same transform as the
// gesture, which is what transformCameraUpdate is for.
const constrain = constrainCameraPitch((zoom) => pitchForZoom(zoom, { latitude: KI }));
assert.deepEqual(constrain({ zoom: 14, pitch: 0 }), { pitch: 0 }, 'flat before the ease');
assert.deepEqual(
  constrain({ zoom: EASE_MID, pitch: 0 }),
  { pitch: 22.5 },
  'half the tilt at the ease midpoint, folded into the same update',
);
assert.deepEqual(constrain({ zoom: 17, pitch: 0 }), { pitch: 45 }, 'full tilt past the ease');

console.log('map-view-camera-apply: ok');
