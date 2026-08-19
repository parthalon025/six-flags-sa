# CI/CD — scripts and workflows

Matt-standard layout: **workflows orchestrate; scripts own policy.** Do not duplicate logic in YAML when a `scripts/` entry point exists.

## `scripts/ci` module (deep seam)

| File | Interface | Role |
|------|-----------|------|
| `manifest.mjs` | `GATE_SCRIPT_TESTS` | Single list of fast guard tests |
| `gate-tests.mjs` | `runGateScriptTests()` | Gate job — runs manifest |
| `stage-version-stamps.mjs` | `stageVersionStamps()` | Bump workflow — `git add` from `version-stamp-paths.json` |
| `party-tracker-ui.mjs` | `unpackBuildArtifact()`, `waitForHealth()` | Playwright jobs — unpack artifact + health wait |
| `pre-merge-vertical.mjs` | `runPreMergeVertical()` | Agent merge gate — static + browser vertical; writes `scripts/ci/local-ci-pass.json` |
| `../lib/clerk-e2e.mjs` | `clerkE2eBlockReason()` | Auth UI diffs require Clerk-on browser e2e before merge |
| `../lib/vertical-e2e.mjs` | `requiredVerticals()`, `verticalE2eBlockReason()` | Which verticals a diff owes, and what blocks a merge without them |
| `local-ci-pass.mjs` | `runWrite()`, `runCheck()` | Writes the `local-ci-verified` stamp after a local vertical; tells GitHub which jobs it already proved |
| `../lib/local-ci-pass.mjs` | `localCiDecision()`, `STATIC_STEPS` | The tag: what a local CI run covers, and when GitHub may honour it |
| `matt-review.mjs` | `runCheck()`, `runWrite()`, `runPrompt()` | Sonnet standards-review stamp (`scripts/lib/matt-review.mjs`) — code PRs fail without a fresh stamp |
| `../lib/matt-standards.mjs` | `runMattStandardsChecks()` | Gate — scripts/lib test presence, functional↔modules sync, venue-builder path-literal lint |

Workflow YAML calls the CLIs; tests import the exported functions.

### Before merge (agents)

Always run vertical validation **before** merging a PR (from repo root with `npm ci` already done):

```bash
npm run test:pre-merge-vertical
```

The run prints the verticals the diff owes (`scripts/lib/vertical-e2e.mjs`), runs them, and refuses to stamp a pass when one did not run.

| Phase | What runs |
|-------|-----------|
| Static (floor) | `test:ci-gate` → `test:unit` → `lint` → `test:coverage-contract` → `test:module-select` → `build -w @party-tracker/app` |
| `automation` vertical | `test:ci-gate` — CI/deploy/stamp decisions through their exported functions |
| `builder` vertical | `test:builder` — assertions over generated venue output |
| `app` vertical | start app + `test:validate-ui:changed` — behaviour in a real browser |

Docs-only branches owe nothing and skip straight through. `--skip-browser` is **refused** for diffs that touch app behaviour — static steps prove the build compiles, not that a guest can still use it. Code paths no vertical claims fail closed: the diff owes every vertical until a `VERTICALS` row claims the path. See [vertical-e2e policy](./policies/vertical-e2e.md).

After a successful run, `scripts/ci/local-ci-pass.json` records the diff, the module selection, the static steps and the `verticals` that ran, tagged `local-ci-verified` (schema 3 — a stamp without the tag or without the verticals never covers a code diff). Commit that file with your branch. Use `--no-stamp` to validate without writing the file.

## `local-ci-verified` — skipping GitHub CI

The tag means *local CI already ran everything the skipped jobs would have run, over this diff*. When `test-app.yml` finds it, the jobs named in `TAG_SKIPPED_JOBS` (`scripts/lib/local-ci-pass.mjs`) are skipped instead of run a second time.

| Property | How it holds |
|----------|--------------|
| Same code | `diffHash` — the branch diff vs merge-base with the stamp files excluded, so committing the stamp never invalidates it and any code change does |
| Same everything else | base ref, merge-base, module selection, `package-lock.json` and `modules.json` hashes all have to match |
| Nothing waved through | the stamp must list every step in `STATIC_STEPS` and every vertical the diff owes; `pre-merge-vertical` writes it only after they all pass |
| Not written by hand | `local-ci-pass.mjs write` (the hand path) records no tag and no verticals, so it can only ever skip the narrower UI matrix |

`gate` and `select` never skip — `select` is the job that reads the tag, and something unskippable has to.

`gitnexus` (soft) never skips either, on purpose: it exists to prove GitNexus still installs on a clean runner, which is exactly the thing a local run cannot vouch for — the agent's own session either has an index already or failed to build one.

