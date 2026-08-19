#!/usr/bin/env node
/**
 * Grant one Profile the max XP/Rank — the top entry of RANK_LADDER in
 * packages/shared/questScore.js. Full access in this app's domain model
 * is just having a Profile (CONTEXT.md); there is no separate
 * access/tier column to flip.
 *
 *   npm run profile:max-rank -- --clerk-id user_xxx
 *   npm run profile:max-rank -- --clerk-id user_xxx --dry-run
 *
 * Requires DATABASE_URL (apps/party-tracker/.env.local or root .env).
 * The Profile must already exist — it's minted by /api/profile/sync on
 * first sign-in, so sign in once before running this.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RANK_LADDER } from '../packages/shared/questScore.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(join(root, 'apps/party-tracker/.env.local'));
loadEnvFile(join(root, '.env'));

const { rank: MAX_RANK, xp: MAX_XP } = RANK_LADDER[RANK_LADDER.length - 1];

function parseArgs(argv) {
  const out = { clerkId: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--clerk-id') out.clerkId = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

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
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.email, p.xp, p.rank
       FROM users u JOIN profiles p ON p.user_id = u.id
       WHERE u.clerk_id = $1
       LIMIT 1`,
      [clerkId],
    );

    if (rows.length === 0) {
      console.error(
        `No Profile found for clerk_id=${clerkId}. Sign in once (mints the Profile via ` +
          '/api/profile/sync), then re-run this script.',
      );
      process.exit(1);
    }

    const { user_id: userId, email, xp: currentXp, rank: currentRank } = rows[0];
    const deltaXp = MAX_XP - Number(currentXp || 0);

    console.log(
      `Profile ${userId} (${email}): xp ${currentXp} -> ${MAX_XP}, rank ${currentRank} -> ${MAX_RANK}`,
    );

    if (dryRun) {
      console.log('Dry run — no changes written.');
      return;
    }

    await pool.query('BEGIN');
    try {
      await pool.query(
        'UPDATE profiles SET xp = $2, rank = $3, updated_at = now() WHERE user_id = $1',
        [userId, MAX_XP, MAX_RANK],
      );
      if (deltaXp !== 0) {
        await pool.query(
          `INSERT INTO score_events (id, author_id, delta_xp, delta_rep, reason)
           VALUES ($1, $2, $3, 0, 'admin_grant')`,
          [`evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`, userId, deltaXp],
        );
      }
      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }

    console.log('Done.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
