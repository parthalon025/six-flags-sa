/**
 * Did a test leg rewrite tracked files?
 *
 * A suite that mutates tracked state leaves the working tree dirty after every
 * run, which trains everyone — human and agent — to read a dirty tree as noise
 * and `git checkout --` it away unread. A real unintended change riding
 * alongside gets discarded by the same reflex (#34). It also means the suite's
 * second run starts from different inputs than its first.
 *
 * The gate is a before/after comparison rather than a "tree must be clean"
 * assertion, because the tree it runs in is a developer's, and their own
 * in-progress edits are not the thing being caught.
 *
 * Interface:
 *   trackedTreeSnapshot(cwd)         → Map<path, status> | null when git is unreadable
 *   treeMutationReason(before, after)→ operator-facing string, or null
 *   uncommittedWorkReason(cwd)       → operator-facing string, or null when tree is clean
 */
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from './git-env.mjs';

/**
 * Tracked-file status by path. Untracked files are excluded: a suite writing a
 * new scratch file is a different (and cheaper) problem than one rewriting
 * committed builder input.
 */
export function trackedTreeSnapshot(cwd = process.cwd()) {
  let out;
  try {
    out = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd,
      // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
      env: scrubGitEnv(),
      encoding: 'utf8',
      // Outside a checkout git writes to stderr before exiting non-zero; the
      // null return is the answer, the noise is not.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const snapshot = new Map();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    // Porcelain v1: two status columns, a space, then the path.
    snapshot.set(line.slice(3).trim(), line.slice(0, 2));
  }
  return snapshot;
}

/**
 * Fail-closed guard for pre-merge-vertical: the gate plans from commits, so
 * uncommitted work in the tree is work the run cannot certify (#35).
 *
 * @param {string} [cwd]
 * @returns {string|null}
 */
export function uncommittedWorkReason(cwd = process.cwd()) {
  let out;
  try {
    out = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      env: scrubGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [
      'the working tree could not be read',
      'Commit first — pre-merge-vertical plans from the committed diff only.',
    ].join(' ');
  }
  const lines = out.split('\n').filter((line) => line.trim());
  if (!lines.length) return null;
  const paths = lines.map((line) => line.slice(3).trim());
  return [
    'the working tree has uncommitted changes the gate did not prove',
    `(${paths.length} path(s): ${paths.join(', ')})`,
    'Commit first — pre-merge-vertical plans from the committed diff only.',
  ].join(' ');
}

/**
 * @param {Map<string,string>|null} before
 * @param {Map<string,string>|null} after
 * @returns {string|null} why the run is refused, or null when nothing changed
 */
export function treeMutationReason(before, after) {
  if (!before || !after) return null;
  const touched = [];
  for (const [file, status] of after) {
    if (before.get(file) !== status) touched.push(file);
  }
  for (const file of before.keys()) {
    if (!after.has(file)) touched.push(file);
  }
  if (!touched.length) return null;
  const list = [...new Set(touched)].sort();
  return [
    `the test legs rewrote ${list.length} tracked file(s): ${list.join(', ')}`,
    'A suite must not mutate tracked state — inject the sink (or the clock) the',
    'writing code path uses, rather than gitignoring the file or reverting it in',
    'a teardown, both of which keep the write and only hide it. See ticket 34.',
  ].join('\n  ');
}
