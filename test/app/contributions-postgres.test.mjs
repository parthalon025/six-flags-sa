#!/usr/bin/env node
/**
 * Contribution store — Postgres integration (#438).
 *
 * Seam: exported store operations against a real database with repo migrations.
 * Skips cleanly when no TEST_DATABASE_URL / DATABASE_URL is reachable.
 */

import assert from 'node:assert/strict';
import {
  openTestPool,
  probeDatabase,
  resetContributionTables,
  seedUsers,
  testDatabaseUrl,
} from '../lib/postgres-test-db.mjs';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const url = testDatabaseUrl();
if (!url) {
  console.log('\ncontributions postgres — SKIP (set TEST_DATABASE_URL or DATABASE_URL)\n');
  process.exit(0);
}

if (!(await probeDatabase(url))) {
  console.log(`\ncontributions postgres — SKIP (no reachable Postgres at ${url})\n`);
  process.exit(0);
}

process.env.DATABASE_URL = url;

const {
  getContribution,
  impactHelpedFor,
  insertContribution,
  listConsolidateCandidates,
  listContributions,
  thankContribution,
  thanksCountFor,
} = await import('../../apps/party-tracker/lib/contributions/store.js');

const pool = await openTestPool(url);

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

console.log('\ncontributions postgres (#438)\n');

await check('insert round-trips through getContribution on Postgres', async () => {
  await resetContributionTables(pool);
  await seedUsers(pool, [{ id: 'usr_author' }]);
  const row = await insertContribution({
    authorId: 'usr_author',
    venueId: 'kings-island',
    placeId: 'orion',
    kind: 'height_rule',
    payload: { placeName: 'Orion', min: 54 },
    lat: 39.34,
    lng: -84.27,
  });
  assert.ok(row.id.startsWith('c_'));
  assert.equal(row.venueId, 'kings-island');
  assert.equal(row.status, 'pending');
  const again = await getContribution(row.id);
  assert.equal(again.placeId, 'orion');
  assert.equal(again.payload.placeName, 'Orion');
});

await check('client-supplied id replay is idempotent (ON CONFLICT DO NOTHING)', async () => {
  await resetContributionTables(pool);
  await seedUsers(pool, [{ id: 'usr_author' }]);
  const first = await insertContribution({
    id: 'c_replay01',
    authorId: 'usr_author',
    venueId: 'kings-island',
    kind: 'height_rule',
    payload: { min: 48 },
  });
  const replay = await insertContribution({
    id: 'c_replay01',
    authorId: 'usr_author',
    venueId: 'kings-island',
    kind: 'height_rule',
    payload: { min: 99 },
  });
  assert.equal(replay.id, first.id);
  assert.equal(replay.payload.min, 48);
});

await check('listContributions filters venueId and status', async () => {
  await resetContributionTables(pool);
  await seedUsers(pool, [{ id: 'usr_author' }]);
  await insertContribution({
    authorId: 'usr_author',
    venueId: 'kings-island',
    kind: 'height_rule',
    status: 'accepted',
    payload: { min: 48 },
  });
  await insertContribution({
    authorId: 'usr_author',
    venueId: 'cedar-point',
    kind: 'height_rule',
    status: 'pending',
    payload: { min: 52 },
  });
  const acceptedKi = await listContributions({
    venueId: 'kings-island',
    status: 'accepted',
  });
  assert.equal(acceptedKi.length, 1);
  assert.equal(acceptedKi[0].venueId, 'kings-island');
});

await check('listConsolidateCandidates returns only accepted rows', async () => {
  await resetContributionTables(pool);
  await seedUsers(pool, [{ id: 'usr_author' }]);
  const accepted = await insertContribution({
    authorId: 'usr_author',
    venueId: 'kings-island',
    kind: 'height_rule',
    status: 'accepted',
    payload: { min: 48 },
  });
  await insertContribution({
    authorId: 'usr_author',
    venueId: 'kings-island',
    kind: 'height_rule',
    status: 'pending',
    payload: { min: 40 },
  });
  const candidates = await listConsolidateCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, accepted.id);
});

await check('thanks dedupe and impact_helped persist in Postgres', async () => {
  await resetContributionTables(pool);
  await seedUsers(pool, [{ id: 'usr_finder' }, { id: 'usr_fan' }, { id: 'usr_other' }]);
  const finder = await insertContribution({
    authorId: 'usr_finder',
    venueId: 'kings-island',
    placeId: 'orion',
    kind: 'height_rule',
    payload: { min: 48 },
  });

  const before = await impactHelpedFor('usr_finder');
  const first = await thankContribution({ contributionId: finder.id, thankerId: 'usr_fan' });
  assert.equal(first.ok, true);
  assert.equal(first.counted, true);
  assert.equal(first.thanksCount, 1);
  assert.equal(await impactHelpedFor('usr_finder'), before + 1);

  const repeat = await thankContribution({ contributionId: finder.id, thankerId: 'usr_fan' });
  assert.equal(repeat.counted, false);
  assert.equal(repeat.reason, 'repeat');
  assert.equal(await impactHelpedFor('usr_finder'), before + 1);

  const second = await thankContribution({ contributionId: finder.id, thankerId: 'usr_other' });
  assert.equal(second.counted, true);
  assert.equal(await thanksCountFor(finder.id), 2);
  assert.equal(await impactHelpedFor('usr_finder'), before + 2);

  const self = await thankContribution({ contributionId: finder.id, thankerId: 'usr_finder' });
  assert.equal(self.counted, false);
  assert.equal(self.reason, 'self');
});

await check('unknown contribution and missing thanker are refused on Postgres', async () => {
  await resetContributionTables(pool);
  await seedUsers(pool, [{ id: 'usr_finder' }]);
  const finder = await insertContribution({
    authorId: 'usr_finder',
    venueId: 'kings-island',
    kind: 'height_rule',
    payload: { min: 48 },
  });
  const gone = await thankContribution({ contributionId: 'c_missing', thankerId: 'usr_fan' });
  assert.equal(gone.ok, false);
  assert.equal(gone.reason, 'not_found');
  const anon = await thankContribution({ contributionId: finder.id, thankerId: '' });
  assert.equal(anon.ok, false);
  assert.equal(anon.reason, 'thanker_required');
});

await pool.end();

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) process.exit(1);