**The stamp is self-attested.** Anyone who can push to the branch can also write a `local-ci-verified` JSON by hand and skip those jobs; the checks above stop a *stale* or *incomplete* stamp, not a dishonest one. That is the same trust model as `matt-review-pass.json`, and it is why review and branch protection stay the real control on what merges. Label a PR `full-ci` when you want the jobs run regardless.

Two things always run full CI regardless of the stamp:

- **Pushes to `main`.** The merge commit is a different diff from any PR head, and it is the tree we ship.
- **`full-ci`.** Label the PR `full-ci`, or put `[full-ci]` in its title, and the tag is ignored for that run.

Re-run `npm run test:pre-merge-vertical` after changing code or dependencies — a stale stamp is ignored, the `Select modules` job summary says why, and CI runs everything.

### Pre-push hook

`.husky/pre-push` runs `npm run test:pre-merge-vertical` before every `git push` (skipped for `main`, and for delete-only pushes). It exists so the stamp is never missing by accident — GitHub credits are only saved when the tag is actually there. `shouldSkipLocalPreMerge` makes a repeat push with no new commits cost nothing: the hook re-runs the script, and the script exits immediately once it sees the existing stamp still covers the tree.

Emergency bypass: `HUSKY=0 git push`. That skips the hook, not the requirement — GitHub runs full CI on that push instead of skipping the jobs a local run would have covered.

## Test app (`.github/workflows/test-app.yml`)

**Touch-only policy:** PRs and `main` pushes run only modules matched by the diff — not the full matrix every time.

| Event | Diff base | What runs |
|-------|-----------|-----------|
| **Pull request** | `merge-base...HEAD` vs PR base branch | Matching modules from `modules.json` |
| **Push to `main`** | `HEAD^1...HEAD` (this commit only) | Same — merge commit ≈ PR files; stamp-only ≈ nothing |
| **`chore: bump version to …`** | — | **Workflow skipped** (Post-merge bump already validated the merge) |

`fullSuitePaths` in `modules.json` still forces all modules when e.g. `functional.mjs` or `test-app.yml` changes. Version-stamp-only file lists bypass full-suite triggers.

`CONTEXT.md` / `docs/adr/**` diffs select the coverage-contract job; it fails on a stale context stamp until `test/app/critical-paths.json` is reviewed against the new capabilities and restamped (`node test/app/coverage-contract.mjs --stamp`).

Optional safety net: `.github/workflows/validate-ui-weekly.yml` runs `npm run test:validate-ui -- --all` every Sunday 08:00 UTC (or `workflow_dispatch`).

| Step | Script / command |
|------|------------------|
| Gate — script invariants | `node scripts/ci/gate-tests.mjs` |
| Gate — README gallery | `node test/app/readme-shots-check.mjs` |
| Module selection | `node test/app/select-modules.mjs` |
| `local-ci-verified` tag | `node scripts/ci/local-ci-pass.mjs check` |
| Boundaries | `npm run lint:boundaries` |
| Unit-ish layers | `npm run test:builder`, `npm run test:coverage-contract` |
| UI unpack / start | `node scripts/ci/party-tracker-ui.mjs unpack\|start` |
| Full local gate | `npm run test:ci-gate` |

## Post-merge (`.github/workflows/bump-version.yml`)

| Step | Script |
|------|--------|
| Semver + stamps | `node scripts/bump-version.mjs` |
| Stage stamp files | `node scripts/ci/stage-version-stamps.mjs` (paths from `scripts/lib/version-stamp-paths.json`) |

## Vercel deploy

| Concern | Script |
|---------|--------|
| Build / skip decision | `scripts/vercel-ignore.sh` → `scripts/lib/vercel-ignore.mjs` |
| Budget caps | `scripts/lib/vercel-budget.mjs` |

Previews skip unless user-directed; production app merges on `main` use the automation pool (~75/day). See [app-updates.md](../app-updates.md).

## Other workflows

| Workflow | Purpose |
|----------|---------|
| `skills-lock.yml` | `npm run skills:check` — no vendored Matt skills |
| `drift-watch.yml` | Weekly `npm run venues:drift-watch` → agent-handoff issue |
| `validate-ui-weekly.yml` | Sunday full `npm run test:validate-ui -- --all` safety net |
| `build-venue.yml` | Manual venue PR builder |
| `databricks-bundle.yml` | Bundle deploy (paused schedules pre-launch) |
| `store.yml` / `ios-app-store-metadata.yml` | Store metadata lanes |

## Changing CI

1. Extend `scripts/lib` or `scripts/ci` first; keep workflow YAML thin.
2. Add a row to this file and `.cursor/rules/scripts-over-instructions.mdc` when you add a new entry point.
3. Wire fast guards into `scripts/ci/manifest.mjs` (run via `npm run test:ci-gate`) so PRs cannot merge broken deploy/skip logic.
