/**
 * CI stamps as commit trailers — the transport that cannot conflict.
 *
 * Both gate stamps (`local-ci-verified` and matt-review) are *regenerated on
 * every branch*, so while they travelled as tracked JSON files any two
 * branches modified the same two files and every merge from main raised a
 * conflict on them. `.gitattributes merge=keep-ours` only ever hid that
 * locally: a merge driver is a shell command registered in `.git/config`, so
 * GitHub's server-side merge never runs one and reported the PR unmergeable
 * anyway.
 *
 * The fix is transport, not resolution. A stamp now rides in a trailer on an
 * empty commit:
 *
 *     chore(ci): publish CI stamps
 *
 *     Local-Ci-Pass: {"schema":3,…}
 *     Matt-Review-Pass: {"schema":1,…}
 *
 * Commit messages are per-commit facts, never merged, so no merge path can
 * produce a conflict. The commit is empty, so it cannot move `diffHash`
 * either — the property the tracked file needed a `:(exclude)` pathspec to
 * fake. Reading stays evidence-based: `diffHash` still decides whether a
 * stamp covers the tree, so a trailer merged in from another branch is
 * inert rather than trusted.
 *
 * Interface:
 *   LOCAL_CI_TRAILER / MATT_REVIEW_TRAILER / STAMP_TRAILERS
 *   stampRange({ mergeBase, headRef })
 *   buildStampMessage({ subject, stamps })
 *   parseStampTrailers(message)
 *   readStampTrailers(cwd, { range })
 *   findStamp(cwd, { key, range, diffHash })
 *   preferMatchingStamp({ trailer, file, diffHash })
 *   publishStamps({ cwd, stamps, subject })
 */
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from './git-env.mjs';

export const LOCAL_CI_TRAILER = 'Local-Ci-Pass';
export const MATT_REVIEW_TRAILER = 'Matt-Review-Pass';
export const STAMP_TRAILERS = [LOCAL_CI_TRAILER, MATT_REVIEW_TRAILER];

export const STAMP_SUBJECT_DEFAULT = 'chore(ci): publish CI stamps';

/** ASCII record/field separators — a commit message may contain anything else. */
const RS = '\x1e';
const FS = '\x1f';

/** How far back a stamp may be read: this branch's own commits, newest first. */
export function stampRange({ mergeBase, headRef = 'HEAD' } = {}) {
  if (!mergeBase) return null;
  return `${mergeBase}..${headRef}`;
}

function git(cwd, args, opts = {}) {
  // An inherited GIT_DIR outranks `cwd`, so a hook-spawned run would silently
  // operate on the hook's repository. See scripts/lib/git-env.mjs.
  return execFileSync('git', args, {
    cwd,
    env: scrubGitEnv(),
    encoding: 'utf8',
    ...opts,
  });
}

/**
 * The commit message a stamp commit carries. `stamps` is keyed by trailer
 * name; entries whose value is null or undefined are left out, so publishing
 * only the review stamp does not blank the CI one.
 */
export function buildStampMessage({ subject = STAMP_SUBJECT_DEFAULT, stamps = {} } = {}) {
  const lines = STAMP_TRAILERS.filter((key) => stamps[key] != null).map(
    (key) => `${key}: ${JSON.stringify(stamps[key])}`,
  );
  if (!lines.length) return null;
  return [
    subject,
    '',
    'Regenerated CI stamps ride in trailers so a merge can never conflict on',
    'them. Read by scripts/lib/stamp-trailer.mjs; see docs/agents/ci.md.',
    '',
    ...lines,
    '',
  ].join('\n');
}

/**
 * Trailers found in one commit message. A key that is absent, or whose value
 * is not parseable JSON, reads as null — an unreadable stamp proves nothing,
 * and every caller already fails closed on null.
 */
