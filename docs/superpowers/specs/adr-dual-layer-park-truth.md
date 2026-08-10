# ADR: Dual-layer park truth (PostGIS twin ⊕ offline JSON)

**Status:** Accepted (planning)  
**Date:** 2026-08-10  
**Context:** Master Park Bound vision asks for PostGIS as canonical geospatial truth. The shipped PWA requires service-worker-precached venue JSON and must work offline in a queue line. `docs/park-intelligence-review.md` correctly rejected PostGIS *as the phone primary store*.

## Decision

1. **Platform twin:** PostgreSQL + PostGIS holds the mutable canonical model (geometry, evidence, temporal validity, contributions, history, admin GIS).
2. **Phone snapshot:** Builder/export pipeline produces `public/venues/*.map.json` and `*.pois.json` (and related indexes). The phone reads snapshots + client overlays. It does not query PostGIS for core map draw.
3. **Overlays:** Accepted/pending community contributions apply as Base ⊕ edits on the client (and optionally sync via a contribution service). They never hand-edit generated venue files.
4. **Graduation:** Durable fixes flow twin → overrides/OSM → rebuild/export → new snapshot.

## Consequences

- We can grow Living Map, provenance, and history without breaking offline.
- We must maintain an export contract (tests that twin ↔ snapshot invariants hold).
- Valhalla/MapLibre/Python workers may attach to the twin/builder side; they are not phone runtime dependencies.
- JSON ceases to be the *only* place platform truth lives, but remains the *offline contract*.

## Rejected alternatives

- PostGIS-only online map (breaks offline premise).
- JSON-only forever with no twin (blocks temporal/contribution scale).
- Guests writing `public/venues/*` directly (breaks builder contract).
