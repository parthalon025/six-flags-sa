#!/usr/bin/env node
/**
 * Session-local GitNexus index. `.gitnexus/` is gitignored and must not land
 * on GitHub — the graph is rebuilt at session start.
 *
 *   node scripts/gitnexus-sync.mjs startup
 *   node scripts/gitnexus-sync.mjs finish    # same as startup
 *
 * `--commit` is accepted and ignored so old CI callers do not fail.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const mode = argv.find((a) => a !== '--commit') || 'startup';
const doCommit = argv.includes('--commit');
const runCjs = join(root, '.gitnexus', 'run.cjs');

function run(nodeCmd, args) {
  execFileSync(nodeCmd, args, { cwd: root, stdio: 'inherit' });
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
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
}

/** Analyze rewrites generated hunks; keep the committed docs stable. */
function restoreAgentDocs() {
  try {
    git(['checkout', '--', 'AGENTS.md', 'CLAUDE.md']);
  } catch {
    // fresh clone / no HEAD — leave whatever analyze wrote
  }
}

if (mode !== 'startup' && mode !== 'finish') {
  console.error('Usage: node scripts/gitnexus-sync.mjs <startup|finish>');
  process.exit(1);
}

if (doCommit) {
  console.warn('[gitnexus-sync] --commit is ignored; the index is gitignored');
}

console.log(`[gitnexus-sync] ${mode}: refreshing session-local index…`);
try {
  analyze();
  restoreAgentDocs();
  console.log('[gitnexus-sync] index is session-local under .gitnexus/ — not committed');
} catch (err) {
  // Sandboxed environments can't always fetch gitnexus's native deps
  // (onnxruntime-node / @ladybugdb/core postinstall downloads). The session
  // continues without the index; code-graph MUSTs degrade to best-effort.
  restoreAgentDocs();
  console.warn(`[gitnexus-sync] gitnexus unavailable — continuing without a code-graph index (${err.message || err})`);
  console.warn('[gitnexus-sync] impact/detect_changes are best-effort this session; note it in PRs per matt-standards');
}
