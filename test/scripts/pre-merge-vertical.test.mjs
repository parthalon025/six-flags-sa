#!/usr/bin/env node
/**
 * Pre-merge vertical — docs-only fast path, and the trailer-only stamp read.
 *
 *   node test/scripts/pre-merge-vertical.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreMergeVertical } from '../../scripts/ci/pre-merge-vertical.mjs';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import {
  LOCAL_CI_PASS_REL,
  LOCAL_CI_TAG,
  buildLocalCiContext,
  writeLocalCiPass,
} from '../../scripts/lib/local-ci-pass.mjs';
import { LOCAL_CI_TRAILER, publishStamps } from '../../scripts/lib/stamp-trailer.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'pre-merge-docs-'));

function git(...args) {
  execFileSync('git', args, { cwd: tmp, env: scrubGitEnv(), encoding: 'utf8' });
}

git('init', '-b', 'main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');
writeFileSync(join(tmp, 'README.md'), 'base\n');
git('add', 'README.md');
git('commit', '-m', 'base');

mkdirSync(join(tmp, 'docs'), { recursive: true });
writeFileSync(join(tmp, 'docs/only.md'), '# docs\n');
git('checkout', '-b', 'docs-branch');
git('add', 'docs/only.md');
git('commit', '-m', 'docs only');

const code = await runPreMergeVertical({ baseRef: 'main', cwd: tmp });
assert.equal(code, 0, 'docs-only diff exits 0 without static floor');

const stampPath = join(tmp, LOCAL_CI_PASS_REL);
assert.ok(existsSync(stampPath), 'docs-only run writes local-ci-pass stamp');
const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
assert.equal(stamp.tag, LOCAL_CI_TAG);
assert.deepEqual(stamp.verticals, []);

// --- The stamp is gitignored, so on any tree but the one that wrote it the
// only copy is the published trailer. pre-merge-vertical is the gate agents
// actually run and the one that reads *both* stamps, so it has to find a
// trailer-only stamp — otherwise every stamped branch re-runs the whole gate.
{
  const dir = mkdtempSync(join(tmpdir(), 'pre-merge-trailer-'));
  const g = (...args) =>
    execFileSync('git', args, {
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
  g('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 1;\n');
  g('add', '.');
  g('commit', '-qm', 'base');
  g('checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 2;\n');
  g('add', '.');
  g('commit', '-qm', 'code change');

  const context = buildLocalCiContext({ baseRef: 'main', cwd: dir });
  writeLocalCiPass(
    {
      context,
      browserVertical: context.needsBrowser,
      verticals: context.verticals,
      factoryLegsRan: Object.entries(context.factoryLegs)
        .filter(([, required]) => required)
        .map(([leg]) => leg),
    },
    dir,
  );
  assert.ok(
    publishStamps({ cwd: dir, stamps: { [LOCAL_CI_TRAILER]: JSON.parse(readFileSync(join(dir, LOCAL_CI_PASS_REL), 'utf8')) } }),
    'the stamp publishes as a trailer',
  );
  unlinkSync(join(dir, LOCAL_CI_PASS_REL)); // gitignored: CI never sees this file

  const said = [];
  const realLog = console.log;
  console.log = (...parts) => said.push(parts.join(' '));
  let trailerCode;
  try {
    trailerCode = await runPreMergeVertical({ baseRef: 'main', cwd: dir });
  } finally {
    console.log = realLog;
  }
  assert.equal(trailerCode, 0, 'a trailer-only stamp still covers the tree');
  assert.match(
    said.join('\n'),
    /stamp covers this tree — skipping/,
    'the gate skipped on the trailer rather than re-running the whole floor',
  );
  rmSync(dir, { recursive: true, force: true });
}

console.log('pre-merge-vertical tests ok');
