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
 *   --modules=a,b       run only these modules (functional ids + grandma)
 *   --all               force every module (default when neither --changed nor --modules)
 *   --jobs N            suites to run at once (default: CPUs-1, capped at 3).
 *                       --jobs 1 runs them one at a time with live output.
 */

import { spawn, execFileSync } from 'node:child_process';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModulesManifest,
  parseModulesArg,
  selectModulesFromFiles,
  partitionModules,
} from './lib/module-select.mjs';
import { buildQueue } from './lib/validate-ui-queue.mjs';

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

/**
 * Suites are independent processes against one already-running app — the same
 * split CI runs as separate jobs — so locally they can overlap instead of
 * queueing. Each one drives its own browser, so the cap is deliberately below
 * the core count: past that they fight for CPU and the slowest suite, not the
 * pool, sets the wall clock.
 */
const jobsIdx = args.indexOf('--jobs');
// os.cpus() reads the host, not the cgroup: a 4-vCPU container with a small
// CPU share still reports 4 and gets 3 parallel browsers, which starve each
// suite's phone-boot wait. VALIDATE_UI_JOBS caps the default from outside
// callers that cannot pass --jobs (pre-merge-vertical hardcodes its args).
const envJobs = Number(process.env.VALIDATE_UI_JOBS);
const DEFAULT_JOBS =
  Number.isFinite(envJobs) && envJobs >= 1
    ? Math.floor(envJobs)
    : Math.max(1, Math.min(3, (cpus().length || 2) - 1));
const jobs = jobsIdx >= 0 ? Math.max(1, Number(args[jobsIdx + 1]) || 1) : DEFAULT_JOBS;

const manifest = loadModulesManifest();

function gitChangedFiles(ref) {
  try {
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', ref], {
      cwd: ROOT,
      // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
      env: scrubGitEnv(),
      encoding: 'utf8',
    }).trim();
    return execFileSync('git', ['diff', '--name-only', `${mergeBase}...HEAD`], {
      cwd: ROOT,
      env: scrubGitEnv(),
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

function banner(name) {
  return `\n${'='.repeat(60)}\n  ${name}\n${'='.repeat(60)}\n`;
}

/**
 * One suite, one process. Serially it streams straight through so a watched run
 * reads as it always did; in parallel it buffers and prints as one block on
 * completion, because interleaving several browser suites live is unreadable.
 */
function runSuite(name, script, scriptArgs = [], { buffered = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!buffered) console.log(banner(name));
    const child = spawn(process.execPath, [path.join(HERE, script), ...scriptArgs], {
      stdio: buffered ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, BASE_URL: BASE },
    });
    let output = '';
    if (buffered) {
      child.stdout.on('data', (d) => {
        output += d;
      });
      child.stderr.on('data', (d) => {
        output += d;
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (buffered) {
        process.stdout.write(banner(`${name} — ${code ? 'FAILED' : 'ok'}`));
        process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
      }
      if (code) reject(new Error(`${script} exited with code ${code}`));
      else resolve();
    });
  });
}

/**
 * Run the queue `limit` at a time, and let every suite finish even after one
 * fails: a run that stops at the first red hides the other three reds behind it
 * and costs another full pass to find them.
 */
async function runPool(queue, limit) {
  const pending = [...queue];
  const failures = [];
  const passed = [];
  const worker = async () => {
    for (;;) {
      const suite = pending.shift();
      if (!suite) return;
      try {
        await runSuite(suite.name, suite.script, suite.args, { buffered: limit > 1 });
        passed.push(suite.id);
      } catch (err) {
        failures.push(`${suite.id}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, pending.length) }, worker));
  return { passed, failures };
}

const started = Date.now();

try {
  if (!skipHealth) {
    process.stdout.write(`Probing ${BASE}/api/health … `);
    await healthCheck();
    console.log('ok');
  }

  const functionalIds = runFunctional
    ? parts.functional.length
      ? parts.functional
      : partitionModules(manifest.modules.map((m) => m.id), manifest).functional
    : [];

  const queue = buildQueue({
    functional: functionalIds,
    grandma: runGrandma,
    parallel: jobs > 1,
  });

  if (!queue.length) {
    console.log('validate-ui: nothing to run for the selected modules');
  } else if (jobs > 1) {
    console.log(`validate-ui: ${queue.length} suites, ${jobs} at a time`);
  }

  const { passed, failures } = await runPool(queue, jobs);

  const sec = ((Date.now() - started) / 1000).toFixed(0);
  if (failures.length) {
    console.error(`\n${'='.repeat(60)}`);
    console.error(`  UI validation FAILED after ${sec}s`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(`${'='.repeat(60)}\n`);
    process.exitCode = 1;
  } else {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  UI validation passed (${passed.join(' + ') || 'empty'}) in ${sec}s`);
    console.log(`${'='.repeat(60)}\n`);
  }
} catch (err) {
  const sec = ((Date.now() - started) / 1000).toFixed(0);
  console.error(`\n${'='.repeat(60)}`);
  console.error(`  UI validation FAILED after ${sec}s`);
  console.error(`  ${err.message}`);
  console.error(`${'='.repeat(60)}\n`);
  process.exitCode = 1;
}
