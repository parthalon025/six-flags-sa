# CI/CD — scripts and workflows

Matt-standard layout: **workflows orchestrate; scripts own policy.** Do not duplicate logic in YAML when a `scripts/` entry point exists.

## `scripts/ci` module (deep seam)

| File | Interface | Role |
|------|-----------|------|
| `manifest.mjs` | `GATE_SCRIPT_TESTS` | Single list of fast guard tests |
| `gate-tests.mjs` | `runGateScriptTests()` | Gate job — runs manifest |
| `stage-version-stamps.mjs` | `stageVersionStamps()` | Bump workflow — `git add` from `version-stamp-paths.json` |
| `party-tracker-ui.mjs` | `unpackBuildArtifact()`, `waitForHealth()` | Playwright jobs — unpack artifact + health wait |
| `pre-merge-vertical.mjs` | `runPreMergeVertical()` | Agent merge gate — static + browser vertical; writes the `local-ci-pass` cache |
| `../lib/clerk-e2e.mjs` | `clerkE2eBlockReason()` | Auth UI diffs require Clerk-on browser e2e before merge |
| `../lib/app-test-origin.mjs` | `appOrigin()`, `allocateAppPort()`, `probeAppHealth()`, `watchOriginHealth()` | Less-contended default port (3118), ephemeral port allocation, and health probes for UI validation |
| `../lib/ci-lane-plan.mjs` | `canonLanePlan()`, `staticStepsForFiles()`, `laneGithubOutputs()` | Canon lanes → static steps and GitHub job flags (GitHub mirrors this) |
| `../lib/vertical-e2e.mjs` | `requiredVerticals()`, `verticalE2eBlockReason()` | Which verticals a diff owes, and what blocks a merge without them |
| `local-ci-pass.mjs` | `runWrite()`, `runCheck()` | Writes the `local-ci-verified` stamp after a local vertical; tells GitHub which jobs it already proved |
| `../lib/local-ci-pass.mjs` | `localCiDecision()`, `STATIC_STEPS` | The tag: what a local CI run covers, and when GitHub may honour it |
| `stamp-commit.mjs` | `runStampCommit()` | Publishes both gate stamps as trailers on one empty commit |
| `../lib/stamp-trailer.mjs` | `publishStamps()`, `findStamp()` | Stamps as commit trailers — the transport a merge cannot conflict on |
| `matt-review.mjs` | `runCheck()`, `runWrite()`, `runPrompt()`, `runTwoAxis()` | Two-axis review prompts + Sonnet standards-review stamp (`scripts/lib/matt-review.mjs`) — code PRs fail without a fresh stamp |
| `../lib/matt-standards.mjs` | `runMattStandardsChecks()` | Gate — scripts/lib test presence, functional↔modules sync, venue-builder path-literal lint |
| `pre-push.mjs` | `main()` (`scripts/lib/pre-push.mjs`: `prePushDecision()`) | `.husky/pre-push` entry point — decides whether a `git push` owes a local CI run |
| `../lib/git-hooks.mjs` | `ensureWorktreeHooks()`, `prePushRunnable()` | Pins `core.hooksPath` to tracked `.husky/` scripts; worktree `node_modules` symlink + readiness |
| — | `scrubGitEnv()` (`scripts/lib/git-env.mjs`) | Strips git's inherited repository out of anything a hook spawns |

Workflow YAML calls the CLIs; tests import the exported functions.

### Before merge (agents)

Always run vertical validation **before** merging a PR (from repo root with `npm ci` already done):

```bash
npm run test:pre-merge-vertical
```

The run prints the verticals the diff owes (`scripts/lib/vertical-e2e.mjs`), runs them, and refuses to stamp a pass when one did not run.

