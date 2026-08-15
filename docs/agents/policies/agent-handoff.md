# Agent handoff — out-of-scope issues

When you encounter errors, failures, or problems **outside the scope of your current task**, file a GitHub issue for handoff instead of fixing them inline or ignoring them.

## When to file

- Test, lint, or build failures unrelated to your assigned work
- Bugs or regressions in code you are not changing
- Broken CI, missing dependencies, or environment/setup blockers
- Tech debt or follow-ups that would expand scope

## When not to file

- Problems you can fix within the current task without scope creep
- Expected behavior or intentional tradeoffs
- Duplicates of an existing open issue (link the existing issue instead)

## How to file

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

Apply the `agent-handoff` label when filing.
