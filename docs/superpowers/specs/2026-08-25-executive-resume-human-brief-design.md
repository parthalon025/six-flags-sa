# Design: Executive resume human brief (single template)

**Date:** 2026-08-25  
**Status:** Draft — awaiting user review of this file  
**Related:** [executive-resume policy](../../agents/policies/executive-resume.md), `scripts/lib/executive-resume.mjs`, dashboard issue **#643**  
**Non-related (keep separate):** Matt workflow (`workflow:next`), wayfinder maps (`.scratch/<effort>/map.md`)

---

## Problem

Session open already prints NOW + open inventory, but that is an **agent/ops** surface. The owner needs one **executive** brief: what the project is doing, why it matters, where Factories vs App stand, and what is hanging or waiting on them — without PR-title walls, HTML prototypes, or a second spoken brief to remember.

ADHD constraint: **one brief only**. Every sentence has a purpose. Overview *is* the executive summary (layman-readable what/why), not “one factory task.”

## Decision

**Path B — one printed brief the script fills from a fixed template.**

| Layer | Owns |
|-------|------|
| **Script** (`scripts/lib/executive-resume.mjs`) | Canonical facts → fill template → print once |
| **Agent** | May polish wording later; **never** presents a second parallel brief |
| **Human** | Reads the printed brief; sets NOW / `human.*` on #643 |

Code and data are canonical. Non-deterministic LLM assists from deterministic data only. No “LLM unavailable” fallback copy in the brief (sessions already use LLMs; that line is noise).

## Non-goals

- HTML or multi-variant prototypes as the product surface  
- Dump + agent ritual that produces two briefs  
- PR titles / draft-PR inventory as the main feed  
- PR checkbox archaeology as the macro source (optional detail later, not this ship)  
- Merging wayfinder or workflow phase into the resume brief  
- Local `.scratch` / train plan as the incomplete-work backlog source  

## Template (fixed slots)

Printed as terminal prose (markdown-ish, not HTML). Section order is fixed:

```text
# Executive brief

## Overview
<2–4 sentences: what this project is doing and why it matters right now.
 Layman. What/why — not a task list.>

## NOW
<one task + doneWhen + nextStep — already owned by resume; keep short.>

## Factories
<what is true / in flight for venue builder, displays, factory trains.
 One short standing line: outcome + where it stands.>

## App
<what is true / in flight for party-tracker / product UI.
 One short standing line: outcome + where it stands.>

## Hanging / waiting on you
- <not done across sessions that still matter>
- <blocked on human>
- <ready-for-human tickets by name>
```

### Purpose of each slot

| Slot | Purpose (if a sentence cannot state this, cut it) |
|------|---------------------------------------------------|
| **Overview** | Orient a returning executive in under 30 seconds |
| **NOW** | Single focus; create goal from this only |
| **Factories** | Macro for factory track without opening PRs |
| **App** | Macro for product track without opening PRs |
| **Hanging / waiting** | Surfaces incomplete cross-session work and human blockers |

Empty Factories or App: print one honest line (“Nothing in flight under this label set.”) — never invent progress.

## Data sources (canonical)

| Fact | Source |
|------|--------|
| NOW + `human.*` | Dashboard issue **#643** pinned JSON (durable pointer in `docs/agents/executive-dashboard.json`) |
| Open inventory (worktrees, draft PRs, …) | Regenerated locally — never trusted from GitHub |
| Incomplete cross-session work | GitHub issues labeled **`ready-for-agent`** or **`ready-for-human` only** — listed under **Hanging**, not under Factories/App |
| Version health (when shown) | **Clerk package/SDK vs lockfile** — not app version vs `main` |
| Factories standing | From NOW + inventory touching factory surfaces (`packages/venue-builder`, venue/display bakes, train H/I scripts) plus any `human.*` note that names factories — **one** outcome/standing paragraph |
| App standing | From NOW + inventory touching `apps/party-tracker` (and related product/UI packages) plus any matching `human.*` note — **one** outcome/standing paragraph |

If inventory cannot tell Factories from App, each section still prints one honest line; do not invent a split. Ticket lines use **issue title (name)**; numbers may trail in parentheses for deep links.

## Architecture (deep module)

Extend the existing resume module; do not add a second dashboard package.

```text
gatherBriefFacts(env)     → { now, human, inventory, tickets, clerkHealth, … }
fillHumanBrief(facts)     → string   // only template filler
print on resume:start     → one brief (+ existing CreateGoal / ritual lines as today)
```

- **External seam:** `fillHumanBrief` / start command print path.  
- **Internal:** gh queries, Clerk lockfile compare, label filters — not part of the caller interface.  
- Policy stays a **pointer** to `npm run resume:start`; do not restate template logic in `AGENTS.md`.

Optional later (not this ship): `--json` or detail flag for agents; default human print stays the template above.

## Error handling

| Case | Behavior |
|------|----------|
| No dashboard pointer / #643 unreachable | Existing resume init / link guidance; brief Overview states dashboard missing |
| `gh` read fails for labeled issues | Hanging section says inventory incomplete; do not fake empty “all clear” |
| No tickets in either label | Hanging section can still list `human.blockedOnMe` / parking lot |
| Cloud token cannot write issues | Print still works from reads + local inventory; push remains local-`gh` as today |

## Testing (output validation)

Assert the **printed string** from `fillHumanBrief` (or start brief builder), not chat narrative:

1. Fixed section headings present in order  
2. Ticket filter: only `ready-for-agent` / `ready-for-human` appear under Hanging when fixtures include other labels  
3. Clerk health line reflects fixture lockfile vs package mismatch when that slot is populated  
4. Overview + Factories + App never duplicate the same sentence  
5. Existing NOW / drift / CreateGoal behaviour unchanged unless a test explicitly updates it  

Gate: unit tests under `test/scripts/executive-resume.test.mjs`; include in pre-merge vertical when the resume script suite is already listed.

## Rollout

1. Implement template filler + tests behind the existing `resume:start` print path  
2. Update [executive-resume policy](../../agents/policies/executive-resume.md) with one pointer sentence to this design / the template slots  
3. Prove with fixture-driven printed output  
4. Owner pins/refreshes #643 with write-capable `gh` when NOW sync is needed (unchanged cloud limit)

## Success criteria

- Owner reads **one** terminal brief at session open and can answer: what/why, Factories vs App standing, what waits on them  
- No second brief appears in agent prose as a required ritual  
- Incomplete work source is exactly the two triage labels above  
- Matt standards: scripts own facts; agent docs stay thin pointers  
