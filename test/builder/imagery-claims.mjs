#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, rmSync, statSync } from 'node:fs';
import {
  CI_PROVEN_PASSES,
  compareToOsm,
  osmPathMap,
  routeImageryExtractions,
  runImageryClaims,
} from '../../packages/venue-builder/lib/imagery-claims.mjs';
import {
  googlePlacesCacheFile,
  run as runGooglePlaces,
} from '../../packages/venue-builder/lib/adapters/google-places.mjs';
import { getAdapter } from '../../packages/venue-builder/lib/adapters/registry.mjs';
import {
  buildOsmChangeProposal,
  writeOsmProposalFile,
} from '../../packages/venue-builder/lib/osm-writeback.mjs';
import { SHIPPED_GAP_TYPES } from '../../packages/venue-builder/lib/ship-gaps.mjs';

const FIXTURE_VENUE = 'fixture-park';
const FETCH_TEST_VENUE = '__test-google-places-fetch__';

function scrubGooglePlacesCache(venueId) {
  try {
    rmSync(googlePlacesCacheFile(venueId));
  } catch {
    // absent is fine
  }
}

const geoMap = {
  layers: {
    path: [{
      geometry: { coordinates: [[-84.268, 39.344], [-84.267, 39.345]] },
    }],
  },
};
const factoryMap = {
  path: [{ r: [[-84.268, 39.344], [-84.267, 39.345]] }],
};

const near = { lat: 39.344, lng: -84.268 };
const far = { lat: 39.4, lng: -84.3 };
const offset = { lat: 39.344, lng: -84.26818 };

assert.equal(compareToOsm({ at: far }, { map: geoMap }).relation, 'adds');
assert.equal(compareToOsm({ at: near }, { map: geoMap }).relation, 'agrees');
assert.equal(compareToOsm({ at: offset }, { map: geoMap }).relation, 'disputes');
assert.equal(compareToOsm({ at: offset }, { map: factoryMap }).relation, 'disputes');
assert.equal(osmPathMap(factoryMap).path[0].r.length, 2);

const routed = routeImageryExtractions([
  { lane: 'model', kind: 'path', at: far, label: 'new-walk' },
  { lane: 'deterministic', deterministic: true, passId: 'unproven', kind: 'path', at: far },
  { lane: 'agent', kind: 'path', at: offset, label: 'moved-walk' },
], { map: factoryMap });

assert.equal(routed.truth.length, 0, 'Lane A without a CI-proven pass never writes truth');
assert.equal(CI_PROVEN_PASSES.length, 0, 'no pass is proven until CI says so');
assert.equal(typeof CI_PROVEN_PASSES.add, 'undefined', 'the proven-pass list cannot grow at runtime');
assert.ok(routed.claims.some((c) => c.kind === 'path' && !c.dissent));
assert.equal(routed.gaps.length, 1);
assert.equal(routed.gaps[0].type, 'path_disputed');
assert.equal(routed.gaps[0].target, null);
assert.ok(SHIPPED_GAP_TYPES.includes('path_disputed'));

const run = runImageryClaims('kings-island', { map: factoryMap, extractions: [] });
assert.equal(run.venue, 'kings-island');
assert.deepEqual(run.gaps, []);

const places = getAdapter('google-places');
assert.ok(places);
assert.equal(places.stage, 'research');
assert.deepEqual(places.evidence_sources, []);

const prevKey = process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_MAPS_API;
const missingKey = await runGooglePlaces({ venueId: FIXTURE_VENUE });
assert.equal(missingKey.gap, true);
assert.equal(missingKey.ok, false);
if (prevKey) process.env.GOOGLE_MAPS_API_KEY = prevKey;

const fixtureCachePath = googlePlacesCacheFile(FIXTURE_VENUE);
const fixtureCacheBefore = readFileSync(fixtureCachePath, 'utf8');
const fixtureMtimeBefore = statSync(fixtureCachePath).mtimeMs;

const offlineReplay = await runGooglePlaces(
  { venueId: FIXTURE_VENUE, offline: true, placeIds: ['ChIJtest'] },
  {
    fetchFn: async () => {
      throw new Error('offline must not fetch');
    },
  },
);
assert.equal(offlineReplay.ok, true);
assert.equal(offlineReplay.offline, true);
assert.equal(
  readFileSync(fixtureCachePath, 'utf8'),
  fixtureCacheBefore,
  'offline replay must not rewrite the tracked fixture cache',
);
assert.equal(
  statSync(fixtureCachePath).mtimeMs,
  fixtureMtimeBefore,
  'offline replay must not touch the fixture cache mtime',
);

scrubGooglePlacesCache(FETCH_TEST_VENUE);
process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const fetchedAt = '2026-08-28T12:34:56.789Z';
const fetched = await runGooglePlaces(
  { venueId: FETCH_TEST_VENUE, placeIds: ['ChIJtest'] },
  {
    now: () => new Date(fetchedAt),
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ id: 'ChIJtest', displayName: { text: 'Front Gate' } }),
    }),
  },
);
delete process.env.GOOGLE_MAPS_API_KEY;
assert.equal(fetched.ok, true);
assert.equal(fetched.claims[0].displayName, 'Front Gate');
const written = JSON.parse(readFileSync(googlePlacesCacheFile(FETCH_TEST_VENUE), 'utf8'));
assert.equal(written.fetched, fetchedAt, 'a genuine fetch stamps fetched on the cache row');
scrubGooglePlacesCache(FETCH_TEST_VENUE);

scrubGooglePlacesCache('__test-google-places-now-default__');
process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const beforeFetch = Date.now();
await runGooglePlaces(
  { venueId: '__test-google-places-now-default__', placeIds: ['ChIJnow'] },
  {
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ id: 'ChIJnow', displayName: { text: 'Clock Gate' } }),
    }),
  },
);
delete process.env.GOOGLE_MAPS_API_KEY;
const defaultWritten = JSON.parse(readFileSync(googlePlacesCacheFile('__test-google-places-now-default__'), 'utf8'));
const fetchedMs = Date.parse(defaultWritten.fetched);
assert.ok(Number.isFinite(fetchedMs), 'default fetch path writes a parseable fetched timestamp');
assert.ok(fetchedMs >= beforeFetch - 1000 && fetchedMs <= Date.now() + 1000, 'default fetch path uses wall-clock time');
scrubGooglePlacesCache('__test-google-places-now-default__');

const proposal = buildOsmChangeProposal({ venueId: 'kings-island', claim: { note: 'path position disputed' } });
assert.equal(proposal.status, 'draft');
let invoked = 0;
const refused = writeOsmProposalFile('kings-island', proposal, {
  accepted: false,
  write: () => { invoked += 1; },
});
assert.equal(refused.wrote, false);
assert.equal(invoked, 0, 'a refused write must not touch the sink');
const noSink = writeOsmProposalFile('kings-island', proposal, { accepted: true });
assert.equal(noSink.wrote, false);
const accepted = writeOsmProposalFile('kings-island', proposal, { accepted: true, write: () => { invoked += 1; } });
assert.equal(accepted.wrote, true);
assert.equal(invoked, 1);

const { gapsDocumentFor } = await import('../../packages/venue-builder/lib/venue-io.mjs');
const shipped = gapsDocumentFor({
  meta: { id: 'fixture-park' },
  pois: [],
  map: factoryMap,
  extractions: [{ lane: 'agent', kind: 'path', at: offset, label: 'moved-walk' }],
});
assert.ok(
  shipped.gaps.some((g) => g.type === 'path_disputed'),
  'a disputed extraction reaches the document the phone fetches',
);

console.log('imagery-claims: ok');
