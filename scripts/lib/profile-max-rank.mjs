/**
 * Grant one Profile the max XP/Rank — the top entry of RANK_LADDER in
 * packages/shared/questScore.js. Full access in this app's domain model is
 * just having a Profile (CONTEXT.md); there is no separate access/tier
 * column to flip.
 *
 * Pure decision + write plan with injectable I/O: the caller hands in a
 * `query(sql, params)` (a pg pool/client) and this module owns the SQL —
 * the same schema the migrations in db/migrations/001_profiles_contributions.sql
 * define (`users`, `profiles`, `score_events.author_id/delta_xp/delta_rep/reason`).
 */

import { randomUUID } from 'node:crypto';
import { RANK_LADDER } from '../../packages/shared/questScore.js';

/** The ladder's top rung — what an admin grant sets. */
export function maxRankTarget() {
  const { rank, xp } = RANK_LADDER[RANK_LADDER.length - 1];
  return { rank, xp };
}

/** CLI argv → options. Unknown flags are ignored; missing clerkId stays null. */
export function parseArgs(argv) {
  const out = { clerkId: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--clerk-id') out.clerkId = argv[++i] ?? null;
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

/**
 * Look up the Profile for a Clerk id and set it to the ladder's top rung,
 * logging the XP delta as a `score_events` row with reason `admin_grant`.
 *
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{rows: any[]}>,
 *           clerkId: string, dryRun?: boolean }} deps
 * @returns {Promise<{status: 'missing'} |
 *   {status: 'dry-run'|'granted', userId: string, email: string,
 *    fromXp: number, fromRank: string, toXp: number, toRank: string, deltaXp: number}>}
 */
export async function grantMaxRank({ query, clerkId, dryRun = false }) {
  const target = maxRankTarget();
  const { rows } = await query(
    `SELECT u.id AS user_id, u.email, p.xp, p.rank
     FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE u.clerk_id = $1
     LIMIT 1`,
    [clerkId],
  );
  if (rows.length === 0) return { status: 'missing' };

  const { user_id: userId, email, xp, rank } = rows[0];
  const outcome = {
    userId,
    email,
    fromXp: Number(xp || 0),
    fromRank: rank,
    toXp: target.xp,
    toRank: target.rank,
    deltaXp: target.xp - Number(xp || 0),
  };
  if (dryRun) return { status: 'dry-run', ...outcome };

  await query('BEGIN');
  try {
    await query(
      'UPDATE profiles SET xp = $2, rank = $3, updated_at = now() WHERE user_id = $1',
      [userId, target.xp, target.rank],
    );
    if (outcome.deltaXp !== 0) {
      await query(
        `INSERT INTO score_events (id, author_id, delta_xp, delta_rep, reason)
         VALUES ($1, $2, $3, 0, 'admin_grant')`,
        [`evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`, userId, outcome.deltaXp],
      );
    }
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
  return { status: 'granted', ...outcome };
}
