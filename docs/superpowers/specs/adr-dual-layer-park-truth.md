# ADR: Park truth without requiring PostGIS (batch consolidate + offline JSON)

**Status:** Accepted (planning) — revised 2026-08-10  
**Supersedes:** Earlier draft that treated PostGIS as Day-1 platform twin  

**Context:** Park Bound needs living-map contributions, required user profiles, and continuously improving venue data — while the phone must stay offline-first on precached JSON. GitNexus shows today’s path is already batch: builder `writeVenue` / `reindex` → `public/venues/*.json`; routing is on-device `findRoute`.

## Decision

**Near-term (default): no PostGIS.** Use a **daily or weekly consolidate** pipeline on top of the existing venue builder.

```text
Phone (signed-in profile)
  → contribution / observation API  (plain Postgres or equivalent — not PostGIS)
  → client overlays (immediate Base ⊕ edits)
  → peer confirm / steward review
        │
        ▼  schedule: daily (hot parks) or weekly (default)
  consolidate job
        │
        ├─ durable accepted edits → data/venues/<id>.overrides.json | heights | …
        ├─ optional OSM changeset graduation (later)
        └─ npm run venues:overrides | venues:rebuild | venues:reindex
                │
                ▼
        public/venues/*.json  (sole offline map contract)
```

| Layer | Store | Cadence |
|-------|--------|---------|
| Ephemeral ops (ride down, queue band) | Contribution API + TTL; party mesh | Minutes–hours; **never** baked into venue JSON |
| Pending / accepted overlays | API + client cache | Continuous |
| Durable map/POI/height fixes | Git `data/venues/*` via consolidate | **Daily or weekly** rebuild |
| Phone map / routing | SW-precached JSON | After each ship |

**PostGIS is optional later** — only if/when spatial admin queries, polygon mission generation, or GIS validation UI outgrow JSON + precomputed stats.

## Why batch consolidate works here

1. **Matches the builder contract** — only the builder writes `public/venues/*`; consolidate feeds **inputs**, not generated outputs.
2. **Matches product tempo** — durable park geometry does not need second-by-second DB truth; guests feel immediacy via **overlays**, not via PostGIS.
3. **Avoids dual spatial truth** — one geospatial artifact on the phone (JSON graph), one authoring path (overrides → rebuild).
4. **Profiles still work** — required accounts live in ordinary Postgres/Auth tables; they do not need geometry types.
5. **GitNexus-aligned** — `writeVenue`, `reindex`, override sidecars already form a consolidate-friendly pipeline.

## Cadence guidance

| Cadence | Use when |
|---------|----------|
| **Continuous overlay sync** | Always — accepted contributions visible before rebuild |
| **Daily consolidate** | Active season / high contribution volume / KI reference park |
| **Weekly consolidate** | Default multi-park; low churn |
| **On-demand** | Steward “ship now” after a high-impact fix |

Ship notes / app-version bump workflow stays separate (merge-time version bump on `main`).

## Pros of “no PostGIS + batch consolidate”

| Pro | Detail |
|-----|--------|
| Lower ops | No spatial extension, simpler hosting, fewer migration footguns |
| No phone↔DB spatial coupling | Offline premise intact |
| Fits existing scripts | `venues:overrides` / `rebuild` / `reindex` are the consolidate sinks |
| Clear audit trail | Durable changes are Git diffs in `data/venues/` |
| Faster to Living Map MVP | E9 can ship overlays + confirm before any GIS DB |
| Profiles/XP without geometry | Auth + score tables ≠ PostGIS |

## Cons / limits (when you’d add PostGIS later)

| Con | Mitigation until PostGIS |
|-----|--------------------------|
| Weak “points in polygon” admin SQL | Precompute area completion % into export `meta`; survey missions from entity lists + bbox |
| Harder live GIS editing UI | Steward reviews contribution payloads + map deep-link; full digitizing stays in builder/trace tools |
| Historical geometry versions | Git history of overrides + dated exports; not a temporal DB |
| Heavy concurrent spatial analytics | Defer; not needed for v1 explorer loop |
| OSM quality-gated extracts | Keep using Overpass + builder; Clearance-style later |

## PostGIS pros/cons (reference — deferred)

**Pros if introduced later:** ST_DWithin/Intersects, canonical mutable geometry, GIS admin, thematic OSM sync, multi-park spatial dashboards, GDAL/Valhalla worker fit.

**Cons if introduced too early:** dual-write drift, ops cost, temptation to query PostGIS from the phone, stack complexity, overkill for static facts, migration hazard vs working SVG/`findRoute` stack.

## Verdict

| Horizon | Geometry / map truth | Profiles & contributions |
|---------|----------------------|---------------------------|
| **Now → Living Map MVP** | JSON snapshots + overlays; **daily/weekly consolidate → builder** | Plain DB / auth (required profiles) |
| **Later (optional)** | Add PostGIS twin **behind** export if spatial admin/missions demand it | Unchanged; still export to JSON for phones |

Do **not** block EP (profiles), E9 (contributions), or E10 (XP) on PostGIS.

## Consequences

- Backlog E0 drops PostGIS-as-blocker; add **E0-C consolidate scheduler** instead.
- Contribution graduation always lands in `data/venues/` (or OSM), then rebuild — never patches `public/venues` by hand.
- Precompute any “completion / stale / fog” stats the phone needs into the bundle or a small sidecar JSON at consolidate time.
- Revisit PostGIS only with a measured need (admin GIS or mission generator blocked).

## Rejected alternatives

- PostGIS-only online map (breaks offline).
- PostGIS as Day-1 requirement (unnecessary for batch Living Map).
- Guests writing `public/venues/*` directly (builder contract).
- Skipping overlays and waiting a week for every fix to appear (poor UX — overlays are mandatory between consolidates).
