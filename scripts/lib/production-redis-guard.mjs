/** Re-export app guard for deploy-gate script tests (#371). */
export {
  isProductionRuntime,
  checkProductionRedisGuard,
  redisCredentialsConfigured,
  PRODUCTION_REDIS_GUARD_MESSAGE,
} from '../../apps/party-tracker/lib/productionRedisGuard.js';
