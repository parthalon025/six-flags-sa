# CI/CD — scripts and workflows

Matt-standard layout: **workflows orchestrate; scripts own policy.** Do not duplicate logic in YAML when a `scripts/` entry point exists.

## `scripts/ci` module (deep seam)

| File | Interface | Role |
|------|-----------|------|
| `manifest.mjs` | `GATE_SCRIPT_TESTS` | Single list of fast guard tests |
| `gate-tests.mjs` | `runGateScriptTests()` | Gate job — runs manifest |
| `stage-version-stamps.mjs` | `stageVersionStamps()` | Bump workflow — `git add` from `version-stamp-paths.json` |
| `party-tracker-ui.mjs` | `unpackBuildArtifact()`, `waitForHealth()` | Playwright jobs — unpack artifact + health wait |
| `pre-merge-vertical.mjs` | `runPreMergeVertical()` | Agent merge gate — static + browser vertical |

Workflow YAML calls the CLIs; tests import the exported functions.

### Before merge (agents)

Always run vertical validation **before** merging a PR (from repo root with `npm ci` already done):

```bash
npm run test:pre-merge-vertical
```

| Phase | What runs |
|-------|-----------|
| Static | `test:ci-gate` → `test:unit` → `build -w @party-tracker/app` |
| Browser vertical | When the branch diff selects UI modules: start app + `test:validate-ui:changed` |

CI-only / docs-only branches skip the browser phase automatically. Use `--skip-browser` only when Playwright cannot run (document why in the PR).

## Test app (`.github/workflows/test-app.yml`)

| Step | Script / command |
|------|------------------|
| Gate — script invariants | `node scripts/ci/gate-tests.mjs` then `node scripts/gitnexus-ci.mjs` |
| Gate — README gallery | `node test/app/readme-shots-check.mjs` |
| Module selection | `node test/app/select-modules.mjs` |
| Boundaries | `npm run lint:boundaries` |
| Unit-ish layers | `npm run test:builder`, `npm run test:coverage-contract` |
| UI unpack / start | `node scripts/ci/party-tracker-ui.mjs unpack\|start` |
| Full local gate | `npm run test:ci-gate` |

`gate` skips expensive jobs when `scripts/gitnexus-ci.mjs` classifies a commit as GitNexus-only.

## Post-merge (`.github/workflows/bump-version.yml`)

| Step | Script |
|------|--------|
| Skip GitNexus-only | `node scripts/gitnexus-ci.mjs` |
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
| `build-venue.yml` | Manual venue PR builder |
| `databricks-bundle.yml` | Bundle deploy (paused schedules pre-launch) |
| `store.yml` / `ios-app-store-metadata.yml` | Store metadata lanes |

## Changing CI

1. Extend `scripts/lib` or `scripts/ci` first; keep workflow YAML thin.
2. Add a row to this file and `.cursor/rules/scripts-over-instructions.mdc` when you add a new entry point.
3. Wire fast guards into `scripts/ci/manifest.mjs` (run via `npm run test:ci-gate`) so PRs cannot merge broken deploy/skip logic.
