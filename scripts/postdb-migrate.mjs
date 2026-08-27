#!/usr/bin/env node
/**
 * Apply db/migrations/*.sql in lexical order (CI + local Docker Postgres).
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
