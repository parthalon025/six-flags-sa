# ADR-0025 — Factory module seams (logical modules)

**Status:** Accepted (factories-to-app ticket 14, 2026-08-24)  
**Depends on:** [ADR-0018](./0018-factory-interaction-and-delivery.md) · [ADR-0024](./0024-postdb-factory-bus.md) · [factory-types route catalog](../../packages/venue-builder/lib/factory-types.mjs)

## Context

`packages/venue-builder` grew as one monolith: Map factory truth builds, Visual factory display compiles, and Delivery export all shared `venue-io.mjs` paths and ad hoc script names. Fleet-scale factory work needs **deep modules behind one bus** — testable interfaces, enforceable import boundaries, and CI legs that can skip without breaking required checks.

ADR-0024 moves the canonical bus to PostDB. This ADR records **how the code is decomposed inside the existing npm package** before PostDB Slice 1 lands.

## Decision

1. **Option A — logical modules, one package.** Three folders under `packages/venue-builder/lib/`:
   - `map-factory/` — truth build and certification (`buildTruth`)
   - `visual-factory/` — display compile and certification (`compileDisplay`)
   - `delivery/` — bundle export and freshness gates (`publishBundle`)

2. **Three I/O facades** over the shared `venue-io` kernel (temporary until PostDB facades replace file I/O):
   - `map-io.mjs` — truth reads/writes
   - `visual-io.mjs` — display pack paths
   - `delivery-io.mjs` — reindex and bundle paths  
   `venue-io.mjs` gains no new factory business logic.

3. **Cross-module entry points** (the only surfaces CLIs and `factory-types` routes reference):
   - `buildTruth(venueId, opts) → VenueTruthBundle`
   - `compileDisplay(venueId, opts) → DisplayPack`
   - `publishBundle(venueId, opts) → Manifest`
   - `getRoute` / `routesForFactory` remain the ontology API in `factory-types.mjs`

4. **Import boundaries** (dependency-cruiser):
   - `visual-factory/` may import `map-factory/map-io.mjs` only — never other map-factory files
   - `delivery/` must not import `map-factory/` or `visual-factory/` orchestration
   - Visual factory has **zero writeback** to truth coordinates

5. **Freshness** lives in `lib/delivery/freshness.mjs`; `scripts/lib/venue-freshness.mjs` re-exports through `@party-tracker/venue-builder/freshness.js`.

6. **`build-pipeline.mjs`** stays the batch orchestrator but calls `buildTruth` and `compileDisplay` for certify and display stages.

7. **CI** scaffolds separate map / visual / delivery workflow legs with `*-result` noop jobs when a leg skips.

## Consequences

- PostDB Slice 1 swaps facade implementations without renaming the three entry points.
- `venues:factory-validate` continues as the cross-factory proof surface; route catalog entries point at the new modules.
- A second npm package split is deferred until logical boundaries prove stable on Kings Island.

## Rejected

- Two npm packages for Map and Visual factories in v1 (see factories-to-app spec).
- Visual factory importing `buildTruth` or any map orchestration beyond `readTruth`.
- Keeping freshness only under `scripts/` after delivery module extraction.
