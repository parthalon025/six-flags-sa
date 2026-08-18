/**
 * Side Quest XP → Title rewards.
 *
 * XP lives on the Profile. Crossing a threshold grants a Title — a sub-name
 * under the display name (Scout, Ranger, Cartographer, Steward). Visitor has
 * no Title yet. Titles are not Member, Party, or roster names. XP is never
 * spent. Repeat of the same (venue, type, target) by the same Profile is 0.
 * A name-first Ride report can exist without XP; XP still needs the Profile.
 * No public leaderboard here.
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
  visitor: { title: null, label: 'Visitor', unlock: 'Signed-in Profile' },
  scout: { title: 'Scout', label: 'Scout', unlock: 'Title: Scout' },
  ranger: { title: 'Ranger', label: 'Ranger', unlock: 'Title: Ranger' },
  cartographer: { title: 'Cartographer', label: 'Cartographer', unlock: 'Title: Cartographer' },
  steward: { title: 'Steward', label: 'Steward', unlock: 'Title: Steward' },
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

/** Earned Title sub-name, or null until Scout. */
export function titleFromXp(xp) {
  return rankReward(rankFromXp(xp)).title;
}

/**
 * Where a Profile stands on the Title ladder: the current band's floor, the
 * next threshold, and how far along the band this XP sits. `next` is null at
 * Steward (the top), where `fraction` pins to 1 so a bar can render full.
 *
 * @param {number} xp
 * @returns {{
 *   xp: number,
 *   rank: ProfileRank,
 *   title: string | null,
 *   label: string,
 *   floor: number,
 *   next: { rank: ProfileRank, title: string, label: string, at: number, toGo: number } | null,
 *   fraction: number,
 * }}
 */
export function rankProgress(xp) {
  const n = Math.max(0, Number(xp) || 0);
  const rank = rankFromXp(n);
  const index = RANK_INDEX[rank] ?? 0;
  const floor = RANK_LADDER[index].xp;
  const nextRow = RANK_LADDER[index + 1] || null;
  const reward = rankReward(rank);
  if (!nextRow) {
    return { xp: n, rank, title: reward.title, label: reward.label, floor, next: null, fraction: 1 };
  }
  const nextReward = rankReward(nextRow.rank);
  return {
    xp: n,
    rank,
    title: reward.title,
    label: reward.label,
    floor,
    next: {
      rank: nextRow.rank,
      title: nextReward.title,
      label: nextReward.label,
      at: nextRow.xp,
      toGo: nextRow.xp - n,
    },
    fraction: Math.min(1, Math.max(0, (n - floor) / (nextRow.xp - floor))),
  };
}

/** Coarse ~40 m cell so a generic path walk does not farm-block the whole park. */
export const PATH_SCORE_CELL_M = 40;

export function pathScoreCell(lat, lng, metres = PATH_SCORE_CELL_M) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const latM = lat * 110540;
  const lngM = lng * 111320 * Math.cos((lat * Math.PI) / 180);
  return `${Math.round(latM / metres)}:${Math.round(lngM / metres)}`;
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
  let dailyBonus = false;

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
        dailyBonus = true;
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
  const title = rankReward(rank).title;
  return {
    profile: {
      xp,
      rank,
      title,
      reputation,
      scoredKeys,
      awardedByKey,
      lastQuestDay,
    },
    deltaXp,
    deltaRep,
    dailyBonus,
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
