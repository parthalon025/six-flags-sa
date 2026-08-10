# Research: Gamified map contributions (Waze-style for Parkbound)

**Date:** 2026-08-10  
**Status:** Research complete; design proposal in [`../superpowers/specs/2026-08-10-gamified-map-contributions-design.md`](../superpowers/specs/2026-08-10-gamified-map-contributions-design.md)  
**Master plan:** [`../superpowers/specs/2026-08-10-park-bound-master-spec.md`](../superpowers/specs/2026-08-10-park-bound-master-spec.md)  
**Notion:** MCP server required desktop OAuth — workspace search/write was **blocked** in this cloud run. Authenticate Notion in Cursor Desktop, then re-run to merge any existing product notes and publish a Notion copy of this brief.

---

## Executive summary

Crowdsourced map systems that stay accurate at scale combine three layers: (1) **low-friction field reports** that feel useful immediately, (2) **trust and validation** so bad data does not poison the map, and (3) **motivation design** that rewards *verified value to others*, not raw edit volume.

For Parkbound, the winning pattern is **not** “users write OSM live from the phone.” It is a **StreetComplete / Wayfarer hybrid on top of Parkbound’s existing Base ⊕ edits model**: park-day observations and structured map fixes land in a **central contribution store**, earn provisional score, get peer/moderator confirmation, then either (a) apply as venue overlays for fast in-app improvement or (b) graduate to OSM / builder overrides when the change is durable geometry or tagging. Points and ranks should track **confirmed helpfulness**, with status and editing power as the primary rewards (SAPS), not redeemable swag first.

This fits Parkbound’s hard constraints: offline-first PWA, builder-owned venue JSON, no mandatory always-on server for core use.

---

## Research sources

### Industry / product

