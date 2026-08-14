#!/usr/bin/env node
/**
 * Bump the monorepo app semver after a merge to main, using Conventional
 * Commits for the digit and skipping when the merge did not touch the app.
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
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bumpVersion } from '../apps/party-tracker/lib/version.js';
import { decideBump } from './lib/release-bump.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(root, 'apps/party-tracker');
const releaseNotesPath = path.join(appRoot, 'data/release-notes.json');

const workspacePkgPaths = [
  path.join(root, 'package.json'),
  path.join(appRoot, 'package.json'),
  path.join(root, 'packages/shared/package.json'),
  path.join(root, 'packages/venue-builder/package.json'),
];

/** Internal workspace package names whose exact version pins must track the bump. */
const INTERNAL_DEP_NAMES = ['@party-tracker/shared'];
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function changedFiles() {
  try {
    const out = git(['diff', '--name-only', 'HEAD^1', 'HEAD']);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.error('bump-version: could not diff against first parent (need fetch-depth >= 2).');
    throw err;
  }
}

function mergeMessages(noteArg) {
  const msgs = [];
  if (noteArg) msgs.push(noteArg);
  try {
    msgs.push(git(['log', '-1', '--format=%B', 'HEAD']));
    const parts = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parts.length >= 3) {
      msgs.push(git(['log', '--format=%B', `${parts[1]}..${parts[2]}`]));
    }
  } catch {
    // PR title / noteArg is enough when git history is thin.
  }
  return msgs;
}

function emitSkipped(reason) {
  console.log(`bump-version: skip (${reason})`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'skipped=true\n');
  }
}

function emitBumped(from, to) {
  console.log(`bump-version: ${from} -> ${to}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'skipped=false\n');
  }
}

const noteArg = process.argv.slice(2).join(' ').trim();
const files = changedFiles();
const decision = decideBump(files, mergeMessages(noteArg));
if (decision.skip) {
  emitSkipped(decision.reason);
  process.exit(0);
}

const rootPkg = JSON.parse(fs.readFileSync(workspacePkgPaths[0], 'utf8'));
const from = rootPkg.version || '0.0.0';
const to = bumpVersion(from, decision.kind);
const note = sanitizeNote(noteArg) || 'Latest fixes and improvements.';

for (const pkgPath of workspacePkgPaths) {
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = to;
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const name of INTERNAL_DEP_NAMES) {
      if (typeof deps[name] === 'string' && !deps[name].startsWith('workspace:')) {
        deps[name] = to;
      }
    }
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = to;
  if (lock.packages?.['']) lock.packages[''].version = to;
  for (const key of ['apps/party-tracker', 'packages/shared', 'packages/venue-builder']) {
    const entry = lock.packages?.[key];
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.version === 'string') entry.version = to;
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const deps = entry[section];
      if (!deps) continue;
      for (const name of INTERNAL_DEP_NAMES) {
        if (typeof deps[name] === 'string' && !deps[name].startsWith('workspace:')) {
          deps[name] = to;
        }
      }
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

emitBumped(from, to);

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
