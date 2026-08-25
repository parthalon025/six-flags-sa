/**
 * Production DATABASE_URL guard (#436).
 * Dev/test memory mode stays untouched; production must use Neon Postgres.
 */

export const PRODUCTION_DATABASE_GUARD_MESSAGE =
  'DATABASE_URL is required in production (Neon Postgres) — see docs/guide/neon.md';

/** @param {NodeJS.ProcessEnv} env */
export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

/** @param {NodeJS.ProcessEnv} env */
export function databaseUrlConfigured(env = process.env) {
  return Boolean(String(env.DATABASE_URL || '').trim());
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkProductionDatabaseGuard(env = process.env) {
  if (!isProductionRuntime(env)) return { ok: true };
  if (databaseUrlConfigured(env)) return { ok: true };
  return { ok: false, reason: PRODUCTION_DATABASE_GUARD_MESSAGE };
}