| Source | What it teaches |
|--------|-----------------|
| [Waze Help — Earn points](https://support.google.com/waze/answer/6273662) | Explicit point table: drives (5), reports (6–9), confirm/deny (2), place details (3–6), photos (9), map edits (3). **Confirmation of others’ reports is a first-class scored action.** |
| [Waze / HBS Digit](https://aiinstitute.hbs.edu/platform-digit/submission/waze-leveraging-the-crowd-to-find-your-way/) | Dual crowdsourcing: *indirect* (GPS traces) + *direct* (reports). Network effects + “thank you economy” + ranks/badges. |
| [Octalysis look at Waze](https://yukaichou.com/gamification-examples/an-octalysis-look-at-the-waze-craze/) | Core drives: Epic Meaning, Social Influence (thanks), Achievement (points/ranks), Loss & Avoidance for veterans; later ranks shift toward mentoring and map fixing. |
| [Wazeopedia — Rank and points](https://www.waze.com/discuss/t/your-rank-and-points/377943) | Map edit credits are capped / deduped (same segment / day; save caps) to reduce farming. Separate **user rank** vs **editor rank**. |
| [StreetComplete wiki](https://wiki.openstreetmap.org/wiki/StreetComplete) | Quest UX: simple on-site questions → OSM upload. Achievements unlock educational links (mastery + meaning, not cash). Offline queue + conflict resolution. Team mode for mapping parties. |
| [MapRoulette](https://wiki.openstreetmap.org/wiki/MapRoulette) | Microtasks + challenge leaderboards. Community critique: gamification can drive overzealous retagging if tasks are poorly designed. |
| [Niantic Wayfarer](https://niantic.helpshift.com/hc/en/21-wayfarer/) / [rating system](https://community.wayfarer.nianticlabs.com/t/new-wayfinder-rating-system/113738) | Nominate → community review → accept. Points for **approved** nominations/edits and **review agreement**, not submission alone. Tiered Wayfinder rating gates privileges. |
| OSMF [Organised Editing Guidelines](https://osmfoundation.org/wiki/Organised_Editing_Guidelines) | Multi-user coordinated apps must declare wiki activity page, hashtag, goals, tools, cleanup plan. Direct OSM writes from a product are a compliance project, not a feature toggle. |
| [OSM API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6) | Changesets + diff upload; no pre-moderation at API. Quality is social/post-hoc (OSMCha, notes, community). |
| Clearance / sync literature ([Rodrigo](https://medium.com/@frederic.rodrigo/state-of-the-art-openstreetmap-extraction-synchronization-under-quality-constraints-3d46907c5151)) | Downstream apps often keep a **quality-gated extract**; edits still happen in OSM; rejected diffs wait for fix upstream. |

### Theory

| Source | What it teaches |
|--------|-----------------|
| Odobašić et al., *Gamification of Geographic Data Collection* (GI_Forum 2013) | SAPS: **Status > Access > Power > Stuff**. Compare Waze / Foursquare / Ingress. Point types: experience, redeemable, skill, karma, reputation. |
| Yu-kai Chou — Octalysis / “what is gamification” | Start from motives, not PBL decoration. Relative leagues beat hopeless global leaderboards. Avoid overjustification (extrinsic rewards killing intrinsic help). |
| Guul / community gamification guides | Points = granular feedback; badges = milestones; leaderboards = peer context. Reset/scoped boards keep competition closable. |
| Self-Determination Theory (via recent SGT / APAR papers) | Autonomy, competence, relatedness. Parkbound’s party mesh already supplies relatedness — contributions should plug into that social fabric. |

### In-repo context (Parkbound)

| Source | Relevance |
|--------|-----------|
| `docs/architecture-map.md` | Builder writes `public/venues/*`; phone reads JSON. Phone must not become a second writer of shipped venue artifacts. |
| `docs/park-intelligence-review.md` | **Human validation UI** called highest-leverage. **Base ⊕ edits** already informal via overrides. Observation/action log proposed for ride reports. Offline is non-negotiable. PostGIS-as-primary-runtime rejected. |
| Builder ↔ app contract (AGENTS.md) | Durable venue corrections belong in `data/venues/<id>.*` then rebuild — never hand-patched generated JSON. |

---

## Cross-cutting findings

### 1. Two contribution tempos

Successful systems separate:

1. **Ephemeral / operational reports** — traffic, hazards, “ride down,” long queue, closed restroom. High volume, short TTL, peer confirm/deny.
2. **Durable map structure** — missing path, wrong POI location, height rule, missing amenity tag. Low volume, review gates, may flow to OSM or builder overrides.

Waze scores both but treats them differently operationally. StreetComplete mostly does (2) as tiny quests. Wayfarer is almost entirely (2) with community review.

### 2. Score the outcome, not the submission

Wayfarer and mature Waze editor culture both push credit toward **accepted / agreed** work. Raw submission points invite spam. Karma/reputation points (confirming others) create a second engagement loop that improves quality.

### 3. Power is the premium reward

SAPS ranking matches Waze editor ranks and Wayfarer tiers: higher trust → more edit surface / faster review / moderation. Tangible “stuff” is expensive and secondary; status + power scale better for a park companion app.

### 4. Quest framing beats freeform GIS

StreetComplete’s lesson: casual users will not learn OSM tagging. Give **one question at a time** near the user’s GPS: “Is this restroom open?”, “Does this ride require a companion?”, “Is this path stairs?”. Freeform geometry editing stays expert/moderator territory.

### 5. Direct OSM write is a product decision with policy cost

If Parkbound users edit OSM under an organised activity:

- OSM account OAuth per user (or clearly disclosed bot + user attribution — community prefers human accounts).
- Organised Editing wiki page + hashtag + cleanup plan.
- Quest designs that avoid armchair vandalism (GPS proximity, photo optional, rate limits).
- Expect post-hoc OSMCha scrutiny; do not assume API validation.

A **central contribution DB** that later emits OSM changesets (or GitHub PRs into `data/venues/`) is usually safer for v1.

### 6. Offline-first changes the architecture

Parkbound already precaches venue maps. Contributions must:

- Queue locally when offline.
- Apply as **local overlays** immediately for the contributor (and optionally party).
- Sync when online for scoring and global distribution.
- Never require PostGIS on the phone path for core map draw.

---

## Competitor / analogue matrix

| System | Store of truth | Validation | Motivation | Fit for Parkbound |
|--------|----------------|------------|------------|-------------------|
| Waze | Proprietary map | Peer confirm + editor hierarchy | Points, ranks, thanks, some stuff | Best UX reference for reports + confirm |
| StreetComplete | OSM | OSM community + conflict resolve | Achievements, stats, meaning | Best UX for quests + OSM path |
| MapRoulette | OSM | Challenge design + community | Points / boards | Good for backlog microtasks for trusted mappers |
| Wayfarer | Niantic private map | Peer review consensus | Rating tiers, agreements | Best model for “nominate then review” POIs |
| Parkbound today | Builder JSON + OSM extract | Human overrides / evidence fuse | None | Needs contribution UI + score layer |

---

## Gaps / risks

- **Gaming the score:** volume farming, false confirms, sockpuppets → need rate limits, agreement metrics, proximity checks, delayed full credit.
- **OSM policy missteps:** organised editing without disclosure; automated low-quality tags.
- **Profiles vs offline:** user profiles are required (product decision); mitigate with offline profile cache after sign-in — do not require continuous connectivity for map draw.
- **Leaderboard demotivation:** global boards demotivate mid-pack → use per-venue / weekly leagues.
- **Notion gap:** product intent in Notion could not be merged this run.

---

## Recommended direction (preview)

**Hybrid contribution pipeline (Approach B in the design doc):** central contribution store + in-app overlays first; graduate durable fixes to OSM and/or venue builder overrides; gamify confirmed helpfulness with SAPS (status, access, power) and Waze-like confirm loops.

See the design spec for architecture, contribution types, scoring, and phased delivery.
