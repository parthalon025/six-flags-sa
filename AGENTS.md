<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project uses GitNexus for code intelligence. The index is **session-local**
under `.gitnexus/` (gitignored — not on GitHub). Run `npm run gitnexus:startup`
at session start, then query the graph with the GitNexus MCP / CLI tools.

> No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` from the project root
> (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.
- NEVER commit `.gitnexus/` or GitNexus-generated hunks in `AGENTS.md` / `CLAUDE.md`.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/six-flags-sa/context` | Codebase overview, check index freshness |
| `gitnexus://repo/six-flags-sa/clusters` | All functional areas |
| `gitnexus://repo/six-flags-sa/processes` | All execution flows |
| `gitnexus://repo/six-flags-sa/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Isolate in a worktree

Implementation, refactors, and parallel agent work run in a git worktree. Create one before the first edit; remove it when the task is done.

- Create: `npm run worktree:create -- <slug>` (Claude Code: `EnterWorktree` or `claude --worktree <slug>`). The script cuts from `origin/main`.
- Finish: `npm run worktree:remove -- <slug>` after the branch is pushed or the work is discarded — that also deletes the `worktree-*` branch (local, and origin when empty, merged, or discarded). `npm run worktree:prune` drops leftover `worktree-*` branches with no worktree; `--merged` also drops merged worktrees.
- Keep the main checkout on `main`. Remove only the worktree this session created.
- On Windows: every Read/Edit/Bash uses the absolute `WORKTREE=` path (dispatched `isolation: worktree` leaves CWD on the primary checkout). Delete only via the script — recursive `rm` follows NTFS junctions and can wipe files outside the worktree.

Read `scripts/worktree.mjs` for the commands.

## Agent handoff — out-of-scope issues

When you encounter errors, failures, or problems **outside the scope of your current task**, file a GitHub issue for handoff instead of fixing them inline or ignoring them.

### When to file

- Test, lint, or build failures unrelated to your assigned work
- Bugs or regressions in code you are not changing
- Broken CI, missing dependencies, or environment/setup blockers
- Tech debt or follow-ups that would expand scope

### When not to file

- Problems you can fix within the current task without scope creep
- Expected behavior or intentional tradeoffs
- Duplicates of an existing open issue (link the existing issue instead)

### How to file

Use the **Agent handoff** issue template (`.github/ISSUE_TEMPLATE/agent-handoff.yml`) or:

```bash
gh issue create --template agent-handoff.yml
```

Each issue must include:

1. **What failed** — concise title focused on the problem, not your task
2. **Where you saw it** — file paths, commands, CI run URL
3. **Reproduction** — steps or the exact failing command with output
4. **Impact** — blocking vs. non-blocking for the work you were doing
5. **Suggested fix** — optional, if you have a concrete direction

After filing, mention the issue number in your task summary and continue with your assigned work.

Concurrent Cloud Agent tasks share `/workspace`. Do not `git checkout` there — use `npm run worktree:create` (`scripts/worktree.mjs`) so another task cannot clobber uncommitted files. Apply the `agent-handoff` label when filing.

## Builder ↔ app contract

The venue builder (`packages/venue-builder/`, invoked as `npm run venues:*`) is the only thing allowed to write `apps/party-tracker/public/venues/*.map.json`, `apps/party-tracker/public/venues/*.pois.json`, `apps/party-tracker/public/venues/*.gaps.json`, `apps/party-tracker/public/venues/manifest.json` and the generated `apps/party-tracker/lib/venueIndex.js`. Everything the app reads at runtime comes out of that pipeline.

### Builder output is wrong → fix the builder, not the output

If a generated file under `apps/party-tracker/public/venues/` or `apps/party-tracker/lib/venueIndex.js` is wrong — a missing ride, a wrong height, a bad tag mapping, a stale manifest entry — never hand-edit the generated JSON/JS to patch it. Fix it at the source instead:

- A tag rule, inference or pipeline bug → fix the builder code (`packages/venue-builder/bin/`, `packages/venue-builder/lib/`).
- A one-off correction for a single venue (height, area, alias, hand-added place, district tint, recipe/box/sources) → fix that venue's own input under `packages/venue-builder/data/venues/<id>/` (`overrides.json`, `sources.json`, `recipe.json`, `ids.json`, `attractions.json`, `heights.json`).

Then regenerate with `npm run venues:build`, `venues:rebuild`, `venues:overrides`, `venues:reindex` or `venues:attractions`. `packages/venue-builder/data/venues/` is builder input and is meant to be hand-edited; `apps/party-tracker/public/venues/*.json` and `apps/party-tracker/lib/venueIndex.js` are builder output and are not.

### Prove the fix works in the app

A fix isn't done when the regenerated JSON looks right on its own. After rebuilding, confirm it in the app:

- `npm run venues:report <id>` to sanity-check the rebuilt venue.
- The relevant suite (`npm test`, `npm run test:functional`, `npm run test:visual`, etc.) and/or a manual check of the affected screen, so the fix is proven against the running app and not just the file on disk.

### App change touches the builder's contract → validate against the builder

Going the other way: if an app change reads a new or changed shape from `apps/party-tracker/public/venues/*.json`, `manifest.json` or `apps/party-tracker/lib/venueIndex.js` (a new field, a renamed key, a new required invariant), don't assume the builder already produces it. Before shipping:

- Confirm the builder actually emits that shape for every shipped venue, or update the builder so it does.
- Rerun `npm run venues:build`/`venues:rebuild` (or at minimum `npm run venues:report`) for the affected venues to check the contract holds across all of them, not just the one you tested with.
- Update the builder section of `README.md` if the on-disk contract changed, so the next person building a venue sees the same shape the app now expects.

### Ask before guessing

If it's unclear whether a file is builder input (edit it) or builder output (regenerate it, don't hand-edit it) — or whether a fix belongs in the builder vs. the app — ask before proceeding rather than guessing.

## App version — auto-bumped on merge

The app build semver is **not** bumped in PRs. After every merge to `main`, `.github/workflows/bump-version.yml` runs `scripts/bump-version.mjs`: skip if the merge did not touch app paths (`scripts/lib/app-paths.json`); otherwise bump from the PR title’s Conventional Commit type (`fix:` patch, `feat:` minor, `feat!:` / `BREAKING CHANGE:` major). Tag the **PR title**; do not edit version files. `chore:` / `docs:` / `test:` skip even on app files. Untagged app merges still patch.

### Never bump version in a PR

Do not edit `package.json` `version`, `package-lock.json` version fields, `apps/party-tracker/public/app-version.json`, `apps/party-tracker/public/sw.js`, or future `apps/party-tracker/data/release-notes.json` keys in feature branches.

### Merge conflicts on version files

When syncing with `main`, if those files conflict, keep `main`'s side. The bump workflow assigns the next version after your PR merges.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `parthalon025/six-flags-sa` (via `gh`). Agent-handoff issues share that tracker and enter the triage label flow. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/` (legacy long-form under `docs/superpowers/specs/`). See `docs/agents/domain.md`.

### Packages

Packages are deep modules — see [packages/README.md](./packages/README.md) before adding or importing one. Layout: [docs/repo-structure.md](./docs/repo-structure.md).

### Skills lock

Matt Pocock skills are global (`~/.agents/skills`). This repo must not vendor them. `npm run skills:check` asserts `.agents/skills` and `skills-lock.json` are absent. See `docs/agents/skills-lock.md`.

### Matt standards

Always apply the global Matt skills for design, review, refactor, and agent docs. Skill map and repo rules: [docs/agents/matt-standards.md](./docs/agents/matt-standards.md).
