#!/usr/bin/env node
/**
 * Agent worktree create / remove / prune.
 *
 *   node test/scripts/worktree.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_DIR,
  branchName,
  sanitizeSlug,
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

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

function run(cwd, args) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

const repo = initRepo();
try {
  const created = run(repo, ['create', 'fix-auth']);
  assert.match(created, /WORKTREE=/);
  const wt = join(repo, AGENT_DIR, 'fix-auth');
  assert.equal(existsSync(join(wt, 'README.md')), true);
  assert.equal(git(wt, ['branch', '--show-current']), 'worktree-fix-auth');
  assert.equal(git(wt, ['rev-parse', 'HEAD']), git(repo, ['rev-parse', 'HEAD']));

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

console.log('worktree tests: ok');
