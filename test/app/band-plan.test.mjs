#!/usr/bin/env node
/* Band plan for the phone (ADR-0021 clause 4). Given a camera zoom, a
   latitude, and the bands a device actually holds, decide what to paint: the
   band the camera wants as primary, and the one band held underneath it while
   a child streams in. Clause 4 is explicit that the parent stays drawn across
   the crossfade rather than the child switching on at its edge.

   Expected values here are worked out from the projection and checked against
   ADR-0021's band table, never re-derived by running the module under test.
   The ground resolution of a screen pixel at MapLibre zoom z (which counts
   512 px tiles) and latitude f is C * cos(f) / (512 * 2^z), with C the
   equatorial circumference 40,075,016.686 m. */
import assert from 'node:assert/strict';
import { bandForZoom, bandBoundaryZooms, parentOf } from '../../packages/shared/zoomBands.js';
import { DEFAULT_MAX_PITCH, pitchEaseRange, pitchForZoom } from '../../packages/shared/mapCamera.js';
import { bandDrawPlan } from '../../apps/party-tracker/lib/bandPlan.js';

/** kings-island — the venue whose pack Train H's preview draws. */
const latitude = 39.3422;

/* Tolerance is 1e-12 — about 500 ulps at these magnitudes, so a libm whose
   cos or log2 rounds the last bit differently still passes, while a literal
   truncated even at the ninth decimal does not. */
const near = (got, want, what) =>
  assert.ok(Math.abs(got - want) < 1e-12, `${what}: expected ${want}, got ${got}`);

// ---------------------------------------------------------------------------
// The camera geometry the plan rests on, at kings-island's latitude.
// ---------------------------------------------------------------------------

// cos(39.3422 deg) = 0.7733734965, so a screen pixel covers
//   z14 -> 3.694648 m   z15 -> 1.847324 m   z17 -> 0.461831 m
// against a band table of overview 2.4, mid 0.6, close 0.15 m/px (clause 2).
// Selection takes the coarsest band that is not coarser than the screen.
assert.equal(bandForZoom(14, { latitude }), 'overview');
assert.equal(bandForZoom(15, { latitude }), 'mid');
assert.equal(bandForZoom(17, { latitude }), 'close');

// The handoffs sit at z = log2(C * cos(f) / (512 * mpp)):
//   overview 2.4 m/px -> 14.622402608729475
//   mid      0.6 m/px -> 16.622402608729477   (exactly two zooms finer, as
//                                              clause 2's 4x step requires)
const boundaries = bandBoundaryZooms({ latitude });
assert.equal(boundaries.length, 2, 'three bands, two handoffs');
near(boundaries[0], 14.622402608729475, 'overview->mid handoff at kings-island');
near(boundaries[1], 16.622402608729477, 'mid->close handoff at kings-island');

// The pitch ease is inset DEFAULT_EASE_MARGIN (0.4) zooms into the gap
// between those two handoffs, so it never overlaps one.
const { startZoom, endZoom } = pitchEaseRange({ latitude });
near(startZoom, 15.022402608729475, 'pitch ease start at kings-island');
near(endZoom, 16.222402608729478, 'pitch ease end at kings-island');

// At the mid->close handoff the ease finished 0.4 zooms ago, so the camera is
// already fully tilted before a single close-band pixel is ever selected.
assert.equal(
  pitchForZoom(16.622402608729477, { latitude }),
  DEFAULT_MAX_PITCH,
  'full pitch at the mid->close handoff',
);

// The invariant that follows, stated outright: close-band art is only ever
// seen tilted. Swept, and counted so the sweep cannot pass by never finding a
// close-band zoom at all.
for (const lat of [0, latitude, 60]) {
  let closeZooms = 0;
  for (let z = 10; z <= 22.0001; z += 0.05) {
    if (bandForZoom(z, { latitude: lat }) !== 'close') continue;
    closeZooms += 1;
    assert.equal(
      pitchForZoom(z, { latitude: lat }),
      DEFAULT_MAX_PITCH,
      `close band at z${z.toFixed(2)}, latitude ${lat}, must be at full pitch`,
    );
  }
  assert.ok(closeZooms > 50, `the sweep reached the close band at latitude ${lat}`);
}

