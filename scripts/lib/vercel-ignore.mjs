/**
 * Decide whether Vercel's ignored build step should build.
 *
 * Always diff THIS commit against its first parent (HEAD^1). The last
 * successful deploy SHA Vercel supplies is often a PR preview. A merge commit
 * then has the same tree as that preview, git diff is empty, and production
 * is skipped forever.
 *
 * Budget (see scripts/lib/vercel-budget.mjs): ~100 deploys/day. Twenty-five are
 * reserved for user directive only ([vercel build] or VERCEL_USER_BUILD=1).
 * Production merges with app-path changes use the automation pool (~75).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGitnexusOnlyChange } from '../gitnexus-ci.mjs';
import { isAppChange } from './app-paths.mjs';
import {
  AUTOMATION_DEPLOY_BUDGET,
  USER_DEPLOY_RESERVE,
  commitSubjectWantsBuild,
  commitSubjectWantsSkip,
  isPreviewEnv,
  isUserDirectedBuild,
} from './vercel-budget.mjs';

/** Post-merge bump workflow — stamp only; merge commit already deployed the app. */
const VERSION_STAMP_PATHS = new Set([
  'package.json',
  'package-lock.json',
  'apps/party-tracker/package.json',
  'packages/shared/package.json',
  'packages/venue-builder/package.json',
  'apps/party-tracker/public/app-version.json',
  'apps/party-tracker/public/sw.js',
  'apps/party-tracker/data/release-notes.json',
]);

/** Agent / worktree branches — never preview unless the user directed it. */
const AGENT_PREVIEW_BRANCH = /^(worktree-|cursor\/)/;

export function normalizeChangedPath(file) {
  return String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

export function isVersionStampOnlyChange(files) {
  if (!files?.length) return false;
  return files.every((f) => VERSION_STAMP_PATHS.has(normalizeChangedPath(f)));
}

export function isAgentPreviewBranch(gitRef, env) {
  if (!isPreviewEnv(env)) return false;
  return AGENT_PREVIEW_BRANCH.test(String(gitRef || ''));
}

export { commitSubjectWantsBuild, commitSubjectWantsSkip };

export function decideVercelBuild({
  files,
  env,
  gitRef,
  subject = '',
  userBuild,
} = {}) {
  const userDirected = isUserDirectedBuild({ subject, userBuild });

  if (commitSubjectWantsSkip(subject)) {
    return { build: false, reason: 'commit subject [skip vercel] — skipping build', files };
  }
  if (userDirected) {
    return {
      build: true,
      reason: `user-directed build (reserve ${USER_DEPLOY_RESERVE}/day) — proceeding`,
      files,
    };
  }
  if (files == null) {
    return { build: true, reason: 'unknown-changed-files — proceeding with build' };
  }
  if (!files.length) {
    return { build: false, reason: 'empty diff vs first parent — skipping build', files };
  }
  if (isGitnexusOnlyChange(files)) {
    return { build: false, reason: 'gitnexus-index-only — skipping build', files };
  }
  if (isVersionStampOnlyChange(files)) {
    return {
      build: false,
      reason: 'version-stamp-only bump — skipping build (merge already deployed the app)',
      files,
    };
  }
  if (isAgentPreviewBranch(gitRef, env)) {
    return {
      build: false,
      reason: `agent preview branch ${gitRef} — skipping (user reserve: add [vercel build] or VERCEL_USER_BUILD=1)`,
      files,
    };
  }
  if (isAppChange(files)) {
    if (isPreviewEnv(env)) {
      return {
        build: false,
        reason: `preview reserved for user directive (${USER_DEPLOY_RESERVE}/day) — add [vercel build] or VERCEL_USER_BUILD=1`,
        files,
      };
    }
    return {
      build: true,
      reason: `app-related production change (automation budget ~${AUTOMATION_DEPLOY_BUDGET}/day)`,
      files,
    };
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

export function commitSubject(commitSha = 'HEAD') {
  return git(['log', '-1', '--format=%s', commitSha]) || '';
}

export function runIgnoreCli({
  commitSha = process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD',
  env = process.env.VERCEL_ENV,
  gitRef = process.env.VERCEL_GIT_COMMIT_REF,
  log = console.log,
} = {}) {
  log(`Checking if Vercel build is needed...`);
  log(`Current commit: ${commitSha}`);
  log(`Vercel env: ${env || '(unset)'}`);
  log(`Git ref: ${gitRef || '(unset)'}`);
  log(`Budget: ${USER_DEPLOY_RESERVE} user-reserved, ~${AUTOMATION_DEPLOY_BUDGET} automation`);
  const files = listFirstParentFiles(commitSha);
  const subject = commitSubject(commitSha);
  const decision = decideVercelBuild({ files, env, gitRef, subject });
  if (files) {
    log('Changed files vs first parent:');
    for (const file of files.slice(0, 20)) log(file);
    if (files.length > 20) log(`... and ${files.length - 20} more`);
  }
  if (subject) log(`Commit subject: ${subject}`);
  log(decision.reason);
  return decision.build ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(runIgnoreCli());
}
