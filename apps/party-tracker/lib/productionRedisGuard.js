/**
 * Production Upstash/Redis credential guard (#371).
 * Dev/test memory mode stays untouched; production must have a complete REST pair.
 */
export {
  isProductionRuntime,
  checkProductionRedisGuard,
  redisCredentialsConfigured,
  PRODUCTION_REDIS_GUARD_MESSAGE,
} from '../../../scripts/lib/production-redis-guard.mjs';
