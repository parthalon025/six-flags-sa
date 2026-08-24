#!/usr/bin/env node
/**
 * Pre-merge vertical — docs-only fast path.
 *
 *   node test/scripts/pre-merge-vertical.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreMergeVertical } from '../../scripts/ci/pre-merge-vertical.mjs';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { LOCAL_CI_PASS_REL, LOCAL_CI_TAG } from '../../scripts/lib/local-ci-pass.mjs';

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

console.log('pre-merge-vertical tests ok');
