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
 *   readStampTrailers(cwd, { range } | { ref, limit })
 *   findStamp(cwd, { key, range, diffHash })
 *   preferMatchingStamp({ trailer, file, diffHash })
 *   readStampFile(path)
 *   publishStamps({ cwd, stamps, subject })
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Same 256 MB cap as scripts/lib/{local-ci-pass,matt-review}.mjs, and for the
 * same reason: `git log` over a branch range captures every commit message in
 * it, and this repo's messages are long enough to blow past Node's 1 MB
 * default. CI hit exactly that — `spawnSync git ENOBUFS` — and the range read
 * returned nothing, which every caller renders as "stamp missing".
 */
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

function git(cwd, args, opts = {}) {
  // An inherited GIT_DIR outranks `cwd`, so a hook-spawned run would silently
  // operate on the hook's repository. See scripts/lib/git-env.mjs.
  return execFileSync('git', args, {
    cwd,
    env: scrubGitEnv(),
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
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
 * Trailer-shaped line: a key, a colon, then the value. Deliberately loose on
 * the key — a foreign trailer (`Signed-off-by`, `Co-authored-by`) still counts
 * as part of the block, it just is not one of ours.
 */
const TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/;

/**
 * The message's trailing trailer paragraph, or [].
 *
 * Scanning the *whole* message for a `Key: {json}` line was wrong: any commit
 * that merely quotes the stamp format — a doc commit explaining it, or a
 * squash-merge that concatenates a PR description containing an example —
 * parsed as a genuine stamp. (docs/agents/ci.md's own worked example is
 * exactly that shape.) Git's rule is the one that holds: trailers are the
 * final paragraph, so the block must run to the end of the message and be
 * preceded by a blank line.
 */
function trailerBlock(message) {
  const lines = String(message).replace(/\s+$/, '').split('\n');
  let start = lines.length;
  while (start > 0 && TRAILER_LINE.test(lines[start - 1])) start -= 1;
  if (start === lines.length) return []; // the message does not end in trailers
  if (start === 0) return []; // all trailers and no subject is not a commit message
  if (lines[start - 1].trim() !== '') return []; // not a paragraph of its own
  return lines.slice(start);
}

/**
 * Stamps carried by one commit message. A key that is absent, or whose value
 * is not parseable JSON, reads as null — an unreadable stamp proves nothing,
 * and every caller already fails closed on null.
 */
export function parseStampTrailers(message = '') {
  const found = Object.fromEntries(STAMP_TRAILERS.map((key) => [key, null]));
  for (const line of trailerBlock(message)) {
    const [, key, value] = line.match(TRAILER_LINE);
    if (!STAMP_TRAILERS.includes(key)) continue;
    try {
      found[key] = JSON.parse(value);
    } catch {
      found[key] = null;
    }
  }
  return found;
}

/**
 * Every stamp-carrying commit in `range`, newest first. `range` is a git
 * revision range — `stampRange()` builds the one callers want.
 *
 * A stamp is only read from a commit that carries no diff of its own, because
 * that is what `publishStamps` writes and what makes a stamp safe: an empty
 * commit cannot have moved the `diffHash` it certifies. It is also the second
 * half of the answer to a commit that merely quotes the trailer format — such
 * a commit has content, so its trailers are not stamps.
 */
export function readStampTrailers(cwd, { range, ref, limit } = {}) {
  const selector = range ? [range] : ref ? ['-n', String(limit ?? 200), ref] : null;
  if (!selector) return [];
  let out = '';
  try {
    out = git(cwd, ['log', `--format=%H${FS}%T${FS}%P${FS}%B${RS}`, ...selector]);
  } catch (err) {
    // Said out loud, not swallowed. A stamp that cannot be read is reported as
    // "missing", which is indistinguishable from one that was never published —
    // and that ambiguity cost a CI round to diagnose. Still non-fatal: the
    // caller falls back, and a stamp nobody can read never skips a job.
    process.stderr.write(
      `stamp-trailer: could not read ${selector.join(' ')} — ${err?.message?.split('\n')[0] || err}\n`,
    );
    return [];
  }
  const candidates = [];
  for (const record of out.split(RS)) {
    const [sha, tree, parents, message] = record.replace(/^\s+/, '').split(FS);
    if (!sha || message == null) continue;
    const parentShas = (parents || '').split(' ').filter(Boolean);
    if (parentShas.length !== 1) continue; // a root or a merge is never a stamp
    const stamps = parseStampTrailers(message);
    if (!STAMP_TRAILERS.some((key) => stamps[key] != null)) continue;
    candidates.push({ sha, tree, parent: parentShas[0], stamps });
  }
  // Resolved one at a time on purpose. Batching the rev-parse made a single
  // unresolvable parent — a truncated clone, a missing object — discard every
  // candidate in the range rather than just its own, which is fail-closed but
  // throws away healthy stamps alongside the bad one.
  return candidates
    .filter((c) => c.tree === treeOf(cwd, c.parent))
    .map(({ sha, stamps }) => ({ sha, stamps }));
}

function treeOf(cwd, sha) {
  try {
    return git(cwd, ['rev-parse', `${sha}^{tree}`]).trim();
  } catch {
    return null;
  }
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
export function findStamp(cwd, { key, range, diffHash, ref = 'HEAD', limit = 200 } = {}) {
  const pick = (entries) => {
    const carrying = entries.filter((e) => e.stamps[key] != null);
    if (!carrying.length) return null;
    if (diffHash) {
      const exact = carrying.find((e) => e.stamps[key].diffHash === diffHash);
      if (exact) return exact.stamps[key];
    }
    return carrying[0].stamps[key];
  };

  const inRange = pick(readStampTrailers(cwd, { range }));
  if (inRange && (!diffHash || inRange.diffHash === diffHash)) return inRange;

  // The range is an optimization, not the guarantee — `diffHash` is. Deriving
  // it needs a merge-base against the base ref, which is exactly the thing a
  // shallow or partially-fetched CI checkout can fail to give, and losing it
  // must not read as "this branch published no stamp". Walking back from HEAD
  // needs no base ref at all; a stamp for another diff is still inert.
  return pick(readStampTrailers(cwd, { ref, limit })) ?? inRange;
}

/**
 * The sequencer states that leave HEAD standing somewhere other than where
 * the branch is going. Publishing into any of them writes a stamp into a
 * history that is still being rewritten — mid-merge it lands ahead of a merge
 * that has not happened, and mid-rebase it lands on a detached replay that the
 * finished branch may not even contain.
 */
const IN_PROGRESS_REFS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD'];
const IN_PROGRESS_DIRS = ['rebase-merge', 'rebase-apply'];

function sequencerInProgress(cwd) {
  for (const ref of IN_PROGRESS_REFS) {
    try {
      git(cwd, ['rev-parse', '--verify', '--quiet', ref]);
      return ref;
    } catch {
      // not this one
    }
  }
  for (const dir of IN_PROGRESS_DIRS) {
    try {
      if (existsSync(git(cwd, ['rev-parse', '--git-path', dir]).trim())) return dir;
    } catch {
      // no git dir to ask about
    }
  }
  return null;
}

/**
 * A stamp read from the local cache file. Shared so the two stamp modules do
 * not each carry their own copy of "parse this JSON, null on any failure".
 */
export function readStampFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Whether this repository signs its commits, as `git commit` would read it. */
function signingEnabled(cwd) {
  try {
    return git(cwd, ['config', '--bool', 'commit.gpgsign']).trim() === 'true';
  } catch {
    // `git config` exits 1 for an unset key — unset means do not sign.
    return false;
  }
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
  const pending = sequencerInProgress(cwd);
  if (pending) {
    throw new Error(
      `stamp-trailer: ${pending} is in progress — finish or abort it before publishing a stamp`,
    );
  }
  const tree = git(cwd, ['rev-parse', 'HEAD^{tree}']).trim();
  // `commit-tree` is plumbing: unlike `git commit` it ignores `commit.gpgsign`,
  // so without this every stamp commit landed Unverified in a repo that signs.
  const sign = signingEnabled(cwd) ? ['-S'] : [];
  const sha = git(cwd, ['commit-tree', tree, '-p', 'HEAD', ...sign, '-F', '-'], {
    input: message,
  }).trim();
  git(cwd, ['update-ref', '-m', `commit: ${subject}`, 'HEAD', sha]);
  return sha;
}
