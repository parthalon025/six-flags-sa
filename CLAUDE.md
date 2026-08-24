<!-- agent-docs:generated -->

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

## Orchestrator — dispatch to the team

Every session starts as the **orchestrator** — route multi-step work to the roster member whose model and skills fit (`npm run orchestrator:route -- "<task>"`). See [orchestrator policy](./docs/agents/policies/orchestrator.md).

## Isolate in a worktree

**Worktree** isolation for parallel agents — create before the first edit, remove when done. See [worktree policy](./docs/agents/policies/worktree.md).

## Agent handoff — out-of-scope issues

File **agent-handoff** issues for out-of-scope failures instead of fixing inline. See [agent-handoff policy](./docs/agents/policies/agent-handoff.md).

## Builder ↔ app contract

Venue **builder** output is generated only — fix upstream, prove in the app. See [builder-app-contract policy](./docs/agents/policies/builder-app-contract.md).

## Claude Design — where the front end is designed

**Claude Design** is canon for how the front end looks and reads — the code conforms to it; the repo is canon only for what a canvas cannot see. See [claude-design policy](./docs/agents/policies/claude-design.md).

## Vertical e2e — output validation

All code work is proven **end to end** with the run's output asserted — `npm run test:pre-merge-vertical` gates it. See [vertical-e2e policy](./docs/agents/policies/vertical-e2e.md).

## Root cause — ship the cause, not the hide

**Root cause** is the shipped fix — hide a symptom only when this policy names that exception. See [root-cause policy](./docs/agents/policies/root-cause.md).

## App version — auto-bumped on merge

App **version** is auto-bumped on merge — never edit version files in PRs. See [version-on-merge policy](./docs/agents/policies/version-on-merge.md).

## Vercel previews

**Vercel** previews are user-reserved — verify locally unless deployed behavior is required. See [vercel-previews policy](./docs/agents/policies/vercel-previews.md).

## GitNexus index

**GitNexus** index is session-local — run `npm run gitnexus:startup`, never commit `.gitnexus/`. See [gitnexus-sync policy](./docs/agents/policies/gitnexus-sync.md).

## Scripts over instructions

Put policy in **scripts**, not agent prose — one pointer beats a duplicated paragraph. See [scripts-over-instructions policy](./docs/agents/policies/scripts-over-instructions.md).

## Trains H and I

Train **H/I** slice state is derived from the tree, never stored — run `npm run train:next` to see what is startable. See [train-plan policy](./docs/agents/policies/train-plan.md).

## Executive resume — NOW + open inventory

**Executive resume** — one NOW task and regenerated open inventory; `npm run resume:start` at session open; syncs to the executive dashboard GitHub issue. See [executive-resume policy](./docs/agents/policies/executive-resume.md).

## Matt workflow — follow the skill map

Matt skill **phase** is derived from `.scratch/<effort>/` — run `npm run workflow:next` before `/implement`; gate with `npm run workflow:check`. Pair with `npm run resume:start`. See [matt-workflow policy](./docs/agents/policies/matt-workflow.md).

## Agent skills

### Issue tracker

**Local markdown** (`.scratch/`) for wayfinding and specs; **GitHub** for agent-handoff — see [local-issue-tracker](./docs/agents/policies/local-issue-tracker.md) and [github-issue-tracker](./docs/agents/policies/github-issue-tracker.md) policies.

### Triage labels

**Triage** vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` — see [github-triage-labels policy](./docs/agents/policies/github-triage-labels.md).

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/` (legacy long-form under `docs/superpowers/specs/`). See [docs/agents/domain.md](./docs/agents/domain.md).

### Packages

Packages are deep modules — see [packages/README.md](./packages/README.md) before adding or importing one. Layout: [docs/repo-structure.md](./docs/repo-structure.md).

### Skills lock

Matt Pocock skills are global (`~/.agents/skills`). This repo must not vendor them. `npm run skills:check` asserts `.agents/skills` and `skills-lock.json` are absent. See [docs/agents/skills-lock.md](./docs/agents/skills-lock.md).

### Matt standards

Always apply the global Matt skills for design, review, refactor, and agent docs. Skill map and repo rules: [docs/agents/matt-standards.md](./docs/agents/matt-standards.md).

### Agent docs

Always-loaded agent docs are slim pointers; full policy lives under `docs/agents/policies/`. Regenerate with `npm run agent-docs:build`; CI checks with `npm run agent-docs:check`.
