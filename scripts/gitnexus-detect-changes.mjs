#!/usr/bin/env node
/**
 * CI wrapper around GitNexus's `detect-changes` CLI verb — reports the
 * blast radius of the current diff against a base ref. `.gitnexus/` is
 * session-local (gitignored); this expects `scripts/gitnexus-sync.mjs
 * startup` to have already built it in this run.
 *
 *   node scripts/gitnexus-detect-changes.mjs [--base-ref origin/main]
 *
 * Degrades gracefully exactly like `scripts/gitnexus-sync.mjs`: when the
 * index or GitNexus's native deps are unavailable, this warns and exits 0
 * rather than failing the calling job.
 *
 * When $GITHUB_STEP_SUMMARY is set, the report is appended there (visible
 * on the Actions run's Summary tab); otherwise it's printed to stdout.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { formatSummary, runDetectChanges } from './lib/gitnexus-detect-changes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runCjs = join(root, '.gitnexus', 'run.cjs');

function parseArgs(argv) {
  const idx = argv.indexOf('--base-ref');
  return { baseRef: idx >= 0 && argv[idx + 1] ? argv[idx + 1] : 'origin/main' };
}

function main() {
  const { baseRef } = parseArgs(process.argv.slice(2));
  console.log(`[gitnexus-detect-changes] comparing against ${baseRef}…`);

  if (!existsSync(runCjs)) {
    console.warn(
      '[gitnexus-detect-changes] no .gitnexus/run.cjs — index unavailable this run, skipping (best-effort)',
    );
    return;
  }

  const result = runDetectChanges({ baseRef, cwd: root, runCjs, exists: existsSync, exec: execFileSync });
  if (result.ok) {
    console.log(result.output || '(no changes detected)');
  } else {
    console.warn(`[gitnexus-detect-changes] detect-changes unavailable — continuing (${result.reason})`);
  }

  const summary = formatSummary({ ...result, baseRef });
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, summary);
    console.log('[gitnexus-detect-changes] wrote report to GITHUB_STEP_SUMMARY');
  }
}

main();
