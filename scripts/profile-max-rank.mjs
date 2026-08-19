#!/usr/bin/env node
/**
 * Grant one Profile the max XP/Rank (top of RANK_LADDER).
 *
 *   npm run profile:max-rank -- --clerk-id user_xxx
 *   npm run profile:max-rank -- --clerk-id user_xxx --dry-run
 *
 * Requires DATABASE_URL — the npm script loads apps/party-tracker/.env.local
 * and root .env via --env-file-if-exists. The Profile must already exist —
 * it's minted by /api/profile/sync on first sign-in, so sign in once before
 * running this. Decision + SQL live in scripts/lib/profile-max-rank.mjs.
 */

import { grantMaxRank, parseArgs } from './lib/profile-max-rank.mjs';

async function main() {
  const { clerkId, dryRun } = parseArgs(process.argv.slice(2));
  if (!clerkId) {
    console.error('Usage: npm run profile:max-rank -- --clerk-id <clerk_user_id> [--dry-run]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set (apps/party-tracker/.env.local or root .env).');
    process.exit(1);
  }

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await grantMaxRank({
      query: (sql, params) => pool.query(sql, params),
      clerkId,
      dryRun,
    });
    if (result.status === 'missing') {
      console.error(
        `No Profile found for clerk_id=${clerkId}. Sign in once (mints the Profile via ` +
          '/api/profile/sync), then re-run this script.',
      );
      process.exit(1);
    }
    console.log(
      `Profile ${result.userId} (${result.email}): xp ${result.fromXp} -> ${result.toXp}, ` +
        `rank ${result.fromRank} -> ${result.toRank}`,
    );
    console.log(result.status === 'dry-run' ? 'Dry run — no changes written.' : 'Done.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
