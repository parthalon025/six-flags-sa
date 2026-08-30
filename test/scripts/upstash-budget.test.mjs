/**
 * Upstash command-budget estimator (#380).
 *
 *   node test/scripts/upstash-budget.test.mjs
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_POLL_MS,
  FREE_TIER_DAILY_COMMAND_LIMIT,
  READ_COMMANDS_PER_POLL,
  WRITE_COMMANDS_PER_MUTATE,
  estimateDailyCommands,
  estimateParkDailyCommands,
  freeTierHeadroom,
} from '../../scripts/lib/upstash-budget.mjs';

// Defaults match the constants named in the issue.
assert.equal(DEFAULT_POLL_MS, 2500);

// A single member polling once produces exactly the pipelined read cost, no
// writes, over one poll interval of "active" time.
{
  const oneShot = estimateDailyCommands({
    members: 1,
    pollIntervalMs: 1000,
    activeHoursPerDay: 1 / 3600, // exactly one second of active time
    writesPerPollFraction: 0,
  });
  assert.equal(oneShot.pollsPerMember, 1, 'one second at a 1s cadence is exactly one poll');
  assert.equal(oneShot.readCommands, READ_COMMANDS_PER_POLL);
  assert.equal(oneShot.writeCommands, 0);
  assert.equal(oneShot.total, READ_COMMANDS_PER_POLL);
}

// Doubling members doubles the total at fixed cadence and duration.
{
  const one = estimateDailyCommands({ members: 1, activeHoursPerDay: 2 });
  const two = estimateDailyCommands({ members: 2, activeHoursPerDay: 2 });
  assert.equal(two.total, one.total * 2, 'linear in members');
}

// A non-zero write fraction adds WRITE_COMMANDS_PER_MUTATE per written poll.
{
  const noWrites = estimateDailyCommands({
    members: 1,
    pollIntervalMs: 1000,
    activeHoursPerDay: 10 / 3600, // 10 polls
    writesPerPollFraction: 0,
  });
  const allWrites = estimateDailyCommands({
    members: 1,
    pollIntervalMs: 1000,
    activeHoursPerDay: 10 / 3600,
    writesPerPollFraction: 1,
  });
  assert.equal(noWrites.totalPolls, 10);
  assert.equal(
    allWrites.total - noWrites.total,
    10 * WRITE_COMMANDS_PER_MUTATE,
    'every poll writing adds one full mutate cost per poll',
  );
}

// Invalid inputs fail loudly rather than silently returning nonsense.
{
  assert.throws(() => estimateDailyCommands({ members: 0 }));
  assert.throws(() => estimateDailyCommands({ pollIntervalMs: 0 }));
  assert.throws(() => estimateParkDailyCommands({ concurrentParties: 0 }));
  assert.throws(() => freeTierHeadroom(100, 0));
}

// Park-scale rollup multiplies the per-party estimate and reports headroom
// against the free tier consistently with freeTierHeadroom() directly.
{
  const perParty = estimateDailyCommands({});
  const park = estimateParkDailyCommands({ concurrentParties: 10 });
  assert.equal(park.total, perParty.total * 10);
  assert.deepEqual(park.perParty, perParty);
  const headroom = freeTierHeadroom(park.total);
  assert.equal(park.withinFreeTier, headroom.withinFreeTier);
  assert.equal(park.fractionOfFreeTier, headroom.fractionOfFreeTier);
}

// Pin the numbers docs/guide/upstash.md quotes for ops, so the doc and the
// model cannot silently drift apart. At the default assumptions (6-member
// party, 4 active hours/day, 20% of polls also write), one party costs
// 89,856 commands/day — meaning the *free tier fits far fewer concurrent
// parties than "500,000 commands" sounds like it should*. That gap is the
// actual finding #374's alerting thresholds exist to catch early.
{
  const perParty = estimateDailyCommands({});
  assert.equal(perParty.total, 89_856, 'per-party default estimate — see docs/guide/upstash.md');

  const fiveParties = estimateParkDailyCommands({ concurrentParties: 5 });
  assert.ok(
    fiveParties.withinFreeTier,
    `5 concurrent default parties (${fiveParties.total} commands/day) should still fit the free tier (${FREE_TIER_DAILY_COMMAND_LIMIT})`,
  );

  const tenParties = estimateParkDailyCommands({ concurrentParties: 10 });
  assert.ok(
    !tenParties.withinFreeTier,
    `10 concurrent default parties (${tenParties.total} commands/day) should already exceed the free tier (${FREE_TIER_DAILY_COMMAND_LIMIT})`,
  );
}

console.log('upstash-budget: ok');
