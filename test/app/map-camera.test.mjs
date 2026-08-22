#!/usr/bin/env node
/* Camera curve (ADR-0019 clause 2, ADR-0021 clause 4). Flat top-down when
   zoomed out, easing toward a tilt as the guest zooms in — with the ease
   staged so it never overlaps a Zoom band handoff, or one pinch would tilt
   the world and restyle it in the same instant. */
import assert from 'node:assert/strict';
import { bandBoundaryZooms } from '../../packages/shared/zoomBands.js';
import {
  DEFAULT_CAMERA_PRESET,
  DEFAULT_MAX_PITCH,
  SKIN_CAMERA_PRESETS,
  frameBounds,
  offsetCentre,
  pitchEaseRange,
  pitchForZoom,
  skinCameraPreset,
} from '../../packages/shared/mapCamera.js';
import { PREVIEW_SKINS } from '../../apps/party-tracker/lib/bandedWorldPreview.js';

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

// ---------------------------------------------------------------------------
// Framing and offsetting (slice h11). Two answers the ported ParkMap needs and
// the SVG renderer worked out inline: what camera shows this box of ground,
// and where the centre goes when the puck should sit low on the glass during
// Go. Both are pure geometry, so they belong beside the pitch curve rather
// than inside a component nothing can drive without a browser.
// ---------------------------------------------------------------------------

/* One degree of latitude is 111,319.49 m of ground. Across a 512 px viewport
   that is 217.42 m per pixel; the equator is 40,075,016.686 m and the world is
   512 * 2^z pixels around at MapLibre zoom z, so z = log2(360) = 8.4919. */
{
  const framed = frameBounds({ west: -0.00005, east: 0.00005, south: -0.5, north: 0.5 }, { width: 512, height: 512 });
  assert.ok(Math.abs(framed.zoom - Math.log2(360)) < 1e-3, `a degree tall in 512 px is z8.49, got ${framed.zoom}`);
  assert.deepEqual(framed.center, { lng: 0, lat: 0 }, 'centred on the box');
}

/* The same box at latitude 60 frames one zoom level closer, because a Mercator
   pixel there covers half the ground: the equator over 512 * 2^z pixels is
   halved by cos(60), so 217.42 m/px is reached at z = log2(180) = 7.4919. A
   degree of *latitude* is still a degree of latitude, so this is the case that
   says the cosine belongs to the pixel and not to the height. */
{
  const framed = frameBounds({ west: -0.00005, east: 0.00005, south: 59.5, north: 60.5 }, { width: 512, height: 512 });
  assert.ok(
    Math.abs(framed.zoom - Math.log2(180)) < 1e-3,
    `a degree tall at 60deg is z7.49, got ${framed.zoom}`,
  );
}

// A degree of longitude covers less ground away from the equator, and a
// Mercator pixel shrinks by exactly the same cosine — so framing a one-degree
// box gives the same zoom wherever it sits. That invariant is what says the
// cosine is applied to both sides rather than one.
{
  const equator = frameBounds({ west: -0.5, east: 0.5, south: -0.0001, north: 0.0001 }, { width: 512, height: 512 });
  const north = frameBounds({ west: -0.5, east: 0.5, south: 59.9999, north: 60.0001 }, { width: 512, height: 512 });
  assert.ok(Math.abs(equator.zoom - north.zoom) < 1e-6, 'a degree wide frames the same at any latitude');
  assert.ok(Math.abs(equator.zoom - Math.log2(360)) < 1e-3);
}

// The wider axis decides, or half the box falls off the glass.
{
  const wide = frameBounds({ west: -0.5, east: 0.5, south: -0.0005, north: 0.0005 }, { width: 512, height: 4096 });
  const square = frameBounds({ west: -0.5, east: 0.5, south: -0.5, north: 0.5 }, { width: 512, height: 4096 });
  assert.ok(Math.abs(wide.zoom - square.zoom) < 1e-9, 'a tall viewport is decided by the width it has to fit');
}

// A viewport is pixels and a box is ground; neither can be zero or a caller
// gets Infinity to fly a camera to.
assert.throws(() => frameBounds({ west: 0, east: 0, south: 0, north: 0 }, { width: 512, height: 512 }), /extent/i);
assert.throws(() => frameBounds({ west: 0, east: 1, south: 0, north: 1 }, { width: 0, height: 512 }), /viewport/i);
assert.throws(() => frameBounds({ west: 0, east: 1, south: 0, north: 1 }, { width: 512 }), /viewport/i);
assert.throws(() => frameBounds({ west: 0, east: 1, south: 0 }, { width: 512, height: 512 }), /bounds/i);

