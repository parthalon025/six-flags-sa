#!/usr/bin/env node
/**
 * Local CI pass stamp — the `local-ci-verified` write/check seam shared by
 * pre-merge-vertical and test-app.yml.
 *
 *   node test/scripts/local-ci-pass.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCAL_CI_PASS_REL,
  LOCAL_CI_TAG,
  STATIC_STEPS,
  STATIC_STEP_IDS,
  TAG_SKIPPED_JOBS,
  buildLocalCiContext,
  localCiDecision,
  readLocalCiPass,
  shouldSkipGithubCi,
  shouldSkipGithubUi,
  shouldSkipLocalPreMerge,
  stampCoversContext,
  staticNpmStepsForFiles,
  writeLocalCiPass,
} from '../../scripts/lib/local-ci-pass.mjs';
import { jobsRequiredByCanon } from '../../scripts/lib/ci-lane-plan.mjs';
import { STATIC_NPM_STEPS } from '../../scripts/ci/pre-merge-vertical.mjs';
import { runCheck, runWrite } from '../../scripts/ci/local-ci-pass.mjs';

// The tag skips GitHub jobs, so every job it skips needs a local step that
// stood in for it — otherwise the tag waves through work nothing ran.
{
  const covered = new Set(STATIC_STEPS.flatMap((s) => s.covers));
  for (const job of ['lint', 'boundaries', 'module-select-unit', 'app-build']) {
    assert.ok(covered.has(job), `${job} is skipped by the tag but no static step covers it`);
  }
  assert.deepEqual(
    staticNpmStepsForFiles(['scripts/lib/vercel-ignore.mjs']),
    STATIC_STEPS.filter((s) => s.id === 'test:ci-gate').map((s) => s.npm),
    'backside-only static npm steps mirror canon lanes',
  );
  assert.deepEqual(
    STATIC_NPM_STEPS,
    STATIC_STEPS.map((s) => s.npm),
    'fail-closed unreadable diff uses full static floor',
  );
  for (const job of ['builder', 'ui']) {
    assert.ok(TAG_SKIPPED_JOBS.includes(job), `${job} belongs to the tag's skip set`);
  }
  assert.ok(
    !TAG_SKIPPED_JOBS.includes('gate'),
    'the gate job reads the tag, so it can never be skipped by it',
  );
}

const tmp = mkdtempSync(join(tmpdir(), 'local-ci-pass-'));
try {
  const context = {
    schema: 3,
    head: 'abc123',
    diffHash: 'diff123456789abc',
    mergeBase: 'def456',
    baseRef: 'origin/main',
    files: ['apps/party-tracker/components/Sheet.jsx'],
    modules: ['lint', 'party'],
    needsBrowser: true,
    verticals: ['app'],
    staticSteps: [...STATIC_STEP_IDS],
    canonJobs: jobsRequiredByCanon(['apps/party-tracker/components/Sheet.jsx']),
    lockHash: 'lockhash12345678',
    manifestHash: 'manifest12345678',
  };

  const stamp = writeLocalCiPass({ context, browserVertical: true, verticals: ['app'] }, tmp);
  assert.equal(readLocalCiPass(tmp)?.diffHash, 'diff123456789abc');
  assert.equal(stamp.tag, LOCAL_CI_TAG, 'a pre-merge-vertical stamp carries the tag');
  assert.equal(stamp.browserVertical, true);
  assert.ok(readFileSync(join(tmp, LOCAL_CI_PASS_REL), 'utf8').includes('"browserVertical": true'));

  assert.equal(stampCoversContext(stamp, context), true);
  assert.equal(
    stampCoversContext(stamp, { ...context, diffHash: 'other' }),
    false,
    'a changed diff invalidates the stamp',
  );
  assert.equal(
    stampCoversContext(stamp, { ...context, head: 'committed-the-stamp' }),
    true,
    'committing the stamp moves HEAD but not the diff — the stamp still covers',
  );
  assert.equal(
    stampCoversContext(stamp, { ...context, mergeBase: 'base-tip-of-the-merge-commit' }),
    true,
    'GitHub sees the merge commit, so merge-base moves without the code moving',
  );
  assert.equal(
    stampCoversContext(stamp, { ...context, lockHash: 'deps-moved-on-base' }),
    false,
    'a base that moved the dependencies is a different run',
  );
  assert.equal(
    stampCoversContext({ ...stamp, staticSteps: ['test:ci-gate'] }, context),
    false,
    'a stamp from a narrower static floor never covers the jobs the tag skips',
  );
  assert.equal(
    stampCoversContext({ ...stamp, schema: 2 }, context),
    false,
    'pre-tag schemas never cover',
  );

  assert.equal(
    shouldSkipLocalPreMerge(stamp, context),
    true,
    'full stamp skips local rerun',
  );
  assert.equal(
    shouldSkipLocalPreMerge(stamp, { ...context, needsBrowser: true }, { skipBrowser: true }),
    true,
    'stamp covers static when browser skipped explicitly',
  );
  assert.equal(
    shouldSkipLocalPreMerge({ ...stamp, browserVertical: false }, context),
    false,
    'browser still required when stamp lacks browser vertical',
  );
  assert.equal(
    shouldSkipLocalPreMerge({ ...stamp, verticals: [] }, context),
    false,
    'a stamp missing a required vertical never covers the tree',
  );

  assert.equal(
    shouldSkipGithubUi(stamp, context, { anyUi: true }),
    true,
    'GitHub UI may skip when stamp covers browser vertical',
  );
  assert.equal(
    shouldSkipGithubUi(stamp, context, { anyUi: false }),
    false,
    'no UI modules means nothing to skip on GitHub',
  );

  assert.equal(
    shouldSkipGithubCi(stamp, context),
    true,
    'a tagged stamp over this diff skips the jobs it proved',
  );
  assert.equal(
    shouldSkipGithubCi({ ...stamp, tag: null }, context),
    false,
    'an untagged stamp never skips GitHub jobs',
  );
  assert.equal(
    shouldSkipGithubCi({ ...stamp, verticals: [] }, context),
    false,
    'a stamp missing a required vertical never skips GitHub jobs',
  );
  assert.equal(
    shouldSkipGithubCi({ ...stamp, browserVertical: false }, context),
    false,
    'a UI diff without a browser vertical never skips GitHub jobs',
  );
  assert.equal(
    shouldSkipGithubCi(stamp, { ...context, diffHash: 'moved-on' }),
    false,
    'a new commit on the branch retires the tag',
  );
  assert.equal(
    shouldSkipGithubCi({ ...stamp, diffHash: null }, { ...context, diffHash: null }),
    false,
    'an unreadable diff can never be claimed as verified',
  );

  // Docs-only diffs owe no verticals, so the tag covers them on its own.
  const docsContext = {
    ...context,
    files: ['docs/guide/testing.md'],
    needsBrowser: false,
    verticals: [],
    staticSteps: [],
    canonJobs: [],
    modules: [],
  };
  const docsStamp = writeLocalCiPass(
    { context: docsContext, browserVertical: false, verticals: [] },
    tmp,
  );
  assert.equal(shouldSkipGithubCi(docsStamp, docsContext), true);

  const decision = localCiDecision(stamp, context, { anyUi: true });
  assert.equal(decision.skipCi, true);
  assert.equal(decision.skipUi, true, 'skipping CI implies skipping the UI jobs');
  assert.match(decision.reason, new RegExp(LOCAL_CI_TAG));

  const forced = localCiDecision(stamp, context, { anyUi: true, forceFull: true });
  assert.equal(forced.skipCi, false, 'full-ci escape hatch wins over any stamp');
  assert.equal(forced.skipUi, false);
  assert.match(forced.reason, /forced/);

  const stale = localCiDecision(stamp, { ...context, diffHash: 'moved-on' }, { anyUi: true });
  assert.equal(stale.skipCi, false);
  assert.match(stale.reason, /different diff/);

  assert.equal(
    localCiDecision(null, context, { anyUi: true }).skipCi,
    false,
    'no stamp means full CI',
  );
  assert.match(localCiDecision(null, context, {}).reason, /no local CI pass stamp/);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// A hand-written stamp records no tag, so it can never skip a GitHub job.
{
  const handTmp = mkdtempSync(join(tmpdir(), 'local-ci-hand-'));
  try {
    const handContext = {
      schema: 3,
      head: 'abc123',
      diffHash: 'hand123456789abc',
      mergeBase: 'def456',
      baseRef: 'origin/main',
      files: ['apps/party-tracker/components/Sheet.jsx'],
      modules: ['party'],
      needsBrowser: true,
      verticals: ['app'],
      staticSteps: [...STATIC_STEP_IDS],
      canonJobs: jobsRequiredByCanon(['apps/party-tracker/components/Sheet.jsx']),
      lockHash: 'lockhash12345678',
      manifestHash: 'manifest12345678',
    };
    const stamp = runWrite({ noBrowser: false, cwd: handTmp, context: handContext });
    assert.equal(stamp.tag, null, 'the hand-write path never claims the tag');
    assert.deepEqual(stamp.verticals, []);
    assert.equal(
      shouldSkipGithubCi(stamp, handContext),
      false,
      'a hand stamp can never skip GitHub jobs, however complete it looks',
    );
  } finally {
    rmSync(handTmp, { recursive: true, force: true });
  }
}

const realContext = buildLocalCiContext({ baseRef: 'origin/main' });
assert.ok(realContext.head, 'buildLocalCiContext resolves HEAD in repo');
assert.ok(Array.isArray(realContext.staticSteps), 'context records canon static steps');
assert.ok(Array.isArray(realContext.canonJobs), 'context records canon GitHub jobs');

const prevOut = process.env.GITHUB_OUTPUT;
const outFile = join(tmpdir(), `local-ci-pass-out-${process.pid}`);
writeFileSync(outFile, '');
process.env.GITHUB_OUTPUT = outFile;
try {
  const result = runCheck({ baseRef: 'origin/main', anyUi: false });
  const githubOut = readFileSync(outFile, 'utf8');
  assert.equal(typeof result.skipCi, 'boolean');
  assert.match(githubOut, /skip_ui=(true|false)/);
  assert.match(githubOut, /skip_ci=(true|false)/);
  assert.match(githubOut, new RegExp(`local_ci_tag=${LOCAL_CI_TAG}`));

  writeFileSync(outFile, '');
  const forcedRun = runCheck({ baseRef: 'origin/main', anyUi: true, forceFull: true });
  assert.equal(forcedRun.skipCi, false);
  assert.match(readFileSync(outFile, 'utf8'), /skip_ci=false/);
} finally {
  process.env.GITHUB_OUTPUT = prevOut;
  rmSync(outFile, { force: true });
}

// --- Same environment-dependence bug as matt-review's stamp: `git diff` sizes
// the blob ids in its `index` lines by `core.abbrev=auto`, which git scales
// with the repository's object count. Hashing that made a stamp written on a
// worktree unverifiable on a CI runner holding every branch — the identical
// tree read as a changed diff. `--full-index` pins the ids at 40 digits.
{
  const dir = mkdtempSync(join(tmpdir(), 'localci-abbrev-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, env: scrubGitEnv(), stdio: 'pipe' });
  git('init', '-qb', 'main');
  git('config', 'user.email', 't@e.st');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  // On a branch, or `main...HEAD` is empty and every setting hashes the same
  // empty patch — the test would pass while proving nothing.
  git('checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'a.js'), 'export const a = 2;\n');
  git('add', '.');
  git('commit', '-qm', 'change');

  const hashes = new Set();
  for (const abbrev of ['auto', '7', '8', '12', '40']) {
    git('config', 'core.abbrev', abbrev);
    const ctx = buildLocalCiContext({ baseRef: 'main', cwd: dir });
    assert.ok(ctx.diffHash, 'the fixture must actually produce a diff to hash');
    hashes.add(ctx.diffHash);
  }
  assert.equal(
    hashes.size,
    1,
    `diffHash must not depend on core.abbrev — got ${hashes.size} distinct hashes`,
  );

  rmSync(dir, { recursive: true, force: true });
}

{
  const dir = mkdtempSync(join(tmpdir(), 'localci-train-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, env: scrubGitEnv(), stdio: 'pipe' });
  git('init', '-qb', 'main');
  git('config', 'user.email', 't@e.st');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  // >1 MB patch — the size that used to overflow Node's default git buffer.
  writeFileSync(join(dir, 'a.js'), `${'export const a = 2;\n'.repeat(80_000)}`);
  git('add', '.');
  git('commit', '-qm', 'train-sized change');
  const ctx = buildLocalCiContext({ baseRef: 'main', cwd: dir });
  assert.ok(
    ctx.diffHash,
    'a train-sized patch must still hash — ENOBUFS used to write diffHash: null after a green vertical',
  );
  rmSync(dir, { recursive: true, force: true });
}

console.log('local-ci-pass: ok');
