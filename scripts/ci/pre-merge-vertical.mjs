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
} from '../../test/app/lib/module-select.mjs';
import { allocateAppPort, appOrigin, healthUrl } from '../lib/app-test-origin.mjs';
import { startProductionServer, waitForHealth } from './party-tracker-ui.mjs';
import {
  STATIC_STEPS,
  buildLocalCiContext,
  localCiStampRange,
  readLocalCiPass,
  shouldSkipLocalPreMerge,
  staticNpmStepsForFiles,
  writeLocalCiPass,
} from '../lib/local-ci-pass.mjs';
import { canonLanePlan } from '../lib/ci-lane-plan.mjs';
import { trackedTreeSnapshot, treeMutationReason } from '../lib/tree-mutation.mjs';
import { clerkE2eBlockReason } from '../lib/clerk-e2e.mjs';
import { ensureClerkEnvForCi } from '../lib/cloud-agent-clerk-env.mjs';
import {
  isAgentPolicyOnlyDiff,
  runPolicyTestsForFiles,
} from '../lib/agent-policy-diff.mjs';
import {
  guestBrowserRequired,
  noCodeWorkRequired,
  requiredVerticals,
  verticalById,
  verticalE2eBlockReason,
} from '../lib/vertical-e2e.mjs';
import {
  buildMattReviewContext,
  mattReviewBlockReason,
  mattReviewStampRange,
  readMattReview,
} from '../lib/matt-review.mjs';
import { workflowBlockReason } from '../lib/matt-workflow.mjs';
import { runLiveZoomSweep } from '../lib/map-perf-gate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Full static floor npm argv rows — used when the diff is unreadable (fail closed).
 */
export const STATIC_NPM_STEPS = STATIC_STEPS.map((step) => step.npm);

function runNodeScript(rel, args, cwd = root) {
  const r = spawnSync(process.execPath, [join(cwd, rel), ...args], {
    cwd,
    stdio: 'inherit',
  });
  return r.status ?? 1;
}

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

/** @deprecated use guestBrowserRequired from vertical-e2e.mjs */
export function needsBrowserVertical(files, manifest = loadModulesManifest()) {
  return guestBrowserRequired(files, manifest);
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
  const existing = readLocalCiPass(cwd, {
    range: localCiStampRange(context),
    diffHash: context.diffHash,
  });
  if (shouldSkipLocalPreMerge(existing, context, { skipBrowser })) {
    console.log('pre-merge-vertical: local CI pass stamp covers this tree — skipping');
    return 0;
  }

  const files = gitChangedFiles(baseRef, cwd);
  const manifest = loadModulesManifest();
  const plan = canonLanePlan(files, manifest);
  const required = requiredVerticals(files);
  console.log(
    `pre-merge-vertical: verticals required — ${required.join(', ') || 'none (no code work in this diff)'}`,
  );
  console.log(
    `pre-merge-vertical: static steps — ${plan.staticSteps.join(', ') || 'none'}`,
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
    if (isAgentPolicyOnlyDiff(files)) {
      console.log('pre-merge-vertical: agent-policy diff — thin policy tests only');
      const policyCode = runPolicyTestsForFiles(files, cwd);
      if (policyCode !== 0) return policyCode;
    } else {
      console.log(
        'pre-merge-vertical: no code work in this diff — skipping static floor and verticals',
      );
    }
    if (!noStamp) {
      writeLocalCiPass({ context, browserVertical: false, verticals: [] }, cwd);
    }
    return 0;
  }

  const staticNpm =
    files == null ? STATIC_NPM_STEPS : staticNpmStepsForFiles(files, manifest);
  const ran = [];
  const factoryLegsRan = [];

  // Anything the legs below rewrite in tracked files is compared against this.
  // Taken here, after the cheap refusals, so the snapshot spans exactly the
  // steps that run tests.
  const treeBefore = trackedTreeSnapshot(cwd);

  for (const args of staticNpm) {
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
    if (args[1] === 'test:ci-gate' && required.includes('backside')) ran.push('backside');
  }

  const clerkBlock = clerkE2eBlockReason({ files: files || [], skipBrowser });
  if (clerkBlock) {
    console.error(`pre-merge-vertical: ${clerkBlock}`);
    return 1;
  }

  // clerk gate treats an unknown diff as empty; matt-review instead fails
  // closed on null (reviewRequiredForFiles) — both are deliberate.
  const reviewContext = buildMattReviewContext({ baseRef, cwd });
  const reviewBlock = mattReviewBlockReason({
    files,
    context: reviewContext,
    stamp: readMattReview(cwd, {
      range: mattReviewStampRange(reviewContext),
      diffHash: reviewContext.diffHash,
    }),
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
    for (const [leg, flag] of [
      ['map', plan.runMapFactory],
      ['visual', plan.runVisualFactory],
      ['delivery', plan.runDeliveryFactory],
    ]) {
      if (!flag) continue;
      console.log(`\npre-merge-vertical: factory leg — ${leg}`);
      const legCode = runNodeScript('test/builder/factory-modules.mjs', ['--leg', leg], cwd);
      if (legCode !== 0) return legCode;
      factoryLegsRan.push(leg);
    }
  }

  const browserWanted = guestBrowserRequired(files);
  if (skipBrowser) {
    console.log('pre-merge-vertical: browser vertical skipped (--skip-browser)');
  } else if (!browserWanted) {
    console.log('pre-merge-vertical: no UI modules for diff — browser vertical skipped');
  } else {
    const port = await allocateAppPort();
    const baseUrl = appOrigin(port);
    console.log(`\npre-merge-vertical: starting app for browser vertical on ${baseUrl}`);
    startProductionServer({ root: cwd, port });
    await waitForHealth({ url: healthUrl(baseUrl) });
    await runValidateUiChanged(baseRef, cwd, { baseUrl });
    const sweep = await runLiveZoomSweep({ minFps: 30, throttle: 4, baseUrl });
    if (!sweep.ok) {
      console.error(
        `pre-merge-vertical: zoom sweep failed (${sweep.reason || `${sweep.fps} fps < ${sweep.minFps}`})`,
      );
      return 1;
    }
    ran.push('app');
  }

  const block = verticalE2eBlockReason({ files, ran, skipBrowser });
  if (block) {
    console.error(`pre-merge-vertical: ${block}`);
    return 1;
  }

  // Checked before the pass is stamped: a stamp over a run that rewrote its own
  // inputs certifies a tree nobody has actually tested.
  const mutation = treeMutationReason(treeBefore, trackedTreeSnapshot(cwd));
  if (mutation) {
    console.error(`pre-merge-vertical: ${mutation}`);
    return 1;
  }

  if (!noStamp) {
    writeLocalCiPass(
      {
        context,
        browserVertical: ran.includes('app'),
        verticals: ran,
        factoryLegsRan,
      },
      cwd,
    );
    // The cache is gitignored — GitHub only ever sees a published trailer.
    console.log('\npre-merge-vertical: stamped. Publish it: node scripts/ci/stamp-commit.mjs');
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
