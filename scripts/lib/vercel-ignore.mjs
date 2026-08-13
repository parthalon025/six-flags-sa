/**
 * Decide whether Vercel's ignored build step should build.
 *
 * Always diff THIS commit against its first parent (HEAD^1). The last
 * successful deploy SHA Vercel supplies is often a PR preview. A merge commit
 * then has the same tree as that preview, git diff is empty, and production
 * is skipped forever.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAppChange } from './app-paths.mjs';

export function decideVercelBuild({ files }) {
  if (files == null) {
    return { build: true, reason: 'unknown-changed-files — proceeding with build' };
  }
  if (isAppChange(files)) {
    return { build: true, reason: 'app-related change detected', files };
  }
  return { build: false, reason: 'no app-related changes — skipping build', files };
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function listFirstParentFiles(commitSha = 'HEAD') {
  const parent = git(['rev-parse', `${commitSha}^1`]);
  if (!parent) return null;
  const out = git(['diff', '--name-only', parent, commitSha]);
  if (out == null) return null;
  return out ? out.split('\n').filter(Boolean) : [];
}

export function runIgnoreCli({
  commitSha = process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD',
  log = console.log,
} = {}) {
  log(`Checking if Vercel build is needed...`);
  log(`Current commit: ${commitSha}`);
  const files = listFirstParentFiles(commitSha);
  const decision = decideVercelBuild({ files });
  if (files) {
    log('Changed files vs first parent:');
    for (const file of files.slice(0, 20)) log(file);
    if (files.length > 20) log(`... and ${files.length - 20} more`);
  }
  log(decision.reason);
  return decision.build ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(runIgnoreCli());
}
