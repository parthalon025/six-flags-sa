/**
 * Production Upstash/Redis credential guard (#371).
 * Dev/test memory mode stays untouched; production must have a complete REST pair.
 */

export const PRODUCTION_REDIS_GUARD_MESSAGE =
  'Upstash Redis credentials are required in production — see docs/guide/upstash.md';

/** @param {NodeJS.ProcessEnv} env */
export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

/** @param {NodeJS.ProcessEnv} env */
export function redisCredentialsConfigured(env = process.env) {
  const url = String(
    env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '',
  ).trim();
  const token = String(
    env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '',
  ).trim();
  return Boolean(url && token);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkProductionRedisGuard(env = process.env) {
  if (!isProductionRuntime(env)) return { ok: true };
  if (redisCredentialsConfigured(env)) return { ok: true };
  return { ok: false, reason: PRODUCTION_REDIS_GUARD_MESSAGE };
}
