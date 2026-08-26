/**
 * Production Postgres credential guard (#436).
 * Dev/test memory mode stays untouched; production must have DATABASE_URL.
 */

export const PRODUCTION_POSTGRES_GUARD_MESSAGE =
  'DATABASE_URL is required in production — see docs/guide/neon.md';

/** @param {NodeJS.ProcessEnv} env */
export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

/** @param {NodeJS.ProcessEnv} env */
export function postgresCredentialsConfigured(env = process.env) {
  return Boolean(env.DATABASE_URL?.trim());
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkProductionPostgresGuard(env = process.env) {
  if (!isProductionRuntime(env)) return { ok: true };
  if (postgresCredentialsConfigured(env)) return { ok: true };
  return { ok: false, reason: PRODUCTION_POSTGRES_GUARD_MESSAGE };
}
