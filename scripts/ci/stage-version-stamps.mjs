#!/usr/bin/env node
/**
 * Stage post-merge version stamp files for commit (bump workflow).
 *
 *   node scripts/ci/stage-version-stamps.mjs
 */
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from '../lib/git-env.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVersionStampPaths } from '../lib/version-stamp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function stageVersionStamps({
  cwd = root,
  paths = loadVersionStampPaths(),
  git = (args) => execFileSync('git', args, { cwd, env: scrubGitEnv(), stdio: 'inherit' }),
} = {}) {
  git(['add', ...paths]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageVersionStamps();
}
