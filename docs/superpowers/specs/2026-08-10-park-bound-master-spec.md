# Park Bound — Master Product & Implementation Spec

**Status:** Master specification (planning only — do not implement the whole platform in one pass)  
**Date:** 2026-08-10  
**North star:** *Explore Beyond the Map.* The map is never finished.  
**Companion docs:**
- Repository audit (this file §2)
- Prior architecture verdicts: [`../park-intelligence-review.md`](../park-intelligence-review.md)
- Builder contract: `AGENTS.md`
- Living-map / gamification design: [`../superpowers/specs/2026-08-10-gamified-map-contributions-design.md`](../superpowers/specs/2026-08-10-gamified-map-contributions-design.md)
- Phased backlog: [`./park-bound-implementation-backlog.md`](./park-bound-implementation-backlog.md)

---

## 1. Product vision

Park Bound is a **community-powered, exploration-first digital twin** of theme parks (and other venues). It is not merely a ride tracker, wait-time app, or static map.

It combines:

| Pillar | Job |
|--------|-----|
| Park Digital Twin | Spatially aware model of the venue |
| Park Intelligence | Rules, weather, ops, provenance, confidence |
| Party System | Live coordination, privacy, subgroups, reunification |
| Navigation & Routing | Park-native pedestrian graph |
| Dynamic Planner | Next-best action under live constraints |
| Exploration & Gamification | Missions, XP, impact, passports, packs |
| Community Living Map | Contribute → verify → improve the twin |

### Core product loop

```text
EXPLORE → DISCOVER → CONTRIBUTE → VERIFY → IMPROVE THE MAP
       → HELP OTHER VISITORS → BETTER INTELLIGENCE → BETTER EXPLORATION ↺
```

### Defining question

> Given where my party is, who is with me, what everyone can do, what’s happening in the park, what the weather is doing, and what we want — **what should we explore next?**

### Differentiation

Digital twin + live party map + park-native routing + eligibility + weather intelligence + dynamic optimization + community mapping + exploration gamification — as one system, not five bolted apps.

---

## 2. Repository audit (what already exists)

Shipped venues today: **Kings Island**, **Cedar Point**, **Six Flags Fiesta Texas**, **Big Kahuna's**.

| Pillar | Exists now | Partial | Missing |
|--------|------------|---------|---------|
| Digital twin | OSM builder → `*.map.json` / `*.pois.json`; overrides, heights, trace, evidence fuse | Provenance defects; name-keyed joins | Temporal validity; PostGIS authoring twin; human validation UI |
| Intelligence | Height eligibility; weather→outlook; evidence weights; ride-status ⊕ forecast | Eligibility reasons/profiles; action log not wait series | Accessibility/food/events engines; wait prediction |
| Party | Mesh + hybrid transports; sealed crypto; adaptive GPS; meet; soft groups | Roles = host/member; privacy coarse | Subgroups, duration/precision sharing, guardians, rich reunify UX |
| Routing | On-device A* `lib/routing.js`; profiles/way flags starting | Stairs/shade/wheelchair data thin in OSM | Full park profiles; layer-aware crossings fix |
| Planner | Thin local `scenario.js` | Not opportunity-cost optimizer | Dynamic replan, what-if, strategy sim, split-party planning |
| Exploration / XP | Explore UX + design docs only | Ride reports as social signal | Quests, XP, impact, fog-of-war, packs |
| Living map | Builder + party ride status | No guest durable edits | Contribution service, verify, graduate to OSM/overrides |

**Stack today:** Next.js PWA (`apps/party-tracker`) + Node venue builder (`packages/venue-builder`) + shared contracts. Offline-first via service worker. Thin optional Node sync host. **Not** Python/FastAPI/Valhalla/MapLibre/RN on the phone path.

---

## 3. Critical architecture decision (reconcile with reality)

The product vision wants **PostGIS as canonical geospatial truth**. The running app requires **offline JSON** that a service worker can precache. Both are true.

### Decision: dual-layer truth

```text
┌─────────────────────────────────────────────────────────┐
│  PLATFORM TWIN (authoring / intelligence / contributions)│
│  PostgreSQL + PostGIS + evidence + temporal validity     │
│  Workers: ingest, georef, CV candidates, mission gen     │
└───────────────────────────┬─────────────────────────────┘
                            │ export / bake
                            ▼
┌─────────────────────────────────────────────────────────┐
│  PHONE SNAPSHOT (offline contract — immutable per build) │
│  public/venues/*.map.json + *.pois.json + routing graph  │
│  ⊕ client overlays (pending/accepted contributions)      │
└─────────────────────────────────────────────────────────┘
```

