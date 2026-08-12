#!/usr/bin/env node
/**
 * Create and clean up agent git worktrees.
 *
 *   node scripts/worktree.mjs create <slug>
 *   node scripts/worktree.mjs remove <slug-or-path> [--force]
 *   node scripts/worktree.mjs list
 *   node scripts/worktree.mjs status
 *   node scripts/worktree.mjs prune [--merged]
 *
 * Worktrees live under `.claude/worktrees/<slug>` on branch `worktree-<slug>`,
 * cut from `origin/main` (local `main` if the remote ref is missing).
 * `remove` is the session-end command. `prune --merged` drops only clean
 * agent worktrees whose GitHub PR is already merged — never a 0-commit
 * unused tree, and never a worktree outside the agent dirs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AGENT_DIR = '.claude/worktrees';
const LEGACY_AGENT_DIR = '.worktrees';
const BRANCH_PREFIX = 'worktree-';

export function sanitizeSlug(raw) {
  let slug = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^worktree-/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  if (!slug) throw new Error('slug must contain a letter or digit');
  return slug;
}

export function branchName(slug) {
  return `${BRANCH_PREFIX}${sanitizeSlug(slug)}`;
}

export function worktreePath(root, slug) {
  return join(root, AGENT_DIR, sanitizeSlug(slug));
}

export function shouldRemoveOnPrune({ dirty, locked, aheadCount, prMerged }) {
  return Boolean(prMerged) && !dirty && !locked && Number(aheadCount) === 0;
}

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitOk(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return '';
  }
}

function repoRoot(cwd = process.cwd()) {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

function agentRoots(root) {
  return [join(root, AGENT_DIR), join(root, LEGACY_AGENT_DIR)];
}

function isInside(rootDir, target) {
  const rel = relative(resolve(rootDir), resolve(target));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
}

export function isAgentWorktreePath(root, target) {
  const resolved = resolve(target);
  return agentRoots(root).some((dir) => isInside(dir, resolved) && resolve(dir) !== resolved);
}

function parsePorcelain(text) {
  const trees = [];
  let current = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line) {
      if (current.worktree) trees.push(current);
      current = {};
      continue;
    }
    if (line.startsWith('worktree ')) current.worktree = line.slice(9);
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'bare') current.bare = true;
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
  }
  if (current.worktree) trees.push(current);
  return trees;
}

function listTrees(root) {
  return parsePorcelain(gitOk(root, ['worktree', 'list', '--porcelain']));
}

function defaultBase(root) {
  gitOk(root, ['fetch', 'origin', 'main']);
  if (gitOk(root, ['rev-parse', '--verify', 'origin/main'])) return 'origin/main';
  if (gitOk(root, ['rev-parse', '--verify', 'main'])) return 'main';
  return 'HEAD';
}

function aheadCount(root, branch, base) {
  const out = gitOk(root, ['rev-list', '--count', `${base}..${branch}`]);
  return out ? Number(out) : 0;
}

function isDirty(path) {
  return gitOk(path, ['status', '--porcelain']) !== '';
}

function slugFromPath(root, path) {
  for (const dir of agentRoots(root)) {
    if (isInside(dir, path) && resolve(dir) !== resolve(path)) {
      return normalize(relative(dir, path)).split(/[\\/]/)[0];
    }
  }
  return '';
}

function resolveTarget(root, slugOrPath) {
  if (!slugOrPath) throw new Error('usage: remove <slug-or-path>');
  if (existsSync(slugOrPath) && statSync(slugOrPath).isDirectory()) {
    return resolve(slugOrPath);
  }
  return worktreePath(root, slugOrPath);
}

function mergedPrHeads() {
  try {
    const raw = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'merged', '--limit', '100', '--json', 'headRefName'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const rows = JSON.parse(raw);
    return new Set((rows || []).map((r) => r.headRefName).filter(Boolean));
  } catch {
    return null;
  }
}

function create(root, rawSlug) {
  const slug = sanitizeSlug(rawSlug);
  const path = worktreePath(root, slug);
  const branch = branchName(slug);
  const trees = listTrees(root);

  if (trees.some((t) => resolve(t.worktree) === resolve(path))) {
    throw new Error(`worktree already exists: ${path}`);
  }
  if (existsSync(path)) {
    throw new Error(`path already exists: ${path}`);
  }
  if (trees.some((t) => t.branch === branch)) {
    throw new Error(`branch ${branch} is already checked out in another worktree`);
  }
  if (gitOk(root, ['rev-parse', '--verify', `refs/heads/${branch}`])) {
    throw new Error(`branch ${branch} already exists — pick a different slug`);
  }

  const base = defaultBase(root);
  git(root, ['worktree', 'add', '-b', branch, path, base]);
  return { path, branch, base };
}

function remove(root, slugOrPath, { force = false } = {}) {
  const path = resolveTarget(root, slugOrPath);
  if (!isAgentWorktreePath(root, path)) {
    throw new Error(`refusing to remove ${path} — not an agent worktree under ${AGENT_DIR}/`);
  }

  const trees = listTrees(root);
  const entry = trees.find((t) => resolve(t.worktree) === resolve(path));
  const branch = entry?.branch;

  if (entry?.locked && !force) {
    throw new Error(`worktree is locked: ${path} (another session may own it)`);
  }
  if (existsSync(path) && isDirty(path) && !force) {
    throw new Error(`worktree is dirty: ${path} (pass --force to discard)`);
  }

  if (entry) {
    gitOk(root, ['worktree', 'unlock', path]);
    try {
      git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), path]);
    } catch (err) {
      if (!force) throw err;
      git(root, ['worktree', 'remove', '--force', path]);
    }
  } else if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
  gitOk(root, ['worktree', 'prune']);

  if (branch?.startsWith(BRANCH_PREFIX) && gitOk(root, ['rev-parse', '--verify', `refs/heads/${branch}`])) {
    const base = defaultBase(root);
    const unique = aheadCount(root, branch, base);
    if (unique === 0 || force) {
      gitOk(root, ['branch', '-D', branch]);
    } else {
      console.warn(`kept local branch ${branch} (${unique} commit(s) not on ${base})`);
    }
  }
  return { path, branch };
}

function formatList(root) {
  const main = resolve(root);
  const lines = [];
  for (const t of listTrees(root)) {
    const path = t.worktree;
    const branch = t.branch || '(detached)';
    const mine = isAgentWorktreePath(root, path) || resolve(path) === main;
    const flags = [
      resolve(path) === main ? 'main' : '',
      t.locked ? 'locked' : '',
      existsSync(path) && isDirty(path) ? 'dirty' : '',
    ].filter(Boolean);
    if (!mine && !isInside(root, path)) continue;
    const slug = slugFromPath(root, path);
    lines.push(`  ${slug || (resolve(path) === main ? '(main)' : path)}  ${branch}  ${path}${flags.length ? `  [${flags.join(', ')}]` : ''}`);
  }
  return lines;
}

function status(root) {
  const cwd = resolve(process.cwd());
  const here = listTrees(root).find((t) => resolve(t.worktree) === cwd);
  const agent = formatList(root).filter((l) => !l.includes('  (main)  '));
  const lines = [
    `checkout: ${cwd}  [${here?.branch || gitOk(cwd, ['branch', '--show-current']) || 'unknown'}]`,
    here && isAgentWorktreePath(root, cwd)
      ? 'this session is already in an agent worktree'
      : 'this session is on the main checkout — create a worktree before editing',
    `agent worktrees (${agent.length}):`,
    ...(agent.length ? agent : ['  (none)']),
  ];
  return lines.join('\n');
}

function prune(root, { merged = false } = {}) {
  gitOk(root, ['worktree', 'prune']);
  const trees = listTrees(root).filter((t) => isAgentWorktreePath(root, t.worktree));
  if (!merged) {
    return {
      removed: [],
      leftover: trees.map((t) => t.worktree),
      note: trees.length
        ? 'pass --merged to drop clean agent worktrees whose PR is merged; otherwise npm run worktree:remove -- <slug>'
        : '0 agent worktrees — nothing to remove',
    };
  }
  const heads = mergedPrHeads();
  if (!heads) {
    throw new Error('prune --merged needs gh (GitHub CLI) to confirm merged PRs');
  }
  const base = defaultBase(root);
  const removed = [];
  for (const t of trees) {
    const dirty = existsSync(t.worktree) && isDirty(t.worktree);
    const ahead = t.branch ? aheadCount(root, t.branch, base) : 1;
    if (!shouldRemoveOnPrune({
      dirty,
      locked: Boolean(t.locked),
      aheadCount: ahead,
      prMerged: heads.has(t.branch),
    })) continue;
    remove(root, t.worktree, { force: false });
    removed.push(t.worktree);
  }
  return { removed, leftover: listTrees(root).filter((t) => isAgentWorktreePath(root, t.worktree)).map((t) => t.worktree) };
}

function usage() {
  console.error(`Usage:
  node scripts/worktree.mjs create <slug>
  node scripts/worktree.mjs remove <slug-or-path> [--force]
  node scripts/worktree.mjs list
  node scripts/worktree.mjs status
  node scripts/worktree.mjs prune [--merged]`);
  process.exit(1);
}

function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  if (!cmd) usage();
  const root = repoRoot();
  if (cmd === 'create') {
    const slug = argv[1];
    if (!slug) usage();
    const result = create(root, slug);
    console.log(`Created worktree\n  path: ${result.path}\n  branch: ${result.branch}\n  base: ${result.base}\nWORKTREE=${result.path}`);
    return;
  }
  if (cmd === 'remove') {
    const target = argv.find((a) => a !== 'remove' && a !== '--force' && !a.startsWith('-')) || argv[1];
    const force = argv.includes('--force');
    if (!target || target === '--force') usage();
    const result = remove(root, target, { force });
    console.log(`Removed worktree ${result.path}${result.branch ? ` [${result.branch}]` : ''}`);
    return;
  }
  if (cmd === 'list') {
    const lines = formatList(root);
    console.log(lines.length ? lines.join('\n') : '  (no worktrees)');
    return;
  }
  if (cmd === 'status') {
    console.log(status(root));
    return;
  }
  if (cmd === 'prune') {
    const result = prune(root, { merged: argv.includes('--merged') });
    if (result.removed.length) {
      console.log(`Removed ${result.removed.length} merged worktree(s):`);
      for (const p of result.removed) console.log(`  ${p}`);
    }
    if (result.note) console.log(result.note);
    else if (result.leftover.length) {
      console.log(`Left ${result.leftover.length} agent worktree(s):`);
      for (const p of result.leftover) console.log(`  ${p}`);
    }
    return;
  }
  usage();
}

const invoked =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invoked) {
  try {
    main();
  } catch (err) {
    const msg = err.stderr ? String(err.stderr).trim() : err.message;
    console.error(msg || err);
    process.exit(1);
  }
}
