/**
 * Production Postgres credential guard (#436) — deploy gate seam.
 */
import assert from 'node:assert/strict';
import {
  isProductionRuntime,
  checkProductionPostgresGuard,
  postgresCredentialsConfigured,
  PRODUCTION_POSTGRES_GUARD_MESSAGE,
} from '../../scripts/lib/production-postgres-guard.mjs';

assert.equal(isProductionRuntime({ NODE_ENV: 'production' }), true);
assert.equal(isProductionRuntime({ VERCEL_ENV: 'production' }), true);
assert.equal(isProductionRuntime({ NODE_ENV: 'development' }), false);
assert.equal(isProductionRuntime({ VERCEL_ENV: 'preview' }), false);
assert.equal(isProductionRuntime({}), false);

assert.equal(postgresCredentialsConfigured({ DATABASE_URL: 'postgresql://u:p@host/db' }), true);
assert.equal(postgresCredentialsConfigured({ DATABASE_URL: '' }), false);
assert.equal(postgresCredentialsConfigured({}), false);

const prodNoDb = checkProductionPostgresGuard({
  NODE_ENV: 'production',
  DATABASE_URL: '',
});
assert.equal(prodNoDb.ok, false);
assert.match(prodNoDb.reason, /DATABASE_URL/);
assert.equal(prodNoDb.reason, PRODUCTION_POSTGRES_GUARD_MESSAGE);

const devNoDb = checkProductionPostgresGuard({
  NODE_ENV: 'development',
  DATABASE_URL: '',
});
assert.equal(devNoDb.ok, true);

const previewNoDb = checkProductionPostgresGuard({
  VERCEL_ENV: 'preview',
  DATABASE_URL: '',
});
assert.equal(previewNoDb.ok, true);

const prodWithDb = checkProductionPostgresGuard({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@host/db',
});
assert.equal(prodWithDb.ok, true);

console.log('production-postgres-guard: ok');
