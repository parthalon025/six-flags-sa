# Matt standards — always apply

Engineering work in this repo follows the **global** Matt Pocock skills under `~/.agents/skills`. Do not vendor copies here — see [skills-lock.md](./skills-lock.md).

## Always

Before you design, refactor, review, or add agent-facing docs:

1. **Read the matching global skill** (full `SKILL.md` in `~/.agents/skills/<name>/`). Do not rely on memory alone.
2. **Use the vocabulary** from `codebase-design` — module, interface, depth, seam, adapter, leverage, locality. Packages and `scripts/lib/` are both deep modules.
3. **Put policy in scripts**, not agent prose — see `.cursor/rules/scripts-over-instructions.mdc`. One pointer beats a duplicated paragraph.
4. **Run `code-review` smells** when reviewing a branch or PR (documented repo rules override the Fowler baseline).
5. **Prefer TDD** (`tdd` skill) when adding or changing behaviour that already has tests nearby.
6. **Vertical e2e with output validation before merge** — all code work is proven end to end, with assertions over what the run produced; units are the floor, never the proof. Run `npm run test:pre-merge-vertical` before merging any PR and let every vertical it names actually run. See [vertical-e2e policy](./policies/vertical-e2e.md) and [docs/agents/ci.md](./ci.md#before-merge-agents).
7. **Matt workflow before multi-step work** — run `npm run workflow:next` at session start when `.scratch/` has an active effort; do not `/implement` until the derived phase allows it (`npm run workflow:check -- --intent implement`). Full map: [matt-workflow policy](./policies/matt-workflow.md). Unsure → `/ask-matt`.
8. **Executive resume at session open** — `npm run resume:start` runs automatically (Cloud + Claude Code hooks); confirm one NOW task, CreateGoal from it, and `npm run resume:end-turn` after code changes. Full map: [executive-resume policy](./policies/executive-resume.md).
9. **Builds and maps — no hand-waving** — venue builder, display bakes, and `public/venues/` output must be **regenerated and proved in the app**, not reviewed at the seam only. If you have not run the relevant `venues:*` / display bake / app build + map check, **warn the user before merge**. See [builder-app-contract policy](./policies/builder-app-contract.md#agents-warn-before-hand-waving-builds-or-maps).
10. **Sonnet standards review before merge (code diffs)** — spawn parallel `claude-sonnet-5` sub-agents with the prompts from `node scripts/ci/matt-review.mjs two-axis` (Standards + Spec axes; `prompt` prints Standards only). Address or answer its advisory findings, then stamp with `node scripts/ci/matt-review.mjs write --gitnexus <ok|unavailable>` and commit `scripts/ci/matt-review-pass.json`. CI and `test:pre-merge-vertical` fail code diffs without a fresh stamp; docs-only diffs are exempt.
11. **Root cause** — ship the layer that should have spoken. A hide is a merge only when that policy names the exception. See [root-cause policy](./policies/root-cause.md).

## Skill map

| When you are… | Read this global skill |
|---------------|------------------------|
| Designing or splitting a module / package / `scripts/lib` seam | `codebase-design` |
| Reviewing a branch, PR, or diff since a ref | `code-review` |
| Debugging a reproducible failure | `diagnosing-bugs` |
| Refactoring across call sites | `tdd` + `codebase-design` |
| Editing `AGENTS.md`, `CLAUDE.md`, cursor rules, or skills | `writing-for-agents` + `npm run agent-docs:build` |
| Resolving domain terms or ADR gaps | `domain-modeling` / `grilling` → `CONTEXT.md` + `docs/adr/` |
| Which Matt skill to invoke next | `npm run workflow:next` · `/ask-matt` · [matt-workflow policy](./policies/matt-workflow.md) |
| NOW task + open inventory across sessions | `npm run resume:start` · [executive-resume policy](./policies/executive-resume.md) |
| Git / worktree / commit hygiene | `git-guardrails-claude-code` |
| Merge conflicts | `resolving-merge-conflicts` |
| CI/CD workflows or deploy gates | [docs/agents/ci.md](./ci.md) + `codebase-design` |

## Deep modules here

**Packages** — entry points only (root files plus `package.json` `exports` targets); `npm run lint:boundaries` cruises `apps packages scripts test`, so app/script/test importers and cycles are enforced too. See [packages/README.md](../../packages/README.md).

**Scripts** — pure decision logic in `scripts/lib/*.mjs`, CI orchestration in `scripts/ci/` (manifest + thin CLIs), shared lists in JSON. Test through exported functions (`test/scripts/*.test.mjs`). See [docs/agents/ci.md](./ci.md).

**Apps** — follow existing package and test conventions; UI changes need `npm run test:validate-ui` or the relevant module from `test/app/modules.json`, and the change proven in a browser rather than at the seam it touched.

## Never

- Vendor Matt skills under `.agents/skills/` or commit `skills-lock.json`.
- Duplicate script logic in `AGENTS.md` / cursor rules when a `scripts/lib` module can own it.
- Hand-edit generated `AGENTS.md`, `CLAUDE.md`, or `.cursor/rules/*.mdc` — edit `docs/agents/policies/` and run `npm run agent-docs:build`.
- Invent empty `CONTEXT.md` or ADR stubs — grow domain docs when terms are actually resolved.
- Call code work done on a green run that would still be green if the change were wrong.
