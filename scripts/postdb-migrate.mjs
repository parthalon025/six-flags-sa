#!/usr/bin/env node
/**
 * Apply db/migrations/*.sql in lexical order (CI + local Docker Postgres).
 *
 *   npm run postdb:migrate
 *   DATABASE_URL=postgres://parkbound:parkbound@localhost:5432/parkbound \
 *     node scripts/postdb-migrate.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationFiles, migrationPath } from './lib/lakebase-config.mjs';
import { getPool } from '../packages/venue-builder/lib/db/postgres.mjs';

/** @returns {string[]} */
export function orderedMigrationFiles() {
  return migrationFiles();
}

/**
 * @param {{ query: (sql: string) => Promise<unknown> }} client pg Client or Pool
 * @param {string[]} [files]
 */
export async function applyMigrations(client, files = orderedMigrationFiles()) {
  for (const file of files) {
    const sql = readFileSync(migrationPath(file), 'utf8');
    console.log(`> applying ${file}`);
    await client.query(sql);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('postdb-migrate: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = await getPool();
  await applyMigrations(pool);
  console.log('postdb-migrate: all migrations applied');
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