| Phase | What runs |
|-------|-----------|
| Docs-only | Stamp only — no static floor or verticals (matches GitHub touch-only skip) |
| Agent policy / wayfinder | Thin policy tests only (`scripts/lib/agent-policy-diff.mjs`) — no static floor, verticals, or matt-review |
| Static (lane-derived) | Subset of `STATIC_STEPS` from `scripts/lib/ci-lane-plan.mjs` — app/guest lane owes the full floor; backside owes `test:ci-gate` only |
| `backside` vertical | `test:ci-gate` — scripts, API routes, server libs, non-UI packages |
| `builder` vertical | `test:builder` (+ factory legs when paths require) — assertions over generated venue output |
| `app` vertical | guest module-select only — start app + `test:validate-ui:changed` + zoom sweep in a real browser |

Canon lane plan (`scripts/lib/ci-lane-plan.mjs`) is the source of truth for which static steps and GitHub jobs a diff owes. GitHub `test-app.yml` reads `scripts/ci/lane-plan.mjs` outputs (`canon_*`) so workflow jobs mirror the same lanes. Policy: `scripts/lib/vertical-e2e.mjs`, `scripts/lib/ci-lane-plan.mjs`, and `scripts/lib/agent-policy-diff.mjs`. See [vertical-e2e policy](./policies/vertical-e2e.md).

After a successful run, `scripts/ci/local-ci-pass.json` records the diff, the module selection, the static steps and the `verticals` that ran, tagged `local-ci-verified` (schema 3 — a stamp without the tag or without the verticals never covers a code diff). That file is a **local cache**, gitignored; publish it with `node scripts/ci/stamp-commit.mjs`. Use `--no-stamp` to validate without writing the cache.

### Stamps travel as commit trailers

Both gate stamps are regenerated on every branch, so while they were tracked JSON, any two branches modified the same two files and every merge from `main` raised a conflict on them. Measured on 2026-08-29 with `git merge-tree --write-tree origin/main <pr head>` across the 13 open PRs: 7 conflicted on a stamp file, and for 2 of those the stamp was the *only* thing in the way. `.gitattributes merge=keep-ours` only hid that locally: a merge driver is a shell command registered in `.git/config`, so GitHub's server-side merge never runs one and still reported the PR unmergeable.

`scripts/ci/stamp-commit.mjs` publishes both stamps as trailers on one **empty** commit instead:

```
chore(ci): publish CI stamps

Local-Ci-Pass: {"schema":3,…}
Matt-Review-Pass: {"schema":1,…}
```

Commit messages are per-commit facts and are never merged, so once a branch is on this transport no merge path can conflict on its stamps. (A branch still carrying the old tracked files is not there yet — see the transition note below.) The commit is empty, so it cannot move `diffHash` either. Readers (`readLocalCiPass`, `readMattReview`) scan `mergeBase..HEAD` for a trailer and still judge by `diffHash`, so a trailer merged in from another branch is inert rather than trusted; when a branch holds both a trailer and a fresh local cache, whichever records *this* diff wins. Policy: `scripts/lib/stamp-trailer.mjs`.

A branch that still carries the old tracked stamp files keeps working — the file is read when no trailer covers the range. Crossing over costs one conflict, once:

```
CONFLICT (modify/delete): scripts/ci/local-ci-pass.json deleted in main and modified in HEAD
```

Resolve it with `git rm --ignore-unmatch scripts/ci/local-ci-pass.json scripts/ci/matt-review-pass.json`, then re-stamp. `--ignore-unmatch` is load-bearing: `git rm` is all-or-nothing over its pathspec, and most branches only ever re-stamped `matt-review-pass.json` since their merge base — so `local-ci-pass.json` merged cleanly, is already gone from the index, and the bare command aborts with `fatal: pathspec … did not match any files` having removed *neither* file. Expect one conflicted path, not always two. Every merge after that is clean, which is the trade: one modify/delete per in-flight branch, instead of a content conflict on every branch↔main merge forever.

## `local-ci-verified` — skipping GitHub CI

The tag means *local CI already ran everything the skipped jobs would have run, over this diff*. When `test-app.yml` finds it, the jobs named in `TAG_SKIPPED_JOBS` (`scripts/lib/local-ci-pass.mjs`) are skipped instead of run a second time.

