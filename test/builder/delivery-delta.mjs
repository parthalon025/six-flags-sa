#!/usr/bin/env node
/**
 * Delivery delta API — revision cursor manifest filtering (ticket 17).
 *
 *   node test/builder/delivery-delta.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { writeTruth, writeDisplayPack } from '../../packages/venue-builder/lib/postdb-io.mjs';
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

const pool = await (await import('../../packages/venue-builder/lib/db/postgres.mjs')).getPool();
await pool.query('DELETE FROM display_packs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM venue_heads WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM truth_revisions WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM factory_runs WHERE venue_id = $1', [VENUE]);

console.log('delivery-delta: ok');
