#!/usr/bin/env node
/**
 * Write Neon env for Cloud Agents from Cursor secrets; optionally install MCP + skills.
 *
 * Add `DATABASE_URL` (pooled Neon URL) in the Cursor Cloud environment dashboard —
 * do not commit values. Runs from `.cursor/environment.json` `install` and `start`.
 *
 *   node scripts/cloud-agent-neon-env.mjs
 *   node scripts/cloud-agent-neon-env.mjs --require
 *   node scripts/cloud-agent-neon-env.mjs --tooling
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NEON_REQUIRED_SECRET_KEYS,
  PARKBOUND_CLOUD_ENV_URL,
  neonCloudSecretsStatus,
  writePartyTrackerNeonEnv,
  writeRootNeonEnv,
} from './lib/cloud-agent-neon-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireSecrets = process.argv.includes('--require');
const tooling = process.argv.includes('--tooling');

function runTooling() {
  const skills = spawnSync(
    'npx',
    [
      '-y',
      'skills@latest',
      'add',
      'neondatabase/agent-skills',
      '-s',
      'neon',
      '-s',
      'neon-postgres',
      '-g',
      '-y',
      '-a',
      'cursor',
    ],
    { cwd: root, encoding: 'utf8', stdio: 'inherit' },
  );
  if (skills.status !== 0) {
    console.error('cloud-agent-neon-env: neon skills install failed');
    return false;
  }

  const mcp = spawnSync(
    'npx',
    ['-y', 'neon@latest', 'mcp', '--oauth', '-y', '-a', 'cursor'],
    { cwd: root, encoding: 'utf8', stdio: 'inherit' },
  );
  if (mcp.status !== 0) {
    console.error('cloud-agent-neon-env: neon mcp install failed');
    return false;
  }

  console.log('cloud-agent-neon-env: tooling ok (global neon skills + MCP oauth)');
  return true;
}

if (tooling) {
  const ok = runTooling();
  if (!ok && requireSecrets) process.exit(1);
  if (!ok) process.exit(0);
  // tooling-only invocation may also materialize env when secrets exist
}

const status = neonCloudSecretsStatus();
if (!status.ok) {
  console.error('cloud-agent-neon-env: missing required Cursor Cloud secrets:');
  for (const key of status.missing) console.error(`  - ${key}`);
  console.error(`Add them at ${PARKBOUND_CLOUD_ENV_URL}`);
  console.error(
    'Use the pooled Neon URL, e.g. postgresql://…@…-pooler.…/neondb?sslmode=require',
  );
  if (requireSecrets) process.exit(1);
  process.exit(0);
}

for (const key of NEON_REQUIRED_SECRET_KEYS) {
  console.log(`cloud-agent-neon-env: ${key}=set`);
}

const app = writePartyTrackerNeonEnv(root);
const rootEnv = writeRootNeonEnv(root);
if (app.wrote) {
  console.log(`cloud-agent-neon-env: wrote ${app.path}`);
} else {
  console.error(`cloud-agent-neon-env: failed (${app.reason})`);
  if (requireSecrets) process.exit(1);
}
if (rootEnv.wrote) {
  console.log(`cloud-agent-neon-env: wrote ${rootEnv.path}`);
} else {
  console.error(`cloud-agent-neon-env: failed (${rootEnv.reason})`);
  if (requireSecrets) process.exit(1);
}
