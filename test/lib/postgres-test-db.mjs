/**
 * Postgres test database — migrations + seed for integration tests (#438).
 * Not a seam under test; infrastructure for store integration suites.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS_DIR = join(ROOT, 'db/migrations');

/** @returns {string | null} */
export function testDatabaseUrl() {
  return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || null;
}

/** @param {string} url */
export async function probeDatabase(url) {
  try {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2_000 });
    try {
      await pool.query('SELECT 1');
      return true;
    } finally {
      await pool.end();
    }
  } catch {
    return false;
  }
}

/** @param {import('pg').Pool} pool */
export async function applyMigrations(pool) {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await pool.query(sql);
  }
}

/** @param {import('pg').Pool} pool */
export async function resetContributionTables(pool) {
  await pool.query(`
    TRUNCATE contribution_thanks, confirmations, score_events, contributions,
             profile_entitlements, managed_guests, profiles, users
    RESTART IDENTITY CASCADE
  `);
}

/**
 * @param {import('pg').Pool} pool
 * @param {Array<{ id: string, displayName?: string }>} users
 */
export async function seedUsers(pool, users) {
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, `${u.id}@test.parkbound`],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name, impact_helped)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [u.id, u.displayName || u.id],
    );
  }
}

/** @param {string} url */
export async function openTestPool(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  await applyMigrations(pool);
  return pool;
}
