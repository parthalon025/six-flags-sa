# Scripts over instructions

If a repo script, npm script, or GitHub workflow already performs or enforces a step, **do not duplicate that procedure** in `AGENTS.md`, `CLAUDE.md`, or extra cursor rules.

- **Fix or extend the script** when automation is wrong or incomplete.
- **Agent docs are for judgment** the automation cannot make — when to push, when a preview is worth it, builder-vs-app tradeoffs, etc.
- **One pointer beats a paragraph:** link the script or `npm run …` command instead of restating its logic.

Examples already handled by scripts (read the file, do not re-document the internals):

| Concern | Use this |
|---------|----------|
| Skip Vercel builds / deploy budget (25 user, ~75 automation) | `scripts/lib/vercel-budget.mjs` + `scripts/lib/vercel-ignore.mjs` via `scripts/vercel-ignore.sh` (`vercel.json` `ignoreCommand`) |
| Post-merge version stamp files (bump + ignore skip) | `scripts/lib/version-stamp-paths.json` + `scripts/lib/version-stamp.mjs` |
| Normalize repo-relative paths in scripts | `scripts/lib/repo-path.mjs` |
| CI gate script tests (gitnexus, bump, vercel, stamps) | `npm run test:ci-gate` → `scripts/ci/gate-tests.mjs` |
| Stage version bump files on main | `scripts/ci/stage-version-stamps.mjs` |
| Playwright UI job unpack/start | `scripts/ci/party-tracker-ui.mjs` |
| CI gate manifest | `scripts/ci/manifest.mjs` |
| Pre-merge vertical validation | `npm run test:pre-merge-vertical` → `scripts/ci/pre-merge-vertical.mjs` |
| Which verticals a code diff owes | `scripts/lib/vertical-e2e.mjs` (see vertical-e2e policy) |
| Clerk-on e2e before merge (auth UI) | `scripts/lib/clerk-e2e.mjs` |
| Production Sign in with Apple (Services ID, Clerk flags) | `scripts/lib/clerk-apple-prod-spec.json` + `npm run clerk:check` |
| CI/CD workflow map | [docs/agents/ci.md](../ci.md) |
| Stamp app version on dev/build | `apps/party-tracker/scripts/inject-version.mjs` (`predev` / `prebuild`) |
| Bump semver after merge to `main` | `.github/workflows/bump-version.yml` → `scripts/bump-version.mjs` |
| Regenerate venue output | `npm run venues:build` / `venues:rebuild` (see builder-app-contract policy) |
| Session GitNexus graph | `npm run gitnexus:startup` (gitignored; see gitnexus-sync policy) |
| Isolate agent work in a git worktree | `npm run worktree:create` / `worktree:remove` / `worktree:prune` (`scripts/worktree.mjs`) |
| Install Matt Pocock skills globally | `node scripts/install-global-skills.mjs` (Cloud `install` in `.cursor/environment.json`) |
| Route a task to a team member / model tier | `npm run orchestrator:route -- "<task>"` / `orchestrator:plan` (`scripts/lib/orchestrator/route.mjs`, roster in `roster.json`) |
| Compose agent docs from policy templates | `npm run agent-docs:build` / `agent-docs:check` (`scripts/lib/agent-docs/compose.mjs`) |
| GitHub issue forms | `docs/agents/templates/github/*.yml` → `.github/ISSUE_TEMPLATE/` via `agent-docs:build` |
| Package entry points | [packages/README.md](../../packages/README.md) |
| Apple Identifiers vs Xcode vs Keys | `scripts/lib/apple-developer.json` + `scripts/lib/apple-developer.mjs` (human steps: [docs/guide/apple-developer.md](../../guide/apple-developer.md)) |

When adding new policy, ask: *can a script or workflow own this?* If yes, write that first and keep agent instructions to when and why to invoke it.
