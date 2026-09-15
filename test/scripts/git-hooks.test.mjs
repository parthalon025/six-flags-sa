#!/usr/bin/env node
/**
 * Git hook readiness — tracked `.husky/` hooks must be reachable from worktrees.
 *
 *   node test/scripts/git-hooks.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import {
  hooksPathForRepo,
  prePushHookFile,
  prePushRunnable,
  configureTrackedHooksPath,
  linkNodeModulesFrom,
  ensureWorktreeHooks,
} from '../../scripts/lib/git-hooks.mjs';

assert.equal(hooksPathForRepo(), '.husky');

// A fresh clone never runs scripts/worktree.mjs, so `prepare` is the only thing
// that points core.hooksPath at the tracked .husky scripts rather than husky's
// generated .husky/_ shims.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
assert.match(pkg.scripts.prepare, /husky/, 'prepare must still run husky (pre-push hook install)');
assert.match(
  pkg.scripts.prepare,
  /git config core\.hooksPath \.husky/,
  "prepare must point core.hooksPath at tracked .husky scripts, not husky's generated .husky/_ shims",
);

const missing = mkdtempSync(join(tmpdir(), 'hooks-missing-'));
try {
  assert.equal(prePushRunnable(missing).runnable, false);
  assert.match(prePushRunnable(missing).reason, /missing tracked hook/);
} finally {
  rmSync(missing, { recursive: true, force: true });
}

const noModules = mkdtempSync(join(tmpdir(), 'hooks-nomod-'));
try {
  mkdirSync(join(noModules, '.husky'));
  writeFileSync(join(noModules, '.husky', 'pre-push'), '#!/bin/sh\n');
  assert.equal(prePushRunnable(noModules).runnable, false);
  assert.match(prePushRunnable(noModules).reason, /node_modules missing/);
} finally {
  rmSync(noModules, { recursive: true, force: true });
}

const ready = mkdtempSync(join(tmpdir(), 'hooks-ready-'));
try {
  mkdirSync(join(ready, '.husky'));
  mkdirSync(join(ready, 'node_modules'));
  writeFileSync(join(ready, '.husky', 'pre-push'), '#!/bin/sh\n');
  assert.equal(prePushRunnable(ready).runnable, true);
} finally {
  rmSync(ready, { recursive: true, force: true });
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: scrubGitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-repo-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(dir, '.husky'));
  writeFileSync(join(dir, '.husky', 'pre-push'), '#!/bin/sh\necho "pre-push: test hook ran"\nexit 0\n');
  chmodSync(join(dir, '.husky', 'pre-push'), 0o755);
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

const repo = initRepo();
try {
  configureTrackedHooksPath(repo);
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']), '.husky');
  assert.equal(existsSync(prePushHookFile(repo)), true);

  const primary = mkdtempSync(join(tmpdir(), 'hooks-primary-'));
  const wt = join(primary, 'wt');
  git(repo, ['worktree', 'add', '--detach', wt, 'HEAD']);
  assert.equal(git(wt, ['config', '--get', 'core.hooksPath']), '.husky');
  assert.equal(existsSync(prePushHookFile(wt)), true);
  assert.equal(prePushRunnable(wt).runnable, false);

  mkdirSync(join(repo, 'node_modules'));
  writeFileSync(join(repo, 'node_modules', '.keep'), '');
  const linked = linkNodeModulesFrom({ worktreeRoot: wt, sourceRoot: repo });
  assert.equal(linked.linked, true);
  assert.equal(existsSync(join(wt, 'node_modules', '.keep')), true);
  assert.equal(prePushRunnable(wt).runnable, true);

  const bare = mkdtempSync(join(tmpdir(), 'hooks-bare-'));
  const bareRepo = join(bare, 'remote.git');
  execFileSync('git', ['clone', '--bare', repo, bareRepo], { encoding: 'utf8' });
  git(wt, ['remote', 'add', 'origin', bareRepo]);

  let hookOutput = '';
  try {
    hookOutput = execFileSync('git', ['-C', wt, 'push', '-u', 'origin', 'main'], {
      env: scrubGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    hookOutput = [err.stdout, err.stderr].filter(Boolean).join('\n');
  }
  assert.match(hookOutput, /pre-push: test hook ran/, 'push must invoke the tracked pre-push hook, not skip silently');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('git-hooks tests: ok');
