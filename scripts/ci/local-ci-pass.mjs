#!/usr/bin/env node
/**
 * Local CI pass stamp — write after pre-merge-vertical, check before GitHub jobs.
 *
 *   node scripts/ci/local-ci-pass.mjs write [--base origin/main] [--no-browser]
 *   node scripts/ci/local-ci-pass.mjs check [--base origin/main] [--any-ui true|false] [--force-full]
 *
 * On GitHub Actions, `check` writes `skip_ci`, `skip_ui` and `local_ci_tag` to
 * GITHUB_OUTPUT, and the reason for the decision to the job summary.
 */
import { appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_CI_TAG,
  TAG_SKIPPED_JOBS,
  buildLocalCiContext,
  localCiDecision,
  readLocalCiPass,
  writeLocalCiPass,
} from '../lib/local-ci-pass.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const opts = {
    baseRef: 'origin/main',
    headRef: 'HEAD',
    noBrowser: false,
    anyUi: false,
    forceFull: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') opts.baseRef = argv[++i];
    else if (arg === '--head') opts.headRef = argv[++i];
    else if (arg === '--no-browser') opts.noBrowser = true;
    else if (arg === '--any-ui') opts.anyUi = argv[++i] === 'true';
    else if (arg === '--force-full') opts.forceFull = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  local-ci-pass.mjs write [--base origin/main] [--head <sha>] [--no-browser]
  local-ci-pass.mjs check [--base origin/main] [--head <sha>] [--any-ui true|false] [--force-full]`);
      process.exit(0);
    }
  }
  return opts;
}

function emitGithubOutput(key, value) {
  const line = `${key}=${value}\n`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, line);
  }
}

function emitGithubSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

/**
 * Hand-written stamp. It records **no** verticals and **no** tag — only a real
 * `pre-merge-vertical` run may claim those — so a code diff still owes its
 * runs after this, and a hand stamp can never skip a GitHub job.
 */
export function runWrite({ baseRef, noBrowser, cwd = root, context } = {}) {
  const ctx = context ?? buildLocalCiContext({ baseRef, cwd });
  const stamp = writeLocalCiPass(
    { context: ctx, browserVertical: !noBrowser && ctx.needsBrowser, tag: null },
    cwd,
  );
  console.log(`Wrote ${stamp.diffHash} → scripts/ci/local-ci-pass.json`);
  console.log(`  modules: ${stamp.modules.join(', ') || '(none)'}`);
  console.log(`  browserVertical: ${stamp.browserVertical}`);
  console.log(
    `  tag: (none) — only npm run test:pre-merge-vertical may write ${LOCAL_CI_TAG}`,
  );
  if (ctx.verticals.length) {
    console.log(
      `  verticals: (none recorded) — this diff still owes ${ctx.verticals.join(', ')}; run npm run test:pre-merge-vertical`,
    );
  }
  return stamp;
}

export function runCheck({ baseRef, headRef = 'HEAD', anyUi, forceFull = false, cwd = root } = {}) {
  const context = buildLocalCiContext({ baseRef, headRef, cwd });
  const stamp = readLocalCiPass(cwd);
  const decision = localCiDecision(stamp, context, { anyUi, forceFull });

  console.log(decision.reason);
  emitGithubOutput('skip_ci', decision.skipCi ? 'true' : 'false');
  emitGithubOutput('skip_ui', decision.skipUi ? 'true' : 'false');
  emitGithubOutput('local_ci_tag', LOCAL_CI_TAG);
  emitGithubSummary(
    decision.skipCi
      ? `### \`${LOCAL_CI_TAG}\`\n\n${decision.reason}\n\nSkipped: ${TAG_SKIPPED_JOBS.join(', ')}.`
      : `### \`${LOCAL_CI_TAG}\` not honoured\n\n${decision.reason}`,
  );
  return { ...decision, context, stamp };
}

async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const opts = parseArgs(argv.slice(1));
  if (cmd === 'write') {
    runWrite({ baseRef: opts.baseRef, noBrowser: opts.noBrowser });
    return;
  }
  if (cmd === 'check') {
    runCheck({ baseRef: opts.baseRef, headRef: opts.headRef, anyUi: opts.anyUi, forceFull: opts.forceFull });
    return;
  }
  console.error('Usage: local-ci-pass.mjs <write|check> [options]');
  process.exit(1);
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
