#!/usr/bin/env node
/**
 * Create and clean up agent git worktrees.
 *
 *   node scripts/worktree.mjs create <slug>
 *   node scripts/worktree.mjs remove <slug-or-path> [--force]
 *   node scripts/worktree.mjs list
 *   node scripts/worktree.mjs status
 *   node scripts/worktree.mjs preserve [--dry-run]
 *   node scripts/worktree.mjs prune [--merged]
 *
 * Worktrees live under `.claude/worktrees/<slug>` on branch `worktree-<slug>`,
 * cut from `origin/main` (local `main` if the remote ref is missing).
 * `remove` is the session-end command: it drops the worktree and its
 * `worktree-*` branch (local, and origin when empty/merged/discarded).
 * `prune` deletes leftover `worktree-*` branches that have no worktree and
 * are 0 commits ahead of main. `prune --merged` also drops clean agent
 * worktrees whose GitHub PR already merged.
 *
 * Windows: never recursive-rm a worktree. NTFS junctions (npm/pnpm
 * `node_modules`) are followed by `rm -rf` / `Remove-Item -Recurse` /
 * `fs.rmSync({recursive})` and can delete files *outside* the worktree.
 * This script uses `git worktree remove`, then `cmd /c rmdir /S /Q` for
 * leftover dirs. Dispatched `isolation: worktree` also leaves CWD on the
 * primary checkout on this host — work in the absolute `WORKTREE=` path.
 */
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from './lib/git-env.mjs';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

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

export function isProtectedBranch(name) {
  const n = String(name || '');
  if (!n || n === 'main' || n === 'master' || n === 'develop' || n === 'dev') return true;
  return n.startsWith('wip/');
}

export function isAgentBranch(name) {
  return String(name || '').startsWith('worktree-');
}

/** The archive ref a branch is preserved under, so a reclaimed container
 *  cannot take unpushed work with it. */
export function archiveRefFor(name) {
  return `archive/${String(name || '').replace(/^archive\//, '')}`;
}

/** Does this branch hold work that exists nowhere but this disk?
 *
 *  Deliberately NOT limited to `worktree-*`. The branches that went unprotected
 *  for a week were `slice-h14`, `slice-h18` and friends — created by workflow
 *  fan-out, never matched by `isAgentBranch`, so `prune`'s "still has unique
 *  commits" guard never even considered them (#803).
 *
 *  Deliberately NOT isProtectedBranch either. Protecting a branch from DELETION
 *  is a different question from excluding it from PRESERVATION: `wip/*` is
 *  protected from deletion precisely because it is where unfinished work is
 *  parked, which makes it the branch most likely to hold the only copy of
 *  something. `main` is the same — local commits on main are unpushed work.
 *  The only exclusion is an archive ref itself, which is the preservation
 *  rather than the work.
 *
 *  `archivedSha` is the remote `archive/<name>` tip, or '' when there is none.
 *  Comparing tips rather than mere existence is what makes this re-runnable: a
 *  branch that gains a commit after being archived is at risk again.
 *
 *  Deliberately conservative: `aheadCount` counts commits, so a branch whose
 *  work reached main through a SQUASH merge still looks ahead and is archived
 *  again. That false positive costs one ref; the false negative costs the work.
 *  Do not make this cleverer by testing whether the content landed — patch-ids
 *  differ after a squash and `git branch --merged` lies for the same reason,
 *  and getting it wrong deletes the only copy. */
export function needsPreserving({ name, aheadCount, tipSha, archivedSha }) {
  const n = String(name || '');
  if (!n) return false;
  if (n.startsWith('archive/')) return false;
  if (Number(aheadCount) === 0) return false;
  if (!tipSha) return false;
  return String(archivedSha || '') !== String(tipSha);
}

/** What actually went wrong, for a report that has to be actionable.
 *
 *  git puts the useful part (non-fast-forward, auth, hook rejection) on stderr;
 *  err.message is only "Command failed: git push ...". Reporting the message
 *  alone says a rescue failed but never why. */
