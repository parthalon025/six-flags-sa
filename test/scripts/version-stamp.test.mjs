#!/usr/bin/env node
/**
 * Shared version-stamp path list for bump + Vercel ignore.
 *
 *   node test/scripts/version-stamp.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRepoPath } from '../../scripts/lib/repo-path.mjs';
import {
  isVersionStampOnlyChange,
  loadVersionStampPaths,
} from '../../scripts/lib/version-stamp.mjs';

assert.equal(normalizeRepoPath('.\\apps\\party-tracker\\lib\\x.js'), 'apps/party-tracker/lib/x.js');
assert.equal(normalizeRepoPath('./package.json'), 'package.json');

const paths = loadVersionStampPaths();
assert.ok(paths.includes('package-lock.json'), 'stamp list includes lockfile');
assert.ok(paths.includes('apps/party-tracker/public/sw.js'), 'stamp list includes sw.js');

const bumpOnly = [...paths];
assert.equal(isVersionStampOnlyChange(bumpOnly), true, 'full stamp list is stamp-only');
assert.equal(
  isVersionStampOnlyChange([...bumpOnly, 'apps/party-tracker/lib/party/hostService.js']),
  false,
  'app file mixed in breaks stamp-only',
);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const bump = readFileSync(join(root, 'scripts/bump-version.mjs'), 'utf8');
assert.match(bump, /version-stamp-paths\.json/, 'bump-version points at shared stamp list');

console.log('version-stamp: ok');
