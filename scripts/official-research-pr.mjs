#!/usr/bin/env node
/**
 * Open a draft PR when scheduled official-site research changes caches.
 *
 *   node scripts/official-research-pr.mjs
 *
 * Env: GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_REF_NAME
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { OVERRIDE_DIR } from '@party-tracker/venue-builder/paths.js';
import { scrubGitEnv } from './lib/git-env.mjs';
import {
  composeOfficialResearchPrBody,
  officialCacheAddPattern,
  officialResearchBranchName,
  officialResearchCommitMessage,
} from './lib/official-research-pr.mjs';

const runId = process.env.GITHUB_RUN_ID;
const serverUrl = process.env.GITHUB_SERVER_URL;
const repository = process.env.GITHUB_REPOSITORY;
const refName = process.env.GITHUB_REF_NAME;

if (!runId || !serverUrl || !repository || !refName) {
  console.error('official-research-pr: missing GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_REPOSITORY, or GITHUB_REF_NAME');
  process.exit(2);
}

const gitEnv = scrubGitEnv();

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: gitEnv, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const branch = officialResearchBranchName(runId);
run('git', ['config', 'user.name', 'github-actions[bot]']);
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
run('git', ['checkout', '-b', branch]);

const addPattern = officialCacheAddPattern(OVERRIDE_DIR);
spawnSync('git', ['add', addPattern], { stdio: 'inherit', env: gitEnv });

const diff = spawnSync('git', ['diff', '--cached', '--quiet'], { stdio: 'pipe', env: gitEnv });
if (diff.status === 0) {
  console.log('::notice::No official-cache changes — fleet caches are current.');
  process.exit(0);
}

const { title, body } = officialResearchCommitMessage(runId);
run('git', ['commit', '-m', title, '-m', body]);

run('git', ['push', '-u', 'origin', branch]);

const summaryMarkdown = readFileSync('research-summary.md', 'utf8');
const prBody = composeOfficialResearchPrBody({
  serverUrl,
  repository,
  runId,
  summaryMarkdown,
});
writeFileSync('pr-body.md', prBody);

run('gh', [
  'pr', 'create', '--draft',
  '--base', refName,
  '--head', branch,
  '--title', title,
  '--body-file', 'pr-body.md',
]);
