#!/usr/bin/env node
/**
 * Google Places adapter — cache write behaviour at the public run() seam.
 * Issue #34: fixture tests must not mutate tracked sidecars.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as runGooglePlaces } from '../../packages/venue-builder/lib/adapters/google-places.mjs';

const FIXTURE_CACHE = join(
  process.cwd(),
  'packages/venue-builder/data/venues/fixture-park/google-places-cache.json',
);
const fixtureBefore = readFileSync(FIXTURE_CACHE, 'utf8');

const tmpDir = mkdtempSync(join(tmpdir(), 'google-places-'));
const cacheFile = join(tmpDir, 'google-places-cache.json');
writeFileSync(
  cacheFile,
  `${JSON.stringify({ placeIds: ['ChIJoffline'], claims: [{ kind: 'metadata', source: 'google-places', placeId: 'ChIJoffline', displayName: 'Cached Gate' }] }, null, 2)}\n`,
);

process.env.GOOGLE_MAPS_API_KEY = 'test-key';

const offline = await runGooglePlaces({ venueId: 'fixture-park', offline: true, cacheFile });
assert.equal(offline.ok, true);
assert.equal(offline.offline, true);
assert.equal(offline.claims[0].displayName, 'Cached Gate');
assert.equal(
  readFileSync(cacheFile, 'utf8'),
  `${JSON.stringify({ placeIds: ['ChIJoffline'], claims: [{ kind: 'metadata', source: 'google-places', placeId: 'ChIJoffline', displayName: 'Cached Gate' }] }, null, 2)}\n`,
  'offline run must not rewrite the cache file',
);

const fetched = await runGooglePlaces(
  { venueId: 'fixture-park', placeIds: ['ChIJlive'], cacheFile },
  {
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ id: 'ChIJlive', displayName: { text: 'Live Gate' } }),
    }),
    now: () => '2026-08-28T12:00:00.000Z',
  },
);
assert.equal(fetched.ok, true);
assert.equal(fetched.claims[0].displayName, 'Live Gate');
const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
assert.equal(cached.fetched, '2026-08-28T12:00:00.000Z', 'live fetch records the fetch instant in cache');

const realNow = await runGooglePlaces(
  { venueId: 'fixture-park', placeIds: ['ChIJreal'], cacheFile: join(tmpDir, 'real-now.json') },
  {
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ id: 'ChIJreal', displayName: { text: 'Real Clock' } }),
    }),
  },
);
assert.equal(realNow.ok, true);
const realCached = JSON.parse(readFileSync(join(tmpDir, 'real-now.json'), 'utf8'));
assert.match(realCached.fetched, /^\d{4}-\d{2}-\d{2}T/, 'genuine fetch uses a real ISO timestamp when now is not injected');

delete process.env.GOOGLE_MAPS_API_KEY;
rmSync(tmpDir, { recursive: true, force: true });

assert.equal(
  readFileSync(FIXTURE_CACHE, 'utf8'),
  fixtureBefore,
  'tracked fixture-park sidecar must be untouched by this suite',
);

console.log('google-places: ok');
