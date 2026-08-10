# ADR: Dual-layer park truth (PostGIS twin ⊕ offline JSON)

**Status:** Accepted (planning)  
**Date:** 2026-08-10  
**Context:** Master Park Bound vision asks for PostGIS as canonical geospatial truth. The shipped PWA requires service-worker-precached venue JSON and must work offline in a queue line. `docs/park-intelligence-review.md` correctly rejected PostGIS *as the phone primary store*.

**GitNexus (2026-08-10):** Repo indexed with CLI (`gitnexus analyze`) — 3,450 symbols / 8,592 edges / 291 flows. Queries confirm today’s truth path is builder `writeVenue` → `public/venues/*.json`, and routing is on-device `findRoute` (called from reunification), not a DB spatial service.

## Decision

1. **Platform twin:** PostgreSQL + PostGIS holds the mutable canonical model (geometry, evidence, temporal validity, contributions, history, admin GIS, user profiles).
2. **Phone snapshot:** Builder/export pipeline produces `public/venues/*.map.json` and `*.pois.json` (and related indexes). The phone reads snapshots + client overlays. It does not query PostGIS for core map draw.
3. **Overlays:** Accepted/pending community contributions apply as Base ⊕ edits on the client (and optionally sync via a contribution service). They never hand-edit generated venue files.
4. **Graduation:** Durable fixes flow twin → overrides/OSM → rebuild/export → new snapshot.

## Pros of PostGIS (for Park Bound)

| Pro | Why it matters here |
|-----|---------------------|
| **Spatial queries as first-class SQL** | ST_DWithin, ST_Intersects, clustering, “POIs needing survey in this polygon” for Living Map missions — hard and slow in flat JSON. |
| **Canonical mutable twin** | Contributions, temporal validity (`valid_from`/`valid_to`), evidence rows, and history need relational integrity; Git-only JSON fights concurrent writers. |
| **Provenance & confidence tables** | Evidence claims, dissent, verification audits fit normalized tables better than re-fusing sidecars every build. |
| **User profiles + authz** | Required profiles, party membership, contribution `author_id`, reputation — natural RDBMS fit (PostGIS is Postgres). |
| **GIS admin / validation UI** | Human validation of low-confidence geometry, georef metadata, CV candidates need a queryable store, not SW-precached blobs. |
| **OSM sync / quality gating** | Partial extracts, thematic filters, and “hold until validated” patterns (Clearance-style) assume a spatial DB. |
| **Multi-park scale** | One schema, many parks; completion metrics and stale/conflict dashboards aggregate cleanly. |
| **Worker ecosystem** | GDAL/GeoPandas/Valhalla QA and Celery-style jobs expect PostGIS or can export to it. |

## Cons of PostGIS (for Park Bound)

| Con | Why it matters here |
|-----|---------------------|
| **Cannot be the phone primary store** | Service worker cannot precache a live DB; offline queue-line use requires JSON (or equivalent) snapshots. GitNexus flows show map/routing already local (`writeVenue` → static venues; `findRoute` on device). |
| **Dual-write / drift risk** | Twin + JSON can disagree unless export is the *only* path into `public/venues/*` (builder contract). |
| **Ops cost** | Postgres hosting, backups, migrations, connection pooling — heavier than today’s static Vercel/PWA + thin Node host. |
| **Latency & connectivity** | Phone → PostGIS for every pan/route breaks the “no server required” premise and battery/network budget. |
| **Team/stack mismatch (near term)** | Repo is Node/Next today; PostGIS often pulls Python GIS tooling — training and CI complexity. |
| **False sense of “live map”** | Putting geometry in PostGIS does not fix OSM quality; still need evidence fusion and human validation. |
| **Overkill for static facts alone** | Heights and POI lists that change rarely are already well served by builder JSON + overrides. |
| **Migration hazard** | Big-bang rewrite of phone to MapLibre+PostGIS would discard working SVG map, party mesh, and offline tests. |

## Verdict

Use PostGIS where its pros dominate: **platform twin, profiles, contributions, evidence, admin GIS, mission generation.**  
Keep JSON where its cons of PostGIS dominate: **offline map draw and on-device routing.**

That is this ADR’s dual-layer decision — not “PostGIS everywhere” and not “JSON forever.”

## Consequences

- We can grow Living Map, provenance, history, and required user profiles without breaking offline.
- We must maintain an export contract (tests that twin ↔ snapshot invariants hold).
- Valhalla/MapLibre/Python workers may attach to the twin/builder side; they are not phone runtime dependencies.
- JSON ceases to be the *only* place platform truth lives, but remains the *offline contract*.

## Rejected alternatives

- PostGIS-only online map (breaks offline premise).
- JSON-only forever with no twin (blocks temporal/contribution/profile scale).
- Guests writing `public/venues/*` directly (breaks builder contract).
