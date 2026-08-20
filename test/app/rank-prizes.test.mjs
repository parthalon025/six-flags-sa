#!/usr/bin/env node
/**
 * Rank prize catalog — shared policy + world grants.
 *
 *   node test/app/rank-prizes.test.mjs
 */
import assert from 'node:assert/strict';

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

const {
  RANK_PRIZE_CATALOG,
  rankPrizesForRank,
  rankPrizeCatalog,
  rankUpRewardLine,
  nextRankPrizeRow,
} = await import('../../packages/shared/rankPrizes.js');

const world = await import('../../apps/party-tracker/lib/world.js');

console.log('\nrank prizes\n');

await check('catalog lists every Rank above Visitor', () => {
  assert.equal(RANK_PRIZE_CATALOG.length, 4);
  assert.deepEqual(RANK_PRIZE_CATALOG.map((r) => r.rank), ['scout', 'ranger', 'cartographer', 'steward']);
  return true;
});

await check('rankPrizeCatalog includes Visitor row', () => {
  const rows = rankPrizeCatalog();
  assert.equal(rows[0].rank, 'visitor');
  assert.equal(rows.length, 5);
  return true;
});

await check('scout grants Porter cuff Kit', () => {
  const prizes = rankPrizesForRank('scout');
  assert.equal(prizes.length, 1);
  assert.equal(prizes[0].kind, 'kit');
  assert.equal(prizes[0].id, 'porter-cuff');
  return true;
});

await check('ranger grants Postcard Skin', () => {
  const prizes = rankPrizesForRank('ranger');
  assert.equal(prizes[0].kind, 'skin');
  assert.equal(prizes[0].id, 'postcard');
  return true;
});

await check('rankUpRewardLine joins Title and Rank prizes', () => {
  const line = rankUpRewardLine('cartographer');
  assert.match(line, /Cartographer/);
  assert.match(line, /Drafting/);
  assert.match(line, /Quest sensor/);
  return true;
});

await check('rankUpRewardLine skips note-only rows', () => {
  const line = rankUpRewardLine('steward');
  assert.ok(line);
  assert.doesNotMatch(line, /Wayfarer/);
  assert.match(line, /Marquee/);
  return true;
});

await check('nextRankPrizeRow after scout is Ranger', () => {
  const row = nextRankPrizeRow('scout');
  assert.equal(row?.rank, 'ranger');
  assert.equal(row?.xp, 250);
  return true;
});

await check('grantRankExPrizes applies scout Kit once', () => {
  let p = world.createProgress({ userId: 'u1' });
  p = world.grantRankExPrizes(p, 'scout');
  assert.equal(p.kit, 'porter-cuff');
  assert.deepEqual(p.rankPrizesGranted, ['scout']);
  p = world.grantRankExPrizes(p, 'scout');
  assert.equal(p.kit, 'porter-cuff');
  assert.deepEqual(p.rankPrizesGranted, ['scout']);
  return true;
});

await check('syncRankExPrizes backfills through ranger', () => {
  let p = world.createProgress({ userId: 'u1' });
  p = world.syncRankExPrizes(p, 'ranger');
  assert.deepEqual(p.rankPrizesGranted, ['scout', 'ranger']);
  assert.equal(p.kit, 'porter-cuff');
  assert.equal(world.skinRung(p, 'postcard'), 'unlock');
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  console.log(FAIL.join('\n'));
  process.exit(1);
}
