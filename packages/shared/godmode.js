/**
 * Operator allowlist on a Profile — Clerk private_metadata.admin.
 * Postgres still owns XP / Title (ADR-0010). Clerk owns only this bit.
 */

import { RANK_LADDER, rankReward } from './questScore.js';

/** Top rung of the Title ladder — Steward / 3000 today. */
export function godmodeLadderTarget() {
  const { rank, xp } = RANK_LADDER[RANK_LADDER.length - 1];
  return { rank, xp, title: rankReward(rank).title };
}

/**
 * True when Clerk Backend private metadata has `admin: true`.
 * Accepts SDK camelCase or REST snake_case.
 *
 * @param {{ privateMetadata?: object, private_metadata?: object } | null | undefined} user
 */
export function clerkUserIsGodmode(user) {
  if (!user || typeof user !== 'object') return false;
  const meta = user.privateMetadata || user.private_metadata || {};
  return meta.admin === true;
}

/** Profile snapshot at the top of the Title ladder. Does not persist. */
export function godmodeProfileGrant(profile = {}) {
  const target = godmodeLadderTarget();
  return {
    ...profile,
    xp: target.xp,
    rank: target.rank,
    title: target.title,
  };
}
