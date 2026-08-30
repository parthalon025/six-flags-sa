#!/usr/bin/env node
/**
 * Agent worktree create / remove / prune.
 *
 *   node test/scripts/worktree.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import {
  AGENT_DIR,
  branchName,
  removeDirSafe,
  sanitizeSlug,
  shouldDeleteBranch,
  shouldRemoveOnPrune,
  worktreePath,
  archiveRefFor,
  needsPreserving,
  failureReason,
} from '../../scripts/worktree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'scripts', 'worktree.mjs');

assert.equal(sanitizeSlug('Fix Auth!'), 'fix-auth');
assert.equal(sanitizeSlug('worktree-foo'), 'foo');
assert.equal(sanitizeSlug('a/b/c'), 'a-b-c');
assert.throws(() => sanitizeSlug('...'), /slug/);
assert.equal(branchName('fix-auth'), 'worktree-fix-auth');
assert.equal(
  worktreePath('/repo', 'fix-auth').replace(/\\/g, '/'),
  '/repo/.claude/worktrees/fix-auth',
);

assert.equal(shouldRemoveOnPrune({ dirty: true, locked: false, aheadCount: 0, prMerged: true }), false);
assert.equal(shouldRemoveOnPrune({ dirty: false, locked: true, aheadCount: 0, prMerged: true }), false);
assert.equal(shouldRemoveOnPrune({ dirty: false, locked: false, aheadCount: 0, prMerged: false }), false);
assert.equal(shouldRemoveOnPrune({ dirty: false, locked: false, aheadCount: 1, prMerged: true }), false);
assert.equal(shouldRemoveOnPrune({ dirty: false, locked: false, aheadCount: 0, prMerged: true }), true);

assert.equal(shouldDeleteBranch({ name: 'main', aheadCount: 0, hasWorktree: false, prMerged: true, force: true }), false);
assert.equal(shouldDeleteBranch({ name: 'wip/keep', aheadCount: 0, hasWorktree: false, prMerged: false, force: true }), false);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 0, hasWorktree: true, prMerged: false, force: false }), false);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 0, hasWorktree: false, prMerged: false, force: false }), true);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 2, hasWorktree: false, prMerged: false, force: false }), false);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 2, hasWorktree: false, prMerged: true, force: false }), true);
assert.equal(shouldDeleteBranch({ name: 'worktree-foo', aheadCount: 2, hasWorktree: false, prMerged: false, force: true }), true);

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    // `cwd` is not isolation on its own: under a git hook the environment names
    // the real repository and git prefers it. See scripts/lib/git-env.mjs.
    env: scrubGitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

function run(cwd, args) {
  try {
    return execFileSync(process.execPath, [script, ...args], {
      cwd,
      // worktree.mjs shells out to git; the same inherited-repo trap applies.
      env: scrubGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = [err.stderr, err.stdout, err.message].filter(Boolean).join('\n');
    const wrapped = new Error(msg);
    wrapped.status = err.status;
    throw wrapped;
  }
}

const repo = initRepo();
try {
  const created = run(repo, ['create', 'fix-auth']);
  assert.match(created, /WORKTREE=/);
  const wt = join(repo, AGENT_DIR, 'fix-auth');
  assert.equal(existsSync(join(wt, 'README.md')), true);
  assert.equal(git(wt, ['branch', '--show-current']), 'worktree-fix-auth');
  assert.equal(git(wt, ['rev-parse', 'HEAD']), git(repo, ['rev-parse', 'HEAD']));

  const listed = run(repo, ['list']);
  assert.match(listed, /fix-auth/);
  assert.match(listed, /worktree-fix-auth/);

  assert.throws(() => run(repo, ['create', 'fix-auth']), /already exists/);

  mkdirSync(join(repo, AGENT_DIR, 'taken'));
  writeFileSync(join(repo, AGENT_DIR, 'taken', 'stray.txt'), 'nope\n');
  assert.throws(() => run(repo, ['create', 'taken']), /already exists/);

  const outside = join(repo, 'not-an-agent-tree');
  mkdirSync(outside);
  assert.throws(() => run(repo, ['remove', outside]), /agent worktree/);

  run(repo, ['remove', 'fix-auth']);
  assert.equal(existsSync(wt), false);
  const branches = git(repo, ['branch']);
  assert.equal(branches.includes('worktree-fix-auth'), false);

  const leftover = git(repo, ['worktree', 'list']);
  assert.equal(leftover.includes('fix-auth'), false);

  const pruned = run(repo, ['prune']);
  assert.match(pruned, /nothing to remove|0 agent worktree/i);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

const repo2 = initRepo();
try {
  git(repo2, ['branch', 'worktree-stale']);
  git(repo2, ['checkout', '-b', 'worktree-live']);
  writeFileSync(join(repo2, 'README.md'), 'live\n');
  git(repo2, ['add', 'README.md']);
  git(repo2, ['commit', '-m', 'live work']);
  git(repo2, ['checkout', 'main']);
  git(repo2, ['branch', 'feat/human']);

  run(repo2, ['create', 'keep-me']);
  const pruned = run(repo2, ['prune']);
  assert.match(pruned, /worktree-stale/);
  const branches = git(repo2, ['branch']);
  assert.equal(branches.includes('worktree-stale'), false);
  assert.equal(branches.includes('worktree-live'), true);
  assert.equal(branches.includes('feat/human'), true);
  assert.equal(branches.includes('worktree-keep-me'), true);

  const bareParent = mkdtempSync(join(tmpdir(), 'wt-bare-'));
  const bare = join(bareParent, 'origin.git');
  execFileSync('git', ['clone', '--bare', repo2, bare], { encoding: 'utf8' });
  git(repo2, ['remote', 'add', 'origin', bare]);
  git(join(repo2, AGENT_DIR, 'keep-me'), ['push', '-u', 'origin', 'worktree-keep-me']);
  run(repo2, ['remove', 'keep-me']);
  const remoteHeads = git(bare, ['branch']);
  assert.equal(remoteHeads.includes('worktree-keep-me'), false);
  assert.equal(git(repo2, ['branch']).includes('worktree-keep-me'), false);
} finally {
  rmSync(repo2, { recursive: true, force: true });
}

if (process.platform === 'win32') {
  const outside = mkdtempSync(join(tmpdir(), 'wt-canary-'));
  const victim = mkdtempSync(join(tmpdir(), 'wt-victim-'));
  const canary = join(outside, 'canary.txt');
  writeFileSync(canary, 'safe\n');
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', join(victim, 'node_modules'), outside], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  removeDirSafe(victim);
  assert.equal(existsSync(canary), true, 'Windows rmdir must not follow NTFS junctions');
  rmSync(outside, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// preserve: work that exists nowhere but this disk (#803)

assert.equal(archiveRefFor('slice-h14'), 'archive/slice-h14');
assert.equal(archiveRefFor('worktree-foo'), 'archive/worktree-foo');
// Idempotent: preserving an archive ref must not nest archive/archive/...
assert.equal(archiveRefFor('archive/slice-h14'), 'archive/slice-h14');

const PRESERVE_SHA = 'a'.repeat(40);
const PRESERVE_OTHER = 'b'.repeat(40);

// The regression this exists to prevent: the branches that held the only copy
// of two files for a week were fan-out names, invisible to isAgentBranch.
assert.equal(
  needsPreserving({ name: 'slice-h14', aheadCount: 1, tipSha: PRESERVE_SHA, archivedSha: '' }),
  true,
  'a fan-out branch with unique commits and no archive needs preserving',
);

assert.equal(
  needsPreserving({ name: 'slice-h14', aheadCount: 0, tipSha: PRESERVE_SHA, archivedSha: '' }),
  false,
  'a branch with no commits beyond the base needs no archive',
);

// Already archived at this exact tip -> skip, which is what makes it cheap to
// run on every session start and on a timer.
assert.equal(
  needsPreserving({ name: 'slice-h14', aheadCount: 1, tipSha: PRESERVE_SHA, archivedSha: PRESERVE_SHA }),
  false,
  'a branch already archived at its current tip is skipped',
);

// Archived, then advanced -> at risk again. Comparing tips rather than mere
// existence is the whole reason this is re-runnable.
assert.equal(
  needsPreserving({ name: 'slice-h14', aheadCount: 2, tipSha: PRESERVE_OTHER, archivedSha: PRESERVE_SHA }),
  true,
  'a branch that gained a commit after archiving is at risk again',
);

// Protection from DELETION is not exclusion from PRESERVATION. The first
// version reused isProtectedBranch and so refused to preserve `wip/*` and
// `main` — inverting the point, since wip/* is where unfinished work is parked
// and local commits on main are still unpushed work.
for (const name of ['main', 'master', 'develop', 'dev', 'wip/thing']) {
  assert.equal(
    needsPreserving({ name, aheadCount: 5, tipSha: PRESERVE_SHA, archivedSha: '' }),
    true,
    `${name} holds unpushed commits and must still be preserved`,
  );
}

assert.equal(
  needsPreserving({ name: 'archive/slice-h14', aheadCount: 1, tipSha: PRESERVE_SHA, archivedSha: '' }),
  false,
  'an archive ref is not itself archived',
);

assert.equal(
  needsPreserving({ name: '', aheadCount: 5, tipSha: PRESERVE_SHA, archivedSha: '' }),
  false,
  'an empty branch name is never pushed',
);

// archivedSha must be NON-empty here: with both empty the tip comparison is
// '' !== '' == false, so the assertion would pass whether the guard exists or
// not. That version could not go red, which a mutation run caught.
assert.equal(
  needsPreserving({ name: 'slice-h14', aheadCount: 1, tipSha: '', archivedSha: PRESERVE_SHA }),
  false,
  'a branch with no resolvable tip is not pushed',
);

assert.match(
  failureReason({
    stderr: 'remote: rejected\n ! [rejected] main -> main (non-fast-forward)\n',
    message: 'Command failed: git push origin refs/heads/x:refs/heads/archive/x',
  }),
  /non-fast-forward/,
  'the reported reason names why the rescue failed, not merely that it did',
);
assert.match(
  failureReason({ message: 'Command failed: git push' }),
  /Command failed/,
  'with no stderr it falls back to the message rather than going blank',
);

// --- preserve, end to end, against a real origin ---------------------------
//
// The pure predicate was covered from the start; the command was not, and that
// is where the blocker lived: preserve() detected the failure, printed "FAILED
// to preserve", returned 1 — and the invocation block discarded it, so a rescue
// that saved nothing exited 0. The exit code is the only signal a hook runner
// sees, so it is asserted here.
{
  const sandbox = mkdtempSync(join(tmpdir(), 'wt-preserve-'));
  try {
    const originDir = join(sandbox, 'origin.git');
    execFileSync('git', ['init', '--bare', '-b', 'main', originDir], {
      env: scrubGitEnv(),
      stdio: 'ignore',
    });
    const work = join(sandbox, 'work');
    execFileSync('git', ['clone', originDir, work], { env: scrubGitEnv(), stdio: 'ignore' });
    const g = (args) =>
      execFileSync('git', args, { cwd: work, env: scrubGitEnv(), encoding: 'utf8' }).trim();
    const originRefs = () =>
      execFileSync('git', ['--git-dir', originDir, 'for-each-ref', '--format=%(refname)'], {
        env: scrubGitEnv(),
        encoding: 'utf8',
      });

    g(['config', 'user.email', 't@t.t']);
    g(['config', 'user.name', 't']);
    writeFileSync(join(work, 'a.txt'), 'a\n');
    g(['add', 'a.txt']);
    g(['commit', '-m', 'base']);
    g(['push', '-u', 'origin', 'main']);

    g(['checkout', '-b', 'slice-only-here']);
    writeFileSync(join(work, 'b.txt'), 'b\n');
    g(['add', 'b.txt']);
    g(['commit', '-m', 'only copy']);

    // A LOCAL pre-push hook must never block a rescue. This repo's real
    // pre-push hook demands the review/CI gate and refused the archive push
    // when preserve was first run for real — so it failed exactly when there
    // was unreviewed work in progress, which is when the only copy is on disk.
    mkdirSync(join(work, '.husky'), { recursive: true });
    writeFileSync(join(work, '.husky', 'pre-push'), "#!/bin/sh\necho 'gate says no' >&2\nexit 1\n");
    execFileSync('chmod', ['+x', join(work, '.husky', 'pre-push')]);
    g(['config', 'core.hooksPath', '.husky']);

    assert.match(run(work, ['preserve']), /preserved 1 branch/, 'the at-risk branch is preserved');
    // Anchored at end-of-line: an unanchored /archive\/slice-only-here/ is
    // equally satisfied by the sha-suffixed fallback ref, so it would pass even
    // if the plain archive had never been written.
    assert.match(
      originRefs(),
      /^refs\/heads\/archive\/slice-only-here$/m,
      'the archive ref really exists on the origin, not just in the report',
    );

    assert.match(
      run(work, ['preserve']),
      /already archived/,
      'a branch already archived at its tip is skipped on a second run',
    );

    // Divergence: rewriting history makes the branch a non-fast-forward of what
    // was archived. Force-pushing would preserve the new work by destroying the
    // old copy, which is the one thing this must never do — so it goes to a
    // sha-suffixed ref and BOTH survive. This is the invariant the whole
    // command rests on, so it is asserted rather than assumed.
    const archivedBefore = execFileSync(
      'git',
      ['--git-dir', originDir, 'rev-parse', 'refs/heads/archive/slice-only-here'],
      { env: scrubGitEnv(), encoding: 'utf8' },
    ).trim();
    g(['commit', '--amend', '-m', 'rewritten history']);
    const rewrittenTip = g(['rev-parse', 'HEAD']);

    const diverged = run(work, ['preserve']);
    assert.match(diverged, /preserved 1 branch/, 'the rewritten branch is still preserved');
    assert.match(
      diverged,
      new RegExp(`archive/slice-only-here-${rewrittenTip.slice(0, 9)}`),
      'the rewritten work lands on a sha-suffixed ref',
    );
    assert.equal(
      execFileSync(
        'git',
        ['--git-dir', originDir, 'rev-parse', 'refs/heads/archive/slice-only-here'],
        { env: scrubGitEnv(), encoding: 'utf8' },
      ).trim(),
      archivedBefore,
      'the original archive is untouched — preserve must never force-push over a copy',
    );

    // A tag sharing a branch's name makes %(refname:short) return `heads/v9`,
    // which interpolated into refs/heads/${name} gave refs/heads/heads/v9 — a
    // push that could never succeed, on every session start, for as long as
    // both refs existed. The alarm becomes permanent noise and a genuinely
    // at-risk branch hides in it.
    g(['checkout', '-b', 'v9']);
    writeFileSync(join(work, 'd.txt'), 'd\n');
    g(['add', 'd.txt']);
    g(['commit', '-m', 'work on a branch whose name a tag also claims']);
    g(['tag', '-f', 'v9']);
    const clash = run(work, ['preserve']);
    assert.match(clash, /v9 \(\+\d+\) -> archive\/v9/, 'a name-clashing branch is preserved');
    assert.doesNotMatch(clash, /heads\/v9/, 'the short name is never re-interpolated into a refspec');
    assert.match(
      originRefs(),
      /^refs\/heads\/archive\/v9$/m,
      'the clashing branch lands on the correct archive ref',
    );
    g(['checkout', 'slice-only-here']);

    // A rescue that saves nothing must say so through the exit code.
    writeFileSync(join(originDir, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n');
    execFileSync('chmod', ['+x', join(originDir, 'hooks', 'pre-receive')]);
    writeFileSync(join(work, 'c.txt'), 'c\n');
    g(['add', 'c.txt']);
    g(['commit', '-m', 'second only copy']);

    let status = 0;
    let output = '';
    try {
      output = run(work, ['preserve']);
    } catch (err) {
      status = err.status;
      output = err.message;
    }
    assert.equal(status, 1, 'a rescue that saved nothing must exit non-zero');
    assert.match(output, /still only on this disk/, 'the failure says the work is unprotected');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

console.log('worktree tests: ok');
