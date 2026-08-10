#!/usr/bin/env node
/**
 * Bump package.json patch version after a merge to main.
 *
 * Updates package-lock.json, stamps public/app-version.json and sw.js, and
 * adds a release-notes entry when one is missing for the new version.
 *
 * Usage:
 *   node scripts/bump-version.mjs [release-note line]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bumpPatchVersion } from '../lib/version.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const releaseNotesPath = path.join(root, 'data/release-notes.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const from = pkg.version || '0.0.0';
const to = bumpPatchVersion(from);

const noteArg = process.argv.slice(2).join(' ').trim();
const note = sanitizeNote(noteArg) || 'Latest fixes and improvements.';

pkg.version = to;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = to;
  if (lock.packages?.['']) lock.packages[''].version = to;
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

const notes = JSON.parse(fs.readFileSync(releaseNotesPath, 'utf8'));
if (!notes[to]) {
  notes[to] = { title: "What's new", items: [note] };
  fs.writeFileSync(releaseNotesPath, `${JSON.stringify(notes, null, 2)}\n`);
}

const inject = spawnSync('node', ['scripts/inject-version.mjs'], { cwd: root, stdio: 'inherit' });
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
