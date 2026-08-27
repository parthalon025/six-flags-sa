#!/usr/bin/env node
/**
 * Delivery seed + export — idempotent PostDB seed from file truth (ticket 16).
 *
 *   node test/builder/delivery-seed-export.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { applyMigrations } from '../../scripts/postdb-migrate.mjs';
import { seedVenueFromFiles } from '../../packages/venue-builder/lib/delivery/seed-postdb-from-files.mjs';
import { exportFromPostdb } from '../../packages/venue-builder/lib/delivery/export-from-postdb.mjs';
import { getHeadOutputsHash } from '../../packages/venue-builder/lib/postdb-io.mjs';
import { readTruthFromFiles } from '../../packages/venue-builder/lib/map-factory/map-io.mjs';

const VENUE = 'kings-island';

const truth = readTruthFromFiles(VENUE);
assert.ok(truth.map?.meta?.generated, 'KI has a truth stamp');

if (!process.env.DATABASE_URL) {
  console.log('delivery-seed-export: ok (pure read; integration skipped — no DATABASE_URL)');
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await applyMigrations(client);
} finally {
  await client.end();
}

const first = await seedVenueFromFiles(VENUE);
assert.ok(first?.revisionId, 'first seed returns revisionId');
const hashAfterFirst = await getHeadOutputsHash(VENUE);

const second = await seedVenueFromFiles(VENUE);
assert.equal(second?.revisionId, first.revisionId, 'idempotent seed reuses head revision');
assert.equal(second?.created, false, 'second seed does not create a revision');
assert.equal(await getHeadOutputsHash(VENUE), hashAfterFirst);

const venueDir = mkdtempSync(path.join(tmpdir(), 'seed-export-'));
const displayDir = path.join(venueDir, VENUE, 'display');
const exported = await exportFromPostdb(VENUE, {
  venueDir,
  displayDir,
  outFile: path.join(venueDir, `${VENUE}.bundle.json`),
});
assert.equal(exported.revisionId, first.revisionId);
assert.equal(exported.bundle.basedOn.revisionId, first.revisionId);
assert.equal(exported.bundle.basedOn.map, truth.map.meta.generated);

const written = JSON.parse(readFileSync(path.join(venueDir, `${VENUE}.bundle.json`), 'utf8'));
assert.equal(written.basedOn.revisionId, first.revisionId);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
for (const entry of written.files) {
  const rel = entry.path.replace('/venues/', '');
  const onDisk = readFileSync(path.join(venueDir, rel));
  assert.equal(sha(onDisk), entry.sha256, `${entry.path} hash matches`);
}

const pool = await (await import('../../packages/venue-builder/lib/db/postgres.mjs')).getPool();
await pool.query('DELETE FROM artifact_blobs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM display_packs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM venue_heads WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM truth_revisions WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM factory_runs WHERE venue_id = $1', [VENUE]);

console.log('delivery-seed-export: ok');
