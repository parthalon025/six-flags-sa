# Park Bound — Implementation Backlog

**Master spec:** [`./2026-08-10-park-bound-master-spec.md`](./2026-08-10-park-bound-master-spec.md)  
**Rule:** One increment at a time. Each epic lists **depends on**, **ships**, **done when**.  
**Default park for depth work:** Kings Island (other venues must keep building).

This backlog **strangles** toward the vision. It does not greenfield-rewrite the PWA.

---

## Epic map (vision phases → backlog)

| Vision phase | Backlog epics | Notes |
|--------------|---------------|-------|
| 0 Architecture | E0 | Add twin schemas + PostGIS beside existing app |
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

## E0 — Platform twin foundation

**Depends on:** nothing  
**Goal:** Canonical schema + PostGIS without breaking offline JSON.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E0.1 | Audit & ADR | `docs/` ADR: dual-layer truth (PostGIS ↔ JSON export) | ADR merged; linked from master spec |
| E0.2 | Docker PostGIS service | Optional `infra/docker` compose profile `twin` | `docker compose --profile twin up` healthy; app still runs without it |
| E0.3 | Shared schemas package | `packages/schemas` (or extend `packages/shared`) for Park/Attraction/POI/Evidence | Types + JSON Schema; CI validates fixtures |
| E0.4 | Minimal park-twin tables | parks, areas, attractions, pois, geometries, evidence_claims | Migrations apply cleanly |
| E0.5 | Export stub | Script: twin → builder-compatible staging OR document “JSON remains builder-owned until E1.4” | Clear single direction of export; no dual-write to `public/venues` |

**Non-goals:** Replacing Next.js; deleting venue-builder; phone querying PostGIS.

---

## E1 — Park foundation integrity (Kings Island depth)

**Depends on:** E0.1 (ADR); E0.3 preferred  
**Goal:** Stable identity + static/dynamic split + fix known pipeline defects.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E1.1 | Pipeline integrity defects | Fixes from `park-intelligence-review` workstream (provenance, inventory stage, expect locks) | Tests green; KI bundle provenance coherent |
| E1.2 | Deterministic entity ids | Stable ids for rides/POIs; overrides migrate off display-name-only keys where safe | Joins survive OSM rename; Fiesta duplicate names still OK |
| E1.3 | Static vs dynamic schema | Ride static record shape documented; live fields only in observation/realtime tables | No wait/open mixed into static JSON as “official” |
| E1.4 | Twin ingest from builder | Load KI (then all venues) into PostGIS from current builder outputs | Round-trip counts match; provenance columns populated |

---

## E2 — GIS geometry & validation

**Depends on:** E1.2, E1.4  
**Goal:** Entrance/exit model + human validation path.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E2.1 | Attraction location slots | queue_entrance … queue_exit in twin + export to pois | Nav can prefer real queue entrance when present |
| E2.2 | Admin validation UI | Review low-confidence geometry / candidates | Steward can accept/reject; audit log |
| E2.3 | Georef metadata store | Transformation error + control points in twin | Low-confidence requires validation |
| E2.4 | Path attribute coverage | Carry tags + per-venue coverage counters | Profiles refuse to claim data they don’t have |

---

## E3 — Park-native routing

**Depends on:** E2.4; layer/stairs fixes  
**Goal:** Correct graph + honest profiles on device.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E3.1 | Layer-aware crossings | No bridge→underpass false junctions | Regression test on KI bridges |
| E3.2 | Snap exclusion | Wheelchair/stroller never snap onto excluded segments | Blocked result when only snap excluded |
| E3.3 | Routing profiles v1 | Avoid stairs / restricted; accessible when coverage > 0 | UI hides empty profiles |
| E3.4 | Optional Valhalla bake-off | Builder worker compares graphs | Documented; phone still uses `lib/routing.js` |

---

## E4 — Party product completion

