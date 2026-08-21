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
  mattReviewBlockReason,
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
  assert.match(reason, /matt-review\.mjs prompt/, 'block reason carries the fix');
}

// buildReviewPrompt content — the injected policy
{
  const prompt = buildReviewPrompt({ files: ['apps/a.js'], diffStat: '1 file changed' });
  assert.match(prompt, /code-review/, 'prompt points at the Matt code-review skill');
  assert.match(prompt, /matt-standards\.md/, 'prompt points at the repo standards doc');
  assert.match(prompt, /codebase-design/, 'prompt applies deep-module vocabulary');
  assert.match(prompt, /ADVISORY/, 'findings are advisory');
  assert.match(prompt, /detect_changes/, 'prompt asks for GitNexus blast radius when available');
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

console.log('matt-review: ok');
