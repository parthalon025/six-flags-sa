#!/usr/bin/env node
/**
 * Matt-review stamp — unit behaviour + a temp-repo integration pass.
 *
 *   node test/scripts/matt-review.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MATT_REVIEW_REL,
  buildMattReviewContext,
  buildReviewPrompt,
  buildSpecPrompt,
  buildStandardsPrompt,
  buildTwoAxisReview,
  identifySpecSource,
  identifyStandardsSources,
  mattReviewBlockReason,
  parseIssueRefs,
  readMattReview,
  reviewRequiredForFiles,
  stampCoversReview,
  writeMattReview,
} from '../../scripts/lib/matt-review.mjs';

// reviewRequiredForFiles
assert.equal(reviewRequiredForFiles(['docs/guide/testing.md', 'README.md']), false, 'docs-only diff needs no review');
assert.equal(reviewRequiredForFiles(['apps/party-tracker/app/page.js']), true, 'app code needs review');
assert.equal(reviewRequiredForFiles(['scripts/lib/matt-review.mjs']), true, 'scripts code needs review');
assert.equal(reviewRequiredForFiles(['.github/workflows/test-app.yml']), true, 'workflow edits need review');
assert.equal(reviewRequiredForFiles([MATT_REVIEW_REL]), false, 'the stamp itself is not code');
assert.equal(reviewRequiredForFiles(null), true, 'unknown diff fails closed');

// stampCoversReview
{
  const context = { schema: 1, diffHash: 'abc123' };
  assert.equal(stampCoversReview({ schema: 1, diffHash: 'abc123', model: 'claude-sonnet-5' }, context), true);
  assert.equal(stampCoversReview({ schema: 1, diffHash: 'zzz', model: 'claude-sonnet-5' }, context), false, 'diff change staled the stamp');
  assert.equal(stampCoversReview({ schema: 1, diffHash: 'abc123', model: '' }, context), false, 'model must be recorded');
  assert.equal(stampCoversReview(null, context), false);
}

// mattReviewBlockReason
{
  const context = { diffHash: 'abc' };
  assert.equal(
    mattReviewBlockReason({ files: ['docs/x.md'], context, stamp: null }),
    null,
    'docs diff never blocks',
  );
  const reason = mattReviewBlockReason({ files: ['apps/a.js'], context, stamp: null });
  assert.match(reason, /missing/, 'missing stamp blocks');
  assert.match(reason, /matt-review\.mjs two-axis/, 'block reason carries the fix');
}

// buildReviewPrompt content — the injected policy (via buildStandardsPrompt)
{
  const prompt = buildReviewPrompt({ files: ['apps/a.js'], diffStat: '1 file changed' });
  assert.match(prompt, /code-review/, 'prompt points at the Matt code-review skill');
  assert.match(prompt, /matt-standards\.md/, 'prompt points at the repo standards doc');
  assert.match(prompt, /codebase-design/, 'prompt applies deep-module vocabulary');
  assert.match(prompt, /judgement calls/, 'findings distinguish hard vs judgement');
  assert.match(prompt, /detect_changes/, 'prompt asks for GitNexus blast radius when available');
  assert.match(prompt, /root-cause\.md/, 'prompt asks whether the diff ships the cause or a hide');
}

// Temp-repo integration: stamp survives its own commit, dies on a code change.
{
  const dir = mkdtempSync(join(tmpdir(), 'matt-review-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        // Not `process.env`: under a git hook that names the real repository,
        // and git prefers it to `cwd`. See scripts/lib/git-env.mjs.
        ...scrubGitEnv(),
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 2;\n');
  git('add', '.');
  git('commit', '-qm', 'change');

  const context = buildMattReviewContext({ baseRef: 'main', cwd: dir });
  assert.deepEqual(context.files, ['scripts/a.js']);
  writeMattReview({ context, gitnexus: 'unavailable', recordedAt: 'test' }, dir);
  git('add', '.');
  git('commit', '-qm', 'stamp');

  const afterStamp = buildMattReviewContext({ baseRef: 'main', cwd: dir });
  assert.equal(afterStamp.diffHash, context.diffHash, 'committing the stamp does not stale it');
  assert.equal(stampCoversReview(readMattReview(dir), afterStamp), true, 'stamp covers after commit');

  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 3;\n');
  git('add', '.');
  git('commit', '-qm', 'more code');
  const afterCode = buildMattReviewContext({ baseRef: 'main', cwd: dir });
  assert.equal(stampCoversReview(readMattReview(dir), afterCode), false, 'code change stales the stamp');

  // CLI layer (scripts/ci/matt-review.mjs) over the same temp repo —
  // mirrors how local-ci-pass.mjs tests its runCheck/runWrite.
  const { runCheck, runWrite, runPrompt } = await import('../../scripts/ci/matt-review.mjs');
  assert.equal(runCheck({ baseRef: 'main', cwd: dir }), 1, 'CLI check fails on stale stamp');
  assert.equal(runWrite({ baseRef: 'main', model: 'claude-sonnet-5', gitnexus: 'ok', cwd: dir }), 0, 'CLI write stamps');
  assert.equal(runCheck({ baseRef: 'main', cwd: dir }), 0, 'CLI check passes after write');
  assert.equal(readMattReview(dir).gitnexus, 'ok', 'write records gitnexus status');
  assert.equal(runPrompt({ baseRef: 'main', cwd: dir }), 0, 'CLI prompt renders');

  rmSync(dir, { recursive: true, force: true });
}

// --- The stamp has to verify on a machine other than the one that wrote it.
// `git diff` abbreviates blob ids in its `index` lines to `core.abbrev=auto`
// digits, and git scales that width with the repository's object count. Hashing
// that patch made the stamp environment-dependent: written on a worktree with
// 8-digit ids, checked on a CI runner holding every branch, the same tree read
// as "diff changed since the review". `--full-index` pins the ids at 40 digits.
// Simulate the other machine by forcing each plausible width.
{
  const dir = mkdtempSync(join(tmpdir(), 'matt-abbrev-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, env: scrubGitEnv(), stdio: 'pipe' });
  git('init', '-qb', 'main');
  git('config', 'user.email', 't@e.st');
  git('config', 'user.name', 'T');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  // The change has to live on a branch off main, or `main...HEAD` is empty and
  // the hash is the hash of an empty patch — identical under every setting,
  // which would make this test pass without proving anything.
  git('checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 2;\n');
  git('add', '.');
  git('commit', '-qm', 'change');
  assert.ok(
    buildMattReviewContext({ baseRef: 'main', cwd: dir }).files.length > 0,
    'the fixture must actually produce a diff',
  );

  const hashes = new Set();
  for (const abbrev of ['auto', '7', '8', '12', '40']) {
    git('config', 'core.abbrev', abbrev);
    hashes.add(buildMattReviewContext({ baseRef: 'main', cwd: dir }).diffHash);
  }
  assert.equal(
    hashes.size,
    1,
    `diffHash must not depend on core.abbrev — got ${hashes.size} distinct hashes ${[...hashes].join(', ')}`,
  );

  rmSync(dir, { recursive: true, force: true });
}

// parseIssueRefs — issue numbers from commit messages
{
  assert.deepEqual(parseIssueRefs(['feat: add widget (#605)']), [605]);
  assert.deepEqual(parseIssueRefs(['fix: snap map Closes #123']), [123]);
  assert.deepEqual(parseIssueRefs(['chore: bump', 'feat: thing (#45)']), [45]);
  assert.deepEqual(parseIssueRefs(['no refs here']), []);
}

// identifyStandardsSources — documented repo standards files
{
  const sources = identifyStandardsSources();
  assert.ok(sources.includes('docs/agents/matt-standards.md'), 'matt-standards is a standards source');
  assert.ok(sources.includes('docs/guide/contributing.md'), 'contributing is a standards source');
}

// identifySpecSource — explicit path wins
{
  const spec = identifySpecSource({ specPath: 'docs/agents/matt-standards.md' });
  assert.equal(spec.kind, 'file');
  assert.equal(spec.path, 'docs/agents/matt-standards.md');
}

// identifySpecSource — issue ref beats explicit path (code-review skill order)
{
  const spec = identifySpecSource({
    commitMessages: ['feat: party roster (#595)'],
    specPath: 'docs/agents/matt-standards.md',
  });
  assert.equal(spec.kind, 'issue');
  assert.equal(spec.number, 595);
}

// identifySpecSource — branch-name match when no issue ref or explicit path
{
  const dir = mkdtempSync(join(tmpdir(), 'spec-branch-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs/two-axis-review.md'), '# Spec\n\nBranch match.\n');
  const spec = identifySpecSource({ branch: 'worktree-two-axis-review', cwd: dir });
  assert.equal(spec.kind, 'file');
  assert.match(spec.path, /two-axis-review/);
  rmSync(dir, { recursive: true, force: true });
}

// buildSpecPrompt — issue kind
{
  const prompt = buildSpecPrompt({
    files: ['apps/a.js'],
    spec: { kind: 'issue', number: 595 },
    diffCommand: 'git diff abc...HEAD',
    commits: ['abc123 feat: thing'],
  });
  assert.match(prompt, /issue #595/);
  assert.match(prompt, /gh issue view 595/);
}

// buildStandardsPrompt — Fowler smell baseline is injected
{
  const prompt = buildStandardsPrompt({
    files: ['apps/a.js'],
    diffStat: '1 file changed',
    standardsSources: ['docs/agents/matt-standards.md'],
    diffCommand: 'git diff abc...HEAD',
    commits: ['abc123 feat: thing'],
  });
  assert.match(prompt, /Standards-axis/, 'labels the standards axis');
  assert.match(prompt, /Mysterious Name/, 'includes Fowler smell baseline');
  assert.match(prompt, /git diff abc\.\.\.HEAD/, 'carries the diff command');
  assert.match(prompt, /abc123 feat: thing/, 'carries the commit list');
}

// buildSpecPrompt — spec content and brief
{
  const prompt = buildSpecPrompt({
    files: ['apps/a.js'],
    spec: { kind: 'file', path: 'docs/spec.md', content: 'Must add widget.' },
    diffCommand: 'git diff abc...HEAD',
    commits: ['abc123 feat: thing'],
  });
  assert.match(prompt, /Spec-axis/, 'labels the spec axis');
  assert.match(prompt, /Must add widget/, 'includes spec content');
  assert.match(prompt, /requirements the spec asked for/, 'carries the spec brief');
}

// buildReviewPrompt remains an alias for buildStandardsPrompt
{
  const legacy = buildReviewPrompt({ files: ['apps/a.js'] });
  const standards = buildStandardsPrompt({ files: ['apps/a.js'] });
  assert.equal(legacy, standards, 'buildReviewPrompt delegates to buildStandardsPrompt');
}

// buildTwoAxisReview — orchestrates both axes
{
  const dir = mkdtempSync(join(tmpdir(), 'two-axis-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...scrubGitEnv(),
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'docs/spec.md'), '# Spec\n\nAdd counter.\n');
  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'scripts/a.js'), 'export const a = 2;\n');
  git('add', '.');
  git('commit', '-qm', 'feat: counter');

  const review = buildTwoAxisReview({ baseRef: 'main', specPath: 'docs/spec.md', cwd: dir });
  assert.match(review.diffCommand, /git diff .+\.\.\.HEAD/);
  assert.ok(review.commits.length > 0);
  assert.equal(review.spec.kind, 'file');
  assert.match(review.standardsPrompt, /Standards-axis/);
  assert.match(review.specPrompt, /Add counter/);

  const { runTwoAxis } = await import('../../scripts/ci/matt-review.mjs');
  assert.equal(runTwoAxis({ baseRef: 'main', specPath: 'docs/spec.md', cwd: dir }), 0);

  rmSync(dir, { recursive: true, force: true });
}

console.log('matt-review: ok');