**Depends on:** E3 for quality reunify routes  
**Goal:** Privacy + roles + subgroups + find/reunify UX.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E4.1 | Sharing controls | Off / approx / precise + duration | Explicit UX; defaults safe |
| E4.2 | Roles & permissions | Owner/Adult/Child/Guest matrix | Enforced in protocol |
| E4.3 | Subgroups | Coaster vs kids groups with own target | State + map chrome |
| E4.4 | Find / Meet / Reunify UX | Surfaces on live map; stale never labelled live | Functional tests |
| E4.5 | Battery-aware intervals | Already partial — verify + UI affordance | Documented behavior tests |

---

## E5 — Eligibility / rules engine v2

**Depends on:** E1.2  
**Goal:** Deterministic multi-member reasons.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E5.1 | Guest profiles | Height/age/accessibility prefs per member | Stored locally + optional party sync |
| E5.2 | Verdict + reasons | ELIGIBLE / NOT / COMPANION / UNKNOWN + why | Unit tests; no LLM in path |
| E5.3 | Party eligibility matrix | Who can ride what together | Planner-ready API |

---

## E6 — Weather intelligence

**Depends on:** E5 optional; existing `weather.js`  
**Goal:** Labelled risk, not fake official status.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E6.1 | Ride sensitivity table | Lightning/wind/rain/temp rules in twin | KI seeded; unknowns explicit |
| E6.2 | Risk output | Current/predicted risk + reason + confidence + label enum | UI never says “official closed” for prediction |
| E6.3 | Planner hook | Risk as planner input | Covered in E8 |

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

**Depends on:** E0 twin + E2.2 validation; gamification design Approach B  
**Goal:** Contribute → verify → overlay → graduate.

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E9.1 | Contribution API + local queue | Tier-1 experience reports | Offline-first; party sync optional |
| E9.2 | Peer confirm / deny | Waze-like | Rate limits + proximity |
| E9.3 | Client overlay merge | Base ⊕ accepted ⊕ pending | Conflict strategy declared |
| E9.4 | Tier-2 quests | StreetComplete-style | GPS-gated |
| E9.5 | Graduate to overrides | PR/operator apply → rebuild | Builder remains sole `public/venues` writer |
| E9.6 | Graduate to OSM | Organised editing compliance | Phase after E9.5 |

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

| ID | Item | Ships | Done when |
|----|------|-------|-----------|
| E12.1 | Source discovery worker | Interface + mock + real adapters | Labelled provenance |
| E12.2 | PDF/OCR extract → candidates | Evidence claims only | Human/ stewards validate |
| E12.3 | Conflict + freshness jobs | Feed E10.5 missions | Dashboard metrics |

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
| E14.2 | Cross-park explorer profile | Passport federation | Account optional until E9/E10 |
| E14.3 | No per-park forks | Enforce in review | Documented |

---

## Suggested first implementation order (immediate)

Do **not** start at gamification or CV.

1. **E0.1** — ADR dual-layer truth (docs only)  
2. **E1.1** — Pipeline integrity defects (highest data-quality ROI)  
3. **E0.2–E0.4** — PostGIS + schemas beside app  
4. **E1.2** — Deterministic ids  
5. **E1.4** — Ingest KI into twin  
6. **E3.1–E3.2** — Routing correctness  
7. **E4.1** — Party privacy controls  
8. **E5.1–E5.2** — Eligibility v2  
9. **E8.1** — Next-best + Why?  
10. **E9.1** — Living map Tier-1  

---

## Open product decisions (blockers for later epics)

1. **Identity:** When do accounts become required — E9 scoring only, or earlier?  
2. **PostGIS hosting:** Local docker for dev; production host TBD.  
3. **Height rules → OSM?** Prefer Park Bound overrides forever unless OSM has a clear tag.  
4. **MapLibre:** Stay on SVG until a measured need.  
5. **Python workers now vs later:** Prefer Node workers first if team velocity is JS; Python OK for GIS-heavy E12/E13.

---

## Tracking

- Keep this file updated when an epic completes (checkboxes or status line).  
- New lessons → `docs/lessons-learned.md`.  
- Gamification scoring details live in the dedicated design doc; do not fork conflicting XP tables — reconcile into E10 when implementing.