| Property | How it holds |
|----------|--------------|
| Same code | `diffHash` — merge-base…PR head vs base (stamp files excluded). GitHub passes `--head` from `pull_request.head.sha` so the hash matches local runs on the branch tip, not the merge commit checkout |
| Same proof | `staticSteps`, `verticals`, `factoryLegs`, and `browserVertical` when the canon lanes require them — not module-select alone |
| Nothing waved through | the stamp must list every static step and vertical the diff owes; `stampProvesLocalRun()` gates `skip_ci` |
| Not written by hand | `local-ci-pass.mjs write` (the hand path) records no tag and no verticals, so it can only ever skip the narrower UI matrix |

`gate` and `select` never skip — `select` is the job that reads the tag, and something unskippable has to.

`gitnexus` (soft) never skips either, on purpose: it exists to prove GitNexus still installs on a clean runner, which is exactly the thing a local run cannot vouch for — the agent's own session either has an index already or failed to build one.

**The stamp is self-attested.** Anyone who can push to the branch can also write a `local-ci-verified` JSON by hand and skip those jobs; the checks above stop a *stale* or *incomplete* stamp, not a dishonest one. The trailer transport inherits exactly that boundary and no more: a stamp is honoured when it sits on this branch's own commits and records this diff, so the accidental paths — a revert-and-re-land, a backport, a cherry-pick of the *code* — cannot inherit another branch's stamp. Cherry-picking the *stamp commit itself* onto your branch would, because then it genuinely is one of your commits. That is deliberate fraud rather than a CI-shape accident, and it is the same thing hand-writing the JSON always allowed. That is the same trust model as the matt-review stamp, and it is why review and branch protection stay the real control on what merges. Label a PR `full-ci` when you want the jobs run regardless.

Two things always run full CI regardless of the stamp:

- **Pushes to `main`.** The merge commit is a different diff from any PR head, and it is the tree we ship.
- **`full-ci`.** Label the PR `full-ci`, or put `[full-ci]` in its title, and the tag is ignored for that run.

Re-run `npm run test:pre-merge-vertical` after changing code or dependencies — a stale stamp is ignored, the `Select modules` job summary says why, and CI runs everything.

### Pre-push hook

`.husky/pre-push` calls `scripts/ci/pre-push.mjs`, which runs `npm run test:pre-merge-vertical` before every `git push`. The decision — skip for a push made up only of `refs/heads/main` updates (main always runs full CI regardless of the stamp) or a delete-only push, otherwise run — is `prePushDecision()` in `scripts/lib/pre-push.mjs` (tested in `test/scripts/pre-push.test.mjs`), judged from the refs git is actually pushing rather than the branch checked out locally. It exists so the stamp is never missing by accident — GitHub credits are only saved when the tag is actually there. `shouldSkipLocalPreMerge` makes a repeat push with no new commits cost nothing: the hook re-runs the script, and the script exits immediately once it sees the existing stamp still covers the tree.

`PRE_PUSH_SKIP_BROWSER=1 git push` passes `--skip-browser` through for a faster local check; `test:pre-merge-vertical` still refuses to skip the browser vertical for a diff that touches app behaviour, so this only speeds up pushes that don't need it.

Emergency bypass: `HUSKY=0 git push`. That skips the hook, not the requirement — GitHub runs full CI on that push instead of skipping the jobs a local run would have covered.

