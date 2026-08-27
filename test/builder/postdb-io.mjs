#!/usr/bin/env node
/**
 * PostDB I/O integration — round-trip when DATABASE_URL is set.
 *
 *   node test/builder/postdb-io.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { applyMigrations } from '../../scripts/postdb-migrate.mjs';
import {
  getHeadRevisionId,
  outputsHash,
  publishHead,
  readDisplayPack,
  readTruth,
  requirePostdb,
  usingPostdb,
  writeDisplayPack,
  writeTruth,
} from '../../packages/venue-builder/lib/postdb-io.mjs';

const VENUE = 'fixture-park';
const SKIN = 'layered-atlas';

assert.equal(usingPostdb(), Boolean(process.env.DATABASE_URL));

if (!process.env.DATABASE_URL) {
  assert.throws(() => requirePostdb(), /DATABASE_URL/);
  console.log('postdb-io: skipped (no DATABASE_URL)');
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await applyMigrations(client);
} finally {
  await client.end();
}

const stamp = '2026-08-24T12:00:00.000Z';
const map = {
  meta: { id: VENUE, generated: stamp },
  path: [{ r: [[-84.268, 39.344], [-84.267, 39.345]] }],
};
const pois = [{ i: 'gate', n: 'Front Gate', lat: 39.344, lng: -84.268, c: 'gate' }];
const gaps = { meta: { id: VENUE }, gaps: [] };

const hash = outputsHash({ map, pois, gaps });
assert.match(hash, /^[0-9a-f]{64}$/);

const { revisionId } = await writeTruth(VENUE, {
  map,
  pois,
  gaps,
  factory: 'map',
  routeId: 'map.certify',
});
assert.ok(revisionId);

const head = await getHeadRevisionId(VENUE);
assert.equal(head, revisionId);

const roundTrip = await readTruth(VENUE);
assert.equal(roundTrip.revisionId, revisionId);
assert.equal(roundTrip.generated, stamp);
assert.deepEqual(roundTrip.map, map);
assert.deepEqual(roundTrip.pois, pois);
assert.deepEqual(roundTrip.gaps, gaps);

const packBody = { version: 1, venue: VENUE, skin: SKIN, tokens: { colors: { ground: '#eee' } } };
const { packId } = await writeDisplayPack(VENUE, SKIN, packBody, revisionId);
assert.ok(packId);

const pack = await readDisplayPack(VENUE, SKIN);
assert.equal(pack.packId, packId);
assert.equal(pack.basedOnRevisionId, revisionId);
assert.deepEqual(pack.body, packBody);

const map2 = {
  meta: { id: VENUE, generated: '2026-08-24T13:00:00.000Z' },
  path: map.path,
};
const { revisionId: newerRevision } = await writeTruth(VENUE, { map: map2, pois, gaps: [] });
assert.notEqual(newerRevision, revisionId);

await publishHead(VENUE, revisionId);
assert.equal(await getHeadRevisionId(VENUE), revisionId);
const restored = await readTruth(VENUE);
assert.equal(restored.revisionId, revisionId);
assert.equal(restored.generated, stamp);

const pool = await (await import('../../packages/venue-builder/lib/db/postgres.mjs')).getPool();
await pool.query('DELETE FROM display_packs WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM venue_heads WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM truth_revisions WHERE venue_id = $1', [VENUE]);
await pool.query('DELETE FROM factory_runs WHERE venue_id = $1', [VENUE]);

console.log('postdb-io: ok');
