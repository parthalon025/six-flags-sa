#!/usr/bin/env node
/**
 * Apply db/migrations/*.sql in lexical order (CI + local Docker Postgres).
 * Skips files already recorded in schema_migrations (#443).
 *
 *   npm run postdb:migrate
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationFiles, migrationPath } from './lib/lakebase-config.mjs';

/** @returns {string[]} */
export function orderedMigrationFiles() {
  return migrationFiles();
}

/**
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ name: string }> }> }} client
 */
export async function readAppliedMigrationNames(client) {
  try {
    const result = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    return result.rows.map((row) => row.name);
  } catch (err) {
    if (err?.code === '42P01') return [];
    throw err;
  }
}

/**
 * Databases migrated before the ledger existed have schema but no rows.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>> }} client
 * @param {string[]} files
 */
export async function backfillLedgerIfLegacy(client, files) {
  const applied = await readAppliedMigrationNames(client);
  if (applied.length > 0) return;
  const legacy = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists
  `);
  if (!legacy.rows[0]?.exists) return;
  for (const file of files) {
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
  }
  console.log('> backfilled schema_migrations for legacy database');
}

/**
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<unknown> }} client pg Client or Pool
 * @param {string[]} [files]
 */
export async function applyMigrations(client, files = orderedMigrationFiles()) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await backfillLedgerIfLegacy(client, files);
  const applied = await readAppliedMigrationNames(client);
  for (const file of files) {
    if (applied.includes(file)) {
      console.log(`> skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(migrationPath(file), 'utf8');
    console.log(`> applying ${file}`);
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('postdb-migrate: DATABASE_URL is required');
    process.exit(1);
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await applyMigrations(pool);
    console.log('postdb-migrate: all migrations applied');
  } finally {
    await pool.end();
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
