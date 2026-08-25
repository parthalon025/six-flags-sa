/**
 * Production DATABASE_URL guard (#436) — deploy gate + runtime readiness seam.
 */
import assert from 'node:assert/strict';
import {
  isProductionRuntime,
  checkProductionDatabaseGuard,
  PRODUCTION_DATABASE_GUARD_MESSAGE,
} from '../../scripts/lib/production-database-guard.mjs';

assert.equal(isProductionRuntime({ NODE_ENV: 'production' }), true);
assert.equal(isProductionRuntime({ VERCEL_ENV: 'production' }), true);
assert.equal(isProductionRuntime({ NODE_ENV: 'development' }), false);
assert.equal(isProductionRuntime({}), false);

const prodNoDb = checkProductionDatabaseGuard({
  NODE_ENV: 'production',
  DATABASE_URL: '',
});
assert.equal(prodNoDb.ok, false);
assert.match(prodNoDb.reason, /DATABASE_URL/);
assert.equal(prodNoDb.reason, PRODUCTION_DATABASE_GUARD_MESSAGE);

const devNoDb = checkProductionDatabaseGuard({
  NODE_ENV: 'development',
  DATABASE_URL: '',
});
assert.equal(devNoDb.ok, true);

const testNoDb = checkProductionDatabaseGuard({
  NODE_ENV: 'test',
  DATABASE_URL: '',
});
assert.equal(testNoDb.ok, true);

const prodWithDb = checkProductionDatabaseGuard({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@host/db',
});
assert.equal(prodWithDb.ok, true);

console.log('production-database-guard: ok');