export function parseStampTrailers(message = '') {
  const found = {};
  for (const key of STAMP_TRAILERS) {
    const match = String(message).match(new RegExp(`^${key}:[ \\t]*(\\{.*\\})[ \\t]*$`, 'm'));
    if (!match) {
      found[key] = null;
      continue;
    }
    try {
      found[key] = JSON.parse(match[1]);
    } catch {
      found[key] = null;
    }
  }
  return found;
}

/**
 * Every stamp-carrying commit in `range`, newest first. `range` is a git
 * revision range — `stampRange()` builds the one callers want.
 */
export function readStampTrailers(cwd, { range } = {}) {
  if (!range) return [];
  let out = '';
  try {
    out = git(cwd, ['log', `--format=%H${FS}%B${RS}`, range]);
  } catch {
    // An unreadable range (shallow clone, missing base ref) is not an error
    // here: no trailer found means the caller falls back and CI runs in full.
    return [];
  }
  const entries = [];
  for (const record of out.split(RS)) {
    const [sha, message] = record.replace(/^\s+/, '').split(FS);
    if (!sha || message == null) continue;
    const stamps = parseStampTrailers(message);
    if (STAMP_TRAILERS.some((key) => stamps[key] != null)) entries.push({ sha, stamps });
  }
  return entries;
}

/**
 * The stamp to judge for this run.
 *
 * A range on a GitHub merge ref also contains whatever branches were merged
 * in, and those carry their own stamp trailers, so "newest wins" would let an
 * unrelated branch's stamp mask this branch's own. `diffHash` breaks the tie
 * by evidence: the newest stamp recorded *for this diff* wins, and the newest
 * of any kind is the fallback so the "stamp is for a different diff" message
 * still names something real.
 */
export function findStamp(cwd, { key, range, diffHash } = {}) {
  const entries = readStampTrailers(cwd, { range }).filter((e) => e.stamps[key] != null);
  if (!entries.length) return null;
  if (diffHash) {
    const exact = entries.find((e) => e.stamps[key].diffHash === diffHash);
    if (exact) return exact.stamps[key];
  }
  return entries[0].stamps[key];
}

/**
 * Which of the two transports to believe.
 *
 * A branch can hold both at once: a published trailer from an earlier run, and
 * a local cache file a re-run has just refreshed. Newest-wins would then hide
 * the fresh cache behind the stale trailer and demand a re-stamp for work
 * already done, so evidence decides first — whichever source records *this*
 * diff wins. With neither matching, the trailer is returned so the caller's
 * "stamp is for a different diff" message names what history actually holds.
 */
export function preferMatchingStamp({ trailer = null, file = null, diffHash } = {}) {
  if (diffHash) {
    if (trailer?.diffHash === diffHash) return trailer;
    if (file?.diffHash === diffHash) return file;
  }
  return trailer ?? file;
}

/**
 * Publish stamps as an empty commit on HEAD. Empty on purpose: the commit adds
 * no diff, so it cannot invalidate the very `diffHash` the stamps record.
 *
 * Commit hooks do not run: `commit-tree` is plumbing, and a commit that adds
 * no diff has nothing for a pre-commit hook to check.
 *
 * Returns the new commit's sha, or null when there was nothing to publish.
 */
export function publishStamps({ cwd, stamps = {}, subject = STAMP_SUBJECT_DEFAULT } = {}) {
  const message = buildStampMessage({ subject, stamps });
  if (!message) return null;
  // Built from HEAD's own tree rather than with `git commit --allow-empty`,
  // which commits the *index* — so a stamp published while anything was
  // staged (`git rm --cached`, a half-staged fix) swept that into the commit
  // and stopped being empty, which is the one property the stamp needs. This
  // reads neither the index nor the working tree.
  const tree = git(cwd, ['rev-parse', 'HEAD^{tree}']).trim();
  const sha = git(cwd, ['commit-tree', tree, '-p', 'HEAD', '-F', '-'], { input: message }).trim();
  git(cwd, ['update-ref', '-m', `commit: ${subject}`, 'HEAD', sha]);
  return sha;
}
