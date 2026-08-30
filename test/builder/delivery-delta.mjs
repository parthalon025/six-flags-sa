#!/usr/bin/env node
/**
 * Delivery delta API — revision cursor manifest filtering (ticket 17).
 *
 *   node test/builder/delivery-delta.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { applyMigrations } from '../../scripts/postdb-migrate.mjs';
import {
  changedFiles,
  DELTA_STATUS,
  filesForSync,
  manifestForSync,
  parseSinceParam,
} from '../../packages/venue-builder/lib/delivery/delta-sync.mjs';
import { assembleExportBundle } from '../../packages/venue-builder/lib/delivery/export-from-postdb.mjs';
import { resolveSyncManifest } from '../../packages/venue-builder/lib/delivery/resolve-sync-manifest.mjs';
import { writeTruth, writeDisplayPack, readTruth } from '../../packages/venue-builder/lib/postdb-io.mjs';
import { serializeVenue } from '../../packages/venue-builder/lib/venue-io.mjs';
import { bundleSyncUrl, planBundleSync, bundleIndexOf, mergeManifestDelta } from '../../apps/party-tracker/lib/venue/download.js';

const VENUE = 'fixture-park-delta';
const SKIN = 'layered-atlas';
const STAMP = '2026-08-26';
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

assert.equal(DELTA_STATUS, 'live');

const mapV1 = { meta: { id: VENUE, generated: STAMP }, path: [{ r: [[-84.268, 39.344]] }] };
const mapV2 = { meta: { id: VENUE, generated: STAMP }, path: [{ r: [[-84.269, 39.345]] }] };
const pois = [{ i: 'gate', n: 'Front Gate', lat: 39.344, lng: -84.268, c: 'gate' }];
const gaps = { version: 1, venue: VENUE, gaps: [] };
const spec = { version: 1, venue: VENUE, skin: SKIN, basedOn: { map: STAMP } };

const rev1 = '22222222-2222-2222-2222-222222222222';
const rev2 = '33333333-3333-3333-3333-333333333333';

const bundle1 = assembleExportBundle({
  venueId: VENUE,
  revisionId: rev1,
  generated: STAMP,
  map: mapV1,
  pois,
  gaps,
  displaySpecs: { [SKIN]: spec },
}).bundle;

const bundle2 = assembleExportBundle({
  venueId: VENUE,
  revisionId: rev2,
  generated: STAMP,
  map: mapV2,
  pois,
  gaps,
  displaySpecs: { [SKIN]: spec },
}).bundle;

assert.deepEqual(parseSinceParam(new URLSearchParams('')), { since: null, mode: 'full' });
assert.deepEqual(parseSinceParam(new URLSearchParams('since=rev-1')), { since: 'rev-1', mode: 'delta' });

const changed = changedFiles(bundle2, bundle1);
assert.ok(changed.some((f) => f.path.endsWith('.map.json')));
assert.ok(changed.every((f) => !f.path.endsWith('.pois.json')) || changed.length >= 1);

const delta = manifestForSync(bundle2, { since: rev1, prior: bundle1, priorKnown: true });
assert.equal(delta.mode, 'delta');
assert.ok(delta.manifest.files.length < bundle2.files.length);

const unknown = manifestForSync(bundle2, { since: '00000000-0000-0000-0000-000000000000', prior: null, priorKnown: false });
assert.equal(unknown.mode, 'full');

const upToDate = manifestForSync(bundle2, { since: rev2, prior: bundle2, priorKnown: true });
assert.equal(upToDate.mode, 'delta');
assert.equal(upToDate.manifest.files.length, 0);

const syncPlan = filesForSync(bundle2, rev1, bundle1, true);
assert.equal(syncPlan.stub, false);
assert.ok(syncPlan.files.length > 0);

const priorIndex = bundleIndexOf(bundle1);
const merged = mergeManifestDelta(bundle1, delta.manifest);
const plan = planBundleSync(merged, priorIndex);
assert.ok(plan.fetch.length >= 1);
assert.ok(plan.keep.length >= 1, 'hash dedup skips unchanged blobs');

assert.match(bundleSyncUrl({ id: VENUE }, rev1), /\/api\/venues\/fixture-park-delta\/bundle\?since=/);
assert.equal(bundleSyncUrl({ id: VENUE }, null), `/venues/${VENUE}.bundle.json`);

if (!process.env.DATABASE_URL) {
  console.log('delivery-delta: ok (pure; integration skipped)');
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await applyMigrations(client);
} finally {
  await client.end();
}

const first = await writeTruth(VENUE, {
  map: mapV1, pois, gaps, factory: 'map', routeId: 'map.truth',
});
await writeDisplayPack(VENUE, SKIN, spec, first.revisionId);

const second = await writeTruth(VENUE, {
  map: mapV2, pois, gaps, factory: 'map', routeId: 'map.truth',
});
await writeDisplayPack(VENUE, SKIN, spec, second.revisionId);

const full = await resolveSyncManifest(VENUE, new URLSearchParams());
assert.equal(full.mode, 'full');
assert.equal(full.manifest.basedOn.revisionId, second.revisionId);

const filtered = await resolveSyncManifest(VENUE, new URLSearchParams(`since=${first.revisionId}`));
assert.equal(filtered.mode, 'delta');
assert.ok(filtered.manifest.files.length < full.manifest.files.length);

// --- the head manifest must hash the bytes the origin serves, not a JSONB round-trip ---
//
// PostDB stores truth as JSONB, which normalises object key order to (length, then
// bytewise). Rebuilding the trio from those columns therefore yields the same key set
// and a DIFFERENT sha256 than the `public/venues/*.json` bytes the origin actually
// serves. If the head manifest pinned the rebuilt bytes, every phone on the delta route
// would fetch the disk file, hash it, mismatch the pin, refuse to commit the manifest,
// and replan identically on every launch — a silent, permanent sync failure.
const PINNED = 'fixture-park-pinned';
const pinnedDir = mkdtempSync(path.join(os.tmpdir(), 'delivery-delta-'));
mkdirSync(path.join(pinnedDir, PINNED, 'display'), { recursive: true });

// Key orders chosen so JSONB is guaranteed to reorder them: shipped POIs read
// {i, n, lat, lng, c, a} and come back out of the column as {a, c, i, n, lat, lng}.
const pinnedMeta = { id: PINNED, name: 'Pinned Park', generated: STAMP, bounds: { north: 39.35, south: 39.33, east: -84.25, west: -84.28 } };
const pinnedLayers = { path: [{ r: [[-84.268, 39.344]] }], building: [{ r: [[-84.267, 39.343]] }] };
const pinnedPois = [{ i: 'gate', n: 'Front Gate', lat: 39.344, lng: -84.268, c: 'gate', a: 'Midway' }];
const pinnedGaps = { version: 1, venue: PINNED, gaps: [{ type: 'height', target: 'gate' }] };

// Written exactly as writeVenue writes them, so these are authentic origin bytes.
const shipped = serializeVenue({ meta: pinnedMeta, map: pinnedLayers, pois: pinnedPois, gaps: pinnedGaps });
for (const kind of ['map', 'pois', 'gaps']) {
  writeFileSync(path.join(pinnedDir, `${PINNED}.${kind}.json`), shipped[kind]);
}

const pinnedRev1 = await writeTruth(PINNED, {
  map: { meta: pinnedMeta, ...pinnedLayers }, pois: pinnedPois, gaps: pinnedGaps,
  factory: 'map', routeId: 'map.truth',
});

const head = await resolveSyncManifest(PINNED, new URLSearchParams(), { venueDir: pinnedDir });
assert.equal(head.mode, 'full');

// Guard: if storage ever stopped reordering keys this test would pass vacuously.
const fromColumn = await readTruth(PINNED);
const roundTripped = Buffer.from(serializeVenue({
  meta: pinnedMeta, map: pinnedLayers, pois: fromColumn.pois, gaps: pinnedGaps,
}).pois);
assert.notEqual(sha(roundTripped), sha(Buffer.from(shipped.pois)), 'JSONB still reorders keys — the pin is load-bearing');

// The phone's check, run for real: hash every byte the origin would serve.
const unverifiable = [];
for (const entry of head.manifest.files) {
  const local = path.join(pinnedDir, entry.path.replace(/^\/venues\//, ''));
  if (sha(readFileSync(local)) !== entry.sha256) unverifiable.push(entry.path);
}
assert.deepEqual(unverifiable, [], 'every head manifest hash matches the shipped bytes');

// ...and the prior revision must NOT be pinned to disk, or a real truth change would
// hash alike on both sides and drop out of the delta, so the phone stops re-fetching it.
const pinnedMeta2 = { ...pinnedMeta, generated: '2026-08-30' };
const pinnedLayers2 = { path: [{ r: [[-84.269, 39.345]] }], building: [{ r: [[-84.267, 39.343]] }] };
await writeTruth(PINNED, {
  map: { meta: pinnedMeta2, ...pinnedLayers2 }, pois: pinnedPois, gaps: pinnedGaps,
  factory: 'map', routeId: 'map.truth',
});
const shipped2 = serializeVenue({ meta: pinnedMeta2, map: pinnedLayers2, pois: pinnedPois, gaps: pinnedGaps });
for (const kind of ['map', 'pois', 'gaps']) {
  writeFileSync(path.join(pinnedDir, `${PINNED}.${kind}.json`), shipped2[kind]);
}

const moved = await resolveSyncManifest(
  PINNED, new URLSearchParams(`since=${pinnedRev1.revisionId}`), { venueDir: pinnedDir },
);
assert.equal(moved.mode, 'delta');
const movedPaths = moved.manifest.files.map((f) => f.path);
assert.ok(movedPaths.includes(`/venues/${PINNED}.map.json`), 'a changed map still reaches the delta');
const movedMap = moved.manifest.files.find((f) => f.path === `/venues/${PINNED}.map.json`);
assert.equal(
  movedMap.sha256,
  sha(readFileSync(path.join(pinnedDir, `${PINNED}.map.json`))),
  'the delta entry hashes the new shipped bytes',
);

const pool = await (await import('../../packages/venue-builder/lib/db/postgres.mjs')).getPool();
for (const table of ['display_packs', 'venue_heads', 'truth_revisions', 'factory_runs']) {
  await pool.query(`DELETE FROM ${table} WHERE venue_id = $1`, [PINNED]);
}
await pool.query('DELETE FROM display_packs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM venue_heads WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM truth_revisions WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM factory_runs WHERE venue_id = $1', [VENUE]);

console.log('delivery-delta: ok');
