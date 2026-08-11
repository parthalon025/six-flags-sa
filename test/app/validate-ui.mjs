#!/usr/bin/env node
/**
 * UI enhancement validation — behavioural e2e + grandma persona suite.
 *
 * Run after UI changes to confirm regressions did not slip in and that a
 * first-time visitor can still complete core tasks.
 *
 *   npm run build && npm start &
 *   npm run test:validate-ui
 *
 * Environment:
 *   BASE_URL       app origin (default http://127.0.0.1:3000)
 *   CHROMIUM_PATH  system Chromium for Playwright
 *
 * Flags:
 *   --functional-only   skip grandma
 *   --grandma-only      skip functional (e2e)
 *   --no-health         do not probe /api/health first
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const args = process.argv.slice(2);
const functionalOnly = args.includes('--functional-only');
const grandmaOnly = args.includes('--grandma-only');
const skipHealth = args.includes('--no-health');

const runFunctional = !grandmaOnly;
const runGrandma = !functionalOnly;

async function healthCheck() {
  const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`/api/health returned ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (body.ok === false) throw new Error('health body not ok');
}

function runSuite(name, script) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}\n  ${name}\n${'='.repeat(60)}\n`);
    const child = spawn(process.execPath, [path.join(HERE, script)], {
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: BASE },
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code) reject(new Error(`${script} exited with code ${code}`));
      else resolve();
    });
  });
}

const started = Date.now();
const suites = [];

try {
  if (!skipHealth) {
    process.stdout.write(`Probing ${BASE}/api/health … `);
    await healthCheck();
    console.log('ok');
  }

  if (runFunctional) {
    await runSuite('E2E functional suite (three-phone behavioural)', 'functional.mjs');
    suites.push('functional');
  }

  if (runGrandma) {
    await runSuite('Grandma test (first-time visitor personas)', 'grandma.mjs');
    suites.push('grandma');
  }

  const sec = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  UI validation passed (${suites.join(' + ')}) in ${sec}s`);
  console.log(`${'='.repeat(60)}\n`);
} catch (err) {
  const sec = ((Date.now() - started) / 1000).toFixed(0);
  console.error(`\n${'='.repeat(60)}`);
  console.error(`  UI validation FAILED after ${sec}s`);
  console.error(`  ${err.message}`);
  console.error(`${'='.repeat(60)}\n`);
  process.exitCode = 1;
}
