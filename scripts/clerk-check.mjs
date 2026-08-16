#!/usr/bin/env node
/**
 * Assert Park Bound Clerk production will not revert Apple Sign In.
 *
 *   npm run clerk:check
 *   npm run clerk:check -- --instance prod
 *
 * File check always runs (checked-in prod patch vs spec).
 * --instance prod also pulls live Clerk config (needs clerk CLI login).
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appleDeveloperNotes,
  evaluateClerkAppleProd,
  evaluateProdPatchFile,
} from './lib/clerk-apple-prod.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(root, 'scripts/lib/clerk-apple-prod-spec.json'), 'utf8'));
const prodPatch = JSON.parse(
  readFileSync(join(root, 'scripts/lib/clerk-parkbound-config-prod.json'), 'utf8'),
);

function fail(title, violations) {
  console.error(`\n${title}\n`);
  for (const line of violations) console.error(`  - ${line}`);
  console.error('\nApple Developer checklist:\n');
  for (const note of appleDeveloperNotes(spec)) console.error(`  - ${note}`);
  process.exit(1);
}

const fileResult = evaluateProdPatchFile(prodPatch, spec);
if (!fileResult.ok) fail('clerk-parkbound-config-prod.json drifted from Apple prod spec', fileResult.violations);
console.log('clerk:check file: ok');

const wantLive = process.argv.includes('--instance') && process.argv.includes('prod');
if (!wantLive) process.exit(0);

const dir = mkdtempSync(join(tmpdir(), 'clerk-apple-check-'));
const out = join(dir, 'prod.json');
try {
  execSync(`clerk config pull --instance prod --output "${out}"`, {
    cwd: root,
    stdio: 'inherit',
  });
  const pulled = JSON.parse(readFileSync(out, 'utf8'));
  const live = evaluateClerkAppleProd(pulled, spec);
  if (!live.ok) fail('Clerk production config drifted from Apple prod spec', live.violations);
  console.log('clerk:check live prod: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
