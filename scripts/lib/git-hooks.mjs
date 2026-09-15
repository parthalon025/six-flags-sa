/**
 * Git hook install + readiness for the primary checkout and agent worktrees.
 *
 * Husky generates `.husky/_`, which is gitignored and absent in fresh worktrees
 * when `core.hooksPath` points at it — git then runs no hook at all. This module
 * pins hooks to the tracked `.husky/` scripts and makes a missing runtime loud.
 *
 * Interface:
 *   TRACKED_HOOKS_DIR
 *   hooksPathForRepo()
 *   prePushHookFile(root)
 *   prePushRunnable(root)
 *   configureTrackedHooksPath(root)
 *   linkNodeModulesFrom({ worktreeRoot, sourceRoot })
 *   ensureWorktreeHooks({ worktreeRoot, sourceRoot })
 */
import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { scrubGitEnv } from './git-env.mjs';

export const TRACKED_HOOKS_DIR = '.husky';

export function hooksPathForRepo() {
  return TRACKED_HOOKS_DIR;
}

export function prePushHookFile(root) {
  return join(root, TRACKED_HOOKS_DIR, 'pre-push');
}

export function prePushRunnable(root) {
  const hook = prePushHookFile(root);
  if (!existsSync(hook)) {
    return { runnable: false, reason: `missing tracked hook: ${TRACKED_HOOKS_DIR}/pre-push` };
  }
  if (!existsSync(join(root, 'node_modules'))) {
    return {
      runnable: false,
      reason:
        'node_modules missing — run npm ci in this worktree, or use HUSKY=0 git push to bypass deliberately',
    };
  }
  return { runnable: true };
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: scrubGitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function configureTrackedHooksPath(root) {
  git(root, ['config', 'core.hooksPath', hooksPathForRepo()]);
  return hooksPathForRepo();
}

export function linkNodeModulesFrom({ worktreeRoot, sourceRoot }) {
  const target = join(worktreeRoot, 'node_modules');
  if (existsSync(target)) return { linked: false, reason: 'node_modules already present' };
  const source = join(sourceRoot, 'node_modules');
  if (!existsSync(source)) {
    return { linked: false, reason: 'source node_modules missing — run npm ci in the primary checkout' };
  }
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(source, target, linkType);
  return { linked: true, source };
}

export function ensureWorktreeHooks({ worktreeRoot, sourceRoot }) {
  const hooksPath = configureTrackedHooksPath(worktreeRoot);
  const nodeModules = linkNodeModulesFrom({ worktreeRoot, sourceRoot });
  const readiness = prePushRunnable(worktreeRoot);
  return { hooksPath, nodeModules, readiness };
}