| Layer | Role | Rules |
|-------|------|-------|
| **PostGIS twin** | Canonical mutable model for parks, geometry, provenance, contributions, history | Source of truth for *platform* features; admin GIS; graduation target |
| **Venue JSON bundle** | Deterministic offline snapshot for the PWA | Still the only thing the phone *must* have; still produced only by the builder/export pipeline |
| **Client overlays** | Live Base ⊕ edits for accepted/pending contributions | Never silently rewrite generated `public/venues/*` |

### What we deliberately do **not** do

1. Replace the PWA with a PostGIS-online-only MapLibre app.
2. Put Valhalla on the phone (keep on-device routing; Valhalla optional for builder QA / offline graph bake).
3. Rewrite working party mesh / crypto for a greenfield Python stack in Phase 0.
4. Hand-edit or guest-write generated venue JSON (builder contract stands).
5. Treat LLM output as canonical coordinates, distances, eligibility, or weather thresholds.
6. Make community edits canonical without validation.
7. Present predictions or stale GPS as official / live.

### Stack evolution (pragmatic)

| Domain | Near-term | Platform evolution |
|--------|-----------|--------------------|
| Phone app | Keep Next.js PWA (`apps/party-tracker`) | Optional later native shell; not a rewrite prerequisite |
| Map render | Keep SVG `ParkMap.jsx` | Evaluate MapLibre only if tiles/perf demand it |
| Routing | Keep `lib/routing.js` | Optional Valhalla in workers for graph QA / bake |
| Builder | Keep Node `packages/venue-builder` | Grow export-from-PostGIS; do not delete OSM pipeline |
| Twin DB | **Introduce** PostGIS for platform twin | Required before Living Map graduation at scale |
| API | Next route handlers + optional Node host first | Extract FastAPI/services when boundaries stabilize |
| AI | Interface + mocks; Ollama optional in workers | Never final authority on deterministic facts |

Greenfield `services/*` Python layout from the vision doc is a **target shape**, not a Day-1 rewrite. Prefer strangler: add `services/park-twin` (PostGIS + schemas) beside the existing app; migrate exports into the builder.

---

## 4. Shared data model (canonical entities)

Every entity supports (minimum):

```text
id, name, type, geometry?, status?,
source, source_date, retrieved_at, confidence,
last_verified, valid_from?, valid_to?,
created_at, updated_at
```

### Park tree (logical)

```text
Park
├── Areas
├── Attractions (rides, shows, characters, experiences)
├── Entrances / Exits
├── Paths / Buildings
├── Food / Shops / Services / Bathrooms / …
├── Events / Historical features
└── Accessibility features
```

### Attraction location model (never a single pin for nav)

```text
Attraction
├── queue_entrance
├── queue_path
├── ride_entrance
├── station
├── unload
├── ride_exit
└── queue_exit
```

### Static vs dynamic (hard split)

| Static (twin + bundle) | Dynamic (realtime / observations) |
|------------------------|-----------------------------------|
| Stats, manufacturer, heights, geometry | Open/closed, wait, temporary closure |
| Historical facts | Operating mode, crowd reports |
| Policies with temporal validity | Weather *risk* (labelled predicted) |

### Eligibility engine (deterministic)

Guest profile × ride rules → `ELIGIBLE` | `NOT_ELIGIBLE` | `ELIGIBLE_WITH_COMPANION` | `UNKNOWN` (+ reasons). LLM may extract candidate rules; **code decides**.

### Evidence / provenance

Every important field retains sources, confidence, dissent. Preferred hierarchy: official park → official map/policy → OSM/GIS → imagery → guest evidence → community → historical. Never silently overwrite conflicts.

### Source priority & entity resolution

Normalize aliases to stable ids (`kings-island:orion`). Display names are not primary keys.

### User profiles (required)

**Signed-in user profiles are required** for Park Bound product use (map session, party, contributions, planner personalization, and explorer progress). Anonymous throwaway sessions are not a supported product mode.

