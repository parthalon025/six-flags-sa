# Design: Executive resume human brief (single template)

**Date:** 2026-08-25  
**Status:** Approved (amended: include Wayfinder in the brief)  
**Related:** [executive-resume policy](../../agents/policies/executive-resume.md), `scripts/lib/executive-resume.mjs`, dashboard issue **#643**, [matt-workflow](../../agents/policies/matt-workflow.md) / [local-issue-tracker](../../agents/policies/local-issue-tracker.md) for map + phase derivation

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
- Merging full Matt workflow session brief into the resume print (workflow stays `npm run workflow:next`)  
- Dumping entire `map.md` bodies or train-plan walls into the brief  
- Using local **uncommitted** `.scratch` **implementation** noise as the GitHub hanging backlog (hanging source stays the two triage labels)  
- Leaving wayfinder maps gitignored-only (that breaks Cloud/macro tracking)  

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

## Wayfinder
<active **committed** .scratch efforts that still have a map + open decision fog:
 effort name, derived phase, destination one-liner when parseable,
 frontier decision tickets by title (name). Not the full map body.
 Same view on every clone — maps are not gitignored session junk.>

## Hanging / waiting on you
- <GitHub ready-for-agent / ready-for-human by title>
- <blocked on human / parking lot from human.*>
```

### Purpose of each slot

| Slot | Purpose (if a sentence cannot state this, cut it) |
|------|---------------------------------------------------|
| **Overview** | Orient a returning executive in under 30 seconds |
| **NOW** | Single focus; create goal from this only |
| **Factories** | Macro for factory track without opening PRs |
| **App** | Macro for product track without opening PRs |
| **Wayfinder** | Surface foggy multi-session maps and open decision tickets without opening `map.md` |
| **Hanging / waiting** | Surfaces incomplete GitHub triage work and human blockers |

Empty Factories or App: print one honest line (“Nothing in flight under this label set.”) — never invent progress.

Empty Wayfinder: one honest line (“No active wayfinder map.” or “Maps clear — no open decision tickets.”) — never invent fog.

## Data sources (canonical)

| Fact | Source |
|------|--------|
| NOW + `human.*` | Dashboard issue **#643** pinned JSON (durable pointer in `docs/agents/executive-dashboard.json`) |
| Open inventory (worktrees, draft PRs, …) | Regenerated locally — never trusted from GitHub |
| Incomplete cross-session work (GitHub) | Issues labeled **`ready-for-agent`** or **`ready-for-human` only** — listed under **Hanging**, not under Factories/App/Wayfinder |
| Wayfinder fog | **Committed** `.scratch/<effort>/` trees that have `map.md` (decision tickets + map). Phase + frontier from **`effortPhase` / ticket loaders in `scripts/lib/matt-workflow.mjs`**. List open/claimed **wayfinder decision** tickets by **title**; optional Destination line from `map.md`. **Invariant:** these trees are in git so Cloud/local/macro view all see the same fog — not session-only scratch |
| Version health (when shown) | **Clerk package/SDK vs lockfile** — not app version vs `main` |
| Factories standing | From NOW + inventory touching factory surfaces (`packages/venue-builder`, venue/display bakes, train H/I scripts) plus any `human.*` note that names factories — **one** outcome/standing paragraph |
| App standing | From NOW + inventory touching `apps/party-tracker` (and related product/UI packages) plus any matching `human.*` note — **one** outcome/standing paragraph |

If inventory cannot tell Factories from App, each section still prints one honest line; do not invent a split. Ticket lines use **title (name)**; numbers may trail in parentheses for deep links.

**Split preserved:** Wayfinder answers “what decisions are still foggy?” from **committed** maps; `workflow:next` still answers “which skill now?”; Hanging answers “what GitHub triage / human blocks remain?”

### Committed wayfinder (macro track)

Today `.gitignore` blanks all of `.scratch/`, which hides fog from every fresh Cloud checkout. This design requires:

1. **Wayfinder efforts are committed** — at least `map.md` and `issues/*.md` for each active wayfinder slug (path stays `.scratch/<effort>/` so matt-workflow keeps working).
2. **Allowlist in scripts** — e.g. `scripts/lib/wayfinder-committed.json` lists slugs that must be tracked; a small check (`wayfinder:check` or part of resume gather warnings) fails or warns if an allowlisted effort is missing on disk or still ignored.
3. **Still gitignored:** resume local cache (`.scratch/resume.json`, `.scratch/resume.md`, `.scratch/executive-dashboard.json` pointer cache), and non-wayfinder ephemeral scratch not on the allowlist.
4. **Policy fix:** [local-issue-tracker](../../agents/policies/local-issue-tracker.md) currently says all `.scratch/` is session-local — amend to: wayfinder maps are **repo truth**; other scratch may stay local.

No second dashboard package — git + allowlist script is enough for the macro view to track fog.

## Architecture (deep module)

Extend the existing resume module; do not add a second dashboard package.

```text
gatherBriefFacts(env)     → { now, human, inventory, githubTickets, wayfinder, clerkHealth, … }
fillHumanBrief(facts)     → string   // only template filler
print on resume:start     → one brief (+ CreateGoal / ritual; do not also dump full workflow session brief)
```

- **External seam:** `fillHumanBrief` / start command print path.  
- **Internal:** gh queries, Clerk lockfile compare, label filters, wayfinder fact gather via matt-workflow exports — not part of the caller interface.  
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
3. Wayfinder section lists frontier decision tickets by title from fixture **and** from committed allowlisted efforts when present in the repo checkout  
4. Allowlist / gitignore: committed wayfinder trees are readable on a clean clone (test or `wayfinder:check` asserts allowlisted path is not ignored / exists)  
5. Clerk health line reflects fixture lockfile vs package mismatch when that slot is populated  
6. Overview + Factories + App never duplicate the same sentence  
7. Existing NOW / drift / CreateGoal behaviour unchanged unless a test explicitly updates it  
8. Start print is still **one** human brief — not brief + full `workflow:session` dump  

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
