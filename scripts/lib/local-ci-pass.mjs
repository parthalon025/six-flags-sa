/**
 * Local CI pass stamp — the `local-ci-verified` tag.
 *
 * An agent that ran the full local CI (`npm run test:pre-merge-vertical`)
 * stamps `scripts/ci/local-ci-pass.json` and commits it with the branch. When
 * GitHub Actions sees a stamp carrying the tag for *this exact diff*, it skips
 * the jobs that stamp already proved instead of running them a second time.
 *
 * Two things make the tag safe to trust:
 *   identity  — `diffHash` is the branch diff vs merge-base with the stamp
 *               files excluded, so committing the stamp never invalidates it
 *               and any code change does (same recipe as matt-review).
 *   coverage  — the stamp must record every static step in `STATIC_STEPS` and
 *               every vertical the diff owes. `pre-merge-vertical` writes it
 *               only after all of those pass, and the hand-written `write`
 *               path deliberately records no verticals, so a hand stamp can
 *               never carry the tag past a code diff.
 *
 * Interface:
 *   STATIC_STEPS / STATIC_STEP_IDS / LOCAL_CI_TAG
 *   buildLocalCiContext({ cwd, baseRef })
 *   readLocalCiPass(cwd)
 *   writeLocalCiPass(stamp, cwd)
 *   stampCoversContext(stamp, context)
 *   shouldSkipLocalPreMerge(stamp, context, { skipBrowser })
 *   shouldSkipGithubUi(stamp, context, { anyUi })
 *   shouldSkipGithubCi(stamp, context)
 *   localCiDecision(stamp, context, { anyUi, forceFull })
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from './git-env.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModulesManifest,
  selectModulesFromFiles,
} from '../../test/app/lib/module-select.mjs';
import { STAMP_FILES, requiredVerticals, stampCoversVerticals } from './vertical-e2e.mjs';

function needsBrowserForFiles(files, manifest) {
  if (files == null) return true;
  if (!files.length) return false;
  return selectModulesFromFiles(files, manifest).modules.length > 0;
}

// 2: stamps record which verticals ran, so a pass cannot be claimed for a
//    code diff whose vertical e2e never executed.
// 3: identity moved from HEAD sha to the stamp-excluded diff hash, and the
//    static floor grew to cover every GitHub job the tag now skips.
export const LOCAL_CI_PASS_SCHEMA = 3;
export const LOCAL_CI_PASS_REL = 'scripts/ci/local-ci-pass.json';

/**
 * The tag GitHub reads. It means: local CI ran everything the skipped jobs
 * would have run, over this diff. It is not a request to skip — it is the
 * evidence, and `shouldSkipGithubCi` still checks the evidence covers.
 */
export const LOCAL_CI_TAG = 'local-ci-verified';

/**
 * The static floor of a local CI run, and the GitHub job each step stands in
 * for. Every job named here is one the tag may skip, so a step may only leave
 * this list together with the job it covers — otherwise the tag would wave
 * through work nothing ran.
 *
 * `lint` runs `lint:boundaries` first, which is why it covers both jobs.
 */
export const STATIC_STEPS = [
  { id: 'test:ci-gate', npm: ['run', 'test:ci-gate'], covers: ['gate'] },
  { id: 'test:unit', npm: ['run', 'test:unit'], covers: [] },
  { id: 'lint', npm: ['run', 'lint'], covers: ['lint', 'boundaries'] },
  {
    id: 'test:coverage-contract',
    npm: ['run', 'test:coverage-contract'],
    covers: ['contract'],
  },
  {
    id: 'test:module-select',
    npm: ['run', 'test:module-select'],
    covers: ['module-select-unit'],
  },
  { id: 'build', npm: ['run', 'build', '-w', '@party-tracker/app'], covers: ['app-build'] },
];

export const STATIC_STEP_IDS = STATIC_STEPS.map((s) => s.id);

/** GitHub jobs the tag may skip: the static floor above plus the verticals. */
export const TAG_SKIPPED_JOBS = [
  ...new Set([
    ...STATIC_STEPS.flatMap((s) => s.covers).filter((job) => job !== 'gate'),
    'builder',
    'ui',
    'visual',
  ]),
];

