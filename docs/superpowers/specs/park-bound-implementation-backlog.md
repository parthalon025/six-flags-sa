# Park Bound — Implementation Backlog

**Master spec:** [`./2026-08-10-park-bound-master-spec.md`](./2026-08-10-park-bound-master-spec.md)  
**Rule:** One increment at a time. Each epic lists **depends on**, **ships**, **done when**.  
**Default park for depth work:** Kings Island (other venues must keep building).

## North star

**Explore more, stress less.** Park Bound helps families navigate a park: find each other, know who can ride what, walk with purpose, and meet up without drama.

**Two ways to enjoy the same day:**

1. **Navigate** — map, party, heights, meet, next-best walk (calm foundation).
2. **Adventure** — in-park quests, discovery, passport/fog, party expeditions (second fun layer). Adventure may optionally improve map data; its job is enjoyment in the park, not phone chores.

**Design test for every PR:** Does this help a family enjoy the park more with less stress, or does it glue eyes to the phone?

This backlog **strangles** toward the vision. It does not greenfield-rewrite the PWA.

**Status legend:** done · partial · open. Last hygiene pass: 2026-08-11 (post #70 / #72).

---

## Epic map (vision phases → backlog)

| Vision phase | Backlog epics | Notes |
|--------------|---------------|-------|
| 0 Architecture | E0, **EP** | Schemas + **batch consolidate** (no PostGIS required); **required user profiles** |
| 1 Park foundation | E1 | Align models; KI completeness — app already has 4 venues |
| 2 GIS | E2 | Entrances/exits, georef validation, path integrity |
| 3 Routing | E3 | Profiles + layer-aware graph (on-device first) |
| 4 Party | E4 | Privacy, roles, subgroups, reunify UX |
| 5 Rules | E5 | Eligibility v2 |
| 6 Weather | E6 | Risk labels + ride sensitivity |
| 7 Realtime | E7 | Observation series / wait skeleton |
| 8 Planner | E8 | Next-best + why + replan |
| 9 Community | E9 | Living map contributions |
| 10–11 Gamification / packs | E10–E11 | After E9 trust path |
| 12–13 Research / CV | E12–E13 | Workers; candidates only |
| 14 Multi-park | E14 | Config/templates — already multi-venue; deepen platform |

---

## E0 — Platform data foundation (batch consolidate, no PostGIS required)

**Depends on:** nothing  
**Goal:** Profiles + contributions + durable map improvements **without** PostGIS. Geometry stays in builder JSON; daily/weekly jobs consolidate into `data/venues/` then rebuild.  
**ADR:** [`adr-dual-layer-park-truth.md`](./adr-dual-layer-park-truth.md)

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E0.1 | ADR | Batch consolidate + offline JSON; PostGIS deferred | Merged | **done** |
| E0.2 | Plain store (optional docker) | Postgres **without** PostGIS *or* managed SQL for users/contributions | App runs; map still offline from JSON | open |
| E0.3 | Shared schemas | User, Contribution, Observation, EvidenceClaim (non-spatial) | Types + CI fixtures | open |
| E0.4 | Contribution + profile tables | users/profiles, contributions, confirmations, score_events | Migrations clean | open |
| E0.5 | **Consolidate job** | Cron/GitHub Action: accepted durable edits → override/heights PR or apply → `venues:overrides`/`rebuild` | Dry-run on KI; no hand-edit of `public/venues` | open |
| E0.6 | Cadence config | Per-venue `daily` \| `weekly` \| `manual` | Documented; default weekly | open |
| E0.7 | Precomputed park-completion sidecar | Stats baked at consolidate for fog/missions | Phone reads sidecar/meta; no spatial SQL needed | open |

**Non-goals:** PostGIS; phone querying any DB for map draw; deleting venue-builder.

**Later (optional E0-GIS):** Introduce PostGIS only if admin polygon queries / GIS validation UI are blocked — export still feeds JSON.

---

## EP — User profiles (required foundation)

**Depends on:** E0.3 schemas (can stub types earlier)  
**Goal:** Signed-in profiles required before party personalization, contributions, and XP.  
**Product decision (2026-08-10):** User profiles are **required** — not deferred to living-map-only scoring.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| EP.1 | Auth provider choice + ADR | Email magic link and/or OAuth; session model | ADR documents provider, token storage, offline session | open |
| EP.2 | Profile schema | `users`, `profiles` (display name, avatar key, created_at) | Migrations + shared types | open |
| EP.3 | Sign-in / sign-up UX | Soft gate: browse map anonymously; party/contribute/adventure need sign-in | Functional tests; no anonymous contribution path | open |
| EP.4 | Offline profile cache | Profile + rank/passport snapshot in IndexedDB after login | Map still draws offline; identity available for local queues | open |
| EP.5 | Party ↔ profile link | Party members bind to `user_id` (invite still works; join requires signed-in profile) | Protocol/tests updated | open |
| EP.6 | Managed guest profiles | Height/age for kids under guardian profile | Eligibility-ready; privacy rules documented | open |

**Ordering note:** EP.1–EP.4 should land before E9 (living map) and before E10 (XP). Prefer EP before or alongside E4 party privacy so sharing controls attach to real users.

---

## E1 — Park foundation integrity (Kings Island depth)

**Depends on:** E0.1 (ADR); E0.3 preferred  
**Goal:** Stable identity + static/dynamic split + fix known pipeline defects.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E1.1 | Pipeline integrity defects | Fixes from `park-intelligence-review` workstream (provenance, inventory stage, expect locks) | Tests green; KI bundle provenance coherent | open |
| E1.2 | Deterministic entity ids | Stable ids for rides/POIs; overrides migrate off display-name-only keys where safe | Joins survive OSM rename; Fiesta duplicate names still OK | **partial** (ledger + `i` on POIs; some overrides still name-keyed) |
| E1.3 | Static vs dynamic schema | Ride static record shape documented; live fields only in observation/realtime tables | No wait/open mixed into static JSON as “official” | open |
| E1.4 | Bundle completeness gate | `venues:report` + expect locks; consolidate dry-run | KI (then all) pass report after rebuild | **done** (tooling + KI walkable lock) |

---

## E2 — GIS geometry & validation

**Depends on:** E1.2, E1.4  
**Goal:** Entrance/exit model + human validation path.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E2.1 | Attraction location slots | queue_entrance … queue_exit in twin + export to pois | Nav can prefer real queue entrance when present | **partial** (slots + nav prefer `e`; KI/Fiesta still thin) |
| E2.2 | Admin validation UI | Review low-confidence geometry / candidates | Steward can accept/reject; audit log | open |
| E2.3 | Georef metadata store | Transformation error + control points in twin | Low-confidence requires validation | **partial** (official map georef path via #70) |
| E2.4 | Path attribute coverage | Carry tags + per-venue coverage counters | Profiles refuse to claim data they don’t have | **done** |

---

## E3 — Park-native routing

**Depends on:** E2.4; layer/stairs fixes  
**Goal:** Correct graph + honest profiles on device.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E3.1 | Layer-aware crossings | No bridge→underpass false junctions | Regression test on KI bridges | **done** |
| E3.2 | Snap exclusion | Wheelchair/stroller never snap onto excluded segments | Blocked result when only snap excluded | **done** |
| E3.3 | Routing profiles v1 | Avoid stairs / restricted; accessible when coverage > 0 | UI hides empty profiles | **done** |
| E3.4 | Optional Valhalla bake-off | Builder worker compares graphs | Documented; phone still uses `lib/routing.js` | open |

---

## E4 — Party product completion

**Depends on:** E3 for quality reunify routes  
**Goal:** Privacy + roles + subgroups + find/reunify UX.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E4.1 | Sharing controls | Off / approx / precise + duration | Explicit UX; defaults safe | open (pause-only today) |
| E4.2 | Roles & permissions | Owner/Adult/Child/Guest matrix | Enforced in protocol | open (host/member only) |
| E4.3 | Subgroups | Coaster vs kids groups with own target | State + map chrome | open (`groupId` field only) |
| E4.4 | Find / Meet / Reunify UX | Surfaces on live map; stale never labelled live | Functional tests | **partial** |
| E4.5 | Battery-aware intervals | Already partial — verify + UI affordance | Documented behavior tests | **partial** |

---

## E5 — Eligibility / rules engine v2

**Depends on:** E1.2  
**Goal:** Deterministic multi-member reasons.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E5.1 | Guest profiles | Height/age/accessibility prefs per member | Stored locally + optional party sync | open |
| E5.2 | Verdict + reasons | ELIGIBLE / NOT / COMPANION / UNKNOWN + why | Unit tests; no LLM in path | **partial** (height engine exists; rich reasons missing) |
| E5.3 | Party eligibility matrix | Who can ride what together | Planner-ready API | open |

---

## E6 — Weather intelligence

**Depends on:** E5 optional; existing `weather.js`  
**Goal:** Labelled risk, not fake official status.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E6.1 | Ride sensitivity table | Lightning/wind/rain/temp rules in twin | KI seeded; unknowns explicit | open |
| E6.2 | Risk output | Current/predicted risk + reason + confidence + label enum | UI never says “official closed” for prediction | **partial** (heuristics in `weather.js`) |
| E6.3 | Planner hook | Risk as planner input | Covered in E8 | open |

---

## E7 — Realtime & wait series

**Depends on:** E1.3  
**Goal:** Append-only observations; no fabricated park feed.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E7.1 | Observation schema | ride_id, ts, wait?, status?, source, confidence | Twin + phone action-log bridge |
| E7.2 | Party report → series | Ride-down / queue band written as observations | Offline queue works |
| E7.3 | Freshness UX | Green/yellow/red by volatility class | Stale verification missions later (E10) |

---

## E8 — Dynamic planner

**Depends on:** E3, E4, E5, E6, E7 (minimum E3+E5)  
**Goal:** Next-best action with Why?

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E8.1 | Next-best action v1 | Score walks + eligibility + status | Explainable factors |
| E8.2 | Dynamic replan triggers | Ride down, weather risk, party split | Scenario rebase |
| E8.3 | Opportunity cost v1 | Compare short sequences | Not only lowest wait |
| E8.4 | What-if / strategy sims | Deferred until E8.1–3 stable | Separate tickets |

---

## E9 — Community Living Map

**Depends on:** E0 contribution store + E2.2 validation; gamification design Approach B  
**Goal:** Contribute → verify → overlay → **consolidate** into overrides/rebuild.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E9.1 | Contribution API + local queue | Tier-1 experience reports + adventure missions | Offline-first; party sync optional | **partial** (Side Quests tab + quest-seeds via #70; submit still Soon) |
| E9.2 | Peer confirm / deny | Waze-like | Rate limits + proximity | open |
| E9.3 | Client overlay merge | Base ⊕ accepted ⊕ pending | Conflict strategy declared | open |
| E9.4 | Tier-2 quests | StreetComplete-style | GPS-gated | open |
| E9.5 | Graduate to overrides | PR/operator apply → rebuild | Builder remains sole `public/venues` writer | open |
| E9.6 | Graduate to OSM | Organised editing compliance | Phase after E9.5 | open |

Adventure rules: nearby quests while walking; few pins; party-local competition; impact outranks vanity XP; optional map confirms are a side effect, not the only point.

Detail: [`2026-08-10-gamified-map-contributions-design.md`](./2026-08-10-gamified-map-contributions-design.md).

---

## E10 — Exploration gamification

**Depends on:** E9.1–E9.3 (trust path)  
**Goal:** Score confirmed impact, not spam.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E10.1 | XP + reputation + levels | Per design tables | Clawbacks on overturn |
| E10.2 | Park completion + fog | Completion % by category | Survey missions from gaps |
| E10.3 | Passports + badges | Per-park passport | Multi-park profile |
| E10.4 | Impact metric | “Helped N visitors” | Outranks XP in profile |
| E10.5 | Mission generator | From stale/low-confidence/conflict | AI may draft; rules filter |

---

## E11 — Explorer packs (cosmetics)

**Depends on:** E10  
**Goal:** Earned cosmetics; transparent; no loot-box gambling.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E11.1 | Pack catalog + earn rules | Adventure/Cartographer/… | Documented earn paths |
| E11.2 | Map skins / markers | Unlockable themes | Offline assets cached |
| E11.3 | Party expeditions | Shared missions | Party XP + shared badge |

---

## E12 — Automated research workers

**Depends on:** E0–E1 twin + evidence model  
**Goal:** Candidate extraction, not silent truth.

| ID | Item | Ships | Done when | Status |
|----|------|-------|-----------|--------|
| E12.1 | Source discovery worker | Interface + mock + real adapters | Labelled provenance | **partial** (adapters + research path; #70 deepened) |
| E12.2 | PDF/OCR extract → candidates | Evidence claims only | Human/ stewards validate | open |
| E12.3 | Conflict + freshness jobs | Feed E10.5 missions | Dashboard metrics | open |

---

## Builder fleet waves (Notion digital-twin blueprint)

| Wave | Focus | Status |
|------|--------|--------|
| 0 | Batch pipeline as single build path (PR #61) | **done** |
| 1 | `certify` stage → `certification.json` gates | **partial** (cert artifacts + stage exist; fleet refuse-done still open) |
| 2 | Top-100 inventory, ParksAPI IDs, auto-alias claims | open |
| 3 | Operator-scale height parsers | open |
| 4 | Human review gate; PR-only ship | open |
| 5 | Vision + weekly OSM drift | deferred (E13) |

**Map track:** M0 float rebase landed in #72. **M0 remainder** (viewport cull, gesture off React, node-budget HUD, LOD) is a follow-on — separate from auth epics. M2–M4 skins wait for E11.

---

## E13 — Computer vision candidates

**Depends on:** E2 validation UI  
**Goal:** CV proposes; never auto-canonical.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E13.1 | Entrance/path/building candidates | Into evidence queue | Requires E2.2 accept |
| E13.2 | Compare vs OSM/map/imagery | Confidence fusion | Existing evidence weights |

---

## E14 — Multi-park platform

**Depends on:** KI depth through E8 minimum  
**Goal:** One codebase; park as config/dataset (already true — harden).

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E14.1 | Park config templates | Ingest checklist per venue | `venues:report` gates |
| E14.2 | Cross-park explorer profile | Passport federation | Requires EP; one profile across parks |
| E14.3 | No per-park forks | Enforce in review | Documented |

---

## Suggested first implementation order (immediate)

Do **not** start at full gamification packs or CV. Adventure v1 rides after navigate foundation.

1. **E0.1** — ADR batch consolidate (**done**)  
2. **EP.1** — Auth/profile ADR (required profiles; Auth.js + soft gate)  
3. **E1.1** — Pipeline integrity defects (+ Wave 1 certify completion)  
4. **E0.3–E0.4** — Schemas + profile/contribution tables (plain SQL)  
5. **EP.2–EP.4** — Profile schema, sign-in UX, offline cache  
6. **E0.5–E0.6** — Consolidate job + cadence (steward-approved)  
7. **E1.2** — Finish deterministic ids  
8. ~~**E3.1–E3.2** — Routing correctness~~ (**done**)  
9. **EP.5 + E4.1** — Party ↔ profile + privacy controls  
10. **E5.1–E5.2** — Eligibility v2 (on profiles)  
11. **E8.1** — Next-best + Why?  
12. **E9.1 + adventure v1** — Side Quests submit + nearby discovery (fog/passport seeds)  

Parallel after #72: **M0 remainder** map zoom perf (cull / HUD / LOD).

---

## Open product decisions (blockers for later epics)

1. ~~**Identity:** When do accounts become required?~~ **Resolved 2026-08-10: user profiles are required** (see epic **EP**).  
2. ~~**PostGIS Day-1?**~~ **Resolved 2026-08-10: no — use daily/weekly consolidate into builder; PostGIS optional later.**  
3. ~~**Auth provider:**~~ **Resolved 2026-08-11 plan: Auth.js (NextAuth), email magic link + optional Google OAuth** (EP.1 ADR).  
4. ~~**Sign-in gate hardness:**~~ **Resolved 2026-08-11 plan: soft gate** — browse map anonymously; party / contribute / adventure sync require sign-in.  
5. ~~**Consolidate apply mode:**~~ **Resolved 2026-08-11 plan: steward-approved** override PRs (no auto-merge).  
6. **Height rules → OSM?** Prefer Park Bound overrides forever unless OSM has a clear tag.  
7. **MapLibre:** Stay on SVG until a measured need.  
8. **Python workers now vs later:** Prefer Node workers first; Python OK for GIS-heavy E12/E13.

---

## PR chain status (2026-08-11)

**CI unblocker (merge first):** [#92](https://github.com/parthalon025/six-flags-sa/pull/92) — blank `blocked` route after venue switch + functional harness GPS settle / return-to-KI before walk UX. Rebased onto latest `main` (incl. #93/#94 Vercel preview policy). All epic branches below are rebased onto that fix tip.

| Order | Epic | PR | Branch | Notes |
|-------|------|----|--------|-------|
| A | Hygiene / north star | [#79](https://github.com/parthalon025/six-flags-sa/pull/79) | `cursor/backlog-hygiene-north-star-1139` | Docs only |
| B | EP.1 Auth ADR | [#80](https://github.com/parthalon025/six-flags-sa/pull/80) | `cursor/ep1-auth-adr-1139` | |
| C | E1.1 pipeline integrity | [#81](https://github.com/parthalon025/six-flags-sa/pull/81) | `cursor/e11-pipeline-integrity-1139` | Wave 1 honesty |
| D | E0.3–4 schemas | [#82](https://github.com/parthalon025/six-flags-sa/pull/82) | `cursor/e0-schemas-store-1139` | |
| E | EP.2–4 soft-gate + cache | [#83](https://github.com/parthalon025/six-flags-sa/pull/83) | `cursor/ep-signin-offline-cache-1139` | Needs #92 harness |
| F | E0.5–6 consolidate | [#84](https://github.com/parthalon025/six-flags-sa/pull/84) | `cursor/e0-consolidate-cadence-1139` | |
| G | E1.2 deterministic ids | [#85](https://github.com/parthalon025/six-flags-sa/pull/85) | `cursor/e12-deterministic-ids-1139` | |
| H | EP.5 + E4.1 sharing | [#86](https://github.com/parthalon025/six-flags-sa/pull/86) | `cursor/ep5-e41-party-sharing-1139` | |
| I | E9.1 adventure queue | [#88](https://github.com/parthalon025/six-flags-sa/pull/88) | `cursor/e91-adventure-side-quests-1139` | |
| J | M0 Diagnostics HUD | [#89](https://github.com/parthalon025/six-flags-sa/pull/89) | `cursor/m0-map-perf-remainder-1139` | |
| K | E5 eligibility + guests | [#90](https://github.com/parthalon025/six-flags-sa/pull/90) | `cursor/e5-eligibility-v2-1139` | |
| L | E8.1 next-best + Why? | [#91](https://github.com/parthalon025/six-flags-sa/pull/91) | `cursor/e81-next-best-why-1139` | |

Land **one open epic at a time** after #92 is on `main`. Prefer A→L order. Vercel preview rate-limits on this account are non-blocking for Test app.

Related: [#52](https://github.com/parthalon025/six-flags-sa/issues/52) (older functional flakes; CP blank-route root cause addressed in #92).

## Tracking

- Keep this file updated when an epic completes (checkboxes or status line).  
- New lessons → `docs/lessons-learned.md`.  
- Gamification scoring details live in the dedicated design doc; do not fork conflicting XP tables — reconcile into E10 when implementing.
