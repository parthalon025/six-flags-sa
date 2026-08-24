# Matt workflow — follow the skill map

Matt Pocock skills form **flows** (main, on-ramps, standalones). Phase is **derived** from `.scratch/<effort>/` artifacts — never guessed from memory.

## When this applies

- Every session that does multi-step product or factory work
- Before `/implement`, `/to-spec`, or skipping `/wayfinder`
- When unsure which global skill to invoke — run the router first

## Rules

| Concern | Use this |
|---------|----------|
| Session brief (which skill now) | `npm run workflow:next` |
| Full brief + skill map | `npm run workflow:session` |
| Gate a risky jump (e.g. implement too early) | `npm run workflow:check -- --intent implement` |
| All skills (ask-matt catalog) | `npm run workflow:skills` |
| Active efforts and phases | `npm run workflow:efforts` |
| Unsure which flow | `/ask-matt` (user-invoked) |
| Foggy multi-session effort | `/wayfinder` → `.scratch/<effort>/map.md` |
| Idea → ship (main flow) | `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` → `npm run test:pre-merge-vertical` |
| Trains H/I (orthogonal) | `npm run train:next` |

### Main flow (idea → ship)

1. **`/grill-with-docs`** — sharpen in-repo (CONTEXT.md, ADRs). No repo → **`/grill-me`**.
2. **Prototype detour** (if needed): **`/handoff`** → **`/prototype`** → **`/handoff`** back.
3. **Multi-session?** Yes → **`/to-spec`** then **`/to-tickets`** (one context window through tickets). No → **`/implement`** in the same window.
4. **`/implement`** per ticket (fresh context each) — drives **`/tdd`**, then **`/code-review`**, then commit.
5. **`npm run test:pre-merge-vertical`** — every code chain ends here.

**Context hygiene:** do not `/clear` between grill, spec, and tickets. `/clear` between each `/implement` ticket.

### On-ramps (merge at `/to-spec`)

- **`/wayfinder`** — too foggy for one-session grill; decision tickets on the map; **never** straight to `/implement`
- **`/triage`** — raw incoming issues you did not create
- **`/diagnosing-bugs`** — hard bugs; post-mortem may hand off to **`/improve-codebase-architecture`**

### Standalones (reach for directly)

`/research` · `/prototype` · `/resolving-merge-conflicts` · `/to-questionnaire` · `/wizard` · `/wait-what` · `/teach` · `/writing-for-agents`

### Vocabulary underneath

`/domain-modeling` · `/codebase-design` — pulled in by grill, wayfinder, and implement.

### Preconditions

**`/setup-matt-pocock-skills`** once before the first engineering flow.

## Ask before guessing

- **`workflow:check` failed** — run `npm run workflow:next` and invoke the skill it names. Do not `/implement` through the gate.
- **Canon conflict** — grill before implementation (`orchestrator` policy).
- **Wayfinder map unclear** — resolve frontier decision tickets before `/to-spec`.

---

**After editing:** update `scripts/lib/matt-workflow.mjs` when the ask-matt map changes; register in `scripts/lib/agent-docs/manifest.json`; run `npm run agent-docs:build`.
