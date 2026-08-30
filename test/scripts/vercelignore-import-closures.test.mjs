#!/usr/bin/env node
/**
 * .vercelignore must upload every file its own entry points actually import,
 * for every block that carves an allowlist out of an otherwise-excluded
 * directory tree — and must keep the rest of each tree excluded.
 *
 * The failure mode is the same in both blocks this file checks, and it has
 * bitten this exact allowlist-pattern twice now:
 *
 *   1. packages/venue-builder/** at the top of the old block excluded the
 *      whole package, then tried to re-include files under it with patterns
 *      like `!packages/venue-builder/lib/delivery/**`. Gitignore/vercelignore
 *      forbid re-including a path whose PARENT directory is already
 *      excluded — the negation never took effect, `lib/delivery/index.mjs`
 *      never uploaded, and every Vercel build died with "Module not found:
 *      Can't resolve '@party-tracker/venue-builder/delivery.js'" (#706,
 *      commit 640f4e8 hit this same wall by adding more negations under the
 *      same excluded parent).
 *
 *   2. Even after that block was rewritten one directory level at a time,
 *      the must-upload list was hand-transcribed from a one-off trace and
 *      silently dropped lib/ambient-signal-seeds.mjs — imported by two files
 *      that WERE on the list, so the upload again contained a file without
 *      the file it imports.
 *
 *   3. The scripts/** block has the identical `!scripts/lib/` un-ignore-the-
 *      directory pattern, and the identical hand-maintained-list problem:
 *      scripts/lib/git-env.mjs and scripts/lib/release-bump.mjs are real
 *      imports of the Vercel ignoreCommand's own entry points and were both
 *      missing. In production this crashed the preview ignoreCommand itself
 *      (`ERR_MODULE_NOT_FOUND` on git-env.mjs, ~/vercel-ignore.sh) before
 *      `decideVercelBuild` ever ran — Vercel fell back to building every
 *      preview, which is the actual mechanism behind the agent-preview
 *      budget leak, not merely a branch-order bug in decideVercelBuild.
 *
 * So the must-upload set for each block is never a hand-typed list — that is
 * exactly what drifts. It is the real transitive import closure, computed by
 * computeImportClosure() (scripts/lib/import-closure.mjs, which follows
 * every relative import/export/dynamic-import()/require()) from each
 * block's real entry points, asserted against the actual `.vercelignore`
 * DECISION via `git check-ignore` over a fixture repo (so this also catches
 * a future edit that reintroduces the excluded-parent trap) — not just that
 * some command exits zero.
 *
 *   node test/scripts/vercelignore-import-closures.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { computeImportClosure } from '../../scripts/lib/import-closure.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const vercelIgnore = readFileSync(join(root, '.vercelignore'), 'utf8');

function gitCheckIgnore(cwd, path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd, env: scrubGitEnv() });
    return true; // exit 0 => ignored
  } catch (err) {
    if (err.status === 1) return false; // not ignored
    throw err; // exit >1 => fatal (bad pattern etc.)
  }
}

const BLOCKS = [
  {
    name: 'packages/venue-builder',
    // Entries as repo-root-relative paths (not package-relative): the
    // closure can legitimately reach outside packages/venue-builder —
    // venue-report-gate.mjs reaches into apps/party-tracker/lib/venue/ids.js
    // — and repo-root-relative paths are what .vercelignore patterns (and
    // git check-ignore) key on, so nothing needs re-prefixing (and
    // mis-prefixing) after the trace.
    entries: [
      // The two subpaths apps/party-tracker actually imports (see
      // apps/party-tracker/app/api/venues/[venueId]/bundle/route.js and
      // apps/party-tracker/lib/venueCompare.js). Real runtime need.
      'packages/venue-builder/lib/delivery/index.mjs',
      'packages/venue-builder/src/paths.mjs',
      // Exported in package.json's `exports` map (./venue-report-gate.js)
      // but not reachable from the two entries above, and nothing in
      // apps/party-tracker imports it today (only bin/ CLI scripts and
      // tests do, and those stay excluded independently). Kept uploaded for
      // exports-map parity, not runtime need.
      'packages/venue-builder/lib/venue-report-gate.mjs',
    ],
    // package.json is never imported by JS, but npm workspaces needs it on
    // disk to resolve the package at all.
    alsoMustUpload: ['packages/venue-builder/package.json'],
    // Never needed at runtime by the deployed app — must stay out of the
    // upload so it stays lean. lib/adapters, lib/map-factory and
    // lib/visual-factory are large factory trees; only the thin seams the
    // closure pulls in are needed, so the rest of each directory must stay
    // excluded.
    mustStayExcluded: [
      'packages/venue-builder/data/whatever.json',
      'packages/venue-builder/bin/build-venue.mjs',
      'packages/venue-builder/bin/attractions.mjs',
      'packages/venue-builder/lib/map-factory/index.mjs',
      'packages/venue-builder/lib/visual-factory/index.mjs',
      'packages/venue-builder/lib/build-pipeline.mjs',
      'packages/venue-builder/src/compare.mjs',
      'packages/venue-builder/src/bake-drift.mjs',
    ],
    // The exact failure this fix repairs — kept as its own headline assertion.
    headline: {
      file: 'packages/venue-builder/lib/delivery/index.mjs',
      because:
        'this exact file is what "Module not found: Can\'t resolve ' +
        "'@party-tracker/venue-builder/delivery.js'\" could not resolve",
    },
  },
  {
    name: 'scripts',
    // The two entry points Vercel actually executes: the ignoreCommand
    // (scripts/vercel-ignore.sh -> node scripts/lib/vercel-ignore.mjs) and
    // the post-merge bump (scripts/bump-version.mjs). scripts/vercel-ignore.sh
    // is bash, not JS — computeImportClosure finds no import-shaped specifiers
    // in it, so it is included as a leaf entry, not a source of further files.
    entries: [
      'scripts/lib/vercel-ignore.mjs',
      'scripts/bump-version.mjs',
      'scripts/vercel-ignore.sh',
    ],
    alsoMustUpload: [],
    // A large, arbitrary sample of scripts nothing in the ignoreCommand or
    // bump path reaches — must stay excluded so the upload stays lean.
    mustStayExcluded: [
      'scripts/ci/pre-merge-vertical.mjs',
      'scripts/ci/gate-tests.mjs',
      'scripts/ci/manifest.mjs',
      'scripts/worktree.mjs',
      'scripts/lib/matt-review.mjs',
      'scripts/lib/vertical-e2e.mjs',
    ],
    // The exact failure this fix repairs: the preview ignoreCommand crashed
    // on this import before decideVercelBuild ever ran, so Vercel fell back
    // to building every preview — the real mechanism behind the
    // agent-preview budget leak.
    headline: {
      file: 'scripts/lib/git-env.mjs',
      because:
        'scripts/lib/vercel-ignore.mjs imports this at its top level — missing it crashed the ' +
        'ignoreCommand with ERR_MODULE_NOT_FOUND before decideVercelBuild ever ran, so Vercel fell ' +
        'open and built every preview',
    },
  },
];

const fixture = mkdtempSync(join(tmpdir(), 'vercelignore-closures-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: fixture, env: scrubGitEnv() });
  // .vercelignore uses the same pattern syntax as .gitignore (documented Vercel
  // behavior) — check-ignore only reads files literally named .gitignore.
  writeFileSync(join(fixture, '.gitignore'), vercelIgnore);

  let totalUploaded = 0;
  for (const block of BLOCKS) {
    const closure = computeImportClosure({ root, entries: block.entries });
    assert.deepEqual(
      closure.unresolved,
      [],
      `${block.name}: import-closure trace found unresolved relative imports ` +
        `(broken source, or the tracer needs a fix): ${closure.unresolved.join(', ')}`,
    );

    const mustUpload = [...block.alsoMustUpload, ...closure.files];
    totalUploaded += mustUpload.length;
    for (const path of mustUpload) {
      assert.equal(
        gitCheckIgnore(fixture, path),
        false,
        `.vercelignore must upload ${path} — reached by the real import closure of ${block.entries.join(', ')}`,
      );
    }
    for (const path of block.mustStayExcluded) {
      assert.equal(
        gitCheckIgnore(fixture, path),
        true,
        `.vercelignore must keep ${path} excluded — the ${block.name} upload must stay lean`,
      );
    }
    assert.equal(
      gitCheckIgnore(fixture, block.headline.file),
      false,
      `${block.headline.file} must upload — ${block.headline.because}`,
    );
  }
  console.log(`vercelignore-import-closures: ok (${totalUploaded} must-upload files derived across ${BLOCKS.length} blocks)`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

// Guard the failure mode itself: a bare `packages/venue-builder/**` (or any
// `lib/**`/`src/**` under it) exclude is exactly what breaks re-inclusion of
// anything nested below it — assert the block instead excludes one directory
// LEVEL at a time (`lib/*`, not `lib/**`).
assert.doesNotMatch(
  vercelIgnore,
  /^packages\/venue-builder\/\*\*$/m,
  'packages/venue-builder/** excludes the whole subtree — negations below it silently no-op (the #706 bug)',
);
assert.doesNotMatch(
  vercelIgnore,
  /^packages\/venue-builder\/lib\/\*\*$/m,
  'packages/venue-builder/lib/** excludes the whole lib subtree — negations below it silently no-op',
);
assert.match(
  vercelIgnore,
  /^packages\/venue-builder\/\*$/m,
  'must exclude venue-builder one level at a time so nested re-includes actually apply',
);
