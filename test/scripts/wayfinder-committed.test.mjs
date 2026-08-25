#!/usr/bin/env node
/**
 * Wayfinder committed efforts — allowlist + gitignore exceptions for macro tracking.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import {
  REPO,
  listCommittedWayfinderSlugs,
  wayfinderEffortTracked,
} from '../../scripts/lib/wayfinder-committed.mjs';

const slugs = listCommittedWayfinderSlugs();
assert.ok(slugs.includes('factories-to-app'), 'allowlist must include factories-to-app');

const mapRel = '.scratch/factories-to-app/map.md';
const mapAbs = join(REPO, mapRel);
assert.ok(existsSync(mapAbs), 'committed map must exist on disk');

const tracked = wayfinderEffortTracked(REPO, 'factories-to-app');
assert.equal(tracked.ok, true, tracked.reason ?? 'wayfinder effort should be tracked');

try {
  execFileSync('git', ['check-ignore', '-q', mapRel], { cwd: REPO, env: scrubGitEnv() });
  assert.fail(`${mapRel} must not be gitignored`);
} catch (err) {
  assert.ok(err.status !== 0 || err.code, 'git check-ignore exit non-zero means not ignored');
}

console.log('wayfinder-committed tests ok');
