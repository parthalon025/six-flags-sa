#!/usr/bin/env node
/**
 * Cloud Agent Neon env materialization.
 *
 *   node test/scripts/cloud-agent-neon-env.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NEON_ENV_KEYS,
  NEON_REQUIRED_SECRET_KEYS,
  PARKBOUND_CLOUD_ENV_URL,
  neonCloudSecretsStatus,
  neonEnvFromProcess,
  parseEnvFile,
  upsertEnvFile,
  writePartyTrackerNeonEnv,
  writeRootNeonEnv,
} from '../../scripts/lib/cloud-agent-neon-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const env = JSON.parse(readFileSync(join(root, '.cursor/environment.json'), 'utf8'));
assert.match(
  env.install,
  /node scripts\/cloud-agent-neon-env\.mjs/,
  'Cloud install must materialize Neon DATABASE_URL for party-tracker',
);
assert.match(
  env.install,
  /node scripts\/cloud-agent-neon-env\.mjs --tooling/,
  'Cloud install must install Neon MCP + global neon skills',
);
assert.match(
  env.start,
  /node scripts\/cloud-agent-neon-env\.mjs --require/,
  'Cloud start must require Neon DATABASE_URL on every agent boot',
);
// Neon must run after Clerk so DATABASE_URL is merged into .env.local Clerk just wrote.
const clerkIdx = env.start.indexOf('cloud-agent-clerk-env.mjs --require');
const neonIdx = env.start.indexOf('cloud-agent-neon-env.mjs --require');
assert.ok(clerkIdx >= 0 && neonIdx > clerkIdx, 'Neon env must follow Clerk on start');

assert.equal(PARKBOUND_CLOUD_ENV_URL.includes('d8097811-95a0-11f1-ba66-0e7d0216e441'), true);
assert.deepEqual(NEON_REQUIRED_SECRET_KEYS, ['DATABASE_URL']);
assert.deepEqual(NEON_ENV_KEYS, ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']);

assert.deepEqual(neonCloudSecretsStatus({}).missing, ['DATABASE_URL']);
assert.equal(
  neonCloudSecretsStatus({
    DATABASE_URL: 'postgresql://u:p@ep-x-pooler.example/neondb?sslmode=require',
  }).ok,
  true,
);
assert.deepEqual(
  neonEnvFromProcess({
    DATABASE_URL: 'postgresql://u:p@pooler/db',
    DATABASE_URL_UNPOOLED: 'postgresql://u:p@direct/db',
    NEON_API_KEY: 'napi_should_not_land_in_app_env',
  }),
  {
    DATABASE_URL: 'postgresql://u:p@pooler/db',
    DATABASE_URL_UNPOOLED: 'postgresql://u:p@direct/db',
  },
);

assert.deepEqual(parseEnvFile('A=1\n# c\nB=two words\n'), { A: '1', B: 'two words' });

const scratch = mkdtempSync(join(tmpdir(), 'neon-env-'));
try {
  const skipped = writePartyTrackerNeonEnv(scratch, {});
  assert.equal(skipped.wrote, false);
  assert.deepEqual(skipped.missing, ['DATABASE_URL']);

  mkdirSync(join(scratch, 'apps/party-tracker'), { recursive: true });
  const existingPath = join(scratch, 'apps/party-tracker/.env.local');
  writeFileSync(existingPath, 'CLERK_SECRET_KEY=sk_keep\nDATABASE_URL=old\n', 'utf8');

  const wrote = writePartyTrackerNeonEnv(scratch, {
    DATABASE_URL: 'postgresql://u:p@pooler/db?sslmode=require',
    DATABASE_URL_UNPOOLED: 'postgresql://u:p@direct/db?sslmode=require',
  });
  assert.equal(wrote.wrote, true);
  const text = readFileSync(wrote.path, 'utf8');
  assert.match(text, /^CLERK_SECRET_KEY=sk_keep/m);
  assert.match(text, /^DATABASE_URL=postgresql:\/\/u:p@pooler\/db\?sslmode=require$/m);
  assert.match(text, /^DATABASE_URL_UNPOOLED=postgresql:\/\/u:p@direct\/db\?sslmode=require$/m);
  assert.doesNotMatch(text, /napi_should_not_land|NEON_API_KEY/);

  const rootWrote = writeRootNeonEnv(scratch, {
    DATABASE_URL: 'postgresql://u:p@pooler/db?sslmode=require',
  });
  assert.equal(rootWrote.wrote, true);
  const rootText = readFileSync(rootWrote.path, 'utf8');
  assert.match(rootText, /^DATABASE_URL=postgresql:\/\/u:p@pooler\/db\?sslmode=require$/m);

  const upsertPath = join(scratch, 'merged.env');
  upsertEnvFile(upsertPath, { A: '1' });
  upsertEnvFile(upsertPath, { B: '2', A: '1b' });
  assert.deepEqual(parseEnvFile(readFileSync(upsertPath, 'utf8')), { A: '1b', B: '2' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('cloud-agent-neon-env.test.mjs: ok');
