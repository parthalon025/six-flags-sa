#!/usr/bin/env node
/**
 * Bump the monorepo patch version after a merge to main.
 *
 * Keeps root + workspace package.json versions in lockstep, updates
 * package-lock.json, stamps the app's app-version.json / sw.js, and adds a
 * release-notes entry when one is missing for the new version.
 *
 * Usage (from repo root):
 *   node scripts/bump-version.mjs [release-note line]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bumpPatchVersion } from '../apps/party-tracker/lib/version.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(root, 'apps/party-tracker');
const releaseNotesPath = path.join(appRoot, 'data/release-notes.json');

const workspacePkgPaths = [
  path.join(root, 'package.json'),
  path.join(appRoot, 'package.json'),
  path.join(root, 'packages/shared/package.json'),
];

const rootPkg = JSON.parse(fs.readFileSync(workspacePkgPaths[0], 'utf8'));
const from = rootPkg.version || '0.0.0';
const to = bumpPatchVersion(from);

const noteArg = process.argv.slice(2).join(' ').trim();
const note = sanitizeNote(noteArg) || 'Latest fixes and improvements.';

for (const pkgPath of workspacePkgPaths) {
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = to;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = to;
  if (lock.packages?.['']) lock.packages[''].version = to;
  for (const key of ['apps/party-tracker', 'packages/shared', 'packages/venue-builder']) {
    if (lock.packages?.[key] && typeof lock.packages[key].version === 'string') {
      lock.packages[key].version = to;
    }
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

const notes = JSON.parse(fs.readFileSync(releaseNotesPath, 'utf8'));
if (!notes[to]) {
  notes[to] = { title: "What's new", items: [note] };
  fs.writeFileSync(releaseNotesPath, `${JSON.stringify(notes, null, 2)}\n`);
}

const inject = spawnSync('node', ['scripts/inject-version.mjs'], {
  cwd: appRoot,
  stdio: 'inherit',
});
if (inject.status !== 0) process.exit(inject.status ?? 1);

console.log(`bump-version: ${from} -> ${to}`);

function sanitizeNote(raw) {
  let s = String(raw || '')
    .split('\n')[0]
    .trim();
  if (!s) return '';
  if (/^Merge pull request #\d+ from /i.test(s)) return '';
  if (/^chore:\s*bump version\b/i.test(s)) return '';
  if (s.length > 160) s = `${s.slice(0, 157)}...`;
  return s;
}
