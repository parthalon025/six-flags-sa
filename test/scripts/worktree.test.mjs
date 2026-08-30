#!/usr/bin/env node
/**
 * Agent worktree create / remove / prune.
 *
 *   node test/scripts/worktree.test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubGitEnv } from "../../scripts/lib/git-env.mjs";
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
} from "../../scripts/worktree.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts", "worktree.mjs");

assert.equal(sanitizeSlug("Fix Auth!"), "fix-auth");
assert.equal(sanitizeSlug("worktree-foo"), "foo");
assert.equal(sanitizeSlug("a/b/c"), "a-b-c");
assert.throws(() => sanitizeSlug("..."), /slug/);
assert.equal(branchName("fix-auth"), "worktree-fix-auth");
assert.equal(
  worktreePath("/repo", "fix-auth").replace(/\\/g, "/"),
  "/repo/.claude/worktrees/fix-auth",
);

assert.equal(
  shouldRemoveOnPrune({
    dirty: true,
    locked: false,
    aheadCount: 0,
    prMerged: true,
  }),
  false,
);
assert.equal(
  shouldRemoveOnPrune({
    dirty: false,
    locked: true,
    aheadCount: 0,
    prMerged: true,
  }),
  false,
);
assert.equal(
  shouldRemoveOnPrune({
    dirty: false,
    locked: false,
    aheadCount: 0,
    prMerged: false,
  }),
  false,
);
assert.equal(
  shouldRemoveOnPrune({
    dirty: false,
    locked: false,
    aheadCount: 1,
    prMerged: true,
  }),
  false,
);
assert.equal(
  shouldRemoveOnPrune({
    dirty: false,
    locked: false,
    aheadCount: 0,
    prMerged: true,
  }),
  true,
);

assert.equal(
  shouldDeleteBranch({
    name: "main",
    aheadCount: 0,
    hasWorktree: false,
    prMerged: true,
    force: true,
  }),
  false,
);
assert.equal(
  shouldDeleteBranch({
    name: "wip/keep",
    aheadCount: 0,
    hasWorktree: false,
    prMerged: false,
    force: true,
  }),
  false,
);
assert.equal(
  shouldDeleteBranch({
    name: "worktree-foo",
    aheadCount: 0,
    hasWorktree: true,
    prMerged: false,
    force: false,
  }),
  false,
);
assert.equal(
  shouldDeleteBranch({
    name: "worktree-foo",
    aheadCount: 0,
    hasWorktree: false,
    prMerged: false,
    force: false,
  }),
  true,
);
assert.equal(
  shouldDeleteBranch({
    name: "worktree-foo",
    aheadCount: 2,
    hasWorktree: false,
    prMerged: false,
    force: false,
  }),
  false,
);
assert.equal(
  shouldDeleteBranch({
    name: "worktree-foo",
    aheadCount: 2,
    hasWorktree: false,
    prMerged: true,
    force: false,
  }),
  true,
);
assert.equal(
  shouldDeleteBranch({
    name: "worktree-foo",
    aheadCount: 2,
    hasWorktree: false,
    prMerged: false,
    force: true,
  }),
  true,
);

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    // `cwd` is not isolation on its own: under a git hook the environment names
    // the real repository and git prefers it. See scripts/lib/git-env.mjs.
    env: scrubGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "README.md"), "hi\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

function run(cwd, args) {
  try {
    return execFileSync(process.execPath, [script, ...args], {
      cwd,
      // worktree.mjs shells out to git; the same inherited-repo trap applies.
      env: scrubGitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = [err.stderr, err.stdout, err.message]
      .filter(Boolean)
      .join("\n");
    const wrapped = new Error(msg);
    wrapped.status = err.status;
    throw wrapped;
  }
}

const repo = initRepo();
try {
  const created = run(repo, ["create", "fix-auth"]);
  assert.match(created, /WORKTREE=/);
  const wt = join(repo, AGENT_DIR, "fix-auth");
  assert.equal(existsSync(join(wt, "README.md")), true);
  assert.equal(git(wt, ["branch", "--show-current"]), "worktree-fix-auth");
  assert.equal(
    git(wt, ["rev-parse", "HEAD"]),
    git(repo, ["rev-parse", "HEAD"]),
  );

  const listed = run(repo, ["list"]);
  assert.match(listed, /fix-auth/);
  assert.match(listed, /worktree-fix-auth/);

  assert.throws(() => run(repo, ["create", "fix-auth"]), /already exists/);

  mkdirSync(join(repo, AGENT_DIR, "taken"));
  writeFileSync(join(repo, AGENT_DIR, "taken", "stray.txt"), "nope\n");
  assert.throws(() => run(repo, ["create", "taken"]), /already exists/);

  const outside = join(repo, "not-an-agent-tree");
  mkdirSync(outside);
  assert.throws(() => run(repo, ["remove", outside]), /agent worktree/);

  run(repo, ["remove", "fix-auth"]);
  assert.equal(existsSync(wt), false);
  const branches = git(repo, ["branch"]);
  assert.equal(branches.includes("worktree-fix-auth"), false);

  const leftover = git(repo, ["worktree", "list"]);
  assert.equal(leftover.includes("fix-auth"), false);

  const pruned = run(repo, ["prune"]);
  assert.match(pruned, /nothing to remove|0 agent worktree/i);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

const repo2 = initRepo();
try {
  git(repo2, ["branch", "worktree-stale"]);
  git(repo2, ["checkout", "-b", "worktree-live"]);
  writeFileSync(join(repo2, "README.md"), "live\n");
  git(repo2, ["add", "README.md"]);
  git(repo2, ["commit", "-m", "live work"]);
  git(repo2, ["checkout", "main"]);
  git(repo2, ["branch", "feat/human"]);

  run(repo2, ["create", "keep-me"]);
  const pruned = run(repo2, ["prune"]);
  assert.match(pruned, /worktree-stale/);
  const branches = git(repo2, ["branch"]);
  assert.equal(branches.includes("worktree-stale"), false);
  assert.equal(branches.includes("worktree-live"), true);
  assert.equal(branches.includes("feat/human"), true);
  assert.equal(branches.includes("worktree-keep-me"), true);

  const bareParent = mkdtempSync(join(tmpdir(), "wt-bare-"));
  const bare = join(bareParent, "origin.git");
  execFileSync("git", ["clone", "--bare", repo2, bare], { encoding: "utf8" });
  git(repo2, ["remote", "add", "origin", bare]);
  git(join(repo2, AGENT_DIR, "keep-me"), [
    "push",
    "-u",
    "origin",
    "worktree-keep-me",
  ]);
  run(repo2, ["remove", "keep-me"]);
  const remoteHeads = git(bare, ["branch"]);
  assert.equal(remoteHeads.includes("worktree-keep-me"), false);
  assert.equal(git(repo2, ["branch"]).includes("worktree-keep-me"), false);
} finally {
  rmSync(repo2, { recursive: true, force: true });
}

if (process.platform === "win32") {
  const outside = mkdtempSync(join(tmpdir(), "wt-canary-"));
  const victim = mkdtempSync(join(tmpdir(), "wt-victim-"));
  const canary = join(outside, "canary.txt");
  writeFileSync(canary, "safe\n");
  execFileSync(
    "cmd.exe",
    ["/c", "mklink", "/J", join(victim, "node_modules"), outside],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  removeDirSafe(victim);
  assert.equal(
    existsSync(canary),
    true,
    "Windows rmdir must not follow NTFS junctions",
  );
  rmSync(outside, { recursive: true, force: true });
}

console.log("worktree tests: ok");

// ---------------------------------------------------------------------------
// preserve: work that exists nowhere but this disk
//
// The branches that sat unprotected for a week were `slice-h14`, `slice-h18`
// and friends — workflow fan-out names, never matched by isAgentBranch, so
// prune's "still has unique commits" guard never considered them at all. These
// assertions pin that the net is name-blind.

assert.equal(archiveRefFor("slice-h14"), "archive/slice-h14");
assert.equal(archiveRefFor("worktree-foo"), "archive/worktree-foo");
// Idempotent: preserving an archive ref must not nest archive/archive/...
assert.equal(archiveRefFor("archive/slice-h14"), "archive/slice-h14");

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

// The regression this exists to prevent: a non-agent-prefixed branch with
// unique commits and no archive is at risk.
assert.equal(
  needsPreserving({
    name: "slice-h14",
    aheadCount: 1,
    tipSha: SHA,
    archivedSha: "",
  }),
  true,
  "a fan-out branch with unique commits and no archive needs preserving",
);

// Nothing unique -> nothing to lose.
assert.equal(
  needsPreserving({
    name: "slice-h14",
    aheadCount: 0,
    tipSha: SHA,
    archivedSha: "",
  }),
  false,
  "a branch with no commits beyond the base needs no archive",
);

// Already archived at this exact tip -> skip, so this is cheap on a timer.
assert.equal(
  needsPreserving({
    name: "slice-h14",
    aheadCount: 1,
    tipSha: SHA,
    archivedSha: SHA,
  }),
  false,
  "a branch already archived at its current tip is skipped",
);

// Archived, then advanced -> at risk again. Comparing tips rather than mere
// existence is the whole reason this is re-runnable.
assert.equal(
  needsPreserving({
    name: "slice-h14",
    aheadCount: 2,
    tipSha: OTHER,
    archivedSha: SHA,
  }),
  true,
  "a branch that gained a commit after archiving is at risk again",
);

// Protected branches are never archived.
for (const name of ["main", "master", "develop", "dev", "wip/thing"]) {
  assert.equal(
    needsPreserving({ name, aheadCount: 5, tipSha: SHA, archivedSha: "" }),
    false,
    `${name} is protected and must not be archived`,
  );
}

// An archive ref must not archive itself.
assert.equal(
  needsPreserving({
    name: "archive/slice-h14",
    aheadCount: 1,
    tipSha: SHA,
    archivedSha: "",
  }),
  false,
  "an archive ref is not itself archived",
);

// No resolvable tip -> nothing to push. Guards against pushing a bad ref.
// archivedSha must be NON-empty here: with both empty the tip comparison is
// '' !== '' == false, so the assertion would pass whether the guard exists or
// not. That version could not go red, which a mutation run caught.
assert.equal(
  needsPreserving({
    name: "slice-h14",
    aheadCount: 1,
    tipSha: "",
    archivedSha: SHA,
  }),
  false,
  "a branch with no resolvable tip is not pushed",
);
