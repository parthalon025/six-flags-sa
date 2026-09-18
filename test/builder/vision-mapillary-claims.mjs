#!/usr/bin/env node
/** Vision agent — mapillary-tools ground-ingest cache → evidence claims (#408). */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VENUE_DIR } from '../../packages/venue-builder/src/paths.mjs';
import { writeCache } from '../../packages/venue-builder/lib/adapters/_cache.mjs';
import { videoClaims } from '../../packages/venue-builder/lib/adapters/mapillary-video.mjs';
import { attractionFor, FEATURES } from '../../packages/venue-builder/lib/attractions.mjs';
import {
  mapillaryVideoClaimBatch,
  snapClaimsToRides,
} from '../../packages/venue-builder/lib/external-claims.mjs';
import {
  applyVisionMapillaryClaims,
  enqueueVisionMapillaryClaims,
  resolveMapillaryToolsStatus,
  reviewKeyForVisionMapillary,
} from '../../packages/venue-builder/lib/vision-mapillary-claims.mjs';
import { runVisionAgent } from '../../packages/venue-builder/lib/agents/vision.mjs';

const TEST_VENUE = '__test-vision-mapillary__';
const pois = [
  { n: 'Orion', i: 'ki-orion', c: 'coaster', lat: 39.344, lng: -84.268 },
];

const frames = [
  { filename: 'f0001.jpg', lat: 39.3445, lng: -84.2685, capturedAt: 1755000000000 },
  { filename: 'f0002.jpg', lat: 39.3444, lng: -84.2684, capturedAt: 1755000001000 },
];

const cache = {
  fetched: '2026-09-18T12:00:00',
  source: 'mapillary_tools video_process',
  frames,
};

// --- snapClaimsToRides: video source (#408) ---
const snapped = snapClaimsToRides(videoClaims(frames), pois);
assert.equal(snapped.length, 2);
assert.equal(snapped[0].ride, 'Orion');
assert.equal(snapped[0].source, 'video');
assert.equal(snapped[0].type, 'queue_entrance');

// --- pure claim batch ---
const batch = mapillaryVideoClaimBatch(cache, pois);
assert.equal(batch.frameCount, 2);
assert.equal(batch.claims.length, 2);
assert.equal(batch.claims[0].source, 'video');

const emptyBatch = mapillaryVideoClaimBatch({ frames: [] }, pois);
assert.equal(emptyBatch.frameCount, 0);
assert.deepEqual(emptyBatch.claims, []);

// --- review keys + apply ---
const record = attractionFor(pois[0], TEST_VENUE);
for (const f of FEATURES) {
  record.features[f] ||= { at: null, confidence: 'unknown', score: 0, sources: [], evidence: [] };
}

const key = reviewKeyForVisionMapillary({
  place: 'ki-orion',
  feature: 'queue_entrance',
  filename: 'walkthrough',
});
assert.equal(key, 'vision-mapillary:ki-orion:queue_entrance:walkthrough');

const applied = applyVisionMapillaryClaims([record], batch.claims, { asOf: '2026-09-18' });
assert.equal(applied.applied, 2);
assert.equal(applied.frameCount, 2);
assert.deepEqual(applied.reviewKeys, [key]);
assert.equal(record.features.queue_entrance.evidence.length, 1, 'addEvidence folds one row per source');
assert.equal(record.features.queue_entrance.evidence[0].pending, true);
assert.equal(record.features.queue_entrance.evidence[0].frameCount, 2);

// --- deferred vs available-unused ---
assert.deepEqual(resolveMapillaryToolsStatus({ frameCount: 2 }), {
  deferred: ['sam2', 'opensfm'],
  availableUnused: [],
});
assert.deepEqual(resolveMapillaryToolsStatus({ frameCount: 0 }), {
  deferred: ['sam2', 'opensfm'],
  availableUnused: ['mapillary-tools'],
});

// --- enqueue: no cache ---
const noop = enqueueVisionMapillaryClaims('no-such-venue-id', {
  dryRun: true,
  map: {},
  pois,
});
assert.equal(noop.frameCount, 0);
assert.match(noop.skipped, /no mapillary-video cache/);

// --- enqueue: with cache (dry run) ---
writeCache(TEST_VENUE, 'mapillary-video', cache);
const persisted = enqueueVisionMapillaryClaims(TEST_VENUE, {
  dryRun: true,
  map: {},
  pois,
});
assert.equal(persisted.frameCount, 2);
assert.equal(persisted.applied, 2);
assert.equal(persisted.skipped, null);
assert.ok(persisted.mapillaryProposals?.length >= 1);
assert.match(persisted.mapillaryProposals[0].note, /walkthrough frames/);

// --- runVisionAgent integration ---
mkdirSync(VENUE_DIR, { recursive: true });
writeFileSync(path.join(VENUE_DIR, `${TEST_VENUE}.pois.json`), `${JSON.stringify(pois)}\n`);
writeFileSync(path.join(VENUE_DIR, `${TEST_VENUE}.map.json`), '{}\n');

const withCache = await runVisionAgent(TEST_VENUE, { dryRun: true });
assert.equal(withCache.mapillaryGround?.frameCount, 2);
assert.deepEqual(withCache.deferred, ['sam2', 'opensfm']);
assert.deepEqual(withCache.availableUnused, []);
assert.ok(!withCache.deferred.includes('mapillary-tools'));

const withoutCache = await runVisionAgent('no-such-venue-id', { dryRun: true });
assert.equal(withoutCache.mapillaryGround?.frameCount, 0);
assert.deepEqual(withoutCache.deferred, ['sam2', 'opensfm']);
assert.deepEqual(withoutCache.availableUnused, ['mapillary-tools']);

try {
  rmSync(new URL(`../../packages/venue-builder/data/venues/${TEST_VENUE}`, import.meta.url), {
    recursive: true,
    force: true,
  });
  rmSync(path.join(VENUE_DIR, `${TEST_VENUE}.pois.json`), { force: true });
  rmSync(path.join(VENUE_DIR, `${TEST_VENUE}.map.json`), { force: true });
} catch {
  // best-effort cleanup
}

console.log('vision-mapillary-claims tests ok');
