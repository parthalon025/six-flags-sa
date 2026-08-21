#!/usr/bin/env node
/**
 * Generated-doc restore decision (gitnexus-sync).
 *
 *   node test/scripts/gitnexus-docs.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import {
  GENERATED_DOC_PATHS,
  docsToRestore,
  parseDirtyDocs,
} from '../../scripts/lib/gitnexus-docs.mjs';

// analyze rewrites its own skill docs, not just the two root files — the
// section it dropped was in .claude/skills/gitnexus/gitnexus-cli/SKILL.md.
assert.deepEqual(GENERATED_DOC_PATHS, [
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/skills/gitnexus',
]);

// --- parseDirtyDocs -------------------------------------------------------
assert.deepEqual(
  [...parseDirtyDocs(' M AGENTS.md\n M CLAUDE.md')],
  [
    ['AGENTS.md', ' M'],
    ['CLAUDE.md', ' M'],
  ],
);
assert.deepEqual([...parseDirtyDocs('')], [], 'clean tree → nothing dirty');
assert.deepEqual([...parseDirtyDocs(undefined)], [], 'no output → nothing dirty');
assert.deepEqual(
  [...parseDirtyDocs('R  AGENTS.md -> DOCS.md')],
  [['DOCS.md', 'R ']],
  'rename keys on the destination path',
);
assert.deepEqual(
  [...parseDirtyDocs('?? .claude/skills/gitnexus/new/SKILL.md')],
  [['.claude/skills/gitnexus/new/SKILL.md', '??']],
);
assert.deepEqual(
  [...parseDirtyDocs(' D .claude/skills/gitnexus/gitnexus-cli/SKILL.md')],
  [['.claude/skills/gitnexus/gitnexus-cli/SKILL.md', ' D']],
);

// --- docsToRestore --------------------------------------------------------
const clean = parseDirtyDocs('');
const analyzeDirtied = parseDirtyDocs(
  ' M AGENTS.md\n M .claude/skills/gitnexus/gitnexus-cli/SKILL.md',
);

assert.deepEqual(
  docsToRestore(clean, analyzeDirtied),
  ['AGENTS.md', '.claude/skills/gitnexus/gitnexus-cli/SKILL.md'],
  'clean before analyze → revert everything analyze rewrote',
);

assert.deepEqual(
  docsToRestore(parseDirtyDocs(' M AGENTS.md'), analyzeDirtied),
  ['.claude/skills/gitnexus/gitnexus-cli/SKILL.md'],
  'a doc the user was already editing must survive analyze',
);

assert.deepEqual(
  docsToRestore(clean, parseDirtyDocs('?? .claude/skills/gitnexus/new/SKILL.md')),
  [],
  'untracked: checkout cannot restore it, so never pass it',
);

assert.deepEqual(docsToRestore(clean, clean), [], 'analyze changed nothing → no checkout');
assert.deepEqual(docsToRestore(null, analyzeDirtied).length, 2, 'no baseline → revert all');
assert.deepEqual(docsToRestore(clean, null), [], 'no status (fresh clone) → no checkout');

// --- end to end against a real git repo -----------------------------------
// The decision is only worth anything if `git checkout --` accepts the paths
// it returns and leaves the rest alone.
const repo = mkdtempSync(join(tmpdir(), 'gitnexus-docs-'));
// Scrubbed: under a git hook an inherited GIT_DIR outranks `cwd` and this
// scratch repo's commits would land in the real one.
const gitEnv = scrubGitEnv();
const g = (...args) =>
  execFileSync('git', args, { cwd: repo, env: gitEnv, encoding: 'utf8' });
try {
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'test');
  mkdirSync(join(repo, '.claude/skills/gitnexus/gitnexus-cli'), { recursive: true });
  const skill = join(repo, '.claude/skills/gitnexus/gitnexus-cli/SKILL.md');
  writeFileSync(join(repo, 'AGENTS.md'), 'committed agents\n');
  writeFileSync(join(repo, 'CLAUDE.md'), 'committed claude\n');
  writeFileSync(skill, 'committed skill\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // The user is mid-edit on CLAUDE.md when the session starts.
  writeFileSync(join(repo, 'CLAUDE.md'), 'my in-progress edit\n');
  const before = parseDirtyDocs(
    g('status', '--porcelain', '--', ...GENERATED_DOC_PATHS),
  );

  // analyze runs: rewrites AGENTS.md, clobbers the skill doc, adds a new file.
  writeFileSync(join(repo, 'AGENTS.md'), 'analyze rewrote this\n');
  writeFileSync(skill, 'analyze clobbered this\n');
  writeFileSync(join(repo, '.claude/skills/gitnexus/NEW.md'), 'analyze added this\n');

  const after = parseDirtyDocs(
    g('status', '--porcelain', '--', ...GENERATED_DOC_PATHS),
  );
  const restore = docsToRestore(before, after);
  assert.deepEqual(
    [...restore].sort(),
    ['.claude/skills/gitnexus/gitnexus-cli/SKILL.md', 'AGENTS.md'],
    'restores what analyze dirtied, skips the user edit and the untracked add',
  );

  g('checkout', '--', ...restore);

  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), 'committed agents\n');
  assert.equal(readFileSync(skill, 'utf8'), 'committed skill\n', 'skill doc section survives');
  assert.equal(
    readFileSync(join(repo, 'CLAUDE.md'), 'utf8'),
    'my in-progress edit\n',
    'the user edit is not reverted',
  );
  assert.equal(
    readFileSync(join(repo, '.claude/skills/gitnexus/NEW.md'), 'utf8'),
    'analyze added this\n',
    'untracked add is left in place',
  );
} finally {
  rmSync(repo, { recursive: true, force: true });
}

// The retry/repair sequencing is asserted through its own interface in
// test/scripts/gitnexus-repair.test.mjs. What is left to pin here is the
// top-level contract this script owes every session: an index it could not
// build must never take the session down with it.
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sync = readFileSync(join(root, 'scripts/gitnexus-sync.mjs'), 'utf8');
assert.match(sync, /impact\/detect_changes are best-effort/, 'must degrade, not crash');

console.log('gitnexus-docs tests: ok');
