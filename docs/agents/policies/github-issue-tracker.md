# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Mandatory: read comments before acting

**MUST** read the full comment thread on an issue or PR (`gh issue view <n> --comments` / `gh pr view <n> --comments`) before commenting, labeling, closing, or pushing further changes to it. Acting on stale context — a title/body read without the comments — risks repeating a question already answered or missing a blocker a human already raised. This applies every time you return to an issue/PR, not just on first contact.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Park Bound — agent-handoff coexistence

Out-of-scope failures during agent work still use the **Agent handoff** template (`.github/ISSUE_TEMPLATE/agent-handoff.yml`) and the `agent-handoff` label. That queue is for filing blockers, not for skipping triage.

After filing (or when picking up an existing handoff issue):

1. Apply `needs-triage` if a human still needs to classify it.
2. Or apply `ready-for-agent` when the handoff brief is already enough for an AFK agent.
3. Use `/triage` to move it through the normal label state machine.

**Wayfinding and feature specs** use the local markdown tracker (`.scratch/<feature>/`) — see [local-issue-tracker policy](./local-issue-tracker.md). GitHub #625–630 are superseded by `.scratch/factories-to-app/`.