// ---------------------------------------------------------------------------
// The plan itself. `available` is what the device holds, nothing more.
// ---------------------------------------------------------------------------

const plan = (zoom, available) => bandDrawPlan(zoom, { latitude, available });

// The venue pack ships the mid band and only the mid band (clause 5 makes it
// the offline floor), so this is the state every phone starts a park day in.

// Zoomed out past the overview handoff: the camera wants overview, the device
// has not got one, and the only thing to hold under it is mid downsampled.
assert.deepEqual(plan(14, ['mid']), {
  primary: 'overview',
  placeholder: 'mid',
  primaryReady: false,
  draw: ['mid'],
});

// Inside mid's own range the pack is exactly right: mid is primary, and there
// is nothing coarser on the device to hold underneath it.
assert.deepEqual(plan(15, ['mid']), {
  primary: 'mid',
  placeholder: null,
  primaryReady: true,
  draw: ['mid'],
});

// Past the mid->close handoff with no close band yet. parentOf('close') is
// 'mid' — this is the call the module exists to make, and it had no
// production caller before now.
assert.equal(parentOf('close'), 'mid');
assert.deepEqual(plan(17, ['mid']), {
  primary: 'close',
  placeholder: 'mid',
  primaryReady: false,
  draw: ['mid'],
});

// Once close has streamed in, clause 4 keeps mid drawn *underneath* across
// the crossfade rather than switching close on at the handoff's edge — so the
// plan still names a placeholder, and `draw` is bottom-to-top.
assert.deepEqual(plan(17, ['mid', 'close']), {
  primary: 'close',
  placeholder: 'mid',
  primaryReady: true,
  draw: ['mid', 'close'],
});

// Exactly one parent is held, never the whole pyramid: overview is on the
// device here and is still not painted.
assert.deepEqual(plan(17, ['overview', 'mid', 'close']), {
  primary: 'close',
  placeholder: 'mid',
  primaryReady: true,
  draw: ['mid', 'close'],
});

// A finer band is a stand-in only when the primary is missing. With overview
// present at z14 the camera gets what it asked for and mid stays off — the
// opposite answer to plan(14, ['mid']) above, from the same zoom.
assert.deepEqual(plan(14, ['overview', 'mid']), {
  primary: 'overview',
  placeholder: null,
  primaryReady: true,
  draw: ['overview'],
});

// And a present primary does take the parent underneath it when there is one.
assert.deepEqual(plan(15, ['overview', 'mid']), {
  primary: 'mid',
  placeholder: 'overview',
  primaryReady: true,
  draw: ['overview', 'mid'],
});

// The nearest available ancestor, not merely the immediate parent: with only
// overview on the device at z17, close's missing parent is skipped over.
assert.deepEqual(plan(17, ['overview']), {
  primary: 'close',
  placeholder: 'overview',
  primaryReady: false,
  draw: ['overview'],
});

// ---------------------------------------------------------------------------
// Shape of the input, and the caller bugs worth refusing.
// ---------------------------------------------------------------------------

// A Set is the natural thing a cache hands over; an array is what a test or a
// manifest has. Both mean the same, and order carries no meaning.
assert.deepEqual(plan(17, new Set(['close', 'mid'])), plan(17, ['mid', 'close']));
assert.deepEqual(plan(17, ['close', 'mid']), plan(17, ['mid', 'close']));

// An empty set is not a state to render. The mid band is a venue-pack
// invariant, so a device with nothing at all is a caller bug — refuse it
// rather than hand back a plan that paints an empty screen.
assert.throws(() => plan(17, []), /venue-pack invariant/);
assert.throws(() => plan(17, new Set()), /venue-pack invariant/);
assert.throws(() => bandDrawPlan(17, { latitude }), /venue-pack invariant/);

// A band id that is not in the table is a typo, not an absent band.
assert.throws(() => plan(17, ['mid', 'closeup']), /unknown band/i);

// A latitude that is not a number must not reach a live map.setPitch().
assert.throws(() => bandDrawPlan(17, { latitude: 'north', available: ['mid'] }), /latitude/i);

console.log('band-plan: ok');
