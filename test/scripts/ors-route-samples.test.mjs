#!/usr/bin/env node
/**
 * deriveOrsRouteSamples — regression guard for #465 (ORS route QA never had
 * any samples to check).
 *
 *   node test/scripts/ors-route-samples.test.mjs
 */
import assert from 'node:assert/strict';
import { deriveOrsRouteSamples } from '../../packages/venue-builder/lib/ors-route-samples.mjs';

// Entrance + 3 distinct-category destinations -> 3 correctly-shaped samples.
{
  const pois = [
    { c: 'gate', n: 'Main Gate', lat: 40.1, lng: -82.1 },
    { c: 'coaster', n: 'Millennium Force', lat: 40.2, lng: -82.2 },
    { c: 'ride', n: 'Snake River Falls', lat: 40.3, lng: -82.3 },
    { c: 'show', n: 'Good Time Theatre', lat: 40.4, lng: -82.4 },
  ];
  const samples = deriveOrsRouteSamples(pois);
  assert.equal(samples.length, 3, 'one sample per distinct destination category');
  for (const s of samples) {
    assert.deepEqual(s.from, { lat: 40.1, lng: -82.1 });
    assert.ok(Number.isFinite(s.to.lat) && Number.isFinite(s.to.lng));
    assert.ok(s.label.startsWith('Main Gate'));
  }
}

// No entrance-like POI -> [] (never crashes, never guesses).
assert.deepEqual(
  deriveOrsRouteSamples([{ c: 'coaster', n: 'X', lat: 1, lng: 2 }]),
  [],
  'no gate/parking POI degrades to no samples',
);

// Fewer than 3 distinct destination categories -> [] (min-samples floor).
assert.deepEqual(
  deriveOrsRouteSamples([
    { c: 'gate', n: 'Gate', lat: 1, lng: 2 },
    { c: 'ride', n: 'Only Ride', lat: 3, lng: 4 },
  ]),
  [],
  'fewer than ORS_MIN_SAMPLES distinct categories degrades to no samples',
);

// POIs missing coordinates are filtered out before anything else runs.
assert.deepEqual(deriveOrsRouteSamples([{ c: 'gate', n: 'Gate' }]), [], 'gate POI without lat/lng is unusable');

// Empty / missing input never throws.
assert.deepEqual(deriveOrsRouteSamples([]), []);
assert.deepEqual(deriveOrsRouteSamples(), []);

console.log('ors-route-samples: ok');
