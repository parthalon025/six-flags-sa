# ADR-0026 — Venue geometry: inline `map.json` shipped, Tippecanoe export as escape hatch

**Status:** Accepted (2026-08-27, #430)  
**Amends:** [ADR-0013 display pipeline](./0013-display-pipeline.md) (geometry delivery path)  
**Depends on:** [ADR-0002 dual-layer park truth](./0002-dual-layer-park-truth.md), [ADR-0013 display pipeline](./0013-display-pipeline.md), [ADR-0015 terrain in display](./0015-terrain-in-display.md), [ADR-0019 zoomable worlds](./0019-zoomable-worlds.md)  
**See also:** [universal venue builder dependency matrix](../universal-venue-builder-dependency-matrix.md) (Tippecanoe row), `packages/venue-builder/lib/tiles-export.mjs`, `packages/venue-builder/lib/display-tiles.mjs`

## Context

The phone needs venue ground geometry — paths, buildings, water, coasters — to draw the park map and to route guests. Two delivery shapes exist in the builder today:

| Shape | Artifact | Consumer |
|-------|----------|----------|
| **Inline JSON** | `public/venues/<id>.map.json` | `ParkMap.jsx` / MapLibre caller, `lib/routing.js`, Places |
| **Vector tiles** | Tippecanoe GeoJSON export → `base.pmtiles` (when built) | Future MapLibre base layer; not yet the shipped consumer |

ADR-0013 chose MapLibre + offline PMTiles as the **renderer target**, but Train H (ADR-0019) shipped MapLibre with **inline geometry** first: the caller reads `map.json` ways directly while overlay pins and routing stay on the truth layer. The Tippecanoe path (`venues:attractions --tiles`, `display-tiles.mjs`) writes GeoJSON layers and a `tippecanoe.sh` recipe; it does **not** invoke tippecanoe in CI unless the binary is installed (`wrap` dependency). Nothing in the shipped app bundle **requires** PMTiles today.

The decision is therefore **implemented but undocumented**: inline geometry is what every venue ships; vector tiles are an optional build-time export for inspection, future PMTiles packs, and the display pipeline's `tiles-build` stage when tippecanoe is present.

## Decision

**1. Inline `map.json` is the shipped geometry path.**

- Every certified venue publishes `map.json` (and `pois.json`, `gaps.json`) under `public/venues/`.
- The PWA fetches these JSON files over HTTP or from the service-worker cache — no tile server, no runtime Tippecanoe.
- Routing (`lib/routing.js`), Places, Side Quests, and Overlay graduation read truth geometry from `map.json`; they do not depend on PMTiles.

**2. Tippecanoe export is the escape hatch, not the default.**

- `tiles-export.mjs` (ad-hoc / `attractions --tiles`) and `display-tiles.mjs` (display pack build) write GeoJSON layers and a shell recipe. They record a `gap` when tippecanoe is absent rather than failing the whole build (ADR-0015 pattern).
- CI does **not** require tippecanoe on every machine; certification may pass with GeoJSON + recipe only.
- When tippecanoe runs and produces `base.pmtiles`, that file is an additive display asset — it does not replace or fork truth coordinates.

**3. Truth stays in JSON; tiles are a derived view.**

Per the builder-app contract, `map.json` is generated upstream. Tippecanoe input is always exported **from** truth, never edited by hand. A field rename in `map.json` must be reflected in the export adapters (`wayToFeature`, display-tiles layer keys) or the export silently empties — the 2026-08-18 `way.p` → `way.r` bug is the cautionary example in `tiles-export.mjs`.

## Alternatives considered

| Alternative | Why not now |
|-------------|-------------|
| **PMTiles-only delivery** (no inline ways in the app) | Breaks offline routing without a parallel truth copy; Train H proved MapLibre on inline geometry first; bundle already ships JSON for Places/Gaps. |
| **Runtime vector-tile server** (CDN tile API) | Violates offline-first and $0 OPEX goals (ADR-0013 Non-goals). |
| **Mandatory tippecanoe in CI for every venue** | `wrap` binary not installed on all runners; would block certification on machines without tippecanoe with no user-facing gain until MapLibre reads PMTiles exclusively. |
| **geojson-vt / vt-pbf runtime slicing** | Rejected in [visual factory tools](../visual-factory-tools.md) — tippecanoe is deterministic at build time. |

## Consequences

**Positive**

- One truth artifact (`map.json`) serves routing, Places, and the current MapLibre/SVG renderer — no drift between tile and JSON geometry.
- Venues ship and certify without tippecanoe installed; water parks and CI sandboxes stay unblocked.
- Escape hatch is ready: GeoJSON export + recipe exists when a maintainer or display stage wants `base.pmtiles`.

**Costs**

- `map.json` size grows with venue complexity; very large parks pay download and parse cost on the phone (mitigated by venue-scoped precache, not planet-scale tiles).
- MapLibre today does not yet load `base.pmtiles` for base geometry — duplicate representation if both JSON and PMTiles ship (acceptable until cutover).
- Export adapters must track truth schema changes; contract tests on the builder side catch drift.

**Offline / CDN**

- Inline JSON precaches like today's venue bundles (`manifest.json` versioning).
- PMTiles, when present, cache the same way as other display assets under `display/` — no live tile API.

## Revisit trigger

Flip the **shipped** path from inline JSON to local PMTiles when **all** of the following hold:

1. MapLibre renderer (Train H) loads `display/base.pmtiles` for base geometry with parity on gestures, **Go**, and Overlay (ADR-0013 item 7 / ADR-0019).
2. `lib/routing.js` (or a documented successor) still reads truth from JSON or an equivalent non-tile truth seam — tiles alone must not become the routing source.
3. Measured bundle or frame-time data shows inline `map.json` parse/render cost exceeds PMTiles fetch + GPU draw at the 95th percentile on the store WebView target.
4. tippecanoe (or go-pmtiles) is available in the CI image that gates shipped venues, so `base.pmtiles` is reproducible, not maintainer-hand-built.

Until then, inline `map.json` remains canonical; Tippecanoe stays the documented escape hatch for display packs and inspection.

## Non-goals

- Changing the geometry delivery mechanism in this ADR (record only).
- New tiling infrastructure or tile-server deployment.
- Hand-editing generated `map.json` or GeoJSON exports (builder-app contract).
