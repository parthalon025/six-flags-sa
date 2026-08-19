#!/usr/bin/env node
/**
 * profile:max-rank — decision + write plan through the exported functions.
 *
 *   node test/scripts/profile-max-rank.test.mjs
 */
import assert from 'node:assert/strict';
import { grantMaxRank, maxRankTarget, parseArgs } from '../../scripts/lib/profile-max-rank.mjs';
import { RANK_LADDER } from '../../packages/shared/questScore.js';

// The target is the ladder's top rung, not a hardcoded number.
assert.deepEqual(maxRankTarget(), {
  rank: RANK_LADDER[RANK_LADDER.length - 1].rank,
  xp: RANK_LADDER[RANK_LADDER.length - 1].xp,
});

assert.deepEqual(parseArgs(['--clerk-id', 'user_1', '--dry-run']), {
  clerkId: 'user_1',
  dryRun: true,
});
assert.deepEqual(parseArgs([]), { clerkId: null, dryRun: false });
assert.deepEqual(parseArgs(['--clerk-id']), { clerkId: null, dryRun: false });

const profileRow = { user_id: 'u1', email: 'a@b.c', xp: 100, rank: 'scout' };

function fakeDb({ rows = [profileRow], failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (failOn && sql.includes(failOn)) throw new Error(`boom on ${failOn}`);
      if (sql.startsWith('SELECT')) return { rows };
      return { rows: [] };
    },
  };
}

// Missing profile → status missing, nothing written.
{
  const db = fakeDb({ rows: [] });
  const result = await grantMaxRank({ query: db.query, clerkId: 'user_x' });
  assert.equal(result.status, 'missing');
  assert.equal(db.calls.length, 1);
}

// Dry run reports the delta and writes nothing.
{
  const db = fakeDb();
  const result = await grantMaxRank({ query: db.query, clerkId: 'user_x', dryRun: true });
  assert.equal(result.status, 'dry-run');
  assert.equal(result.deltaXp, maxRankTarget().xp - 100);
  assert.equal(db.calls.length, 1);
}

// A real grant updates the profile and logs the delta inside one transaction.
{
  const db = fakeDb();
  const result = await grantMaxRank({ query: db.query, clerkId: 'user_x' });
  assert.equal(result.status, 'granted');
  const kinds = db.calls.map((c) => c.sql.split(' ')[0]);
  assert.deepEqual(kinds, ['SELECT', 'BEGIN', 'UPDATE', 'INSERT', 'COMMIT']);
  const insert = db.calls.find((c) => c.sql.startsWith('INSERT'));
  assert.match(insert.params[0], /^evt_[0-9a-f]{20}$/);
  assert.equal(insert.params[1], 'u1');
  assert.equal(insert.params[2], result.deltaXp);
  assert.ok(insert.sql.includes("'admin_grant'"));
}

// Already at max XP → no score_events row, still committed.
{
  const db = fakeDb({ rows: [{ ...profileRow, xp: maxRankTarget().xp }] });
  const result = await grantMaxRank({ query: db.query, clerkId: 'user_x' });
  assert.equal(result.status, 'granted');
  assert.equal(result.deltaXp, 0);
  const kinds = db.calls.map((c) => c.sql.split(' ')[0]);
  assert.deepEqual(kinds, ['SELECT', 'BEGIN', 'UPDATE', 'COMMIT']);
}

// A failed write rolls back and rethrows.
{
  const db = fakeDb({ failOn: 'INSERT INTO score_events' });
  await assert.rejects(
    () => grantMaxRank({ query: db.query, clerkId: 'user_x' }),
    /boom on INSERT/,
  );
  const kinds = db.calls.map((c) => c.sql.split(' ')[0]);
  assert.deepEqual(kinds, ['SELECT', 'BEGIN', 'UPDATE', 'INSERT', 'ROLLBACK']);
}

console.log('profile-max-rank.test.mjs: ok');
