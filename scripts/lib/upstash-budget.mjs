/**
 * Upstash command-budget estimator (#380).
 *
 * Model: members × poll interval × (read + write) + rate-limit INCRs, per the
 * roadmap issue. It is deliberately a rough, adjustable model — not a
 * measurement — so every constant below is either read from the code paths
 * that actually issue Redis commands, or left as a named, overridable input.
 *
 *   estimateDailyCommands({ ... }) -> per-day command totals for one party
 *   estimateParkDailyCommands({ ... }) -> scaled to concurrent parties
 *   freeTierHeadroom(dailyCommands, limit) -> how much of the free tier is left
 */

/** Mirrors DEFAULT_POLL_MS in apps/party-tracker/lib/transport/mailboxClient.js. */
export const DEFAULT_POLL_MS = 2500;

/** Mirrors MAILBOX_DEPTH in apps/party-tracker/lib/serverStore.js. */
export const MAILBOX_DEPTH = 500;

/**
 * Commands per `readMailbox()` call (serverStore.js): a pipelined
 * ZRANGEBYSCORE + GET. Upstash bills pipelined commands individually, so a
 * pipeline of 2 is 2 commands, not 1. `mailboxRead`'s own rate limit is
 * `durable: false` (in-process), so it adds none — see docs/guide/security.md.
 */
export const READ_COMMANDS_PER_POLL = 2;

/**
 * Commands per `appendMailbox()` call: one Lua EVAL (Upstash bills a script
 * invocation as 1 command) plus the durable `mailboxWrite` rate-limit hit
 * (INCR + EXPIRE = 2, from `redisHit()` in rateLimit.js).
 */
export const WRITE_COMMANDS_PER_MUTATE = 1 + 2;

/**
 * Upstash's published free-tier daily command cap as of writing. Kept as a
 * named constant rather than hard-coded in call sites so a plan change is one
 * edit; verify against the current Upstash console before trusting it for a
 * capacity decision.
 */
export const FREE_TIER_DAILY_COMMAND_LIMIT = 500_000;

/**
 * Per-party daily Upstash command estimate.
 *
 * @param {object} [opts]
 * @param {number} [opts.members] guests in the party polling the mailbox
 * @param {number} [opts.pollIntervalMs] foreground poll cadence
 * @param {number} [opts.activeHoursPerDay] hours the party is actively polling (not idle/backgrounded)
 * @param {number} [opts.writesPerPollFraction] fraction of polls that also produce a mailbox write
 *   (location patch, chat message, presence) from this member — not every poll writes.
 */
export function estimateDailyCommands({
  members = 6,
  pollIntervalMs = DEFAULT_POLL_MS,
  activeHoursPerDay = 4,
  writesPerPollFraction = 0.2,
} = {}) {
  if (members <= 0) throw new Error('estimateDailyCommands: members must be > 0');
  if (pollIntervalMs <= 0) throw new Error('estimateDailyCommands: pollIntervalMs must be > 0');

  const activeSeconds = activeHoursPerDay * 3600;
  const pollsPerMember = activeSeconds / (pollIntervalMs / 1000);
  const totalPolls = members * pollsPerMember;

  const readCommands = Math.round(totalPolls * READ_COMMANDS_PER_POLL);
  const writeCommands = Math.round(
    totalPolls * writesPerPollFraction * WRITE_COMMANDS_PER_MUTATE,
  );
  const total = readCommands + writeCommands;

  return {
    members,
    pollIntervalMs,
    activeHoursPerDay,
    pollsPerMember: Math.round(pollsPerMember),
    totalPolls: Math.round(totalPolls),
    readCommands,
    writeCommands,
    total,
  };
}

/**
 * Scale a per-party estimate to `concurrentParties` running the same day at
 * once (a rough proxy for "park at capacity"), and compare to the free tier.
 */
export function estimateParkDailyCommands({
  concurrentParties = 50,
  perPartyOptions = {},
} = {}) {
  if (concurrentParties <= 0) {
    throw new Error('estimateParkDailyCommands: concurrentParties must be > 0');
  }
  const perParty = estimateDailyCommands(perPartyOptions);
  const total = perParty.total * concurrentParties;
  return {
    concurrentParties,
    perParty,
    total,
    ...freeTierHeadroom(total),
  };
}

/** How much of the free-tier daily budget `dailyCommands` would use. */
export function freeTierHeadroom(dailyCommands, limit = FREE_TIER_DAILY_COMMAND_LIMIT) {
  if (limit <= 0) throw new Error('freeTierHeadroom: limit must be > 0');
  const fractionOfFreeTier = dailyCommands / limit;
  return {
    limit,
    fractionOfFreeTier,
    withinFreeTier: dailyCommands <= limit,
    headroomCommands: Math.max(0, limit - dailyCommands),
  };
}
