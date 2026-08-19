/**
 * Hermetic git environment — keep a hook's repository out of everything it spawns.
 *
 * Git hands its hooks a *pre-resolved* repository in the environment: `GIT_DIR`,
 * `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY` and friends. Those variables win over
 * directory discovery, and `cwd` does not override them — with `GIT_DIR` set and
 * no `GIT_WORK_TREE`, git treats the *current directory* as the work tree and the
 * inherited `GIT_DIR` as the repository. A script that builds a scratch repo in a
 * tmpdir and runs `git add` / `git commit` there therefore stages the tmpdir's
 * files and commits them onto the real branch.
 *
 * That is not hypothetical. The pre-push hook runs the unit suite, and
 * test/scripts/release-cycle.test.mjs builds a two-commit fixture repo; on the
 * first push after the hook landed it committed its fixtures onto the branch
 * being pushed, truncating README.md to one line and apps/party-tracker/app/page.js
 * to one line, and wrote `user.name = Test` into the real .git/config.
 *
 * The variables are also why `cwd` alone is not isolation: anything that shells
 * out to git — or shells out to something that might — scrubs them first.
 */

/**
 * The repository-locating and identity variables git exports to hooks. Removing
 * all of them returns git to plain directory discovery and to the config files.
 *
 * Deliberately *not* included: GIT_EXEC_PATH, GIT_SSH_COMMAND, GIT_CONFIG_* and
 * the proxy/terminal variables — those configure how git runs, not which
 * repository it runs against, and dropping them would break the caller's setup.
 */
export const GIT_ENV_VARS = Object.freeze([
  // Which repository.
  'GIT_DIR',
  'GIT_COMMON_DIR',
  'GIT_WORK_TREE',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
  // Which index and objects.
  'GIT_INDEX_FILE',
  'GIT_INDEX_VERSION',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  // Who is committing — these outrank the scratch repo's own `git config user.*`.
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_DATE',
  // Reflog attribution from the outer command ("push", "rebase") is misleading
  // once the child is operating on a different repository.
  'GIT_REFLOG_ACTION',
]);

/**
 * A copy of `env` with git's repository variables removed.
 *
 * @param {NodeJS.ProcessEnv} [env] defaults to the current environment
 * @returns {NodeJS.ProcessEnv} a new object; `env` is not mutated
 */
export function scrubGitEnv(env = process.env) {
  const out = { ...env };
  for (const key of GIT_ENV_VARS) delete out[key];
  return out;
}

/** True when `env` carries a repository git would use in preference to `cwd`. */
export function hasInheritedGitRepo(env = process.env) {
  return Boolean(env.GIT_DIR || env.GIT_INDEX_FILE || env.GIT_OBJECT_DIRECTORY);
}
