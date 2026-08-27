#!/usr/bin/env node
/**
 * App bundle delta sync — mirrors `resolveSyncManifest` + shipped seed bundles (ticket 17).
 *
 *   node test/app/venue-delta-api.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from '../../scripts/postdb-migrate.mjs';
import { resolveSyncManifest } from '../../packages/venue-builder/lib/delivery/resolve-sync-manifest.mjs';
import { writeTruth, writeDisplayPack } from '../../packages/venue-builder/lib/postdb-io.mjs';
import { assembleExportBundle } from '../../packages/venue-builder/lib/delivery/export-from-postdb.mjs';

const PUBLIC_VENUES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/party-tracker/public/venues',
);

const VENUE = 'fixture-park-app-delta';
const SKIN = 'layered-atlas';
const STAMP = '2026-08-27';

const mapV1 = { meta: { id: VENUE, generated: STAMP }, path: [{ r: [[-84.268, 39.344]] }] };
const mapV2 = { meta: { id: VENUE, generated: STAMP }, path: [{ r: [[-84.269, 39.345]] }] };
const pois = [{ i: 'gate', n: 'Front Gate', lat: 39.344, lng: -84.268, c: 'gate' }];
const gaps = { version: 1, venue: VENUE, gaps: [] };
const spec = { version: 1, venue: VENUE, skin: SKIN, basedOn: { map: STAMP } };

const bundle2 = assembleExportBundle({
  venueId: VENUE,
  revisionId: '55555555-5555-5555-5555-555555555555',
  generated: STAMP,
  map: mapV2,
  pois,
  gaps,
  displaySpecs: { [SKIN]: spec },
}).bundle;

const seedManifest = JSON.parse(
  readFileSync(path.join(PUBLIC_VENUES, 'kings-island.bundle.json'), 'utf8'),
);
assert.ok(seedManifest.basedOn?.revisionId, 'shipped seed bundle exposes revision cursor');

if (!process.env.DATABASE_URL) {
  console.log('venue-delta-api: ok (seed manifest; PostDB integration skipped)');
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

const full = await resolveSyncManifest(VENUE, new URLSearchParams(), { venueDir: PUBLIC_VENUES });
assert.equal(full.mode, 'full');
assert.equal(full.manifest.basedOn.revisionId, second.revisionId);
assert.equal(full.manifest.files.length, bundle2.files.length);

const delta = await resolveSyncManifest(
  VENUE,
  new URLSearchParams(`since=${first.revisionId}`),
  { venueDir: PUBLIC_VENUES },
);
assert.equal(delta.mode, 'delta');
assert.ok(delta.manifest.files.length > 0, 'delta returns changed files');
assert.ok(delta.manifest.files.length < full.manifest.files.length, 'delta is smaller than full');

const current = await resolveSyncManifest(
  VENUE,
  new URLSearchParams(`since=${second.revisionId}`),
  { venueDir: PUBLIC_VENUES },
);
assert.equal(current.mode, 'delta');
assert.equal(current.manifest.files.length, 0, 'since=head is up to date');

const pool = await (await import('../../packages/venue-builder/lib/db/postgres.mjs')).getPool();
await pool.query('DELETE FROM display_packs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM venue_heads WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM truth_revisions WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM factory_runs WHERE venue_id = $1', [VENUE]);

console.log('venue-delta-api: ok');
