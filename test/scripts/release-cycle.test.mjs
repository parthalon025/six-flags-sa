#!/usr/bin/env node
/**
 * Event-driven release cycle classifier
 *
 *   node test/scripts/release-cycle.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyStoreRelease } from '../../scripts/lib/store-release-plan.mjs';
import {
  buildReleaseCycleReport,
  changedFilesSinceRef,
  releaseCycleChecklist,
} from '../../scripts/lib/release-cycle.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const webOnly = classifyStoreRelease(['apps/party-tracker/app/page.js']);
assert.equal(webOnly.recommended, 'web');

const report = buildReleaseCycleReport({ repoRoot });
assert.ok(report.appVersion);
assert.ok(['web_continuous', 'native_pending', 'first_store_submit'].includes(report.mode));
assert.ok(report.modeLabel);
assert.ok(Array.isArray(releaseCycleChecklist(report)));

const nativeFiles = buildReleaseCycleReport({
  repoRoot,
  sinceRef: null,
});
assert.ok(nativeFiles.classification);

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initShallowRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'release-cycle-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), 'v1\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  mkdirSync(join(dir, 'apps/party-tracker/app'), { recursive: true });
  writeFileSync(join(dir, 'apps/party-tracker/app/page.js'), 'export default function Page() {}\n');
  git(dir, ['add', 'apps/party-tracker/app/page.js']);
  git(dir, ['commit', '-m', 'add page']);
  return dir;
}

const shallowRepo = initShallowRepo();
assert.deepEqual(changedFilesSinceRef(shallowRepo, null), ['apps/party-tracker/app/page.js']);

console.log('release-cycle.test.mjs: ok');
