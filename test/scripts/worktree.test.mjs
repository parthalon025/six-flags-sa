#!/usr/bin/env node
/**
 * Agent worktree create / remove / prune.
 *
 *   node test/scripts/worktree.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync, unlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import {
  AGENT_DIR,
  branchName,
  removeDirSafe,
  sanitizeSlug,
  shouldDeleteBranch,
  shouldRemoveOnPrune,
  worktreePath,
} from '../../scripts/worktree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'scripts', 'worktree.mjs');

assert.equal(sanitizeSlug('Fix Auth!'), 'fix-auth');
assert.equal(sanitizeSlug('worktree-foo'), 'foo');
assert.equal(sanitizeSlug('a/b/c'), 'a-b-c');
assert.throws(() => sanitizeSlug('...'), /slug/);
assert.equal(branchName('fix-auth'), 'worktree-fix-auth');
assert.equal(
  worktreePath('/repo', 'fix-auth').replace(/\\/g, '/'),
  '/repo/.claude/worktrees/fix-auth',
);

assert.equal(shouldRemoveOnPrune({ dirty: true, locked: false, aheadCount: 0, prMerged: true }), false);
assert.equal(shouldRemoveOnPrune({ dirty: false, locked: true, aheadCount: 0, prMerged: true }), false);
assert.equal(shouldRemoveOnPrune({ dirty: false, locked: false, aheadCount: 0, prMerged: false }), false);
assert.equal(shouldRemoveOnPrune({ dirty: false, locked: false, aheadCount: 1, prMerged: true }), false);
assert.equal(shouldRemoveOnPrune({ dirty: false, locked: false, aheadCount: 0, prMerged: true }), true);

assert.equal(shouldDeleteBranch({ name: 'main', aheadCount: 0, hasWorktree: false, prMerged: true, force: true }), false);
assert.equal(shouldDeleteBranch({ name: 'wip/keep', aheadCount: 0, hasWorktree: false, prMerged: false, force: true }), false);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 0, hasWorktree: true, prMerged: false, force: false }), false);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 0, hasWorktree: false, prMerged: false, force: false }), true);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 2, hasWorktree: false, prMerged: false, force: false }), false);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 2, hasWorktree: false, prMerged: true, force: false }), true);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 2, hasWorktree: false, prMerged: false, force: true }), true);

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    // `cwd` is not isolation on its own: under a git hook the environment names
    // the real repository and git prefers it. See scripts/lib/git-env.mjs.
    env: scrubGitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo({ productionPrePush = false, withNodeModules = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(dir, '.husky'));
  const hookPath = join(dir, '.husky', 'pre-push');
  if (productionPrePush) {
    writeFileSync(hookPath, readFileSync(join(root, '.husky', 'pre-push')));
    chmodSync(hookPath, 0o755);
  } else {
    writeFileSync(hookPath, '#!/bin/sh\nexit 0\n');
  }
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  if (withNodeModules) {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  }
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);
  if (withNodeModules) {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', '.keep'), '');
  }
  return dir;
}

function run(cwd, args) {
  try {
    return execFileSync(process.execPath, [script, ...args], {
      cwd,
      // worktree.mjs shells out to git; the same inherited-repo trap applies.
      env: scrubGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = [err.stderr, err.stdout, err.message].filter(Boolean).join('\n');
    const wrapped = new Error(msg);
    wrapped.status = err.status;
    throw wrapped;
  }
}

const repo = initRepo();
try {
  const created = run(repo, ['create', 'fix-auth']);
  assert.match(created, /WORKTREE=/);
  const wt = join(repo, AGENT_DIR, 'fix-auth');
  assert.equal(existsSync(join(wt, 'README.md')), true);
  assert.equal(git(wt, ['branch', '--show-current']), 'worktree-fix-auth');
  assert.equal(git(wt, ['rev-parse', 'HEAD']), git(repo, ['rev-parse', 'HEAD']));
  assert.equal(git(wt, ['config', '--get', 'core.hooksPath']), '.husky');
  assert.equal(existsSync(join(wt, '.husky', 'pre-push')), true);

  const listed = run(repo, ['list']);
  assert.match(listed, /fix-auth/);
  assert.match(listed, /worktree-fix-auth/);

  assert.throws(() => run(repo, ['create', 'fix-auth']), /already exists/);

  mkdirSync(join(repo, AGENT_DIR, 'taken'));
  writeFileSync(join(repo, AGENT_DIR, 'taken', 'stray.txt'), 'nope\n');
  assert.throws(() => run(repo, ['create', 'taken']), /already exists/);

  const outside = join(repo, 'not-an-agent-tree');
  mkdirSync(outside);
  assert.throws(() => run(repo, ['remove', outside]), /agent worktree/);

  run(repo, ['remove', 'fix-auth']);
  assert.equal(existsSync(wt), false);
  const branches = git(repo, ['branch']);
  assert.equal(branches.includes('worktree-fix-auth'), false);

  const leftover = git(repo, ['worktree', 'list']);
  assert.equal(leftover.includes('fix-auth'), false);

  const pruned = run(repo, ['prune']);
  assert.match(pruned, /nothing to remove|0 agent worktree/i);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

const repoHooks = initRepo({ productionPrePush: true, withNodeModules: true });
try {
  const created = run(repoHooks, ['create', 'hook-gate']);
  assert.match(created, /pre-push hook: ready/);
  const wt = join(repoHooks, AGENT_DIR, 'hook-gate');
  assert.equal(lstatSync(join(wt, 'node_modules')).isSymbolicLink(), true);

  const bareParent = mkdtempSync(join(tmpdir(), 'wt-hooks-bare-'));
  const bare = join(bareParent, 'origin.git');
  execFileSync('git', ['clone', '--bare', repoHooks, bare], { encoding: 'utf8' });
  git(wt, ['remote', 'add', 'origin', bare]);

  unlinkSync(join(wt, 'node_modules'));
  let pushOutput = '';
  try {
    pushOutput = execFileSync('git', ['push', '-u', 'origin', 'worktree-hook-gate'], {
      cwd: wt,
      env: scrubGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    pushOutput = [err.stdout, err.stderr].filter(Boolean).join('\n');
    assert.notEqual(err.status, 0);
  }
  assert.match(
    pushOutput,
    /refusing silent skip — node_modules missing/,
    'push from worktree without node_modules must refuse loudly',
  );

  run(repoHooks, ['remove', 'hook-gate']);
} finally {
  rmSync(repoHooks, { recursive: true, force: true });
}

const repo2 = initRepo();
try {
  git(repo2, ['branch', 'worktree-stale']);
  git(repo2, ['checkout', '-b', 'worktree-live']);
  writeFileSync(join(repo2, 'README.md'), 'live\n');
  git(repo2, ['add', 'README.md']);
  git(repo2, ['commit', '-m', 'live work']);
  git(repo2, ['checkout', 'main']);
  git(repo2, ['branch', 'feat/human']);

  run(repo2, ['create', 'keep-me']);
  const pruned = run(repo2, ['prune']);
  assert.match(pruned, /worktree-stale/);
  const branches = git(repo2, ['branch']);
  assert.equal(branches.includes('worktree-stale'), false);
  assert.equal(branches.includes('worktree-live'), true);
  assert.equal(branches.includes('feat/human'), true);
  assert.equal(branches.includes('worktree-keep-me'), true);

  const bareParent = mkdtempSync(join(tmpdir(), 'wt-bare-'));
  const bare = join(bareParent, 'origin.git');
  execFileSync('git', ['clone', '--bare', repo2, bare], { encoding: 'utf8' });
  git(repo2, ['remote', 'add', 'origin', bare]);
  git(join(repo2, AGENT_DIR, 'keep-me'), ['push', '-u', 'origin', 'worktree-keep-me']);
  run(repo2, ['remove', 'keep-me']);
  const remoteHeads = git(bare, ['branch']);
  assert.equal(remoteHeads.includes('worktree-keep-me'), false);
  assert.equal(git(repo2, ['branch']).includes('worktree-keep-me'), false);
} finally {
  rmSync(repo2, { recursive: true, force: true });
}

if (process.platform === 'win32') {
  const outside = mkdtempSync(join(tmpdir(), 'wt-canary-'));
  const victim = mkdtempSync(join(tmpdir(), 'wt-victim-'));
  const canary = join(outside, 'canary.txt');
  writeFileSync(canary, 'safe\n');
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', join(victim, 'node_modules'), outside], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  removeDirSafe(victim);
  assert.equal(existsSync(canary), true, 'Windows rmdir must not follow NTFS junctions');
  rmSync(outside, { recursive: true, force: true });
}

console.log('worktree tests: ok');
