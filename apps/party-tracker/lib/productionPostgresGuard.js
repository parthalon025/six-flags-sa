/**
 * Production Postgres credential guard (#436).
 * Dev/test memory mode stays untouched; production must have DATABASE_URL.
 */

export const PRODUCTION_POSTGRES_GUARD_MESSAGE =
  'DATABASE_URL is required in production — see docs/guide/neon.md';

/** @param {NodeJS.ProcessEnv} runtimeEnv */
export function isProductionRuntime(runtimeEnv = process.env) {
  return runtimeEnv.NODE_ENV === 'production' || runtimeEnv.VERCEL_ENV === 'production';
}

/** @param {NodeJS.ProcessEnv} runtimeEnv */
export function postgresCredentialsConfigured(runtimeEnv = process.env) {
  return Boolean(runtimeEnv.DATABASE_URL?.trim());
}

/**
 * @param {NodeJS.ProcessEnv} runtimeEnv
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkProductionPostgresGuard(runtimeEnv = process.env) {
  if (!isProductionRuntime(runtimeEnv)) return { ok: true };
  if (postgresCredentialsConfigured(runtimeEnv)) return { ok: true };
  return { ok: false, reason: PRODUCTION_POSTGRES_GUARD_MESSAGE };
}
