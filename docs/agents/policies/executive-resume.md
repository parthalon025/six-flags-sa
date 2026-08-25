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
| Session start brief | `npm run resume:start` (natural prose in the terminal) |
| Regenerate open inventory | `npm run resume:refresh` |
| Pull NOW + human from GitHub | `npm run resume:pull` |
| Push NOW + human to GitHub | `npm run resume:push` |
| Drift check (NOW vs inventory) | `npm run resume:check` |
| Print human message | `npm run resume:print` (add `--markdown` for full inventory) |
| End-of-turn agent update | `npm run resume:end-turn -- --next "..." [--doing "..."]` |
| 12h timer fired | `npm run resume:timer-fired` |
| First-time setup | `npm run resume:init` |
| Link existing dashboard issue | `npm run resume:link -- --issue 643` |
| 12h timer prompt text | `npm run resume:timer-prompt` |
| Timer subscription args | `npm run resume:subscribe-timer` |
| Which Matt skill now | `npm run workflow:next` |
| Gate implement too early | `npm run workflow:check -- --intent implement` |

### Canonical split

- **`now` + `human.*`** → GitHub executive dashboard issue (pinned JSON comment)
- **`inventory`** → regenerated locally (never trusted from GitHub)
- **`.scratch/resume.md`** → markdown archive for GitHub sync; do not hand-edit. Terminal humans see a short `renderProse` executive brief (goal / progress / next) — not PR titles or inventory.
- **`docs/agents/executive-dashboard.json`** → committed durable pointer (issue number); survives ephemeral cloud `.scratch/`
- **`.scratch/executive-dashboard.json`** → session cache only (`jsonCommentId`)

### Who may edit what

| Writer | Fields |
|--------|--------|
| **Human** | `now.task`, `doneWhen`, `inScope`, all of `human.*`, switch NOW |
| **Agent** | `now.nextStep`, `lastStop`, inventory via refresh, timestamps |
| **Agent must not** | edit `human.parkingLot` or `human.blockedOnMe` without explicit user approval |

### Session start ritual

1. **`npm run resume:start`** runs automatically at session open (Cloud `environment.json` start + Claude Code SessionStart hook)
2. Confirm **NOW** or say **switch** (platform change warns and regenerates inventory)
3. **CreateGoal** from NOW task + next step only (printed in start brief)
4. Run `npm run workflow:check` before `/implement`
5. Do not code until NOW is one task

### End of turn (agents)

After code changes each turn:

```bash
npm run resume:end-turn -- --next "<next step>" --doing "<what you just did>"
```

Pulls fresh inventory, updates `nextStep` + `lastStop`, pushes to GitHub when token allows.

### 12-hour Cursor timer

Subscribe once per cloud session (`npm run resume:subscribe-timer` prints args):

```text
cursor-subscriptions subscribe_timer
  name: executive-resume-12h
  delaySeconds: 43200
  prompt: (output of npm run resume:timer-prompt)
```

On fire: `npm run resume:timer-fired`, then ask user “Still on NOW or switch?”

### GitHub executive dashboard

```bash
npm run resume:init                          # first time only — creates issue + durable pointer
npm run resume:link -- --issue 643           # link / retarget committed pointer (no new issue)
```

Pin the comment containing `<!-- executive-resume-json:v1 -->`.

**Issue #643** is the repo dashboard. The committed file `docs/agents/executive-dashboard.json` stores the number so `resume:start` / `resume:pull` work on fresh cloud VMs without a local `.scratch` pointer. Cloud agent tokens may lack issue-write — use local `gh` for `resume:push`, or edit the pinned JSON by hand.

### Out of scope

- Unrelated failures → [agent-handoff](./agent-handoff.md), not NOW expansion
- Wayfinding specs → `.scratch/<effort>/` per [local-issue-tracker](./local-issue-tracker.md)

## Ask before guessing

- **No dashboard issue** → `npm run resume:init`, pin the JSON comment, set NOW
- **Pointer missing on cloud** → ensure `docs/agents/executive-dashboard.json` is committed (`resume:link -- --issue 643`); do not re-`init`
- **Drift warnings** → confirm NOW or update worktree/branch/PR fields
- **`workflow:check` failed** → invoke the skill `workflow:next` names; do not implement through the gate

---

**After editing:** register in `scripts/lib/agent-docs/manifest.json`; run `npm run agent-docs:build`.
