#!/usr/bin/env node
/**
 * Post-deploy smoke — readiness, migration ledger, Clerk webhook route (#443).
 *
 * Seam: scripts/lib/post-deploy-check.mjs (network and DB stubbed).
 */
import assert from 'node:assert/strict';
import {
  checkClerkWebhook,
  checkMigrationSchema,
  checkReady,
  migrationDrift,
  runPostDeployChecks,
} from '../../scripts/lib/post-deploy-check.mjs';

const base = 'https://parkbound.example';

/** Red slice 1: readiness fails when /api/ready is not ready. */
const readyFail = await checkReady(base, {
  fetchFn: async () => ({
    ok: false,
    status: 503,
    json: async () => ({ ready: false, backend: 'redis', error: 'timeout' }),
  }),
});
assert.equal(readyFail.ok, false);
assert.match(readyFail.error, /ready/);

/** Green slice 1: readiness passes when every configured backend is healthy. */
const readyOk = await checkReady(base, {
  fetchFn: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ready: true,
      backend: 'redis',
      durable: true,
      postgres: { ok: true, configured: true },
      clerk: { configured: true },
    }),
  }),
});
assert.equal(readyOk.ok, true);

/** Migration drift: repo ahead of deployed ledger. */
const drift = migrationDrift(
  ['001_profiles_contributions.sql', '002_clerk_users.sql'],
  ['001_profiles_contributions.sql'],
);
assert.equal(drift.ok, false);
assert.deepEqual(drift.missing, ['002_clerk_users.sql']);

const migrationFail = await checkMigrationSchema({
  query: async () => ({ rows: [{ name: '001_profiles_contributions.sql' }] }),
  expectedFiles: ['001_profiles_contributions.sql', '002_clerk_users.sql'],
});
assert.equal(migrationFail.ok, false);
assert.match(migrationFail.error, /002_clerk_users/);

const migrationOk = await checkMigrationSchema({
  query: async () => ({
    rows: [{ name: '001_profiles_contributions.sql' }, { name: '002_clerk_users.sql' }],
  }),
  expectedFiles: ['001_profiles_contributions.sql', '002_clerk_users.sql'],
});
assert.equal(migrationOk.ok, true);

/** Clerk webhook: 404 means route missing; verification failure is healthy. */
const clerkMissing = await checkClerkWebhook(base, {
  fetchFn: async () => ({ ok: false, status: 404 }),
});
assert.equal(clerkMissing.ok, false);

const clerkOk = await checkClerkWebhook(base, {
  fetchFn: async () => ({ ok: false, status: 500 }),
});
assert.equal(clerkOk.ok, true);

const aggregate = await runPostDeployChecks({
  baseUrl: base,
  fetchFn: async (url) => {
    if (url.endsWith('/api/ready')) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ ready: false, error: 'down' }),
      };
    }
    return { ok: false, status: 500 };
  },
  query: async () => ({ rows: [] }),
  expectedMigrations: ['001_profiles_contributions.sql'],
});
assert.equal(aggregate.ok, false);
assert.ok(aggregate.failures.length >= 2);

console.log('post-deploy-check.test.mjs: ok');
