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
 *   buildStandardsPrompt({ files, diffStat, standardsSources, diffCommand, commits })
 *   buildSpecPrompt({ files, spec, diffCommand, commits })
 *   buildTwoAxisReview({ baseRef, specPath, cwd })
 *   identifyStandardsSources({ cwd })
 *   identifySpecSource({ branch, commitMessages, specPath, cwd })
 *   parseIssueRefs(commitMessages)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isAgentPolicyOnlyDiff } from './agent-policy-diff.mjs';
import { scrubGitEnv } from './git-env.mjs';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export const MATT_REVIEW_SCHEMA = 1;
export const MATT_REVIEW_REL = 'scripts/ci/matt-review-pass.json';
export const REVIEW_MODEL_DEFAULT = 'claude-sonnet-5';

/** Documented standards files checked in order; only existing paths are returned. */
export const STANDARDS_SOURCE_CANDIDATES = [
  'docs/agents/matt-standards.md',
  'docs/guide/contributing.md',
  'packages/README.md',
  'docs/agents/ci.md',
];

/** Fowler smell baseline (_Refactoring_, ch.3) — judgement calls, repo docs override. */
export const FOWLER_SMELL_BASELINE = [
  'Mysterious Name: a function, variable, or type whose name does not reveal what it does or holds.',
  'Duplicated Code: the same logic shape appears in more than one hunk or file in the change.',
  'Feature Envy: a method that reaches into another object\'s data more than its own.',
  'Data Clumps: the same few fields or params keep travelling together.',
  'Primitive Obsession: a primitive or string standing in for a domain concept that deserves its own type.',
  'Repeated Switches: the same switch/if-cascade on the same type recurs across the change.',
  'Shotgun Surgery: one logical change forces scattered edits across many files in the diff.',
  'Divergent Change: one file or module is edited for several unrelated reasons.',
  'Speculative Generality: abstraction, parameters, or hooks added for needs the spec does not have.',
  'Message Chains: long a.b().c().d() navigation the caller should not depend on.',
  'Middle Man: a class or function that mostly just delegates onward.',
  'Refused Bequest: a subclass or implementer that ignores or overrides most of what it inherits.',
];

/** Directories searched for a branch-name-matching spec file. */
export const SPEC_SEARCH_DIRS = ['docs', 'specs', '.scratch'];

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
  if (isAgentPolicyOnlyDiff(files)) return false;
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
  // An inherited GIT_DIR outranks `cwd`, so a hook-spawned run would
  // silently operate on the hook's repository. See scripts/lib/git-env.mjs.
  return execFileSync('git', args, {
    cwd,
    env: scrubGitEnv(),
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
  });
}

/**
 * Hash of the branch diff vs merge-base, excluding the stamp files — so
 * committing a stamp never invalidates it, and any code change does.
 *
 * `--full-index` is load-bearing, not cosmetic. Without it `git diff` writes
 * abbreviated blob ids into each `index abc1234..def5678` line, and the width
 * of that abbreviation is `core.abbrev=auto`, which git scales with how many
 * objects the repository holds. The same tree therefore hashes differently on
 * a small worktree and on a CI runner that cloned every branch, so a stamp
 * written locally could never be verified in CI — the stamp would read as
 * "diff changed since the review" while the diff had not changed at all. Full
 * 40-character ids are identical everywhere.
 */
export function buildMattReviewContext({ baseRef = 'origin/main', cwd = root } = {}) {
  const mergeBase = git(['merge-base', 'HEAD', baseRef], cwd).trim();
  const excludes = STAMP_EXCLUDES.map((p) => `:(exclude)${p}`);
  const patch = git(['diff', '--full-index', `${mergeBase}...HEAD`, '--', '.', ...excludes], cwd);
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
    'Run the Sonnet two-axis review, then stamp:',
    '  1. node scripts/ci/matt-review.mjs two-axis   # spawn parallel Standards + Spec sub-agents',
    '  2. node scripts/ci/matt-review.mjs write --gitnexus <ok|unavailable>',
    `  3. commit ${MATT_REVIEW_REL} with the branch`,
    'Findings are advisory — address them or answer them in the PR. The run is required.',
  ].join('\n');
}

/** Extract unique issue numbers from commit messages, highest first. */
export function parseIssueRefs(commitMessages = []) {
  const refs = new Set();
  const re = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)|#(\d+)/gi;
  for (const message of commitMessages) {
    for (const match of message.matchAll(re)) {
      refs.add(Number(match[1] ?? match[2]));
    }
  }
  return [...refs].sort((a, b) => b - a);
}

/** Return repo-relative paths to documented standards sources that exist. */
export function identifyStandardsSources({ cwd = root } = {}) {
  return STANDARDS_SOURCE_CANDIDATES.filter((rel) => existsSync(join(cwd, rel)));
}

function branchSlug(branch = '') {
  const leaf = branch.split('/').pop() ?? branch;
  return leaf.replace(/-[0-9a-f]{4,}$/i, '').replace(/^cursor-/, '');
}

function findSpecFileByBranch(branch, cwd) {
  const slug = branchSlug(branch);
  if (!slug || slug.length < 3) return null;
  const tokens = slug.split('-').filter((t) => t.length >= 3);
  for (const dir of SPEC_SEARCH_DIRS) {
    const abs = join(cwd, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs, { recursive: true })) {
      const rel = join(dir, String(name)).replaceAll('\\', '/');
      const lower = rel.toLowerCase();
      if (!/\.(md|txt)$/.test(lower)) continue;
      if (tokens.some((t) => lower.includes(t))) return rel;
    }
  }
  return null;
}

