#!/usr/bin/env node
/**
 * Write Clerk env for party-tracker from Cloud Agent secrets.
 *
 * Add secrets in the Cursor Cloud environment dashboard — do not commit values.
 * Runs from `.cursor/environment.json` `install` and `start`.
 *
 *   node scripts/cloud-agent-clerk-env.mjs
 *   node scripts/cloud-agent-clerk-env.mjs --require
 *   node scripts/cloud-agent-clerk-env.mjs --ci
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLERK_REQUIRED_SECRET_KEYS,
  PARKBOUND_CLOUD_ENV_URL,
  clerkCloudSecretsStatus,
  ensureClerkEnvForCi,
  writePartyTrackerClerkEnv,
} from './lib/cloud-agent-clerk-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireSecrets = process.argv.includes('--require');
const ciFallback = process.argv.includes('--ci');

if (ciFallback) {
  const result = ensureClerkEnvForCi(root);
  if (!result.wrote) {
    console.error(`cloud-agent-clerk-env: failed (${result.reason})`);
    process.exit(1);
  }
  console.log(`cloud-agent-clerk-env: wrote ${result.path} (${result.source})`);
  process.exit(0);
}

const status = clerkCloudSecretsStatus();
if (!status.ok) {
  console.error('cloud-agent-clerk-env: missing required Cursor Cloud secrets:');
  for (const key of status.missing) console.error(`  - ${key}`);
  console.error(`Add them at ${PARKBOUND_CLOUD_ENV_URL}`);
  console.error('Copy Production keys from Clerk Dashboard → Park Bound app → API keys.');
  if (requireSecrets) process.exit(1);
  process.exit(0);
}

for (const key of CLERK_REQUIRED_SECRET_KEYS) {
  console.log(`cloud-agent-clerk-env: ${key}=set`);
}

const result = writePartyTrackerClerkEnv(root);
if (result.wrote) {
  console.log(`cloud-agent-clerk-env: wrote ${result.path}`);
} else {
  console.error(`cloud-agent-clerk-env: failed (${result.reason})`);
  if (requireSecrets) process.exit(1);
}
