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
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'scripts/ci/lane-plan.mjs');

// Diffing HEAD against itself is a no-op diff — every canon flag must come
// back false, and the git call underneath must not fail.
const res = spawnSync(process.execPath, [script, '--base', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
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

console.log('lane-plan-cli: ok');
