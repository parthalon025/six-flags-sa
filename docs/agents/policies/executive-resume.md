# Executive resume — NOW + open inventory

One **executive source of truth** for ADHD-friendly focus: one NOW task, full open inventory, survives cloud session death via a pinned GitHub issue.

Works with the **Matt workflow gate** (`npm run workflow:next`, `workflow:check`) — resume says *what*; workflow says *which skill*.

## When this applies

- Every coding session (especially after platform switch: Cursor Cloud ↔ local ↔ Claude Code)
- When you have many open PRs, worktrees, or `.scratch` efforts
- Before starting or switching implementation work

## Rules

| Concern | Use this |
|---------|----------|
| Session start brief | `npm run resume:start` |
| Regenerate open inventory | `npm run resume:refresh` |
| Pull NOW + human from GitHub | `npm run resume:pull` |
| Push NOW + human to GitHub | `npm run resume:push` |
| Drift check (NOW vs inventory) | `npm run resume:check` |
| First-time setup | `npm run resume:init` |
| 12h timer prompt text | `npm run resume:timer-prompt` |
| Which Matt skill now | `npm run workflow:next` |
| Gate implement too early | `npm run workflow:check -- --intent implement` |

### Canonical split

- **`now` + `human.*`** → GitHub executive dashboard issue (pinned JSON comment)
- **`inventory`** → regenerated locally (never trusted from GitHub)
- **`.scratch/resume.md`** → rendered view; do not hand-edit

### Who may edit what

| Writer | Fields |
|--------|--------|
| **Human** | `now.task`, `doneWhen`, `inScope`, all of `human.*`, switch NOW |
| **Agent** | `now.nextStep`, `lastStop`, inventory via refresh, timestamps |
| **Agent must not** | edit `human.parkingLot` or `human.blockedOnMe` without explicit user approval |

### Session start ritual

1. Run `npm run resume:start` (pull issue → refresh inventory → Matt workflow brief)
2. Confirm **NOW** or say **switch**
3. **CreateGoal** from NOW task + next step only
4. Run `npm run workflow:check` before `/implement`
5. Do not code until NOW is one task

### 12-hour Cursor timer

Subscribe once per cloud session:

```text
cursor-subscriptions subscribe_timer
  name: executive-resume-12h
  delaySeconds: 43200
  prompt: (output of npm run resume:timer-prompt)
```

On fire: refresh inventory, run `resume:check`, ask user “Still on NOW or switch?”

### GitHub executive dashboard

```bash
npm run resume:init   # creates issue + .scratch/executive-dashboard.json
```

Pin the comment containing `<!-- executive-resume-json:v1 -->`.

**Issue #643** is the repo dashboard (pointer file stores the number). Cloud agent tokens may lack issue-write — use local `gh` for `resume:push` / `resume:pull`, or edit the pinned JSON by hand.

### Out of scope

- Unrelated failures → [agent-handoff](./agent-handoff.md), not NOW expansion
- Wayfinding specs → `.scratch/<effort>/` per [local-issue-tracker](./local-issue-tracker.md)

## Ask before guessing

- **No dashboard issue** → `npm run resume:init`, pin the JSON comment, set NOW
- **Drift warnings** → confirm NOW or update worktree/branch/PR fields
- **`workflow:check` failed** → invoke the skill `workflow:next` names; do not implement through the gate

---

**After editing:** register in `scripts/lib/agent-docs/manifest.json`; run `npm run agent-docs:build`.
