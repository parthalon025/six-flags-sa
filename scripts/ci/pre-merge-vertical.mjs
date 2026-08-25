/**
 * Pre-merge vertical validation — static checks + browser vertical when the diff warrants it.
 *
 * Every code diff must clear the verticals its paths require (see
 * scripts/lib/vertical-e2e.mjs) — static steps are the floor, not the proof.
 *
 * Interface:
 *   gitChangedFiles(baseRef, cwd)
 *   needsBrowserVertical(files, manifest)
 *   runPreMergeVertical({ baseRef, skipBrowser, cwd })
 *
 * CLI:
 *   node scripts/ci/pre-merge-vertical.mjs [--base origin/main] [--skip-browser] [--no-stamp]
 *   npm run test:pre-merge-vertical
 */
import { spawn, spawnSync } from 'node:child_process';
import { scrubGitEnv } from '../lib/git-env.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModulesManifest,
  selectModulesFromFiles,
} from '../../test/app/lib/module-select.mjs';
import { appOrigin, healthUrl, reserveAppPort } from '../lib/app-test-origin.mjs';
import { startProductionServer, waitForHealth } from './party-tracker-ui.mjs';
import {
  STATIC_STEPS,
  buildLocalCiContext,
  readLocalCiPass,
  shouldSkipLocalPreMerge,
  writeLocalCiPass,
} from '../lib/local-ci-pass.mjs';
import { clerkE2eBlockReason } from '../lib/clerk-e2e.mjs';
import { ensureClerkEnvForCi } from '../lib/cloud-agent-clerk-env.mjs';
import {
  noCodeWorkRequired,
  requiredVerticals,
  verticalById,
  verticalE2eBlockReason,
} from '../lib/vertical-e2e.mjs';
import {
  buildMattReviewContext,
  mattReviewBlockReason,
  readMattReview,
} from '../lib/matt-review.mjs';
import { workflowBlockReason } from '../lib/matt-workflow.mjs';
import { runLiveZoomSweep } from '../lib/map-perf-gate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The static floor, in run order. Derived from `STATIC_STEPS` rather than
 * restated: the stamp records those ids, and GitHub skips the jobs they cover,
 * so a second copy here would let the two drift into a lie.
 */
export const STATIC_NPM_STEPS = STATIC_STEPS.map((step) => step.npm);

export function gitChangedFiles(baseRef = 'origin/main', cwd = root) {
  try {
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', baseRef], {
      cwd,
      // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
      env: scrubGitEnv(),
      encoding: 'utf8',
    }).trim();
    const out = execFileSync('git', ['diff', '--name-only', `${mergeBase}...HEAD`], {
      cwd,
      env: scrubGitEnv(),
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function needsBrowserVertical(files, manifest = loadModulesManifest()) {
  if (files == null) return true;
  if (!files.length) return false;
  const sel = selectModulesFromFiles(files, manifest);
  return sel.modules.length > 0;
}

export function runNpmStep(args, cwd = root) {
  const r = spawnSync('npm', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return r.status ?? 1;
}

function runValidateUiChanged(baseRef, cwd = root, { baseUrl } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npm',
      ['run', 'test:validate-ui:changed', '--', '--base', baseRef, '--no-health'],
      {
        cwd,
        stdio: 'inherit',
        env: baseUrl ? { ...process.env, BASE_URL: baseUrl } : process.env,
        shell: process.platform === 'win32',
      },
    );
    child.on('error', reject);
    child.on('close', (code) => {
      if (code) reject(new Error(`test:validate-ui:changed exited ${code}`));
      else resolve();
    });
  });
}