function readSpecFile(path, cwd) {
  const content = readFileSync(join(cwd, path), 'utf8');
  return { kind: 'file', path, content };
}

/**
 * Locate the originating spec: issue ref in commits, explicit path, or branch-name match.
 * Returns null when nothing is found.
 */
export function identifySpecSource({ branch, commitMessages = [], specPath, cwd = root } = {}) {
  const issueRefs = parseIssueRefs(commitMessages);
  if (issueRefs.length > 0) return { kind: 'issue', number: issueRefs[0] };
  if (specPath) {
    const rel = specPath.replace(/^\.\//, '');
    if (!existsSync(join(cwd, rel))) return null;
    return readSpecFile(rel, cwd);
  }
  if (branch) {
    const matched = findSpecFileByBranch(branch, cwd);
    if (matched) return readSpecFile(matched, cwd);
  }
  return null;
}

function listCommitsSinceMergeBase(mergeBase, cwd) {
  return git(['log', '--oneline', `${mergeBase}..HEAD`], cwd)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function currentBranch(cwd) {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
  } catch {
    return '';
  }
}

/** Standards-axis prompt for a parallel sub-agent. Policy lives here, not in agent prose. */
export function buildStandardsPrompt({
  files = [],
  diffStat = '',
  standardsSources = [],
  diffCommand = '',
  commits = [],
} = {}) {
  const smellLines = FOWLER_SMELL_BASELINE.map((s) => `- ${s}`).join('\n');
  return [
    'You are the Standards-axis reviewer for this repo.',
    '',
    diffCommand ? `Diff command: ${diffCommand}` : '',
    commits.length ? `Commits:\n${commits.map((c) => `  - ${c}`).join('\n')}` : '',
    '',
    'Documented standards sources (repo overrides the Fowler baseline):',
    ...standardsSources.map((s) => `  - ${s}`),
    '',
    'Fowler smell baseline (judgement calls only — documented repo standards override):',
    smellLines,
    '',
    'Apply, in order:',
    "1. The global Matt Pocock `code-review` skill — Standards axis.",
    '2. The Always / Never lists in docs/agents/matt-standards.md.',
    '3. The deep-module vocabulary from the `codebase-design` skill for any new or moved seam: is each new module deep (small interface, real behaviour)? Is policy in scripts/lib rather than prose? Behaviour changes near existing tests should have arrived test-first (tdd skill).',
    '4. The root-cause policy (docs/agents/policies/root-cause.md): does this diff ship the missing layer, or a hide?',
    '',
    'If GitNexus tools are available, run detect_changes / impact on the touched symbols first.',
    '',
    `Changed files (${files.length}):`,
    ...files.map((f) => `  - ${f}`),
    diffStat ? `\nDiff stat:\n${diffStat}` : '',
    '',
    'Report, per file/hunk where relevant: (a) every place the diff violates a documented standard — cite the standard (file + rule); and (b) any baseline smell you spot — name it and quote the hunk. Distinguish hard violations from judgement calls. Skip anything tooling enforces. Under 400 words. Do not edit files.',
  ]
    .filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n');
}

/** Spec-axis prompt for a parallel sub-agent. */
export function buildSpecPrompt({ files = [], spec, diffCommand = '', commits = [] } = {}) {
  if (!spec) return null;
  const specBody =
    spec.kind === 'file'
      ? `Spec file: ${spec.path}\n\n${spec.content}`
      : `GitHub issue #${spec.number} — fetch with: gh issue view ${spec.number} --comments`;
  return [
    'You are the Spec-axis reviewer for this repo.',
    '',
    diffCommand ? `Diff command: ${diffCommand}` : '',
    commits.length ? `Commits:\n${commits.map((c) => `  - ${c}`).join('\n')}` : '',
    '',
    'Spec:',
    specBody,
    '',
    `Changed files (${files.length}):`,
    ...files.map((f) => `  - ${f}`),
    '',
    'Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that was not asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words. Do not edit files.',
  ].join('\n');
}

/** Pin the fixed point and build both axis prompts. */
export function buildTwoAxisReview({ baseRef = 'origin/main', specPath, cwd = root } = {}) {
  const context = buildMattReviewContext({ baseRef, cwd });
  const diffCommand = `git diff ${baseRef}...HEAD`;
  const commits = listCommitsSinceMergeBase(context.mergeBase, cwd);
  const commitMessages = commits.map((c) => c.replace(/^[0-9a-f]+\s+/, ''));
  const branch = currentBranch(cwd);
  const standardsSources = identifyStandardsSources({ cwd });
  const spec = identifySpecSource({ branch, commitMessages, specPath, cwd });
  let diffStat = '';
  try {
    diffStat = git(['diff', '--stat', `${context.mergeBase}...HEAD`], cwd).trim();
  } catch {
    // stat is garnish
  }
  const standardsPrompt = buildStandardsPrompt({
    files: context.files,
    diffStat,
    standardsSources,
    diffCommand,
    commits,
  });
  const specPrompt = buildSpecPrompt({
    files: context.files,
    spec,
    diffCommand,
    commits,
  });
  return {
    ...context,
    diffCommand,
    commits,
    branch,
    standardsSources,
    spec,
    standardsPrompt,
    specPrompt,
  };
}

/** @deprecated Use buildStandardsPrompt — kept for callers that predate the two-axis split. */
export function buildReviewPrompt(opts = {}) {
  return buildStandardsPrompt(opts);
}
