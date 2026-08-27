#!/usr/bin/env node
/**
 * PostDB sync helpers — map/visual mirror when DATABASE_URL is set.
 *
 *   node test/builder/postdb-sync.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { applyMigrations } from '../../scripts/postdb-migrate.mjs';
import { mirrorTruthToPostdb } from '../../packages/venue-builder/lib/map-factory/postdb-sync.mjs';
import { mirrorDisplayPacksToPostdb } from '../../packages/venue-builder/lib/visual-factory/postdb-sync.mjs';
import { readTruthAsync } from '../../packages/venue-builder/lib/map-factory/map-io.mjs';
import { readDisplayPack } from '../../packages/venue-builder/lib/postdb-io.mjs';

const VENUE = 'fixture-park-sync';
const SKIN = 'layered-atlas';

if (!process.env.DATABASE_URL) {
  assert.equal(await mirrorTruthToPostdb(VENUE, { map: {}, pois: [] }), null);
  assert.deepEqual(await mirrorDisplayPacksToPostdb(VENUE, {}), []);
  const truth = await readTruthAsync('kings-island');
  assert.ok(truth.map && truth.pois?.length, 'readTruthAsync falls back to files');
  console.log('postdb-sync: skipped integration (no DATABASE_URL)');
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await applyMigrations(client);
} finally {
  await client.end();
}

const stamp = '2026-08-24T14:00:00.000Z';
const map = { meta: { id: VENUE, generated: stamp }, path: [] };
const pois = [{ i: 'gate', n: 'Gate', lat: 39.34, lng: -84.27, c: 'gate' }];
const gaps = { version: 1, venue: VENUE, gaps: [] };

const { revisionId } = await mirrorTruthToPostdb(VENUE, { map, pois, gaps });
assert.ok(revisionId);

const asyncTruth = await readTruthAsync(VENUE);
assert.equal(asyncTruth.map.meta.generated, stamp);

const packs = {
  [SKIN]: {
    spec: { version: 1, venue: VENUE, skin: SKIN, basedOn: stamp },
    certification: { certified: true },
    style: {},
  },
};
const mirrored = await mirrorDisplayPacksToPostdb(VENUE, packs, revisionId);
assert.equal(mirrored.length, 1);
assert.equal(mirrored[0].skinId, SKIN);

const stored = await readDisplayPack(VENUE, SKIN);
assert.equal(stored.basedOnRevisionId, revisionId);
assert.equal(stored.body.skin, SKIN);

const pool = await (await import('../../packages/venue-builder/lib/db/postgres.mjs')).getPool();
await pool.query('DELETE FROM display_packs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM venue_heads WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM truth_revisions WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM factory_runs WHERE venue_id = $1', [VENUE]);

console.log('postdb-sync: ok');