export async function runPreMergeVertical({
  baseRef = 'origin/main',
  skipBrowser = false,
  noStamp = false,
  cwd = root,
} = {}) {
  const context = buildLocalCiContext({ baseRef, cwd });
  const existing = readLocalCiPass(cwd);
  if (shouldSkipLocalPreMerge(existing, context, { skipBrowser })) {
    console.log('pre-merge-vertical: local CI pass stamp covers this tree — skipping');
    return 0;
  }

  const files = gitChangedFiles(baseRef, cwd);
  const required = requiredVerticals(files);
  console.log(
    `pre-merge-vertical: verticals required — ${required.join(', ') || 'none (no code work in this diff)'}`,
  );

  // Refusing a flag combination should not cost a full static run, so the
  // --skip-browser check happens before the slow steps: `ran = required`
  // leaves only that rule able to fire.
  const refusal = verticalE2eBlockReason({ files, ran: required, skipBrowser });
  if (refusal) {
    console.error(`pre-merge-vertical: ${refusal}`);
    return 1;
  }

  if (noCodeWorkRequired(files)) {
    console.log(
      'pre-merge-vertical: no code work in this diff — skipping static floor and verticals',
    );
    if (!noStamp) {
      writeLocalCiPass({ context, browserVertical: false, verticals: [] }, cwd);
    }
    return 0;
  }

  for (const args of STATIC_NPM_STEPS) {
    if (args[1] === 'build') {
      const clerkEnv = ensureClerkEnvForCi(cwd);
      if (!clerkEnv.wrote) {
        console.error(`pre-merge-vertical: ${clerkEnv.reason}`);
        return 1;
      }
      if (clerkEnv.source === 'keyless') {
        console.log(
          'pre-merge-vertical: Clerk keyless CI env materialized for app build — Clerk-on auth e2e still needs real keys in the runner env',
        );
      }
    }
    console.log(`\npre-merge-vertical: npm ${args.join(' ')}`);
    const code = runNpmStep(args, cwd);
    if (code !== 0) return code;
  }

  const ran = [];
  // test:ci-gate is a static step and is exactly the automation vertical.
  if (required.includes('automation')) ran.push('automation');

  const clerkBlock = clerkE2eBlockReason({ files: files || [], skipBrowser });
  if (clerkBlock) {
    console.error(`pre-merge-vertical: ${clerkBlock}`);
    return 1;
  }

  // clerk gate treats an unknown diff as empty; matt-review instead fails
  // closed on null (reviewRequiredForFiles) — both are deliberate.
  const reviewBlock = mattReviewBlockReason({
    files,
    context: buildMattReviewContext({ baseRef, cwd }),
    stamp: readMattReview(cwd),
  });
  if (reviewBlock) {
    console.error(`pre-merge-vertical: ${reviewBlock}`);
    return 1;
  }

  const workflowBlock = workflowBlockReason({ files, cwd });
  if (workflowBlock) {
    console.error(`pre-merge-vertical: ${workflowBlock}`);
    return 1;
  }

  if (required.includes('builder')) {
    const builder = verticalById('builder');
    console.log(`\npre-merge-vertical: ${builder.title} — ${builder.command}`);
    const code = runNpmStep(['run', 'test:builder'], cwd);
    if (code !== 0) return code;
    ran.push('builder');
  }

  const browserWanted = required.includes('app') || needsBrowserVertical(files);
  if (skipBrowser) {
    console.log('pre-merge-vertical: browser vertical skipped (--skip-browser)');
  } else if (!browserWanted) {
    console.log('pre-merge-vertical: no UI modules for diff — browser vertical skipped');
  } else {
    const held = await reserveAppPort();
    const baseUrl = appOrigin(held.port);
    console.log(`\npre-merge-vertical: starting app for browser vertical on ${baseUrl}`);
    startProductionServer({ root: cwd, port: held.port });
    await held.release();
    await waitForHealth({ url: healthUrl(baseUrl) });
    await runValidateUiChanged(baseRef, cwd, { baseUrl });
    const sweep = await runLiveZoomSweep({ minFps: 30, throttle: 4, baseUrl });
    if (!sweep.ok) {
      console.error(
        `pre-merge-vertical: zoom sweep failed (${sweep.reason || `${sweep.fps} fps < ${sweep.minFps}`})`,
      );
      return 1;
    }
    if (required.includes('app')) ran.push('app');
  }

  const block = verticalE2eBlockReason({ files, ran, skipBrowser });
  if (block) {
    console.error(`pre-merge-vertical: ${block}`);
    return 1;
  }

  if (!noStamp) {
    writeLocalCiPass(
      { context, browserVertical: ran.includes('app'), verticals: ran },
      cwd,
    );
  }
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  const baseIdx = argv.indexOf('--base');
  const baseRef = baseIdx >= 0 ? argv[baseIdx + 1] : 'origin/main';
  const skipBrowser = argv.includes('--skip-browser');
  const noStamp = argv.includes('--no-stamp');
  const code = await runPreMergeVertical({ baseRef, skipBrowser, noStamp });
  if (code !== 0) process.exit(code);
  console.log('\npre-merge-vertical: ok');
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