export function failureReason(err) {
  const detail = String(err?.stderr || '').trim();
  const text = detail || String(err?.message || err || '').trim();
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' | ');
}

export function shouldDeleteBranch({ name, aheadCount, hasWorktree, prMerged, force }) {
  if (isProtectedBranch(name)) return false;
  if (hasWorktree && !force) return false;
  if (force || prMerged) return true;
  return Number(aheadCount) === 0;
}

/** Drop a directory without following NTFS junctions into their targets. */
export function removeDirSafe(dir) {
  if (!existsSync(dir)) return;
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/c', 'rmdir', '/S', '/Q', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return;
  }
  rmSync(dir, { recursive: true, force: true });
}

function git(cwd, args, opts = {}) {
  // An inherited GIT_DIR outranks `cwd`, so a hook-spawned run would
  // silently operate on the hook's repository. See scripts/lib/git-env.mjs.
  return execFileSync('git', args, {
    cwd,
    env: scrubGitEnv(),
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

function localBranches(root) {
  const out = gitOk(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function branchHasWorktree(root, name) {
  return listTrees(root).some((t) => t.branch === name);
}

function remoteHasBranch(root, name) {
  return gitOk(root, ['ls-remote', '--heads', 'origin', name]) !== '';
}

function switchOffBranch(root, name) {
  if (gitOk(root, ['branch', '--show-current']) !== name) return;
  if (isDirty(root)) {
    throw new Error(`cannot delete checked-out branch ${name} while the working tree is dirty`);
  }
  if (gitOk(root, ['rev-parse', '--verify', 'main'])) {
    git(root, ['switch', '-q', 'main']);
    return;
  }
  git(root, ['switch', '-q', '--detach', 'HEAD']);
}

function deleteAgentBranch(root, name, { force = false, prMerged = false } = {}) {
  if (!name || isProtectedBranch(name)) return { deleted: false, remote: false };
  const hasWorktree = branchHasWorktree(root, name);
  const ahead = aheadCount(root, name, defaultBase(root));
  if (!shouldDeleteBranch({ name, aheadCount: ahead, hasWorktree, prMerged, force })) {
    return { deleted: false, remote: false };
  }
  switchOffBranch(root, name);
  gitOk(root, ['branch', '-D', name]);
  let remote = false;
  if (remoteHasBranch(root, name)) {
    gitOk(root, ['push', 'origin', '--delete', name]);
    gitOk(root, ['fetch', 'origin', '--prune']);
    remote = true;
  }
  return { deleted: true, remote };
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
    removeDirSafe(path);
  }
  gitOk(root, ['worktree', 'prune']);

  const deleted = branch
    ? deleteAgentBranch(root, branch, { force })
    : { deleted: false, remote: false };
  return { path, branch, branchDeleted: deleted.deleted, remoteDeleted: deleted.remote };
}

function formatList(root) {
  const main = resolve(root);
  const lines = [];
  for (const t of listTrees(root)) {
    const path = t.worktree;
    const flags = [
      resolve(path) === main ? 'primary' : '',
      t.locked ? 'locked' : '',
      existsSync(path) && isDirty(path) ? 'dirty' : '',
    ].filter(Boolean);
    const slug = slugFromPath(root, path);
    const label = slug || (resolve(path) === main ? '(primary)' : path);
    lines.push(`  ${label}  ${t.branch || '(detached)'}  ${path}${flags.length ? `  [${flags.join(', ')}]` : ''}`);
  }
  return lines;
}

function leftoverAgentBranches(root) {
  const checkedOut = new Set(listTrees(root).map((t) => t.branch).filter(Boolean));
  return localBranches(root).filter((name) => isAgentBranch(name) && !checkedOut.has(name));
}

function status(root) {
  const cwd = resolve(process.cwd());
  const here = listTrees(root).find((t) => resolve(t.worktree) === cwd);
  const agent = formatList(root).filter((l) => !l.includes('  (primary)  '));
  const leftover = leftoverAgentBranches(root);
  const lines = [
    `checkout: ${cwd}  [${here?.branch || gitOk(cwd, ['branch', '--show-current']) || 'unknown'}]`,
    here && isAgentWorktreePath(root, cwd)
      ? 'this session is already in an agent worktree'
      : 'this session is in the primary checkout — create a worktree before editing',
    `agent worktrees (${agent.length}):`,
    ...(agent.length ? agent : ['  (none)']),
    `leftover agent branches (${leftover.length}):`,
    ...(leftover.length ? leftover.map((b) => `  ${b}`) : ['  (none)']),
  ];
  return lines.join('\n');
}

function prune(root, { merged = false } = {}) {
  gitOk(root, ['worktree', 'prune']);
  const trees = listTrees(root).filter((t) => isAgentWorktreePath(root, t.worktree));
  const heads = merged ? mergedPrHeads() : new Set();
  if (merged && heads === null) {
    throw new Error('prune --merged needs gh (GitHub CLI) to confirm merged PRs');
  }
  const removed = [];
  if (merged) {
    const base = defaultBase(root);
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
  }

  const deletedBranches = [];
  for (const name of localBranches(root)) {
    if (!isAgentBranch(name)) continue;
    const result = deleteAgentBranch(root, name, {
      prMerged: heads instanceof Set && heads.has(name),
      force: false,
    });
    if (result.deleted) deletedBranches.push(name);
  }

  const leftoverTrees = listTrees(root).filter((t) => isAgentWorktreePath(root, t.worktree));
  return {
    removed,
    deletedBranches,
    leftover: leftoverTrees.map((t) => t.worktree),
    leftoverBranches: leftoverAgentBranches(root),
    note: leftoverTrees.length
      ? 'npm run worktree:remove -- <slug> to drop a worktree this session owns'
      : leftoverAgentBranches(root).length
        ? 'leftover agent branches still have unique commits — not pruned'
        : '0 agent worktrees — nothing to remove',
  };
}

/** Remote `archive/*` tips, keyed by the branch name they preserve. */
function remoteArchives(root) {
  const out = gitOk(root, ['ls-remote', '--heads', 'origin', 'refs/heads/archive/*']);
  const map = new Map();
  for (const line of (out || '').split(/\r?\n/)) {
    const [sha, ref] = line.split(/\s+/);
    if (!sha || !ref) continue;
    map.set(ref.replace('refs/heads/archive/', ''), sha);
  }
  return map;
}

/** Push every branch holding work that exists nowhere but this disk.
 *
 *  Never deletes and never force-pushes: preserving is not tidying, and a
 *  rescue that can lose the thing it rescues is worse than none. A branch
 *  already archived at its tip is skipped, so this is cheap on every session
 *  start and on a timer. */
function preserve(root, { dryRun = false } = {}) {
  const base = defaultBase(root);
  const archives = remoteArchives(root);
  const preserved = [];
  const alreadySafe = [];
  const failed = [];

  for (const name of localBranches(root)) {
    const tipSha = gitOk(root, ['rev-parse', name]);
    const ahead = aheadCount(root, name, base);
    const archivedSha = archives.get(name) || '';
    if (!needsPreserving({ name, aheadCount: ahead, tipSha, archivedSha })) {
      if (ahead > 0 && archivedSha === tipSha && tipSha) alreadySafe.push(name);
      continue;
    }
    if (dryRun) {
      preserved.push({ name, ahead, dryRun: true });
      continue;
    }
    const ref = archiveRefFor(name);
    // --no-verify because the pre-push hook demands the review/CI gate, and a
    // rescue must not be blocked by one. Found by running this for real: the
    // hook refused the archive push, so preserve failed exactly when there was
    // unreviewed work in progress — precisely when the only copy of something
    // is on this disk. An `archive/*` ref is a backup: never merged, never
    // deployed (it is in AGENT_PREVIEW_BRANCH), never a code submission.
    //
    // Checked before bypassing it: `.husky/pre-push` runs
    // `scripts/ci/pre-push.mjs` and nothing else — it routes local CI versus
    // GitHub Actions to save credits and enforces the review stamp. No secret
    // scanning, no credential check, nothing security-relevant is skipped. The
    // hook documents its own escape hatch (`HUSKY=0 git push`); --no-verify is
    // the same thing without assuming husky is the hook manager.
    //
    // Not gitOk: it swallows a failure into '', and a successful push writes to
    // stderr with an empty stdout, so the two are indistinguishable by return
    // value. A rescue that reports success for a push that did not happen is
    // worse than no rescue, so let git throw and catch it.
    try {
      git(root, ['push', '--no-verify', 'origin', `refs/heads/${name}:refs/heads/${ref}`]);
      preserved.push({ name, ahead, ref });
      continue;
    } catch (err) {
      // A rebased or amended branch is not a fast-forward of what was archived
      // before, so the plain push is rejected and the NEW work would never be
      // preserved. Force-pushing would fix that by destroying the older copy,
      // which is the one thing this must never do. Push to a sha-suffixed ref
      // instead: both copies survive and neither is a lie.
      const fallback = `${ref}-${String(tipSha).slice(0, 9)}`;
      try {
        git(root, ['push', '--no-verify', 'origin', `refs/heads/${name}:refs/heads/${fallback}`]);
        preserved.push({ name, ahead, ref: fallback, diverged: true });
        continue;
      } catch {
        // fall through and report the original failure, which is the useful one
      }
      failed.push({ name, ahead, ref, reason: failureReason(err) });
    }
  }

  return { preserved, alreadySafe, failed, base };
}

function usage() {
  console.error(`Usage:
  node scripts/worktree.mjs create <slug>
  node scripts/worktree.mjs remove <slug-or-path> [--force]
  node scripts/worktree.mjs list
  node scripts/worktree.mjs status
  node scripts/worktree.mjs preserve [--dry-run]
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
    if (result.branchDeleted) {
      console.log(`Deleted branch ${result.branch}${result.remoteDeleted ? ' (local + origin)' : ' (local)'}`);
    } else if (result.branch) {
      console.log(`Kept branch ${result.branch} (unique commits still not on main)`);
    }
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
  if (cmd === 'preserve') {
    const dryRun = argv.includes('--dry-run');
    const result = preserve(root, { dryRun });
    if (result.preserved.length) {
      const label = dryRun ? 'would preserve' : 'preserved';
      console.log(`${label} ${result.preserved.length} branch(es) holding work only on this disk:`);
      for (const p of result.preserved) {
        console.log(`  ${p.name} (+${p.ahead}) -> ${p.ref || archiveRefFor(p.name)}`);
      }
    }
    if (result.alreadySafe.length) {
      console.log(`already archived (${result.alreadySafe.length}): ${result.alreadySafe.join(', ')}`);
    }
    if (result.failed.length) {
      console.error(`FAILED to preserve ${result.failed.length} branch(es) — this work is still only on this disk:`);
      for (const f of result.failed) console.error(`  ${f.name}: ${f.reason}`);
      return 1;
    }
    if (!result.preserved.length && !result.alreadySafe.length) {
      console.log('nothing to preserve — every local branch is on the remote');
    }
    return 0;
  }
  if (cmd === 'prune') {
    const result = prune(root, { merged: argv.includes('--merged') });
    if (result.deletedBranches.length) {
      console.log(`Deleted ${result.deletedBranches.length} leftover agent branch(es):`);
      for (const b of result.deletedBranches) console.log(`  ${b}`);
    }
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
    // main() returns a meaningful code for `preserve` (1 when a rescue failed).
    // Discarding it made a failed rescue exit 0, so npm, the SessionStart hook
    // and every other caller read "nothing was saved" as success — the exact
    // failure this command exists to prevent. Other commands return undefined.
    process.exitCode = main() ?? 0;
  } catch (err) {
    const msg = err.stderr ? String(err.stderr).trim() : err.message;
    console.error(msg || err);
    process.exit(1);
  }
}
