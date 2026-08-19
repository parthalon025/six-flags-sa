#!/usr/bin/env node
/**
 * Hermetic git environment — scripts/lib/git-env.mjs
 *
 * The end-to-end legs below are the real point: they build a throwaway "outer"
 * repository, then run git in a *different* directory with `GIT_DIR` pointing at
 * the outer one, exactly as a git hook leaves the environment. The scrubbed leg
 * must leave the outer repo alone; the leaked leg must corrupt it, because a
 * regression test that cannot fail is not protecting anything.
 *
 *   node test/scripts/git-env.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_ENV_VARS, hasInheritedGitRepo, scrubGitEnv } from '../../scripts/lib/git-env.mjs';

/* ------------------------------------------------------------------ unit -- */

const seeded = Object.fromEntries(GIT_ENV_VARS.map((k) => [k, `/leaked/${k}`]));
const input = { ...seeded, PATH: '/bin', GIT_EXEC_PATH: '/usr/lib/git-core', HOME: '/home/x' };
const scrubbed = scrubGitEnv(input);

for (const key of GIT_ENV_VARS) {
  assert.equal(scrubbed[key], undefined, `${key} survived the scrub`);
}
assert.equal(scrubbed.PATH, '/bin');
assert.equal(scrubbed.HOME, '/home/x');
// How git runs, not which repository it runs against — dropping it breaks callers.
assert.equal(scrubbed.GIT_EXEC_PATH, '/usr/lib/git-core');
assert.equal(input.GIT_DIR, '/leaked/GIT_DIR', 'scrubGitEnv mutated its argument');

assert.equal(hasInheritedGitRepo({ GIT_DIR: '/x' }), true);
assert.equal(hasInheritedGitRepo({ GIT_INDEX_FILE: '/x' }), true);
assert.equal(hasInheritedGitRepo({ GIT_OBJECT_DIRECTORY: '/x' }), true);
assert.equal(hasInheritedGitRepo({ PATH: '/bin' }), false);

/* ------------------------------------------------------------ end to end -- */

const clean = scrubGitEnv();

function git(cwd, args, env = clean) {
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo(prefix, readme) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), readme);
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

const dirs = [];
try {
  const outer = initRepo('git-env-outer-', 'the real readme\n');
  dirs.push(outer);
  const outerHead = git(outer, ['rev-parse', 'HEAD']);
  const leaked = { ...process.env, GIT_DIR: join(outer, '.git') };

  // Scrubbed: a scratch repo built under a leaked GIT_DIR stays its own repo.
  const safe = mkdtempSync(join(tmpdir(), 'git-env-safe-'));
  dirs.push(safe);
  const safeEnv = scrubGitEnv(leaked);
  git(safe, ['init', '-b', 'main'], safeEnv);
  git(safe, ['config', 'user.email', 'test@example.com'], safeEnv);
  git(safe, ['config', 'user.name', 'Test'], safeEnv);
  git(safe, ['config', 'commit.gpgsign', 'false'], safeEnv);
  writeFileSync(join(safe, 'README.md'), 'v1\n');
  git(safe, ['add', 'README.md'], safeEnv);
  git(safe, ['commit', '-m', 'fixture'], safeEnv);

  assert.equal(git(outer, ['rev-parse', 'HEAD']), outerHead, 'scrubbed run moved the outer HEAD');
  assert.equal(git(outer, ['show', 'HEAD:README.md']), 'the real readme');
  assert.equal(git(outer, ['status', '--porcelain']), '', 'scrubbed run dirtied the outer repo');
  assert.notEqual(git(safe, ['rev-parse', 'HEAD'], safeEnv), outerHead);
  assert.equal(git(outer, ['config', '--local', '--get', 'user.name']), 'Test');

  // Leaked: the same sequence commits the scratch files onto the outer branch —
  // the failure this module exists to prevent. `outer` is disposable.
  const trap = mkdtempSync(join(tmpdir(), 'git-env-trap-'));
  dirs.push(trap);
  writeFileSync(join(trap, 'README.md'), 'v1\n');
  git(trap, ['add', 'README.md'], leaked);
  git(trap, ['commit', '-m', 'fixture'], leaked);

  assert.notEqual(git(outer, ['rev-parse', 'HEAD']), outerHead, 'the trap no longer reproduces');
  assert.equal(git(outer, ['show', 'HEAD:README.md']), 'v1');
  // The tell we actually saw: HEAD truncated, the file on disk untouched.
  assert.equal(readFileSync(join(outer, 'README.md'), 'utf8'), 'the real readme\n');
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

/* ----------------------------------------------------------- structural -- */

/**
 * The destructive shape is narrow and easy to name: a test that builds its own
 * repository with `git init`. Every one of those must scrub, because the whole
 * point of the scratch repo is that it is *not* the repository git handed the
 * hook. Grep for the shape rather than trusting anyone to remember.
 */
const suiteDir = join(dirname(fileURLToPath(import.meta.url)));
for (const entry of readdirSync(suiteDir)) {
  if (!entry.endsWith('.test.mjs')) continue;
  const src = readFileSync(join(suiteDir, entry), 'utf8');
  if (!/'init'/.test(src)) continue;
  assert.match(
    src,
    /scrubGitEnv/,
    `${entry} builds a scratch repo with git init but does not import scrubGitEnv — `
      + 'under a git hook its commits land on the real branch (scripts/lib/git-env.mjs)',
  );
}

console.log('git-env.test.mjs: ok');
