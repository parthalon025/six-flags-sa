#!/usr/bin/env node
/**
 * Contribution store — Postgres integration when DATABASE_URL is set.
 *
 *   node test/app/contributions-postgres.test.mjs
 *
 * Skips cleanly offline (no DATABASE_URL). CI runs this in the builder job
 * after postdb-migrate against the service-container Postgres.
 */

import assert from 'node:assert/strict';
import pg from 'pg';
import { applyMigrations } from '../../scripts/postdb-migrate.mjs';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

if (!process.env.DATABASE_URL) {
  console.log('contributions-postgres: skipped (no DATABASE_URL)');
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await applyMigrations(client);
} finally {
  await client.end();
}

const {
  getContribution,
  impactHelpedFor,
  insertContribution,
  listConsolidateCandidates,
  listContributions,
  thankContribution,
  thanksCountFor,
} = await import('../../apps/party-tracker/lib/contributions/store.js');

const pool = await (await import('../../apps/party-tracker/lib/db/postgres.js')).getPool();

const TEST_USERS = [
  { id: 'usr_pg_finder', email: 'finder-pg@test.local' },
  { id: 'usr_pg_fan', email: 'fan-pg@test.local' },
  { id: 'usr_pg_other', email: 'other-pg@test.local' },
];

async function seedUsers() {
  for (const u of TEST_USERS) {
    await pool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.email],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name, impact_helped)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id) DO UPDATE SET impact_helped = 0`,
      [u.id, u.id],
    );
  }
}

async function cleanupContribution(id) {
  await pool.query('DELETE FROM contribution_thanks WHERE contribution_id = $1', [id]);
  await pool.query('DELETE FROM contributions WHERE id = $1', [id]);
}

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

console.log('\ncontribution store (postgres)\n');

await seedUsers();

const insertedIds = [];

await check('insert and get round-trip a contribution row', async () => {
  const row = await insertContribution({
    authorId: 'usr_pg_finder',
    venueId: 'kings-island',
    placeId: 'orion',
    kind: 'height',
    payload: { heightIn: 48 },
    lat: 39.34,
    lng: -84.27,
  });
  insertedIds.push(row.id);
  assert.match(row.id, /^c_/);
  assert.equal(row.authorId, 'usr_pg_finder');
  assert.equal(row.venueId, 'kings-island');
  assert.equal(row.status, 'pending');
  assert.deepEqual(row.payload, { heightIn: 48 });

  const again = await getContribution(row.id);
  assert.equal(again.id, row.id);
  assert.equal(again.placeId, 'orion');
});

await check('client-supplied id replays idempotently (ON CONFLICT DO NOTHING)', async () => {
  const fixedId = 'c_pg_replay01';
  const first = await insertContribution({
    id: fixedId,
    authorId: 'usr_pg_finder',
    venueId: 'kings-island',
    kind: 'height',
    payload: { heightIn: 52 },
  });
  insertedIds.push(fixedId);
  assert.equal(first.id, fixedId);

  const replay = await insertContribution({
    id: fixedId,
    authorId: 'usr_pg_finder',
    venueId: 'kings-island',
    kind: 'height',
    payload: { heightIn: 99 },
  });
  assert.equal(replay.id, fixedId);
  assert.deepEqual(replay.payload, { heightIn: 52 });
});

await check('listContributions filters by venue and status', async () => {
  const accepted = await insertContribution({
    authorId: 'usr_pg_finder',
    venueId: 'cedar-point',
    kind: 'wait',
    status: 'accepted',
    payload: { waitMin: 15 },
  });
  insertedIds.push(accepted.id);

  const pending = await insertContribution({
    authorId: 'usr_pg_finder',
    venueId: 'cedar-point',
    kind: 'wait',
    status: 'pending',
    payload: { waitMin: 30 },
  });
  insertedIds.push(pending.id);

  const acceptedOnly = await listContributions({ venueId: 'cedar-point', status: 'accepted' });
  assert.ok(acceptedOnly.some((r) => r.id === accepted.id));
  assert.ok(acceptedOnly.every((r) => r.status === 'accepted'));
  assert.ok(!acceptedOnly.some((r) => r.id === pending.id));
});

await check('listConsolidateCandidates returns only accepted rows', async () => {
  const candidates = await listConsolidateCandidates();
  assert.ok(candidates.length >= 1);
  assert.ok(candidates.every((r) => r.status === 'accepted'));
});

const finder = await insertContribution({
  authorId: 'usr_pg_finder',
  venueId: 'kings-island',
  placeId: 'orion',
  kind: 'height',
  payload: { heightIn: 48 },
});
insertedIds.push(finder.id);

await check('first thanks counts for the finder and moves impact by exactly one', async () => {
  const before = await impactHelpedFor('usr_pg_finder');
  const r = await thankContribution({ contributionId: finder.id, thankerId: 'usr_pg_fan' });
  assert.equal(r.ok, true);
  assert.equal(r.counted, true);
  assert.equal(r.thanksCount, 1);
  assert.equal(await impactHelpedFor('usr_pg_finder'), before + 1);
});

await check('a repeat from the same thanker counts nothing and is not an error', async () => {
  const before = await impactHelpedFor('usr_pg_finder');
  const r = await thankContribution({ contributionId: finder.id, thankerId: 'usr_pg_fan' });
  assert.equal(r.ok, true);
  assert.equal(r.counted, false);
  assert.equal(r.reason, 'repeat');
  assert.equal(r.thanksCount, 1);
  assert.equal(await impactHelpedFor('usr_pg_finder'), before);
});

await check('a second guest counts again — impact is per thanker, not per tap', async () => {
  const before = await impactHelpedFor('usr_pg_finder');
  const r = await thankContribution({ contributionId: finder.id, thankerId: 'usr_pg_other' });
  assert.equal(r.counted, true);
  assert.equal(r.thanksCount, 2);
  assert.equal(await thanksCountFor(finder.id), 2);
  assert.equal(await impactHelpedFor('usr_pg_finder'), before + 1);
});

await check('self-thanks never counts and never moves impact', async () => {
  const before = await impactHelpedFor('usr_pg_finder');
  const r = await thankContribution({ contributionId: finder.id, thankerId: 'usr_pg_finder' });
  assert.equal(r.ok, true);
  assert.equal(r.counted, false);
  assert.equal(r.reason, 'self');
  assert.equal(await impactHelpedFor('usr_pg_finder'), before);
});

await check('unknown contribution and missing thanker are refused', async () => {
  const gone = await thankContribution({ contributionId: 'c_missing', thankerId: 'usr_pg_fan' });
  assert.equal(gone.ok, false);
  assert.equal(gone.reason, 'not_found');
  const anon = await thankContribution({ contributionId: finder.id, thankerId: '' });
  assert.equal(anon.ok, false);
  assert.equal(anon.reason, 'thanker_required');
});

for (const id of insertedIds) {
  await cleanupContribution(id);
}
await pool.end();

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) process.exit(1);