| Concern | Requirement |
|---------|-------------|
| Identity | Stable `user_id` backed by an account (email/OAuth/device-linked signup TBD in implementation) |
| Profile | Display name, avatar/cosmetics hooks, explorer level, reputation, impact, per-park passport |
| Party | Party members resolve to (or are linked from) user profiles; roles attach to profile membership |
| Eligibility | Height/age/accessibility live on profile (or linked guest profiles the user manages) |
| Contributions | All reports, confirms, and quests attribute to `user_id`; no anonymous global score |
| Offline | Profile + entitlements cache on device after sign-in; sync when online; sealed party crypto unchanged |
| Privacy | Location sharing remains explicit; profile existence ≠ continuous location broadcast |

Child accounts / guardian-managed profiles are in scope for the party roles model (`Child` under an `Adult`/`Owner`).

---

## 5. Party system (product requirements)

Party is first-class: members, roles (`Owner`/`Adult`/`Child`/`Guest`), subgroups, locations, permissions, meeting points, shared plans.

Location states: `LIVE` | `RECENT` | `STALE` | `OFFLINE` | `UNKNOWN` — never show stale as live.

Privacy: explicit share off / approximate / precise; duration; visibility scope. Server (when used) enforces authz; keys stay on devices for sealed payloads.

Architecture target remains **hybrid**: cloud + local host + offline continuation (already largely true in-repo).

---

## 6. Navigation, weather, planner (product requirements)

- Pedestrian graph with park attributes (stairs, shade, stroller, wheelchair, indoor, seasonal, …).
- Profiles: fastest, accessible, stroller, heat/rain/shade, crowd avoid, party route.
- Weather → ride risk engine with `OBSERVED` | `OFFICIAL` | `PREDICTED` | `INFERRED` labels.
- Wait-time series from observations (append-only), then prediction — no fake official feed.
- Planner: next-best action, dynamic replan, opportunity cost, split-party, reunification, what-if, strategy sims.
- Every recommendation has a **Why?** panel.

---

## 7. Living map + exploration gamification

Community contributions are a **core loop**, not a side quest.

Users: confirm, correct, add, map, verify, evidence, report stale.

Gamification rewards **accuracy, difficulty, evidence, confirmation, longevity, impact** — not raw volume. Impact (“helped N visitors”) outranks XP. See detailed design in the gamification spec (Approach B: central contributions + overlays → graduate to overrides/OSM).

Product surfaces from the vision (implement in gamification phases, not before twin foundations):

- Park completion % + fog of war (`UNKNOWN` → `DISCOVERED` → `MAPPED` → `VERIFIED`)
- Exploration modes (Wander, Quest, Survey, …)
- XP / levels / reputation / badges / passports
- Expedition packs (earned cosmetics — **no** loot-box gambling)
- Party expeditions, discovery cards, seasonal missions
- AI-generated survey missions from low-confidence / stale / conflict objects

---

## 8. AI layer policy

LLMs may: research, extract, classify, resolve names, summarize, explain, generate missions.

LLMs must **not** be authority for: coordinates, distance, routing, height math, eligibility, weather thresholds, canonical DB truth.

Unavailable external sources → interface + labelled mock; never fabricate park facts.

---

## 9. Offline-first & safety invariants

Before the park: download map, paths, rides, heights, POIs, routing graph, itinerary.

**Never:**

- Route through restricted geometry without saying so
- Claim stale location is live
- Claim predicted closure is official
- Override official facts with weaker evidence
- Allow invalid height calculations
- Expose party location outside authorization
- Let low-confidence community edits become canonical silently
- Let LLM output bypass deterministic validation

---

## 10. Definition of done (every feature)

Backend/data/API/UI as applicable · tests · error handling · offline considered · permissions · provenance · confidence · logging · docs · regression protection.

Data-producing features also: source, timestamp, confidence, validation path, conflict handling, historical versioning when in twin scope.

---

## 11. Lessons-learned system

Maintain `docs/lessons-learned.md`. Each production bug → lesson, root cause, fix, regression test, guardrail.

---

## 12. How Cursor (and humans) should execute

1. Inspect repo; map to this spec.
2. Do not rewrite working systems without cause.
3. Take the **smallest next backlog item** that unblocks the dependency chain.
4. Spec → implement → test → document → lessons → next.
5. Prefer correctness, integrity, offline resilience, geospatial accuracy, privacy, explainability, testability, modularity, UX — in that spirit.

**Do not** attempt Phases 9–14 (community, packs, CV, multi-park platform rewrite) before twin schema, GIS integrity, routing correctness, party privacy, and validation paths are stable.

Kings Island remains the **reference park** for depth; multi-park is already partially shipped — deepen KI, don’t fork codebases per park.