/* Course-up during Go puts the puck low on the glass and the road ahead above
   it, which is the camera centre moved *forward along the bearing* rather than
   simply north. Getting that wrong is not subtle on a phone: the map slides
   the wrong way every time the guest turns a corner. */
{
  const centre = { lng: -84.2678, lat: 39.3422 };
  const north = offsetCentre(centre, { metres: 111319.49079327358, bearing: 0 });
  assert.ok(Math.abs(north.lat - 40.3422) < 1e-9, 'a degree north is a degree of latitude');
  assert.equal(north.lng, centre.lng, 'and no longitude at all');

  const east = offsetCentre(centre, { metres: 111319.49079327358, bearing: 90 });
  assert.ok(Math.abs(east.lat - centre.lat) < 1e-9);
  // A degree of longitude here is a degree of latitude times cos(39.3422).
  assert.ok(
    Math.abs(east.lng - (centre.lng + 1 / Math.cos((39.3422 * Math.PI) / 180))) < 1e-9,
    `east by one degree of ground, got ${east.lng}`,
  );

  const south = offsetCentre(centre, { metres: 111319.49079327358, bearing: 180 });
  assert.ok(Math.abs(south.lat - 38.3422) < 1e-9, 'bearing 180 goes south, not north');
}

/* No assertion for `metres: 0`. The early return for it is a fast path and
   nothing more — the general path multiplies the same zero through and answers
   the identical pair — so any test of it passes whether the branch is there or
   not. A mutation sweep found exactly that, and an assertion that cannot fail
   is worse than none: it reads as cover. */

assert.throws(() => offsetCentre({ lng: 0, lat: 0 }, { metres: Number.NaN, bearing: 0 }), /metres/i);
assert.throws(() => offsetCentre({ lng: 0, lat: 0 }, { metres: 10, bearing: '90' }), /bearing/i);
assert.throws(() => offsetCentre({ lng: 0, lat: 'north' }, { metres: 10, bearing: 0 }), /centre|lat/i);

/* --- Per-Skin camera feel (slice h14). ADR-0019 clause 2 makes bearing and
   pitch presets "a per-Skin declared trait of the design request", and clause 6
   makes one of them load-bearing: pixel-tycoon lost the iso projection that
   carried its distinctness and gets "the iso flavor painted into the sprites
   ... plus a camera preset" in exchange. This is that preset, and it lives
   here rather than in the kit for the reason skin-distinct's UNMAPPED_AXES A6
   already states — the kit schema has no camera field, and giving it one is a
   separate decision about what a kit should be able to say. */
{
  const plain = skinCameraPreset(null);
  assert.deepEqual(plain, DEFAULT_CAMERA_PRESET, 'no Skin, the default feel');
  assert.deepEqual(skinCameraPreset('no-such-skin'), DEFAULT_CAMERA_PRESET, 'an unknown Skin falls back');
  assert.equal(plain.bearing, 0, 'the map is north-up unless a Skin says otherwise');

  const tycoon = skinCameraPreset('pixel-tycoon');
  assert.notEqual(tycoon.bearing, DEFAULT_CAMERA_PRESET.bearing, 'the quarter-turn is the iso read');
  assert.equal(tycoon.bearing, 45, 'a quarter-turn, the angle the projection used to draw at');
  assert.equal(tycoon.maxPitch, DEFAULT_MAX_PITCH, 'and every degree of tilt ADR-0019 clause 2 allows');

  // Every declared preset stays inside clause 2's stated range. A preset is a
  // design knob, and a design knob that can leave the range the ADR fixed is
  // how the camera ends up somewhere no ADR agreed to.
  for (const [skin, preset] of Object.entries(SKIN_CAMERA_PRESETS)) {
    assert.ok(preset.maxPitch >= 30 && preset.maxPitch <= 45, `${skin} maxPitch ${preset.maxPitch} outside 30-45`);
    assert.ok(preset.bearing >= 0 && preset.bearing < 360, `${skin} bearing ${preset.bearing} out of range`);
  }
  // The first ship declares all three (ADR-0021 clause 6). A trio where two
  // Skins share the camera is a trio judged on two cameras.
  const bearings = new Set(PREVIEW_SKINS.map((s) => skinCameraPreset(s).bearing));
  const pitches = new Set(PREVIEW_SKINS.map((s) => skinCameraPreset(s).maxPitch));
  for (const skin of PREVIEW_SKINS) {
    assert.ok(SKIN_CAMERA_PRESETS[skin], `${skin} ships without a declared camera feel`);
  }
  assert.ok(bearings.size + pitches.size > 2, 'the shipped trio does not all share one camera');

  // The preset is what mountMapView takes as `maxPitch`, so it has to move the
  // curve rather than merely be reported. Measured at the top of the ease,
  // where the two presets are furthest apart.
  const { endZoom } = pitchEaseRange({ latitude: 39.34 });
  const flat = skinCameraPreset('layered-atlas');
  assert.ok(
    pitchForZoom(endZoom, { latitude: 39.34, maxPitch: tycoon.maxPitch })
      > pitchForZoom(endZoom, { latitude: 39.34, maxPitch: flat.maxPitch }),
    'pixel-tycoon reaches a steeper tilt than the flat-painted Skins',
  );
  assert.equal(
    pitchForZoom(0, { latitude: 39.34, maxPitch: tycoon.maxPitch }),
    0,
    'and every Skin is still flat top-down zoomed out — a preset is a ceiling, not an offset',
  );
}

console.log('map-camera: ok');
