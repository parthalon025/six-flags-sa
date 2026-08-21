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
import { scrubGitEnv } from './lib/git-env.mjs';
import { GENERATED_DOC_PATHS, docsToRestore, parseDirtyDocs } from './lib/gitnexus-docs.mjs';
import {
  analyzeWithRepair,
  chooseInvocation,
  ladybugInstallerPath,
} from './lib/gitnexus-repair.mjs';
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

// Named, and named distinctly: an anonymous `warn:` property indexes as a
// bare `warn` symbol, which collides repo-wide and makes detect_changes
// report this script as touching hundreds of app flows.
function warnSync(message) {
  console.warn(`[gitnexus-sync] ${message}`);
}

function gitRaw(args) {
  // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
  return execFileSync('git', args, { cwd: root, env: scrubGitEnv(), encoding: 'utf8' });
}

function git(args) {
  return gitRaw(args).trim();
}

/** Tracked generated-doc paths that are currently dirty, keyed path → status code. */
function dirtyGeneratedDocs() {
  try {
    // Raw, not trimmed: porcelain's status field is two columns wide and the
    // first is a space for a worktree-only change, so trimming shifts the path.
    return parseDirtyDocs(gitRaw(['status', '--porcelain', '--', ...GENERATED_DOC_PATHS]));
  } catch (err) {
    // not a git work tree, or no git binary — nothing to compare against
    warnSync(`cannot read git status (${err.message || err}) — generated docs left as analyze wrote them`);
    return null;
  }
}

/**
 * Analyze rewrites generated hunks; keep the committed docs stable. Only revert
 * what *this* run dirtied — a path already modified before analyze is the
 * user's own edit and must survive.
 */
function restoreAgentDocs(before) {
  const restore = docsToRestore(before, dirtyGeneratedDocs());
  if (!restore.length) return;
  try {
    git(['checkout', '--', ...restore]);
  } catch (err) {
    warnSync(`could not restore ${restore.join(', ')} (${err.message || err})`);
  }
}

function onPath(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * `npm i -g gitnexus` fails in sandboxed/proxied containers: onnxruntime-node's
 * postinstall downloads a native binary and hits `read ECONNRESET` through the
 * outbound proxy, which aborts the *whole* install — including @ladybugdb/core,
 * whose `lbugjs.node` gitnexus cannot run without. Installing with scripts off
 * and then running only LadybugDB's installer gets the binary without the
 * network: it copies a prebuilt out of the @ladybugdb/core-<platform> package
 * that npm already fetched. Embedding/FTS features stay unavailable; the code
 * graph, `impact`, and `detect_changes` do not need them.
 */
function repairGitnexusInstall() {
  run('npm', ['i', '-g', 'gitnexus', '--ignore-scripts']);
  let globalRoot;
  try {
    globalRoot = execFileSync('npm', ['root', '-g'], { cwd: root, encoding: 'utf8' }).trim();
  } catch (err) {
    warnSync(`cannot locate the global npm root (${err.message || err}) — LadybugDB's binary stays missing`);
    return;
  }
  const installer = ladybugInstallerPath(globalRoot);
  if (!existsSync(installer)) {
    warnSync(`no LadybugDB installer at ${installer} — its binary stays missing`);
    return;
  }
  run(process.execPath, [installer]);
}

function analyze() {
  const invoke = (extraArgs) => {
    const resolver = existsSync(runCjs) ? runCjs : null;
    const { command, args } = chooseInvocation({
      runCjs: resolver,
      nodePath: process.execPath,
      // Only probe PATH when there is no resolver to defer to.
      gitnexusOnPath: resolver ? false : onPath('gitnexus'),
      args: ['analyze', ...extraArgs],
    });
    run(command, args);
  };

  analyzeWithRepair({
    analyze: invoke,
    repair: repairGitnexusInstall,
    warn: warnSync,
  });
}

if (mode !== 'startup' && mode !== 'finish') {
  console.error('Usage: node scripts/gitnexus-sync.mjs <startup|finish>');
  process.exit(1);
}

if (doCommit) {
  warnSync('--commit is ignored; the index is gitignored');
}

console.log(`[gitnexus-sync] ${mode}: refreshing session-local index…`);
const dirtyBefore = dirtyGeneratedDocs();
try {
  analyze();
  restoreAgentDocs(dirtyBefore);
  console.log('[gitnexus-sync] index is session-local under .gitnexus/ — not committed');
} catch (err) {
  // The repair path above covers the common sandbox failure (onnxruntime-node /
  // @ladybugdb/core postinstall downloads). Anything left — no registry at all —
  // must not crash the session; code-graph MUSTs degrade to best-effort.
  restoreAgentDocs(dirtyBefore);
  warnSync(`gitnexus unavailable — continuing without a code-graph index (${err.message || err})`);
  warnSync('impact/detect_changes are best-effort this session');
}
