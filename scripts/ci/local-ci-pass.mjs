#!/usr/bin/env node
/**
 * Local CI pass stamp — write after pre-merge-vertical, check before GitHub UI jobs.
 *
 *   node scripts/ci/local-ci-pass.mjs write [--base origin/main] [--no-browser]
 *   node scripts/ci/local-ci-pass.mjs check [--base origin/main] [--any-ui true|false]
 *
 * On GitHub Actions, `check` writes `skip_ui=true|false` to GITHUB_OUTPUT.
 */
import { appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLocalCiContext,
  readLocalCiPass,
  shouldSkipGithubUi,
  writeLocalCiPass,
} from '../lib/local-ci-pass.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const opts = {
    baseRef: 'origin/main',
    noBrowser: false,
    anyUi: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') opts.baseRef = argv[++i];
    else if (arg === '--no-browser') opts.noBrowser = true;
    else if (arg === '--any-ui') opts.anyUi = argv[++i] === 'true';
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  local-ci-pass.mjs write [--base origin/main] [--no-browser]
  local-ci-pass.mjs check [--base origin/main] [--any-ui true|false]`);
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

/**
 * Hand-written stamp. It deliberately records **no** verticals — only a real
 * `pre-merge-vertical` run may claim those — so a code diff still owes its
 * runs after this, and a hand stamp can never wave one through.
 */
export function runWrite({ baseRef, noBrowser, cwd = root } = {}) {
  const context = buildLocalCiContext({ baseRef, cwd });
  const stamp = writeLocalCiPass(
    { context, browserVertical: !noBrowser && context.needsBrowser },
    cwd,
  );
  console.log(`Wrote ${stamp.head.slice(0, 7)} → scripts/ci/local-ci-pass.json`);
  console.log(`  modules: ${stamp.modules.join(', ') || '(none)'}`);
  console.log(`  browserVertical: ${stamp.browserVertical}`);
  if (context.verticals.length) {
    console.log(
      `  verticals: (none recorded) — this diff still owes ${context.verticals.join(', ')}; run npm run test:pre-merge-vertical`,
    );
  }
  return stamp;
}

export function runCheck({ baseRef, anyUi, cwd = root } = {}) {
  const context = buildLocalCiContext({ baseRef, cwd });
  const stamp = readLocalCiPass(cwd);
  const skipUi = shouldSkipGithubUi(stamp, context, { anyUi });
  if (skipUi) {
    console.log('Local CI pass covers this tree — GitHub UI jobs may be skipped.');
  } else if (stamp) {
    console.log('Local CI pass stamp is stale or incomplete — GitHub UI jobs will run.');
  } else {
    console.log('No local CI pass stamp — GitHub UI jobs will run.');
  }
  emitGithubOutput('skip_ui', skipUi ? 'true' : 'false');
  return { skipUi, context, stamp };
}

async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const opts = parseArgs(argv.slice(1));
  if (cmd === 'write') {
    runWrite({ baseRef: opts.baseRef, noBrowser: opts.noBrowser });
    return;
  }
  if (cmd === 'check') {
    runCheck({ baseRef: opts.baseRef, anyUi: opts.anyUi });
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
