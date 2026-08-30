#!/usr/bin/env node
/**
 * Canon lane plan CLI — the actual `node scripts/ci/lane-plan.mjs` entry
 * point GitHub Actions invokes, not just the `ci-lane-plan.mjs` library
 * (already covered by test/scripts/ci-lane-plan.test.mjs).
 *
 * Regression for a wrong-argument-order bug: the CLI called
 * `gitChangedFiles(baseRef, root)`, but that function's signature is
 * `(baseRef, headRef, cwd)` — passing the filesystem root where a git ref
 * was expected made `git merge-base` fail on every invocation, which the
 * caller's try/catch swallowed into a `files: null` fail-closed result.
 * That silently forced every canon flag on regardless of the real diff,
 * only surfacing as a CI break on diffs the real module selector found no
 * UI work for (e.g. docs-only), where the `ui` job's matrix came up empty.
 *
 *   node test/scripts/lane-plan-cli.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { lanePlanGithubOutputs } from '../../scripts/ci/lane-plan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const lanePlanCli = join(root, 'scripts/ci/lane-plan.mjs');

function git(dir, ...args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...scrubGitEnv(),
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

// A synthetic repo whose only change is backside — the CLI must resolve git
// inside that repo (cwd), not mistake cwd for the head ref.
{
  const dir = mkdtempSync(join(tmpdir(), 'lane-plan-cli-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'lane-plan@example.invalid');
  git(dir, 'config', 'user.name', 'Lane Plan');
  mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
  writeFileSync(join(dir, 'scripts/ci/pre-merge-vertical.mjs'), '// backside\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  writeFileSync(join(dir, 'scripts/ci/pre-merge-vertical.mjs'), '// backside edit\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'backside change');

  const outs = lanePlanGithubOutputs('main', { cwd: dir });
  assert.equal(
    outs.canon_any_ui,
    'false',
    'lanePlanGithubOutputs must resolve git in cwd, not treat cwd as headRef',
  );

  rmSync(dir, { recursive: true, force: true });
}

// The real repo, through the real CLI: this branch's own diff is backside
// only, so the UI lanes must stay off.
{
  const cliOut = execFileSync('node', [lanePlanCli, '--base', 'origin/main'], {
    cwd: root,
    encoding: 'utf8',
    env: scrubGitEnv(),
  });
  assert.match(
    cliOut,
    /^canon_any_ui=false$/m,
    'lane-plan CLI must emit canon_any_ui=false for a backside-only diff',
  );
}

// Diffing HEAD against itself is a no-op diff — every canon flag must come
// back false, and the git call underneath must not fail.
{
  const res = spawnSync(process.execPath, [lanePlanCli, '--base', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    env: scrubGitEnv(),
  });

  assert.equal(res.status, 0, `lane-plan.mjs exits 0 (stderr: ${res.stderr})`);
  assert.doesNotMatch(
    res.stderr,
    /fatal:/,
    'gitChangedFiles must be called with a valid git ref, not the filesystem root',
  );
  for (const flag of [
    'canon_builder',
    'canon_lint',
    'canon_selector',
    'canon_any_ui',
    'canon_boundaries',
    'canon_map_factory',
    'canon_visual_factory',
    'canon_delivery_factory',
  ]) {
    assert.match(
      res.stdout,
      new RegExp(`^${flag}=false$`, 'm'),
      `a no-op diff owes no canon lane (${flag})`,
    );
  }
}

console.log('lane-plan-cli: ok');
