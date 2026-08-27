/**
 * Production Upstash/Redis credential guard (#371) — deploy gate seam.
 */
import assert from 'node:assert/strict';
import {
  isProductionRuntime,
  checkProductionRedisGuard,
  redisCredentialsConfigured,
  PRODUCTION_REDIS_GUARD_MESSAGE,
} from '../../scripts/lib/production-redis-guard.mjs';

assert.equal(isProductionRuntime({ NODE_ENV: 'production' }), true);
assert.equal(isProductionRuntime({ VERCEL_ENV: 'production' }), true);
assert.equal(isProductionRuntime({ NODE_ENV: 'development' }), false);
assert.equal(isProductionRuntime({ VERCEL_ENV: 'preview' }), false);
assert.equal(isProductionRuntime({}), false);

assert.equal(
  redisCredentialsConfigured({
    UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'tok',
  }),
  true,
);
assert.equal(
  redisCredentialsConfigured({
    KV_REST_API_URL: 'https://y.upstash.io',
    KV_REST_API_TOKEN: 'tok',
  }),
  true,
);
assert.equal(
  redisCredentialsConfigured({
    UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: '',
  }),
  false,
);
assert.equal(
  redisCredentialsConfigured({
    UPSTASH_REDIS_REST_URL: '',
    KV_REST_API_TOKEN: 'tok',
  }),
  false,
);

const prodNoRedis = checkProductionRedisGuard({
  NODE_ENV: 'production',
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
});
assert.equal(prodNoRedis.ok, false);
assert.match(prodNoRedis.reason, /Redis/);
assert.equal(prodNoRedis.reason, PRODUCTION_REDIS_GUARD_MESSAGE);

const devNoRedis = checkProductionRedisGuard({
  NODE_ENV: 'development',
  UPSTASH_REDIS_REST_URL: '',
});
assert.equal(devNoRedis.ok, true);

const previewNoRedis = checkProductionRedisGuard({
  VERCEL_ENV: 'preview',
  UPSTASH_REDIS_REST_URL: '',
});
assert.equal(previewNoRedis.ok, true);

const prodWithUpstash = checkProductionRedisGuard({
  NODE_ENV: 'production',
  UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'tok',
});
assert.equal(prodWithUpstash.ok, true);

const prodWithKv = checkProductionRedisGuard({
  VERCEL_ENV: 'production',
  KV_REST_API_URL: 'https://y.upstash.io',
  KV_REST_API_TOKEN: 'tok',
});
assert.equal(prodWithKv.ok, true);

console.log('production-redis-guard: ok');
