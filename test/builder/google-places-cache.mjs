#!/usr/bin/env node
/**
 * google-places adapter cache seam — fixture runs must not rewrite tracked sidecars.
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { run as runGooglePlaces, googlePlacesCacheFile } from '../../packages/venue-builder/lib/adapters/google-places.mjs';

const FIXTURE = 'fixture-park';
const FIXTURE_CACHE = googlePlacesCacheFile(FIXTURE);
const TEST_VENUE = '__test-google-places-cache__';

const cleanup = () => {
  try {
    rmSync(new URL(`../../packages/venue-builder/data/venues/${TEST_VENUE}`, import.meta.url), {
      recursive: true,
      force: true,
    });
  } catch {
    // best-effort
  }
};

cleanup();

const fixtureBefore = readFileSync(FIXTURE_CACHE, 'utf8');

process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const offline = await runGooglePlaces({ venueId: FIXTURE, offline: true });
delete process.env.GOOGLE_MAPS_API_KEY;

assert.equal(offline.ok, true);
assert.equal(offline.offline, true);
assert.equal(offline.claims[0]?.displayName, 'Front Gate');
assert.equal(
  readFileSync(FIXTURE_CACHE, 'utf8'),
  fixtureBefore,
  'offline fixture run must not rewrite the tracked google-places-cache.json',
);

const fixedNow = '2026-01-15T12:00:00.000Z';
process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const fetched = await runGooglePlaces(
  { venueId: TEST_VENUE, placeIds: ['ChIJlive'], now: () => new Date(fixedNow) },
  {
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ id: 'ChIJlive', displayName: { text: 'Live Gate' } }),
    }),
  },
);
delete process.env.GOOGLE_MAPS_API_KEY;

assert.equal(fetched.ok, true);
assert.equal(fetched.claims[0].displayName, 'Live Gate');
const written = JSON.parse(readFileSync(googlePlacesCacheFile(TEST_VENUE), 'utf8'));
assert.equal(written.fetched, fixedNow, 'a genuine fetch must stamp fetched from the live clock');

cleanup();

console.log('google-places-cache: ok');
