#!/usr/bin/env node
/**
 * Cloud Agent Clerk env materialization.
 *
 *   node test/scripts/cloud-agent-clerk-env.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLERK_CI_STUB_ENV,
  CLERK_ENV_DEFAULTS,
  CLERK_REQUIRED_SECRET_KEYS,
  PARKBOUND_CLOUD_ENV_URL,
  clerkCloudSecretsStatus,
  clerkEnvFromProcess,
  ensureClerkEnvForCi,
  formatEnvFile,
  isClerkCiStubEnv,
  writePartyTrackerClerkEnv,
} from '../../scripts/lib/cloud-agent-clerk-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const env = JSON.parse(readFileSync(join(root, '.cursor/environment.json'), 'utf8'));
assert.match(
  env.install,
  /node scripts\/cloud-agent-clerk-env\.mjs/,
  'Cloud install must materialize Clerk env for party-tracker',
);
assert.match(
  env.start,
  /node scripts\/cloud-agent-clerk-env\.mjs --require/,
  'Cloud start must require Clerk secrets on every agent boot',
);

assert.equal(PARKBOUND_CLOUD_ENV_URL.includes('d8097811-95a0-11f1-ba66-0e7d0216e441'), true);
assert.deepEqual(CLERK_REQUIRED_SECRET_KEYS, [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
]);

assert.deepEqual(clerkEnvFromProcess({}), CLERK_ENV_DEFAULTS);
assert.deepEqual(clerkCloudSecretsStatus({}).missing, CLERK_REQUIRED_SECRET_KEYS);
assert.equal(clerkCloudSecretsStatus({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x',
  CLERK_SECRET_KEY: 'sk_test_y',
}).ok, true);
assert.equal(
  clerkEnvFromProcess({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x' }).NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  CLERK_ENV_DEFAULTS.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
);

const scratch = mkdtempSync(join(tmpdir(), 'clerk-env-'));
try {
  const skipped = writePartyTrackerClerkEnv(scratch, {});
  assert.equal(skipped.wrote, false);
  assert.deepEqual(skipped.missing, CLERK_REQUIRED_SECRET_KEYS);

  const wrote = writePartyTrackerClerkEnv(scratch, {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x',
    CLERK_SECRET_KEY: 'sk_test_y',
  });
  assert.equal(wrote.wrote, true);
  const text = readFileSync(wrote.path, 'utf8');
  assert.match(text, /^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_x/m);
  assert.match(text, /^CLERK_SECRET_KEY=sk_test_y/m);
  assert.match(text, /^NEXT_PUBLIC_CLERK_SIGN_IN_URL=\/sign-in/m);

  const stubbed = ensureClerkEnvForCi(scratch, {});
  assert.equal(stubbed.wrote, true);
  assert.equal(stubbed.source, 'stub');
  assert.equal(isClerkCiStubEnv(CLERK_CI_STUB_ENV), true);
  const stubText = readFileSync(stubbed.path, 'utf8');
  assert.match(stubText, new RegExp(`^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${CLERK_CI_STUB_ENV.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}`, 'm'));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

assert.equal(formatEnvFile({ A: '1', B: '2' }), 'A=1\nB=2\n');

console.log('cloud-agent-clerk-env.test.mjs: ok');