`npm install` runs husky, then pins `core.hooksPath` to the tracked `.husky/` scripts (not husky's generated `.husky/_` shims, which are gitignored and absent in fresh worktrees). If `node_modules` is missing, `.husky/pre-push` refuses with a message instead of silently skipping — see `scripts/lib/git-hooks.mjs` (`test/scripts/git-hooks.test.mjs`).

#### Worktrees and the pre-push hook

`npm run worktree:create` calls `ensureWorktreeHooks()` (`scripts/lib/git-hooks.mjs`): it sets `core.hooksPath=.husky` in the new tree and symlinks `node_modules` from the primary checkout when the worktree does not already have one. A push from that worktree therefore runs the same gate as the primary checkout. Raw `git worktree add` without that setup still has the tracked `.husky/pre-push` hook (git checks out tracked files), but without `node_modules` the hook refuses loudly rather than no-oping.

#### The hook's repository does not belong to the suite

Git resolves the repository *before* running a hook and passes it down in the environment (`GIT_DIR`, `GIT_INDEX_FILE`, and the rest — `scripts/lib/git-env.mjs` has the list). Those variables outrank `cwd`: with `GIT_DIR` set and no `GIT_WORK_TREE`, git treats the current directory as the work tree and the inherited `GIT_DIR` as the repository. Several script tests build a throwaway repo in a tmpdir, so unscrubbed they stage the tmpdir's fixtures and commit them onto the branch being pushed.

That is not a hypothetical: on the first push after the hook landed it truncated `README.md` and `apps/party-tracker/app/page.js` to one line each and wrote `user.name = Test` into `.git/config`.

So `pre-push.mjs` spawns the run through `scrubGitEnv()`, the `scripts/lib` modules that take an explicit repo directory scrub at their own `git()` wrapper, and `test/scripts/git-env.test.mjs` fails any test that calls `git init` without importing `scrubGitEnv`. The end-to-end legs in that test assert both directions — scrubbed leaves the outer repo alone, leaked corrupts it — so the guard cannot rot into a test that passes for the wrong reason.

### Auto-ready draft PRs

The `auto-ready` job in `test-app.yml` marks a draft PR ready for review automatically once `select` reports `skip_ci == 'true'` — i.e. a fresh `local-ci-verified` tag covers the diff, so a human has nothing left to gate before review starts. It runs `gh pr ready` with the job's own `pull-requests: write` permission (scoped to that job only; the workflow's default is `contents: read`). It is not in the `ci` job's `needs:` list — it can never block a merge, whatever it does.

The job is skipped entirely for a non-PR event, an already-ready PR, or no tag. For a draft PR from a **fork** that does carry a fresh tag, the job still runs — a fork's `GITHUB_TOKEN` on the `pull_request` event is read-only regardless of the permissions block, so `gh pr ready` fails there rather than being skipped. `continue-on-error: true` on that step is what keeps the expected failure from showing red on a job nothing depends on.

## Test app (`.github/workflows/test-app.yml`)

**Touch-only policy:** PRs and `main` pushes run only modules matched by the diff — not the full matrix every time.

| Event | Diff base | What runs |
|-------|-----------|-----------|
| **Pull request** | `merge-base...HEAD` vs PR base branch | Matching modules from `modules.json` |
| **Push to `main`** | `HEAD^1...HEAD` (this commit only) | Same — merge commit ≈ PR files; stamp-only ≈ nothing |
| **`chore: bump version to …`** | — | **Workflow skipped** (Post-merge bump already validated the merge) |

`fullSuitePaths` in `modules.json` still forces all modules when e.g. `functional.mjs` or `test-app.yml` changes. Version-stamp-only file lists bypass full-suite triggers.

`CONTEXT.md` / `docs/adr/**` diffs select no module: they are read by people, and no suite can check that a capability row still means what it says.

Optional safety net: `.github/workflows/validate-ui-weekly.yml` runs `npm run test:validate-ui -- --all` every Sunday 08:00 UTC (or `workflow_dispatch`).

| Step | Script / command |
|------|------------------|
| Gate — script invariants | `node scripts/ci/gate-tests.mjs` |
| Gate — README gallery | `node test/app/readme-shots-check.mjs` |
| Module selection | `node test/app/select-modules.mjs` |
| `local-ci-verified` tag | `node scripts/ci/local-ci-pass.mjs check` |
| Boundaries | `npm run lint:boundaries` |
| Unit-ish layers | `npm run test:builder` |
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
2. Add a row to the `scripts/ci` table above when you add a new entry point. (This step used to also say "and `.cursor/rules/scripts-over-instructions.mdc`". That file is generated — `renderCursorRule` in `scripts/lib/agent-docs/compose.mjs` always emits a slim pointer — so a hand-added row there is silently clobbered by the next `npm run agent-docs:build`.)
3. Wire fast guards into `scripts/ci/manifest.mjs` (run via `npm run test:ci-gate`) so PRs cannot merge broken deploy/skip logic.
