#!/usr/bin/env node
/**
 * Keep the committed GitNexus index in sync for cloud agents and local dev.
 *
 *   node scripts/gitnexus-sync.mjs startup           # session start (do not commit)
 *   node scripts/gitnexus-sync.mjs finish --commit   # post-merge / CI only
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GITNEXUS_INDEX_PATHS, GITNEXUS_REFRESH_MESSAGE } from './gitnexus-ci.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const mode = argv.find((a) => a !== '--commit') || 'startup';
const doCommit = argv.includes('--commit');
const runCjs = join(root, '.gitnexus', 'run.cjs');
const innerGitignore = join(root, '.gitnexus', '.gitignore');
const gitExclude = join(root, '.git', 'info', 'exclude');

/** Paths GitNexus analyze may refresh and that we commit on main. */
const TRACKED = GITNEXUS_INDEX_PATHS;

function run(nodeCmd, args) {
  execFileSync(nodeCmd, args, { cwd: root, stdio: 'inherit' });
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/** GitNexus analyze writes ignore rules that hide the committed index — strip them. */
function clearGitnexusIgnoreRules() {
  if (existsSync(innerGitignore)) {
    rmSync(innerGitignore);
  }
  if (!existsSync(gitExclude)) return;
  const next = readFileSync(gitExclude, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '.gitnexus/' && line.trim() !== '.gitnexus')
    .join('\n');
  writeFileSync(gitExclude, next.endsWith('\n') ? next : `${next}\n`);
}

function analyze() {
  const args = ['analyze'];
  const invoke = () => {
    if (existsSync(runCjs)) {
      run(process.execPath, [runCjs, ...args]);
    } else {
      run('npx', ['gitnexus', ...args]);
    }
  };
  try {
    invoke();
  } catch (err) {
    if (args.includes('--force')) throw err;
    console.warn('[gitnexus-sync] analyze failed — retrying with --force');
    args.push('--force');
    invoke();
  }
  clearGitnexusIgnoreRules();
}

function indexChanges() {
  try {
    return git(['status', '--porcelain', ...TRACKED]);
  } catch {
    return '';
  }
}

if (mode !== 'startup' && mode !== 'finish') {
  console.error('Usage: node scripts/gitnexus-sync.mjs <startup|finish> [--commit]');
  process.exit(1);
}

if (doCommit && mode !== 'finish') {
  console.error('[gitnexus-sync] --commit is only valid with finish');
  process.exit(1);
}

console.log(`[gitnexus-sync] ${mode}: refreshing index…`);
analyze();

const changes = indexChanges();
if (!changes) {
  console.log('[gitnexus-sync] index matches working tree');
  process.exit(0);
}

console.log('[gitnexus-sync] index updated:');
console.log(changes);

if (mode === 'finish' && doCommit) {
  git(['add', '-f', '.gitnexus/', 'AGENTS.md', 'CLAUDE.md']);
  git(['commit', '-m', GITNEXUS_REFRESH_MESSAGE]);
  console.log(`[gitnexus-sync] committed ${GITNEXUS_REFRESH_MESSAGE}`);
} else {
  console.log('[gitnexus-sync] leave these changes unstaged — the post-merge workflow commits the index on main');
}
