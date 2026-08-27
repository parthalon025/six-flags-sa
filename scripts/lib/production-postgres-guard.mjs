/**
 * Production Postgres credential guard (#436) — scripts/lib seam.
 * Gate runs before workspace install; this file must not reach app source.
 */
export const PRODUCTION_POSTGRES_GUARD_MESSAGE =
  'DATABASE_URL is required in production — see docs/guide/neon.md';

/** @param {NodeJS.ProcessEnv} [env] */
export function isProductionRuntime(env = process.env) {
  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv === 'preview' || vercelEnv === 'development') return false;
  return env.NODE_ENV === 'production' || vercelEnv === 'production';
}

/** @param {NodeJS.ProcessEnv} [env] */
export function postgresCredentialsConfigured(env = process.env) {
  return Boolean(env.DATABASE_URL?.trim());
}

/** @param {NodeJS.ProcessEnv} [env] */
export function checkProductionPostgresGuard(env = process.env) {
  if (!isProductionRuntime(env)) return { ok: true };
  if (postgresCredentialsConfigured(env)) return { ok: true };
  return { ok: false, reason: PRODUCTION_POSTGRES_GUARD_MESSAGE };
}
