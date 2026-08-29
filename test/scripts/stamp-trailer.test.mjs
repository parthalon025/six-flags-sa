#!/usr/bin/env node
/**
 * CI stamps travel in commit trailers, not tracked files.
 *
 * Both stamps are regenerated per branch, so as tracked JSON they guaranteed a
 * conflict between any two branches — the control leg below reproduces it —
 * and `.gitattributes merge=keep-ours` could not help, because a merge driver
 * is a shell command in `.git/config` that GitHub's server-side merge never
 * runs. A commit message is per-commit and never merged, so the same two
 * branches merge clean.
 *
 *   node test/scripts/stamp-trailer.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import {
  LOCAL_CI_TRAILER,
  MATT_REVIEW_TRAILER,
  buildStampMessage,
  findStamp,
  parseStampTrailers,
  preferMatchingStamp,
  publishStamps,
  readStampTrailers,
  stampRange,
} from '../../scripts/lib/stamp-trailer.mjs';
import { LOCAL_CI_PASS_REL } from '../../scripts/lib/local-ci-pass.mjs';
import { MATT_REVIEW_REL } from '../../scripts/lib/matt-review.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// --- message round-trip
{
  const stamps = {
    [LOCAL_CI_TRAILER]: { schema: 3, tag: 'local-ci-verified', diffHash: 'aaaa1111' },
    [MATT_REVIEW_TRAILER]: { schema: 1, diffHash: 'bbbb2222', model: 'a-model' },
  };
  const message = buildStampMessage({ stamps });
  const parsed = parseStampTrailers(message);
  assert.deepEqual(parsed[LOCAL_CI_TRAILER], stamps[LOCAL_CI_TRAILER], 'CI stamp round-trips');
  assert.deepEqual(parsed[MATT_REVIEW_TRAILER], stamps[MATT_REVIEW_TRAILER], 'review stamp round-trips');

  const one = parseStampTrailers(buildStampMessage({ stamps: { [MATT_REVIEW_TRAILER]: { diffHash: 'x' } } }));
  assert.equal(one[LOCAL_CI_TRAILER], null, 'publishing one stamp does not invent the other');
  assert.equal(buildStampMessage({ stamps: {} }), null, 'nothing to publish is not a commit');
  assert.equal(parseStampTrailers(`${LOCAL_CI_TRAILER}: {not json}`)[LOCAL_CI_TRAILER], null, 'a corrupt trailer reads as no stamp');
  assert.equal(parseStampTrailers('')[LOCAL_CI_TRAILER], null, 'an empty message carries no stamp');
}

// --- which transport to believe when a branch holds both
{
  const trailer = { diffHash: 'old' };
  const file = { diffHash: 'fresh' };
  assert.equal(
    preferMatchingStamp({ trailer, file, diffHash: 'fresh' }),
    file,
    'a re-run’s fresh cache is not hidden behind an already-published stale trailer',
  );
  assert.equal(
    preferMatchingStamp({ trailer: { diffHash: 'fresh' }, file, diffHash: 'fresh' }).diffHash,
    'fresh',
    'the published trailer wins when both record this diff',
  );
  assert.equal(
    preferMatchingStamp({ trailer, file, diffHash: 'neither' }),
    trailer,
    'with neither matching, the reason names what history holds',
  );
  assert.equal(preferMatchingStamp({ trailer: null, file, diffHash: 'x' }), file, 'file alone is still read');
  assert.equal(preferMatchingStamp({}), null, 'no stamp anywhere is null, not a throw');
}

// --- the repo itself: the stamps must not be tracked, or every branch pair conflicts again
{
  const tracked = execFileSync('git', ['ls-files', '--', LOCAL_CI_PASS_REL, MATT_REVIEW_REL], {
    cwd: root,
    env: scrubGitEnv(),
    encoding: 'utf8',
  }).trim();
  assert.equal(tracked, '', `stamp files must stay untracked — still tracked:\n${tracked}`);

  for (const rel of [LOCAL_CI_PASS_REL, MATT_REVIEW_REL]) {
    const ignored = execFileSync('git', ['check-ignore', '--', rel], {
      cwd: root,
      env: scrubGitEnv(),
      encoding: 'utf8',
    }).trim();
    assert.equal(ignored, rel, `${rel} must be gitignored so a gate run never dirties the tree`);
  }
}

// --- two branches, both stamped, merged: the whole point
{
  const dir = mkdtempSync(join(tmpdir(), 'stamp-trailer-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        // Not `process.env`: under a git hook GIT_DIR names the real
        // repository and git prefers it to `cwd`. See scripts/lib/git-env.mjs.
        ...scrubGitEnv(),
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });

  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();

  const stampFor = (hash) => ({
    [LOCAL_CI_TRAILER]: { schema: 3, tag: 'local-ci-verified', diffHash: hash },
    [MATT_REVIEW_TRAILER]: { schema: 1, diffHash: hash, model: 'a-model' },
  });

  git('checkout', '-qb', 'feature-a');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'a');
  const aStamp = publishStamps({ cwd: dir, stamps: stampFor('aaaa1111') });
  assert.ok(aStamp, 'publishStamps returns the new commit');

  git('checkout', '-q', 'main');
  git('checkout', '-qb', 'feature-b');
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  git('add', '.');
  git('commit', '-qm', 'b');
  publishStamps({ cwd: dir, stamps: stampFor('bbbb2222') });

  // The stamp commit is empty: it adds nothing to the diff it certifies.
  assert.equal(git('show', '--stat', '--format=', 'HEAD').trim(), '', 'a stamp commit carries no diff');

  git('checkout', '-q', 'feature-a');
  git('merge', '--no-edit', '-q', 'feature-b');
  assert.equal(git('status', '--porcelain').trim(), '', 'two stamped branches merge clean');

  // Both stamps survive the merge, and each is still findable by its own diff.
  const range = stampRange({ mergeBase: base });
  const entries = readStampTrailers(dir, { range });
  assert.equal(entries.length, 2, 'both branches’ stamp commits are in range');
  assert.equal(
    findStamp(dir, { key: LOCAL_CI_TRAILER, range, diffHash: 'aaaa1111' })?.diffHash,
    'aaaa1111',
    'a foreign branch’s newer stamp does not mask this diff’s own',
  );
  assert.equal(
    findStamp(dir, { key: MATT_REVIEW_TRAILER, range, diffHash: 'bbbb2222' })?.diffHash,
    'bbbb2222',
    'the review stamp is selected by diff too',
  );
  assert.ok(
    findStamp(dir, { key: LOCAL_CI_TRAILER, range, diffHash: 'no-such-diff' }),
    'an unmatched diff still yields a stamp, so the reason names a real one',
  );
  assert.equal(findStamp(dir, { key: LOCAL_CI_TRAILER, range: null }), null, 'no range, no trailer read');

  // --- GitHub reads the PR's merge ref, not the branch tip. The stamp has to
  // be reachable from there too, or CI never honours a stamp it was given.
  git('checkout', '-q', 'main');
  writeFileSync(join(dir, 'main-moved.txt'), 'moved\n');
  git('add', '.');
  git('commit', '-qm', 'main moves on');
  const mainTip = git('rev-parse', 'HEAD').trim();
  git('checkout', '-qb', 'pr-merge-ref');
  git('merge', '--no-ff', '--no-edit', '-q', 'feature-a');
  const mergeRefRange = stampRange({ mergeBase: mainTip });
  assert.equal(
    findStamp(dir, { key: LOCAL_CI_TRAILER, range: mergeRefRange, diffHash: 'aaaa1111' })?.diffHash,
    'aaaa1111',
    'the stamp is readable from the PR merge ref',
  );

  // --- and it has to stay empty with work staged: `git commit --allow-empty`
  // commits the *index*, so publishing mid-`git rm --cached` swept that in.
  writeFileSync(join(dir, 'staged.txt'), 'staged\n');
  git('add', 'staged.txt');
  publishStamps({ cwd: dir, stamps: stampFor('cccc3333') });
  assert.equal(git('show', '--stat', '--format=', 'HEAD').trim(), '', 'a staged change is not swept into the stamp');
  assert.match(git('status', '--porcelain').trim(), /^A\s+staged\.txt$/, 'and it is left staged, untouched');
  git('rm', '-q', '-f', '--cached', 'staged.txt');
  rmSync(join(dir, 'staged.txt'));

  // --- Control: the transport this replaced. Same two branches, stamp as a
  // tracked file, and the merge that just ran clean conflicts instead.
  git('checkout', '-q', 'main');
  git('checkout', '-qb', 'file-a');
  writeFileSync(join(dir, 'stamp.json'), '{"diffHash":"aaaa1111"}\n');
  git('add', '.');
  git('commit', '-qm', 'file stamp a');
  git('checkout', '-q', 'main');
  git('checkout', '-qb', 'file-b');
  writeFileSync(join(dir, 'stamp.json'), '{"diffHash":"bbbb2222"}\n');
  git('add', '.');
  git('commit', '-qm', 'file stamp b');
  assert.throws(
    () => git('merge', '--no-edit', '-q', 'file-a'),
    /.*/,
    'the tracked-file transport conflicts — that is what the trailer replaces',
  );
  git('merge', '--abort');

  rmSync(dir, { recursive: true, force: true });
}

console.log('stamp-trailer: ok');
