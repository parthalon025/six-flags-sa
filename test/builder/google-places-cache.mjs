#!/usr/bin/env node
/**
 * Ticket 34 — builder tests must not rewrite tracked fixture caches.
 *
 *   node test/builder/google-places-cache.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as runGooglePlaces } from '../../packages/venue-builder/lib/adapters/google-places.mjs';
import { googlePlacesCacheFile } from '../../packages/venue-builder/lib/adapters/google-places.mjs';
import { readCache } from '../../packages/venue-builder/lib/adapters/_cache.mjs';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_CACHE = path.join(
  root,
  'packages/venue-builder/data/venues/fixture-park/google-places-cache.json',
);
const SCRATCH_VENUE = '__test-google-places-cache__';

function gitPorcelain(relativePath) {
  return execFileSync('git', ['status', '--porcelain', '--', relativePath], {
    cwd: root,
    encoding: 'utf8',
    env: scrubGitEnv(),
  }).trim();
}

function cleanupScratchVenue() {
  const dir = path.dirname(googlePlacesCacheFile(SCRATCH_VENUE));
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

cleanupScratchVenue();

const fixedIso = '2026-01-15T12:00:00.000Z';
process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const fetched = await runGooglePlaces(
  {
    venueId: SCRATCH_VENUE,
    placeIds: ['ChIJscratch'],
    now: () => new Date(fixedIso),
  },
  {
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ id: 'ChIJscratch', displayName: { text: 'Scratch Gate' } }),
    }),
  },
);
delete process.env.GOOGLE_MAPS_API_KEY;

assert.equal(fetched.ok, true);
const scratchCache = readCache(SCRATCH_VENUE, 'google-places');
assert.equal(scratchCache.fetched, fixedIso, 'a live fetch must stamp fetched on a genuine write');
assert.equal(scratchCache.claims[0].displayName, 'Scratch Gate');
cleanupScratchVenue();

const beforeOffline = readFileSync(FIXTURE_CACHE, 'utf8');
await runGooglePlaces({ venueId: 'fixture-park', offline: true });
assert.equal(
  readFileSync(FIXTURE_CACHE, 'utf8'),
  beforeOffline,
  'offline replay must not rewrite a tracked fixture cache',
);
assert.equal(
  gitPorcelain('packages/venue-builder/data/venues/fixture-park/google-places-cache.json'),
  '',
  'offline replay must leave git porcelain clean for the fixture cache',
);

execFileSync('node', ['test/builder/imagery-claims.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: scrubGitEnv(),
});
assert.equal(
  gitPorcelain('packages/venue-builder/data/venues/fixture-park/google-places-cache.json'),
  '',
  'imagery-claims must not rewrite fixture-park google-places-cache.json',
);

console.log('google-places-cache: ok');
