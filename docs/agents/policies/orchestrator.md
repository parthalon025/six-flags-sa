# Orchestrator — dispatch, don't solo

Every session opens as the **orchestrator**: the SessionStart hook prints the agent roster, and multi-step work is dispatched to the team member whose model and skills fit it.

## When this applies

- Any task with more than one step — explore, design, implement, review, verify.
- Any task where the right skill file or model tier is not obvious.
- Never for a one-line answer or a single mechanical edit: routing costs more than the work.

## Rules

The roster is data, not prose: `scripts/lib/orchestrator/roster.json` names each member's subagent type, model tier, skills to read first, repo files to read first, and the hand-back contract. Edit that file — the session brief, the routing, and the `.cursor` rule all read from it.

**Session start:** read root [`CONTEXT.md`](../../CONTEXT.md) before routing or dispatching — **to clarify** vocabulary, spot canon conflicts, and keep prompts aligned. Do **not** edit `CONTEXT.md` during routine dispatch or implementation; glossary updates happen only when the owner explicitly resolves terms (`domain-modeling` / `grilling` / `/grill-with-docs`) or asks for a glossary change.

**Canon conflict → auto-grill:** when owner decisions or a task contradict `CONTEXT.md`, an accepted ADR, or another canonical doc, do not proceed on assumptions and do not patch `CONTEXT.md` to paper over the conflict. Open a grill round (`grilling` skill): name each conflict, ask the frontier questions with recommendations, and wait for owner answers before implementation dispatch. File the ADR amendment as a `scribe` or `architect` follow-up once the grill settles.

| Concern | Use this |
|---------|----------|
| Roster printed at session start | `node scripts/orchestrator.mjs brief` (wired into `.claude/settings.json` → SessionStart) |
| Who takes this task, on which model | `npm run orchestrator:route -- "<task>"` |
| The phase chain for the Workflow tool | `npm run orchestrator:plan -- "<task>"` |
| The whole team | `npm run orchestrator:list` (`orchestrator:brief` prints the session-start form) |
| Roster drift vs the repo (missing files, dead npm scripts, unwired hook) | `npm run orchestrator:check` (gated by `test/scripts/orchestrator.test.mjs`) |
| Routing and workflow logic | `scripts/lib/orchestrator/route.mjs` |

- **One member per dispatch.** Give the subagent that member's prompt (`route --json` emits it), its model tier, and its skills — not a generic "go fix this".
- **Every code chain ends `reviewer` → `verifier`.** The reviewer is the Sonnet standards pass ([matt-standards.md](../matt-standards.md) §7); the verifier runs `npm run test:pre-merge-vertical` ([vertical-e2e policy](./vertical-e2e.md)).
- **Tie-breaks favour the more committal kind** (`kindPriority` in the roster): a task that reads as both a search and a breakage goes to diagnosis, not to the read-only scout.
- **Model tiers are the roster's call:** opus for ambiguous design and implementation, sonnet for scoped review/diagnosis/verification, haiku for mechanical sweeps.
- **The orchestrator routes; the member judges.** Do not re-do a dispatched member's work in the main thread.

## Ask before guessing

A task that routes to a fallback member (`route` reports `no trigger matched`) is a roster gap, not a routing failure. Add the trigger to `roster.json` when the same kind of task shows up twice, rather than hand-picking a member each time.

---

**After editing:** add or update the policy in `scripts/lib/agent-docs/manifest.json`, then run `npm run agent-docs:build`.
