/**
 * Side Quest XP → Rank rewards.
 *
 * XP is never spent. Completing a Side Quest (walked-near, Profile attached)
 * awards XP; the visible reward is Rank (Status). Repeat of the same
 * (venue, type, target) by the same Profile is 0. No public leaderboard here.
 */

/** @typedef {'visitor'|'scout'|'ranger'|'cartographer'|'steward'} ProfileRank */

export const RANK_LADDER = Object.freeze([
  { rank: 'visitor', xp: 0 },
  { rank: 'scout', xp: 50 },
  { rank: 'ranger', xp: 250 },
  { rank: 'cartographer', xp: 1000 },
  { rank: 'steward', xp: 3000 },
]);

export const RANK_REWARDS = Object.freeze({
  visitor: { label: 'Visitor', unlock: 'Signed-in Profile' },
  scout: { label: 'Scout', unlock: 'Status: Scout' },
  ranger: { label: 'Ranger', unlock: 'Status: Ranger' },
  cartographer: { label: 'Cartographer', unlock: 'Status: Cartographer' },
  steward: { label: 'Steward', unlock: 'Status: Steward' },
});

export const XP_AWARDS = Object.freeze({
  first: 12,
  confirm: 2,
  deny: 2,
  live: 2,
  firstHelpfulDay: 5,
});

const RANK_INDEX = Object.fromEntries(RANK_LADDER.map((row, i) => [row.rank, i]));

/** UTC calendar day `YYYY-MM-DD` so Saturday progress does not depend on park TZ. */
export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Highest Rank whose threshold the Profile's XP meets. */
export function rankFromXp(xp) {
  const n = Number(xp) || 0;
  let rank = 'visitor';
  for (const row of RANK_LADDER) {
    if (n >= row.xp) rank = row.rank;
  }
  return rank;
}

export function rankReward(rank) {
  return RANK_REWARDS[rank] || RANK_REWARDS.visitor;
}

/** Stable key for "already answered this Gap / live ride". */
export function scoreKey(venueId, type, target) {
  return `${venueId || ''}:${type || ''}:${target ?? ''}`;
}

/**
 * Pure score step. Does not persist.
 *
 * @param {object} profile
 * @param {object} event
 * @param {'first'|'confirm'|'deny'|'live'|'repeat'|'overturned'} event.action
 * @param {string} [event.key]
 * @param {boolean} event.hasProfile
 * @param {boolean} event.walkedNear
 * @param {number} [event.now]
 */
export function scoreSideQuest(profile = {}, event = {}) {
  const scoredKeys = Array.isArray(profile.scoredKeys) ? [...profile.scoredKeys] : [];
  const awardedByKey = { ...(profile.awardedByKey || {}) };
  let xp = Math.max(0, Number(profile.xp) || 0);
  let reputation = Number(profile.reputation) || 0;
  let lastQuestDay = profile.lastQuestDay || null;
  const previousRank = rankFromXp(xp);
  const { action, key, hasProfile, walkedNear, now = Date.now() } = event;

  let deltaXp = 0;
  let deltaRep = 0;
  let reason = 'none';

  if (action === 'overturned') {
    deltaRep = -10;
    reputation += deltaRep;
    const claw = Number(awardedByKey[key]) || 0;
    deltaXp = -Math.min(xp, claw);
    xp = Math.max(0, xp + deltaXp);
    if (key) delete awardedByKey[key];
    reason = 'overturned';
  } else if (!hasProfile) {
    reason = 'no_profile';
  } else if (!walkedNear) {
    reason = 'not_near';
  } else if (action === 'repeat' || (key && scoredKeys.includes(key))) {
    reason = 'repeat';
  } else {
    const base =
      action === 'first'
        ? XP_AWARDS.first
        : action === 'confirm'
          ? XP_AWARDS.confirm
          : action === 'deny'
            ? XP_AWARDS.deny
            : action === 'live'
              ? XP_AWARDS.live
              : 0;
    if (base > 0) {
      deltaXp = base;
      const day = utcDay(now);
      if (lastQuestDay !== day) {
        deltaXp += XP_AWARDS.firstHelpfulDay;
        lastQuestDay = day;
      }
      xp += deltaXp;
      reason = action;
      if (key) {
        scoredKeys.push(key);
        awardedByKey[key] = deltaXp;
      }
    }
  }

  const rank = rankFromXp(xp);
  return {
    profile: {
      xp,
      rank,
      reputation,
      scoredKeys,
      awardedByKey,
      lastQuestDay,
    },
    deltaXp,
    deltaRep,
    rankUp: (RANK_INDEX[rank] ?? 0) > (RANK_INDEX[previousRank] ?? 0),
    previousRank,
    reason,
  };
}

/** Merge a score result onto a Profile snapshot (still pure). */
export function applyScore(profile, event) {
  const result = scoreSideQuest(profile, event);
  return { ...profile, ...result.profile, ...result };
}
