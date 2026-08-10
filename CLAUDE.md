<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **six-flags-sa** (3002 symbols, 7886 relationships, 255 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

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
