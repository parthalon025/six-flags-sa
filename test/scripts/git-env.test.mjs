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
import { dirname, join, relative } from 'node:path';
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
 * The narrow version of this guard — "tests that call `git init`" — would not
 * have caught the holes the standards review found: scripts/ci/pre-merge-vertical.mjs
 * and three test/app entry points shelled out to git unscrubbed, and none of
 * them calls `git init`. So the guard tracks the real shape instead: any file
 * under scripts/ or test/ that spawns git at all must scrub.
 *
 * Every one of those call sites means "the repository I was pointed at", and
 * every one is reachable as a standalone npm script, so there is no legitimate
 * exemption and no allowlist to rot. packages/ is out of scope on purpose:
 * packages must not import repo tooling out of scripts/, so the one git caller
 * there (venue-builder/lib/venue-pr.mjs) cannot use this module.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPAWNS_GIT = /(?:execFileSync|execSync|spawnSync|spawn|exec)\(\s*['"`]git['"`]/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(mjs|js|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const spawners = [];
for (const dir of ['scripts', 'test']) {
  for (const file of walk(join(repoRoot, dir))) {
    const src = readFileSync(file, 'utf8');
    if (!SPAWNS_GIT.test(src)) continue;
    const rel = relative(repoRoot, file);
    spawners.push(rel);
    assert.match(
      src,
      /scrubGitEnv/,
      `${rel} spawns git without importing scrubGitEnv — under a git hook the `
        + 'inherited GIT_DIR outranks its cwd and it operates on the wrong '
        + 'repository (scripts/lib/git-env.mjs)',
    );
  }
}

// A guard that silently matches nothing passes forever. Assert it has teeth.
assert.ok(
  spawners.length >= 10,
  `expected the git-spawning file scan to find at least 10 files, found ${spawners.length} `
    + '— the pattern probably stopped matching',
);

console.log('git-env.test.mjs: ok');
