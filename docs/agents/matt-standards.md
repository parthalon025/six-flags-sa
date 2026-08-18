# Matt standards — always apply

Engineering work in this repo follows the **global** Matt Pocock skills under `~/.agents/skills`. Do not vendor copies here — see [skills-lock.md](./skills-lock.md).

## Always

Before you design, refactor, review, or add agent-facing docs:

1. **Read the matching global skill** (full `SKILL.md` in `~/.agents/skills/<name>/`). Do not rely on memory alone.
2. **Use the vocabulary** from `codebase-design` — module, interface, depth, seam, adapter, leverage, locality. Packages and `scripts/lib/` are both deep modules.
3. **Put policy in scripts**, not agent prose — see `.cursor/rules/scripts-over-instructions.mdc`. One pointer beats a duplicated paragraph.
4. **Run `code-review` smells** when reviewing a branch or PR (documented repo rules override the Fowler baseline).
5. **Prefer TDD** (`tdd` skill) when adding or changing behaviour that already has tests nearby.
6. **Vertical test before merge** — run `npm run test:pre-merge-vertical` before merging any PR. See [docs/agents/ci.md](./ci.md#before-merge-agents).
7. **Sonnet standards review before merge (code diffs)** — spawn a `claude-sonnet-5` subagent with the prompt from `node scripts/ci/matt-review.mjs prompt` (it applies `code-review`, this doc, and `codebase-design`; give it the GitNexus blast radius when the index is available). Address or answer its advisory findings, then stamp with `node scripts/ci/matt-review.mjs write --gitnexus <ok|unavailable>` and commit `scripts/ci/matt-review-pass.json`. CI and `test:pre-merge-vertical` fail code diffs without a fresh stamp; docs-only diffs are exempt.

## Skill map

| When you are… | Read this global skill |
|---------------|------------------------|
| Designing or splitting a module / package / `scripts/lib` seam | `codebase-design` |
| Reviewing a branch, PR, or diff since a ref | `code-review` |
| Debugging a reproducible failure | `diagnosing-bugs` |
| Refactoring across call sites | `tdd` + `codebase-design` |
| Editing `AGENTS.md`, `CLAUDE.md`, cursor rules, or skills | `writing-for-agents` + `npm run agent-docs:build` |
| Resolving domain terms or ADR gaps | `domain-modeling` / `grilling` → `CONTEXT.md` + `docs/adr/` |
| Git / worktree / commit hygiene | `git-guardrails-claude-code` |
| Merge conflicts | `resolving-merge-conflicts` |
| CI/CD workflows or deploy gates | [docs/agents/ci.md](./ci.md) + `codebase-design` |

## Deep modules here

**Packages** — entry points only (root files plus `package.json` `exports` targets); `npm run lint:boundaries` cruises `apps packages scripts test`, so app/script/test importers and cycles are enforced too. See [packages/README.md](../../packages/README.md).

**Scripts** — pure decision logic in `scripts/lib/*.mjs`, CI orchestration in `scripts/ci/` (manifest + thin CLIs), shared lists in JSON. Test through exported functions (`test/scripts/*.test.mjs`). See [docs/agents/ci.md](./ci.md).

**Apps** — follow existing package and test conventions; UI changes need `npm run test:validate-ui` or the relevant module from `test/app/modules.json`.

## Never

- Vendor Matt skills under `.agents/skills/` or commit `skills-lock.json`.
- Duplicate script logic in `AGENTS.md` / cursor rules when a `scripts/lib` module can own it.
- Hand-edit generated `AGENTS.md`, `CLAUDE.md`, or `.cursor/rules/*.mdc` — edit `docs/agents/policies/` and run `npm run agent-docs:build`.
- Invent empty `CONTEXT.md` or ADR stubs — grow domain docs when terms are actually resolved.
