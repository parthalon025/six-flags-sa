#!/usr/bin/env node
/**
 * Matt-review stamp CLI — thin over scripts/lib/matt-review.mjs.
 *
 *   node scripts/ci/matt-review.mjs prompt [--base origin/main]   # print the review subagent prompt
 *   node scripts/ci/matt-review.mjs write  [--base origin/main] [--model claude-sonnet-5] [--gitnexus ok|unavailable]
 *   node scripts/ci/matt-review.mjs check  [--base origin/main]   # exit 1 when a code diff lacks a fresh stamp
 *   node scripts/ci/matt-review.mjs two-axis [--base origin/main] [--spec path]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REVIEW_MODEL_DEFAULT,
  buildMattReviewContext,
  buildTwoAxisReview,
  mattReviewBlockReason,
  readMattReview,
  writeMattReview,
} from '../lib/matt-review.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

export function runCheck({ baseRef = 'origin/main', cwd = root } = {}) {
  const context = buildMattReviewContext({ baseRef, cwd });
  const reason = mattReviewBlockReason({
    files: context.files,
    context,
    stamp: readMattReview(cwd),
  });
  if (reason) {
    console.error(`matt-review: ${reason}`);
    return 1;
  }
  console.log('matt-review: ok (no code diff, or stamp covers it)');
  return 0;
}

export function runWrite({ baseRef = 'origin/main', model, gitnexus, cwd = root } = {}) {
  const context = buildMattReviewContext({ baseRef, cwd });
  const stamp = writeMattReview({ context, model, gitnexus }, cwd);
  console.log(`matt-review: stamped diff ${stamp.diffHash} (model ${stamp.model}, gitnexus ${stamp.gitnexus})`);
  return 0;
}

export function runTwoAxis({ baseRef = 'origin/main', specPath, cwd = root } = {}) {
  const review = buildTwoAxisReview({ baseRef, specPath, cwd });
  if (review.files.length === 0) {
    console.error('two-axis review: empty diff — pin a fixed point with commits ahead of it');
    return 1;
  }
  console.log(JSON.stringify(review, null, 2));
  return 0;
}

export function runPrompt({ baseRef = 'origin/main', cwd = root } = {}) {
  const review = buildTwoAxisReview({ baseRef, cwd });
  console.log(review.standardsPrompt);
  return 0;
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const baseRef = arg(argv, '--base', 'origin/main');
  const specPath = arg(argv, '--spec', undefined);
  let code = 1;
  if (cmd === 'check') code = runCheck({ baseRef });
  else if (cmd === 'write')
    code = runWrite({
      baseRef,
      model: arg(argv, '--model', REVIEW_MODEL_DEFAULT),
      gitnexus: arg(argv, '--gitnexus', 'unavailable'),
    });
  else if (cmd === 'prompt') code = runPrompt({ baseRef });
  else if (cmd === 'two-axis') code = runTwoAxis({ baseRef, specPath });
  else console.error('Usage: matt-review.mjs <check|write|prompt|two-axis> [--base ref] [--model m] [--gitnexus s] [--spec path]');
  process.exit(code);
}
