/**
 * Matt-review stamp — proof that a Sonnet standards-review subagent ran over
 * this branch's diff before merge. Findings stay advisory; the *run* is the
 * enforced part (same shape as local-ci-pass: stamp committed with the
 * branch, CI fails code PRs whose stamp is missing or stale).
 *
 * Interface:
 *   reviewRequiredForFiles(files)
 *   buildMattReviewContext({ baseRef, cwd })
 *   readMattReview(cwd) / writeMattReview({ context, model, gitnexus }, cwd)
 *   stampCoversReview(stamp, context)
 *   mattReviewBlockReason({ files, context, stamp })
 *   buildReviewPrompt({ files, diffStat })
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export const MATT_REVIEW_SCHEMA = 1;
export const MATT_REVIEW_REL = 'scripts/ci/matt-review-pass.json';
export const REVIEW_MODEL_DEFAULT = 'claude-sonnet-5';

/** Stamp files never count as reviewable code and never invalidate the diff hash. */
export const STAMP_EXCLUDES = [
  'scripts/ci/matt-review-pass.json',
  'scripts/ci/local-ci-pass.json',
];

const CODE_PATH =
  /^(apps|packages|scripts|test)\/|^\.github\/workflows\/|^(package\.json|package-lock\.json|eslint\.config\.mjs|\.dependency-cruiser\.cjs|turbo\.json|vercel\.json)$/;

/** Does this diff need a standards review? Unknown diffs fail closed. */
export function reviewRequiredForFiles(files) {
  if (files == null) return true;
  return files.some((f) => CODE_PATH.test(f) && !STAMP_EXCLUDES.includes(f));
}

/**
 * `maxBuffer` is explicit because one caller below captures the *whole* branch
 * patch in order to hash it. Node's default is 1 MB, so any branch whose diff
 * passed that — a large feature branch, or a small one that adds a binary
 * asset — died with `spawnSync git ENOBUFS`, uncaught, after the app build had
 * already run. 256 MB is far beyond any real review diff.
 */
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
}

/**
 * Hash of the branch diff vs merge-base, excluding the stamp files — so
 * committing a stamp never invalidates it, and any code change does.
 */
export function buildMattReviewContext({ baseRef = 'origin/main', cwd = root } = {}) {
  const mergeBase = git(['merge-base', 'HEAD', baseRef], cwd).trim();
  const excludes = STAMP_EXCLUDES.map((p) => `:(exclude)${p}`);
  const patch = git(['diff', `${mergeBase}...HEAD`, '--', '.', ...excludes], cwd);
  const files = git(['diff', '--name-only', `${mergeBase}...HEAD`, '--', '.', ...excludes], cwd)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    schema: MATT_REVIEW_SCHEMA,
    baseRef,
    mergeBase,
    diffHash: createHash('sha256').update(patch).digest('hex').slice(0, 16),
    files,
  };
}

export function mattReviewPath(cwd = root) {
  return join(cwd, MATT_REVIEW_REL);
}

export function readMattReview(cwd = root) {
  const path = mattReviewPath(cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function writeMattReview(
  { context, model = REVIEW_MODEL_DEFAULT, gitnexus = 'unavailable', recordedAt = new Date().toISOString() },
  cwd = root,
) {
  const stamp = {
    schema: MATT_REVIEW_SCHEMA,
    diffHash: context.diffHash,
    mergeBase: context.mergeBase,
    model,
    gitnexus,
    recordedAt,
  };
  const path = mattReviewPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

/** True when the stamp reviewed exactly this diff content. */
export function stampCoversReview(stamp, context) {
  if (!stamp || stamp.schema !== MATT_REVIEW_SCHEMA) return false;
  if (!stamp.model) return false;
  return stamp.diffHash === context.diffHash;
}

/** null when merge may proceed; otherwise the reason plus the fix. */
export function mattReviewBlockReason({ files, context, stamp }) {
  if (!reviewRequiredForFiles(files)) return null;
  if (stampCoversReview(stamp, context)) return null;
  const state = stamp ? 'stale (diff changed since the review)' : 'missing';
  return [
    `matt-review stamp ${state} for this code diff.`,
    'Run the Sonnet standards review, then stamp:',
    '  1. node scripts/ci/matt-review.mjs prompt   # spawn a claude-sonnet-5 subagent with this prompt',
    '  2. node scripts/ci/matt-review.mjs write --gitnexus <ok|unavailable>',
    `  3. commit ${MATT_REVIEW_REL} with the branch`,
    'Findings are advisory — address them or answer them in the PR. The run is required.',
  ].join('\n');
}

/** The injected prompt for the review subagent. Policy lives here, not in agent prose. */
export function buildReviewPrompt({ files = [], diffStat = '' } = {}) {
  return [
    'You are a standards reviewer for this repo. Review the current branch diff vs origin/main.',
    '',
    'Apply, in order:',
    "1. The global Matt Pocock `code-review` skill (~/.claude/skills/code-review or ~/.agents/skills/code-review) — Standards axis; this repo's documented rules override the Fowler baseline.",
    '2. The Always / Never lists in docs/agents/matt-standards.md.',
    '3. The deep-module vocabulary from the `codebase-design` skill for any new or moved seam: is each new module deep (small interface, real behaviour)? Is policy in scripts/lib rather than prose? Behaviour changes near existing tests should have arrived test-first (tdd skill).',
    '',
    'If GitNexus tools are available in this session, run detect_changes / impact on the touched symbols first and use the blast radius to focus the review; if unavailable, say so and continue.',
    '',
    `Changed files (${files.length}):`,
    ...files.map((f) => `  - ${f}`),
    diffStat ? `\nDiff stat:\n${diffStat}` : '',
    '',
    'Report ADVISORY findings only: a numbered list, each with file:line, the standard it bends, and a concrete fix. End with a one-line verdict. Do not edit files.',
  ].join('\n');
}
