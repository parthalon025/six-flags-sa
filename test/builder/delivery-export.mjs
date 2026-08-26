#!/usr/bin/env node
/**
 * Delivery export from PostDB — factory program writes the phone bundle.
 *
 *   node test/builder/delivery-export.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { applyMigrations } from '../../scripts/postdb-migrate.mjs';
import { assembleExportBundle } from '../../packages/venue-builder/lib/delivery/export-from-postdb.mjs';
import { exportFromPostdb } from '../../packages/venue-builder/lib/delivery/export-from-postdb.mjs';
import { publishBundle } from '../../packages/venue-builder/lib/delivery/publish-bundle.mjs';
import { writeDisplayPack, writeTruth } from '../../packages/venue-builder/lib/postdb-io.mjs';
import { planBundleSync, bundleIndexOf } from '../../apps/party-tracker/lib/venue/download.js';
import { parseSinceParam, SINCE_QUERY } from '../../packages/venue-builder/lib/delivery/delta-sync.mjs';

const VENUE = 'fixture-park-export';
const SKIN = 'layered-atlas';
const REVISION = '11111111-1111-1111-1111-111111111111';
const STAMP = '2026-08-25';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const map = { meta: { id: VENUE, generated: STAMP }, path: [{ r: [[-84.268, 39.344]] }] };
const pois = [{ i: 'gate', n: 'Front Gate', lat: 39.344, lng: -84.268, c: 'gate' }];
const gaps = { version: 1, venue: VENUE, gaps: [] };
const spec = { version: 1, venue: VENUE, skin: SKIN, basedOn: { map: STAMP } };

const assembled = assembleExportBundle({
  venueId: VENUE,
  revisionId: REVISION,
  generated: STAMP,
  map,
  pois,
  gaps,
  displaySpecs: { [SKIN]: spec },
  extraFiles: new Map([
    [`/venues/${VENUE}/display/base.pmtiles`, Buffer.from('PMT!')],
  ]),
});

assert.deepEqual(assembled.basedOn, { map: STAMP, revisionId: REVISION });
assert.equal(assembled.bundle.venue, VENUE);
assert.equal(assembled.bundle.basedOn.revisionId, REVISION);
const paths = assembled.bundle.files.map((f) => f.path);
assert.deepEqual(paths, [
  `/venues/${VENUE}.gaps.json`,
  `/venues/${VENUE}.map.json`,
  `/venues/${VENUE}.pois.json`,
  `/venues/${VENUE}/display/base.pmtiles`,
  `/venues/${VENUE}/display/${SKIN}.visual.json`,
]);
const mapBuf = assembled.files.get(`/venues/${VENUE}.map.json`);
assert.equal(sha(mapBuf), assembled.bundle.files.find((f) => f.path.endsWith('.map.json')).sha256);

const plan = planBundleSync(assembled.bundle, bundleIndexOf(null));
assert.equal(plan.fetch.length, assembled.bundle.files.length);
assert.deepEqual(plan.drop, []);

assert.equal(await exportFromPostdb(VENUE), null, 'no DATABASE_URL → no export');

const filePublish = await publishBundle('kings-island', { skipReindex: true });
assert.equal(filePublish.revisionId, null);
assert.ok(filePublish.bundle?.files?.length, 'file fallback still reads the seed bundle');
assert.equal(filePublish.bundle.basedOn.revisionId, undefined);

assert.equal(SINCE_QUERY, 'since');
assert.deepEqual(parseSinceParam(new URLSearchParams('')), { since: null, mode: 'full' });

if (!process.env.DATABASE_URL) {
  console.log('delivery-export: ok (pure + file fallback; integration skipped)');
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await applyMigrations(client);
} finally {
  await client.end();
}

const { revisionId } = await writeTruth(VENUE, {
  map, pois, gaps, factory: 'map', routeId: 'map.truth',
});
await writeDisplayPack(VENUE, SKIN, spec, revisionId);

const venueDir = mkdtempSync(path.join(tmpdir(), 'postdb-export-'));
const displayDir = path.join(venueDir, VENUE, 'display');
mkdirSync(displayDir, { recursive: true });
writeFileSync(path.join(displayDir, 'base.pmtiles'), 'PMT!');

const exported = await exportFromPostdb(VENUE, {
  venueDir,
  displayDir,
  outFile: path.join(venueDir, `${VENUE}.bundle.json`),
});
assert.equal(exported.revisionId, revisionId);
assert.equal(exported.bundle.basedOn.revisionId, revisionId);
assert.equal(exported.bundle.basedOn.map, STAMP);

const writtenBundle = JSON.parse(readFileSync(path.join(venueDir, `${VENUE}.bundle.json`), 'utf8'));
assert.equal(writtenBundle.basedOn.revisionId, revisionId);
for (const entry of writtenBundle.files) {
  const rel = entry.path.replace('/venues/', '');
  const onDisk = readFileSync(path.join(venueDir, rel));
  assert.equal(sha(onDisk), entry.sha256, `${entry.path} export hash matches disk`);
}

const pool = await (await import('../../packages/venue-builder/lib/db/postgres.mjs')).getPool();
const blobs = await pool.query(
  'SELECT path, sha256 FROM artifact_blobs WHERE venue_id = $1 ORDER BY path',
  [VENUE],
);
assert.ok(blobs.rows.length >= 4, 'exported files registered as artifact blobs');

await pool.query('DELETE FROM artifact_blobs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM display_packs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM venue_heads WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM truth_revisions WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM factory_runs WHERE venue_id = $1', [VENUE]);

console.log('delivery-export: ok');
