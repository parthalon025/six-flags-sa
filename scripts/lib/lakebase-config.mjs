/**
 * Lakebase connection metadata — host, Data API URL, migration order.
 * Passwords come from OAuth via `databricks postgres generate-database-credential`
 * or a full DATABASE_URL; never commit secrets.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = join(root, 'db/migrations');

/** @returns {string[]} SQL migration basenames in lexical order */
export function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/** @param {string} name */
export function migrationPath(name) {
  return join(migrationsDir, name);
}

/**
 * Parse Lakebase settings from env (see .env.example).
 * @returns {{
 *   host: string | undefined,
 *   user: string | undefined,
 *   database: string | undefined,
 *   dataApiUrl: string | undefined,
 *   endpoint: string | undefined,
 * }}
 */
export function lakebaseFromEnv(env = process.env) {
  return {
    host: env.LAKEBASE_PG_HOST,
    user: env.LAKEBASE_PG_USER,
    database: env.LAKEBASE_PG_DATABASE ?? 'databricks_postgres',
    dataApiUrl: env.LAKEBASE_DATA_API_URL,
    endpoint: env.LAKEBASE_ENDPOINT,
  };
}

/**
 * Load root .env into process.env when keys are unset.
 * @param {string} [envPath]
 */
export function loadRootEnv(envPath = join(root, '.env')) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
