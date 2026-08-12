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
 *   TEST_MODULES   comma-separated module ids (see test/app/modules.json)
 *
 * Flags:
 *   --functional-only   skip grandma
 *   --grandma-only      skip functional (e2e)
 *   --no-health         do not probe /api/health first
 *   --changed           select modules from git diff vs --base / origin/main
 *   --base <ref>        git base for --changed (default origin/main)
 *   --modules=a,b       run only these modules (functional ids + grandma + contract)
 *   --all               force every module (default when neither --changed nor --modules)
 */

import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModulesManifest,
  parseModulesArg,
  selectModulesFromFiles,
  partitionModules,
} from './lib/module-select.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const args = process.argv.slice(2);
const functionalOnly = args.includes('--functional-only');
const grandmaOnly = args.includes('--grandma-only');
const skipHealth = args.includes('--no-health');
const changed = args.includes('--changed');
const wantAll = args.includes('--all');
const baseIdx = args.indexOf('--base');
const baseRef = baseIdx >= 0 ? args[baseIdx + 1] : process.env.TEST_BASE_REF || 'origin/main';

const manifest = loadModulesManifest();

function gitChangedFiles(ref) {
  try {
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', ref], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return execFileSync('git', ['diff', '--name-only', `${mergeBase}...HEAD`], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    console.warn(`validate-ui: git diff failed (${err.message}); running all modules`);
    return null;
  }
}

let selected = parseModulesArg(args, process.env);
if (wantAll) selected = null;
else if (changed && !process.env.TEST_MODULES) {
  const files = gitChangedFiles(baseRef);
  if (!files) selected = null;
  else {
    const sel = selectModulesFromFiles(files, manifest);
    selected = new Set(sel.modules);
    console.log(`validate-ui: --changed selected ${sel.modules.join(', ')}`);
    for (const id of sel.modules) {
      console.log(`  - ${id}: ${sel.reasons[id]}`);
    }
  }
}

const parts = partitionModules(
  selected ? [...selected] : manifest.modules.map((m) => m.id),
  manifest,
);

let runFunctional = !grandmaOnly && (parts.functional.length > 0 || !selected);
let runGrandma = !functionalOnly && (parts.grandma || !selected);
let runContract = parts.contract || !selected;

// Legacy flags override module selection for grandma/functional.
if (functionalOnly) runGrandma = false;
if (grandmaOnly) {
  runFunctional = false;
  runGrandma = true;
}

async function healthCheck() {
  const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`/api/health returned ${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (body.ok === false) throw new Error('health body not ok');
}

function runSuite(name, script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}\n  ${name}\n${'='.repeat(60)}\n`);
    const child = spawn(process.execPath, [path.join(HERE, script), ...scriptArgs], {
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

  if (runContract) {
    await runSuite('Critical-path coverage contract', 'coverage-contract.mjs');
    suites.push('coverage-contract');
  }

  if (runFunctional) {
    const functionalModules = selected
      ? parts.functional.join(',')
      : 'all';
    const scriptArgs =
      functionalModules && functionalModules !== 'all'
        ? [`--modules=${functionalModules}`]
        : [];
    await runSuite(
      `E2E functional suite (${functionalModules})`,
      'functional.mjs',
      scriptArgs,
    );
    suites.push(`functional:${functionalModules}`);
  }

  if (runGrandma) {
    await runSuite('Grandma test (first-time visitor personas)', 'grandma.mjs');
    suites.push('grandma');
  }

  if (!suites.length) {
    console.log('validate-ui: nothing to run for the selected modules');
  }

  const sec = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  UI validation passed (${suites.join(' + ') || 'empty'}) in ${sec}s`);
  console.log(`${'='.repeat(60)}\n`);
} catch (err) {
  const sec = ((Date.now() - started) / 1000).toFixed(0);
  console.error(`\n${'='.repeat(60)}`);
  console.error(`  UI validation FAILED after ${sec}s`);
  console.error(`  ${err.message}`);
  console.error(`${'='.repeat(60)}\n`);
  process.exitCode = 1;
}
