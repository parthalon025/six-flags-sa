#!/usr/bin/env node
/**
 * Fast script tests that guard CI/CD invariants (gate job).
 *
 *   node scripts/ci/gate-tests.mjs
 *   npm run test:ci-gate
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_SCRIPT_TESTS } from './manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function runGateScriptTests({
  tests = GATE_SCRIPT_TESTS,
  cwd = root,
  execPath = process.execPath,
  spawn = spawnSync,
} = {}) {
  for (const rel of tests) {
    const file = join(cwd, rel);
    const r = spawn(execPath, [file], { cwd, stdio: 'inherit' });
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = runGateScriptTests();
  if (code !== 0) process.exit(code);
  console.log('ci gate-tests: ok');
}
