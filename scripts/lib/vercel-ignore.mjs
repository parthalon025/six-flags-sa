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
import { scrubGitEnv } from './git-env.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGitnexusOnlyChange } from './gitnexus-only.mjs';
import { isAppChange } from './app-paths.mjs';
import {
  AUTOMATION_DEPLOY_BUDGET,
  USER_DEPLOY_RESERVE,
  commitSubjectWantsBuild,
  commitSubjectWantsSkip,
  isPreviewEnv,
  isUserDirectedBuild,
} from './vercel-budget.mjs';
import { isVersionStampOnlyChange } from './version-stamp.mjs';
import { checkLiveAutomationGate } from './vercel-deploy-gate.mjs';
import { checkProductionPostgresGuard } from '../../apps/party-tracker/lib/productionPostgresGuard.js';

/** Agent / worktree branches — never preview unless the user directed it. */
const AGENT_PREVIEW_BRANCH = /^(worktree-|cursor\/)/;

export { isVersionStampOnlyChange };

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
    return { build: false, category: 'skip-explicit', reason: 'commit subject [skip vercel] — skipping build', files };
  }
  if (userDirected) {
    return {
      build: true,
      category: 'user-directed',
      reason: `user-directed build (reserve ${USER_DEPLOY_RESERVE}/day) — proceeding`,
      files,
    };
  }
  if (files == null) {
    return { build: true, category: 'unknown-diff', reason: 'unknown-changed-files — proceeding with build' };
  }
  if (!files.length) {
    return { build: false, category: 'skip-empty-diff', reason: 'empty diff vs first parent — skipping build', files };
  }
  if (isGitnexusOnlyChange(files)) {
    return { build: false, category: 'skip-gitnexus', reason: 'gitnexus-index-only — skipping build', files };
  }
  if (isVersionStampOnlyChange(files)) {
    if (isPreviewEnv(env)) {
      return {
        build: false,
        category: 'skip-version-stamp-preview',
        reason: 'version-stamp-only bump — skipping preview build',
        files,
      };
    }
    return {
      build: true,
      category: 'version-stamp-production',
      reason:
        'version-stamp production bump — proceeding (bump push cancels the merge deploy)',
      files,
    };
  }
  if (isAgentPreviewBranch(gitRef, env)) {
    return {
      build: false,
      category: 'skip-agent-preview',
      reason: `agent preview branch ${gitRef} — skipping (user reserve: add [vercel build] or VERCEL_USER_BUILD=1)`,
      files,
    };
  }
  if (isAppChange(files)) {
    if (isPreviewEnv(env)) {
      return {
        build: false,
        category: 'skip-preview-reserved',
        reason: `preview reserved for user directive (${USER_DEPLOY_RESERVE}/day) — add [vercel build] or VERCEL_USER_BUILD=1`,
        files,
      };
    }
    return {
      build: true,
      category: 'automation-production',
      reason: `app-related production change (automation budget ~${AUTOMATION_DEPLOY_BUDGET}/day)`,
      files,
    };
  }
  return { build: false, category: 'skip-no-app-changes', reason: 'no app-related changes — skipping build', files };
}

/**
 * Second, live pass on top of decideVercelBuild: only the automation-production
 * category is subject to the stepped budget gate (previews and user-directed
 * builds never touch the automation pool, so they're never throttled here).
 * Falls open to the categorical decision when the live check is unavailable.
 */
export async function applyLiveAutomationGate(decision, liveGateOptions = {}) {
  if (!decision.build || decision.category !== 'automation-production') {
    return decision;
  }
  const live = await checkLiveAutomationGate(liveGateOptions);
  if (live.allow) {
    if (live.tier === 'warn') {
      return { ...decision, reason: live.reason, liveGate: live };
    }
    return { ...decision, liveGate: live };
  }
  return {
    ...decision,
    build: false,
    category: `automation-production-${live.tier}`,
    reason: live.reason,
    liveGate: live,
  };
}

export function applyProductionPostgresGuard(
  decision,
  { vercelEnv = process.env.VERCEL_ENV, runtimeEnv = process.env } = {},
) {
  if (!decision.build || vercelEnv !== 'production') return decision;
  const guard = checkProductionPostgresGuard(runtimeEnv);
  if (guard.ok) return decision;
  return {
    ...decision,
    build: false,
    category: 'production-postgres-missing',
    reason: guard.reason,
  };
}

function git(args) {
  try {
    return execFileSync('git', args, { env: scrubGitEnv(), encoding: 'utf8' }).trim();
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

export async function runIgnoreCli({
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
  let decision = decideVercelBuild({ files, env, gitRef, subject });
  if (files) {
    log('Changed files vs first parent:');
    for (const file of files.slice(0, 20)) log(file);
    if (files.length > 20) log(`... and ${files.length - 20} more`);
  }
  if (subject) log(`Commit subject: ${subject}`);
  if (decision.category === 'automation-production') {
    decision = await applyLiveAutomationGate(decision);
    if (decision.liveGate?.counts) {
      log(
        `Live deploy count today: ${decision.liveGate.counts.total} total (${decision.liveGate.counts.automation} automation, ${decision.liveGate.counts.user} user-directed)`,
      );
    }
  }
  decision = applyProductionPostgresGuard(decision, { vercelEnv: env, runtimeEnv: process.env });
  log(decision.reason);
  return decision.build ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(await runIgnoreCli());
}
