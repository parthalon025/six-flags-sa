#!/usr/bin/env node
/**
 * Version matrix across repo, Vercel, and app stores.
 *
 *   npm run version:matrix
 *   npm run version:matrix -- --markdown   # GitHub step summary
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDeployVersionReport,
  formatDeployVersionBrief,
  readRepoVersion,
} from './lib/deploy-version-report.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    json: false,
    markdown: false,
    summary: false,
    bumpFrom: process.env.BUMP_FROM || null,
    bumpTo: process.env.BUMP_TO || null,
    bumpSkipped: process.env.BUMP_SKIPPED === 'true',
    mergeSha: process.env.GITHUB_SHA || null,
    mergeMessage: process.env.MERGE_MESSAGE || null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--markdown' || arg === '--summary') opts.markdown = true;
    else if (arg === '--bump-from') opts.bumpFrom = argv[++i];
    else if (arg === '--bump-to') opts.bumpTo = argv[++i];
    else if (arg === '--skipped') opts.bumpSkipped = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: deploy-version-report.mjs [--json] [--markdown] [--bump-from V] [--bump-to V] [--skipped]`);
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const repoVersion = readRepoVersion(repoRoot);
const bumpTo = opts.bumpTo || repoVersion;

const report = await buildDeployVersionReport({
  repoRoot,
  repoVersion: bumpTo,
  bumpFrom: opts.bumpFrom,
  bumpTo: opts.bumpTo || bumpTo,
  bumpSkipped: opts.bumpSkipped,
  mergeSha: opts.mergeSha,
  mergeMessage: opts.mergeMessage,
});

const brief = formatDeployVersionBrief(report);

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else if (opts.markdown) {
  console.log(brief);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${brief}\n`);
  }
} else {
  console.log(brief);
}
