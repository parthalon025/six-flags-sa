#!/usr/bin/env node
/**
 * Version matrix across repo, Vercel, and app stores.
 *
 *   npm run version:matrix
 *   npm run version:matrix -- --wait          # poll production until repo semver
 *   npm run version:matrix -- --markdown      # GitHub step summary
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDeployVersionReport,
  formatDeployVersionBrief,
  formatDeployVersionOneline,
  readRepoVersion,
  waitForProductionVersion,
} from './lib/deploy-version-report.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    json: false,
    markdown: false,
    wait: false,
    comment: false,
    timeoutMs: process.env.VERSION_MATRIX_TIMEOUT_MS
      ? Number(process.env.VERSION_MATRIX_TIMEOUT_MS)
      : null,
    bumpFrom: process.env.BUMP_FROM || null,
    bumpTo: process.env.BUMP_TO || null,
    bumpSkipped: process.env.BUMP_SKIPPED === 'true',
    mergeSha: process.env.GITHUB_SHA || null,
    mergeMessage: process.env.MERGE_MESSAGE || null,
    mergePr: process.env.MERGE_PR || null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--markdown' || arg === '--summary') opts.markdown = true;
    else if (arg === '--wait') opts.wait = true;
    else if (arg === '--comment') opts.comment = true;
    else if (arg === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
    else if (arg === '--bump-from') opts.bumpFrom = argv[++i];
    else if (arg === '--bump-to') opts.bumpTo = argv[++i];
    else if (arg === '--skipped') opts.bumpSkipped = true;
    else if (arg === '--pr') opts.mergePr = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: deploy-version-report.mjs [--json] [--markdown] [--wait] [--comment] [--timeout-ms N]`);
      process.exit(0);
    }
  }
  return opts;
}

function setupAscKeySync() {
  const keyB64 = process.env.APP_STORE_CONNECT_API_KEY;
  if (!keyB64) return;
  const keyPath = join(repoRoot, 'secrets/AuthKey.p8');
  mkdirSync(join(repoRoot, 'secrets'), { recursive: true });
  writeFileSync(keyPath, Buffer.from(keyB64, 'base64'));
  process.env.APP_STORE_CONNECT_API_KEY_PATH = keyPath;
}

const opts = parseArgs(process.argv.slice(2));
setupAscKeySync();

const repoVersion = readRepoVersion(repoRoot);
const targetVersion = opts.bumpTo || repoVersion;

let deployWait = null;
let productionOverride = null;

if (opts.wait && !opts.bumpSkipped) {
  deployWait = await waitForProductionVersion(targetVersion, {
    timeoutMs: opts.timeoutMs ?? undefined,
  });
  productionOverride = deployWait.production;
}

const report = await buildDeployVersionReport({
  repoRoot,
  repoVersion: targetVersion,
  bumpFrom: opts.bumpFrom,
  bumpTo: opts.bumpTo || targetVersion,
  bumpSkipped: opts.bumpSkipped,
  mergeSha: opts.mergeSha,
  mergeMessage: opts.mergeMessage,
  productionOverride,
  deployWait,
});

const brief = formatDeployVersionBrief(report);
const oneline = formatDeployVersionOneline(report);

if (opts.json) {
  console.log(JSON.stringify({ oneline, ...report }, null, 2));
} else if (opts.markdown) {
  console.log(brief);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${brief}\n`);
  }
} else {
  console.log(oneline);
  console.log('');
  console.log(brief);
}

if (opts.comment && opts.mergePr) {
  execFileSync(
    'gh',
    ['pr', 'comment', opts.mergePr, '--body', brief],
    { cwd: repoRoot, stdio: 'inherit' },
  );
}
