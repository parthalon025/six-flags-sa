#!/usr/bin/env node
/**
 * Write Clerk env for party-tracker from Cloud Agent secrets.
 *
 * Add secrets in the Cursor Cloud environment dashboard — do not commit values.
 * Cloud Agents run this from `.cursor/environment.json` `install`.
 *
 *   node scripts/cloud-agent-clerk-env.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePartyTrackerClerkEnv } from './lib/cloud-agent-clerk-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = writePartyTrackerClerkEnv(root);

if (result.wrote) {
  console.log(`cloud-agent-clerk-env: wrote ${result.path}`);
} else {
  console.log(`cloud-agent-clerk-env: skipped (${result.reason})`);
}