function repoRootFrom(cwd) {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function localCiPassPath(cwd = repoRootFrom()) {
  return join(cwd, LOCAL_CI_PASS_REL);
}

function git(cwd, args) {
  // An inherited GIT_DIR outranks `cwd`, so a hook-spawned run would
  // silently operate on the hook's repository. See scripts/lib/git-env.mjs.
  return execFileSync('git', args, { cwd, env: scrubGitEnv(), encoding: 'utf8' }).trim();
}

function hashFile(path) {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

export function gitChangedFiles(baseRef = 'origin/main', cwd = repoRootFrom()) {
  try {
    const mergeBase = git(cwd, ['merge-base', 'HEAD', baseRef]);
    const out = git(cwd, ['diff', '--name-only', `${mergeBase}...HEAD`]);
    return {
      mergeBase,
      files: out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  } catch {
    return { mergeBase: null, files: null };
  }
}

/**
 * Content identity of the branch's code work. The stamp files are excluded so
 * that committing the stamp — the last thing an agent does — does not
 * invalidate the very run it records.
 *
 * `--full-index` keeps the hash the same on every machine. Abbreviated blob
 * ids in the patch's `index` lines are sized by `core.abbrev=auto`, which git
 * scales with the repository's object count, so an identical tree hashes
 * differently on a worktree and on a CI runner holding every branch.
 */
export function diffHashFor(mergeBase, cwd = repoRootFrom()) {
  if (!mergeBase) return null;
  try {
    const excludes = STAMP_FILES.map((p) => `:(exclude)${p}`);
    const patch = git(cwd, ['diff', '--full-index', `${mergeBase}...HEAD`, '--', '.', ...excludes]);
    return createHash('sha256').update(patch).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

export function buildLocalCiContext({
  baseRef = 'origin/main',
  cwd = repoRootFrom(),
  manifest = loadModulesManifest(),
} = {}) {
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const { mergeBase, files } = gitChangedFiles(baseRef, cwd);
  const selection =
    files == null
      ? { modules: manifest.modules.map((m) => m.id), fullSuite: true }
      : selectModulesFromFiles(files, manifest);
  const modules = [...selection.modules].sort();
  const needsBrowser = files == null ? true : needsBrowserForFiles(files, manifest);

  return {
    schema: LOCAL_CI_PASS_SCHEMA,
    verticals: requiredVerticals(files),
    head,
    diffHash: diffHashFor(mergeBase, cwd),
    mergeBase,
    baseRef,
    modules,
    needsBrowser,
    staticSteps: [...STATIC_STEP_IDS],
    lockHash: hashFile(join(cwd, 'package-lock.json')),
    manifestHash: hashFile(join(cwd, 'test/app/modules.json')),
  };
}

export function readLocalCiPass(cwd = repoRootFrom()) {
  const path = localCiPassPath(cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function writeLocalCiPass(
  {
    context,
    browserVertical = false,
    verticals = [],
    tag = LOCAL_CI_TAG,
    recordedAt = new Date().toISOString(),
  },
  cwd = repoRootFrom(),
) {
  const stamp = {
    schema: LOCAL_CI_PASS_SCHEMA,
    tag,
    diffHash: context.diffHash,
    head: context.head,
    mergeBase: context.mergeBase,
    baseRef: context.baseRef,
    modules: context.modules,
    browserVertical,
    verticals: [...verticals].sort(),
    staticSteps: context.staticSteps,
    lockHash: context.lockHash,
    manifestHash: context.manifestHash,
    recordedAt,
  };
  const path = localCiPassPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

function sortedEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
}

/**
 * True when the stamp records a run over exactly this diff and toolchain.
 *
 * `mergeBase` is recorded but deliberately *not* compared: GitHub checks out
 * the PR's merge commit, so its merge-base is the base tip while the local one
 * is the fork point. They differ the moment main moves. `diffHash` is what
 * says "same code", and the lock/manifest hashes are read from the tree that
 * actually ran, so a base that moved the dependencies still fails to cover.
 */
export function stampCoversContext(stamp, context) {
  if (!stamp || stamp.schema !== LOCAL_CI_PASS_SCHEMA) return false;
  // A null hash means the diff could not be read; nothing may be claimed for it.
  if (!stamp.diffHash || stamp.diffHash !== context.diffHash) return false;
  if (stamp.baseRef !== context.baseRef) return false;
  if (!sortedEq(stamp.modules, context.modules)) return false;
  if (!sortedEq(stamp.staticSteps, context.staticSteps)) return false;
  if (stamp.lockHash !== context.lockHash) return false;
  if (stamp.manifestHash !== context.manifestHash) return false;
  return true;
}

/** Skip a local pre-merge-vertical run when the stamp already covers this tree. */
export function shouldSkipLocalPreMerge(
  stamp,
  context,
  { skipBrowser = false } = {},
) {
  if (!stampCoversContext(stamp, context)) return false;
  if (!stampCoversVerticals(stamp, context.verticals)) return false;
  if (!context.needsBrowser || skipBrowser) return true;
  return stamp.browserVertical === true;
}

/**
 * Skip expensive GitHub UI jobs when a committed stamp proves the same diff
 * already passed browser vertical locally.
 */
export function shouldSkipGithubUi(stamp, context, { anyUi = false } = {}) {
  if (!anyUi) return false;
  if (!stampCoversContext(stamp, context)) return false;
  return stamp.browserVertical === true;
}

/**
 * The `local-ci-verified` decision: skip every job in `TAG_SKIPPED_JOBS`
 * because local CI already ran all of them over this diff.
 *
 * The gate and select jobs are deliberately not skippable — they are cheap,
 * and they are what reads this tag. Something unskippable has to.
 */
export function shouldSkipGithubCi(stamp, context) {
  if (!stampCoversContext(stamp, context)) return false;
  if (stamp.tag !== LOCAL_CI_TAG) return false;
  if (!stampCoversVerticals(stamp, context.verticals)) return false;
  if (context.needsBrowser && stamp.browserVertical !== true) return false;
  return true;
}

/**
 * Why CI did or did not honour the tag — one line, for the workflow log and
 * the job summary. An unexplained skip is indistinguishable from a broken gate.
 */
export function localCiSkipReason(stamp, context) {
  if (!stamp) return 'no local CI pass stamp — full CI will run';
  if (stamp.schema !== LOCAL_CI_PASS_SCHEMA) {
    return `stamp schema ${stamp.schema} predates the ${LOCAL_CI_TAG} tag (want ${LOCAL_CI_PASS_SCHEMA}) — full CI will run`;
  }
  if (stamp.tag !== LOCAL_CI_TAG) return `stamp carries no ${LOCAL_CI_TAG} tag — full CI will run`;
  if (!stamp.diffHash || stamp.diffHash !== context.diffHash) {
    return `stamp is for a different diff (${stamp.diffHash || 'none'} != ${context.diffHash || 'unreadable'}) — full CI will run`;
  }
  if (!stampCoversContext(stamp, context)) {
    return 'stamp does not match this base ref, module selection, lockfile or step list — full CI will run';
  }
  if (!stampCoversVerticals(stamp, context.verticals)) {
    const missing = context.verticals.filter((id) => !(stamp.verticals || []).includes(id));
    return `stamp is missing the ${missing.join(', ')} vertical — full CI will run`;
  }
  if (context.needsBrowser && stamp.browserVertical !== true) {
    return 'stamp has no browser vertical for a UI diff — full CI will run';
  }
  return `${LOCAL_CI_TAG}: local CI covered this diff — skipping ${TAG_SKIPPED_JOBS.join(', ')}`;
}

/**
 * The whole GitHub-side decision in one call, so the workflow stays dumb.
 *
 * `forceFull` is the escape hatch — a `full-ci` label, a `[full-ci]` title, or
 * a push to main — and it wins over any stamp.
 */
export function localCiDecision(stamp, context, { anyUi = false, forceFull = false } = {}) {
  if (forceFull) {
    return {
      skipCi: false,
      skipUi: false,
      reason: 'full CI forced — the local CI tag is ignored for this run',
    };
  }
  const skipCi = shouldSkipGithubCi(stamp, context);
  return {
    skipCi,
    skipUi: skipCi || shouldSkipGithubUi(stamp, context, { anyUi }),
    reason: localCiSkipReason(stamp, context),
  };
}
