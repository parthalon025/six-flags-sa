# Display pipeline — builder-owned map beauty, phone-owned overlay

**Status:** Accepted — amended 2026-08-19 (item 4, real-time PBR tier) · Amended by [ADR-0021](./0021-zoomable-worlds-revised.md) (visual-spec step 3) · Amended 2026-08-21 (visual-spec step 3 direction, skin templates, Non-goals — Zone tone leaves map truth) · Amended by [ADR-0026](./0026-venue-geometry-inline-vs-tiles.md) (inline `map.json` ships; Tippecanoe optional)  
**Date:** 2026-08-17  
**Depends on:** [ADR-0002 dual-layer park truth](./0002-dual-layer-park-truth.md), [ADR-0005 store Capacitor shell](./0005-store-capacitor-shell.md)  
**Extended by:** [ADR-0015 terrain in display](./0015-terrain-in-display.md)  
**See also:** [custom map display factory](../research/2026-08-18-custom-map-display-factory.md) — PBR material pipeline and rendering-tier detail for implementation order item 4

> Note: this ADR previously cited an `ADR-0012 map visual design`. No such file
> was ever committed — the work it named lives on an unmerged branch. The
> reference is removed rather than left dangling.

## Context

Park Bound will ship **hundreds of Venues** through the universal builder (`packages/venue-builder`, `build-top-parks.mjs`). **Side Quest** and **Rank** rewards grant **Skins** — Profile-owned map paint that must look correct at every Venue, including custom visuals tied to quest prizes. Today the phone draws OSM geometry as SVG in `ParkMap.jsx` with global **Skin** paint in `world.js`. That path does not scale: per-Venue DOM weight, hand-tuned CSS, and no automated visual production for batch builds.

Store apps (Capacitor shells, ADR-0005) need offline display at the gate, smooth pan during **Go**, and lazy download — not one IPA with every park and every skin.

## Decision

Separate **map truth** from **map display**. The builder owns both; the phone never invents geometry.

### Runtime split (phone)

| Layer | Artifact | Role |
|-------|----------|------|
| **Truth** | `map.json`, `pois.json`, `gaps.json` | Routing (`lib/routing.js`), **Places**, **Side Quests**, **Overlay** graduation inputs |
| **Display** | `display/base.pmtiles`, `visual.json`, skin assets | MapLibre GL + offline PMTiles (or parametric style JSON) — how the ground looks |
| **Overlay (live)** | Markers, route, puck, **Meet**, **Overlay** pins | SVG or MapLibre symbol layers — moves every frame |

Phones **do not** run a tile server. Display files are static assets produced at build time, downloaded and cached like venue JSON today.

### Builder pipeline (per Venue)

Extend `runVenuePipeline` after `certify`:

1. **tiles-export** — GeoJSON layers (`packages/venue-builder/lib/tiles-export.mjs`, existing)
2. **tiles-build** — Tippecanoe → `display/base.pmtiles`
3. **visual-spec** — compile `visual.json` (Zone tones, labels, landmark refs, quest-linked skin overrides)
   *Amended 2026-08-20 by [ADR-0021](./0021-zoomable-worlds-revised.md) (clause 1):* `visual.json`
   carries label *styling* only. Label strings come from `pois.json`.
   *Amended 2026-08-21:* the verb is **compile**, not merge, and the direction is one-way. The
   Visual factory **derives** Zone tone from the **Skin template**'s palette and the World's
   *relationships* — its land-cover classification and its grounding harvest
   (`data/venues/<id>/display/grounding.json`, ADR-0020 clauses 1 and 4). `map.json` contributes
   **no treatment** to the compile. The unqualified "merge" here was the loophole: the code merged
   a hand-tint table out of `map.json`'s `meta.lands` *over* the factory's own derivation, so every
   **Skin** of a World emitted a byte-identical `landTones` block and no Skin could restyle a
   **Zone**. Each Skin's spec now carries only the half its own `tokens.mode` paints, and every
   colour in it must be one that Skin's declared palette can make (`palette_derives_tones`).
4. **skin-bake** — optional per-(Venue × **Skin**) raster or vector variants when parametric templates are insufficient
5. **display-certify** — automated visual matrix (fixed camera points); fail build on drift
6. **manifest** — hashes, sizes, versions for phone download manager

Batch runs (`venues:build-top100`) emit the same contract for every catalog park. No per-Venue forks in `ParkMap.jsx`.

### Skin templates (global)

**Skin** ids stay in `world.js` / earn ladders. Each **Skin** resolves to a **skin template** — MapLibre `style.json`, iso template id, and optional baked tile variant — not ad hoc CSS per park. Venue-specific reward art lives in the Venue **display pack** (`visual.json`, optional `display/skins/<skinId>.pmtiles`), referenced when a **Side Quest** at that Venue grants that **Skin**.

*Amended 2026-08-21:* a skin template resolves to the MapLibre style, its **bake kit** binding, its
iso recipe id, and its **Zone-tone rule** — how this Skin turns a World's relationships into Zone
treatment (`tokens.landTones`: how far a wash travels from the Skin's own ground toward its land
cover, how far it leans toward the token a Zone's declared character names, and the bounded ramp
that separates Zones sharing both). Making the rule a declared part of the template is what makes
"this Skin restyles a Zone" a property of the ledger rather than of a merge order. The iso recipe
id stays real and is now read — `bin/display-bake.mjs` resolves it from the ledger, so
`layered-atlas` gets the `frisco-fields` geometry it declares instead of silently getting
`rct-classic`. Iso is retired from the *map* path by [ADR-0019](./0019-zoomable-worlds.md) clause 6
and [ADR-0021](./0021-zoomable-worlds-revised.md) clause 6; the id survives for the iso **bake**
target, which still runs.

**Trail** / **Park Midnight** remain always-on **Palettes**. **Skins** never move **Places**.

### Phone delivery (hundreds of Venues)

- App install: MapLibre runtime + global skin templates; zero or one default Venue pack.
- User selects a Venue: download **display pack** on Wi-Fi or first visit (~3–15 MB typical).
- **Skin** unlock: download skin variant if not covered by parametric template; cache indefinitely.
- Service worker / Capacitor filesystem cache; versioned by `manifest.json`.

### Renderer migration

Target: **MapLibre GL JS** in the Capacitor WebView reading local PMTiles. SVG `ParkMap.jsx` remains until display packs and overlay port are proven; gestures, declutter priority, and **Go** behaviour must match before cutover.

## Consequences

- New Venue bundle fields under `apps/party-tracker/public/venues/<id>/` (or CDN mirror): `display/`, `visual.json`, `manifest.json`.
- `packages/venue-builder/lib/build-pipeline.mjs` gains display stages; `attractions.mjs --tiles` path becomes mandatory in CI for shipped venues.
- Implementation backlog: MapLibre renderer, real-time PBR tier (three.js), venue download manager, skin template compiler, display-certify matrix.
- Databricks unchanged (ADR-0008a/0010a): batch ingest may feed better geometry; display baking stays Node/CI Tippecanoe.

## Non-goals

- Tile **server** process on the phone (use PMTiles files + MapLibre)
- Google Maps / MapKit SDK as the park map product surface
- Live Mapbox/Google tile APIs as the primary display path ($0 OPEX and offline-first stay goals)
- Databricks or Postgres serving map tiles to phones
- Per-Venue React/CSS forks (E14.3)
- **Skin** or display changes that reposition **Places** or rewrite routing truth
- Map truth carrying per-World **treatment** — tints, tones, materials, palettes. `map.json` carries
  geometry, **Places** and **Gaps**; treatment lives in the **display pack**. *(Added 2026-08-21.
  This ADR banned the Display→Truth direction for geometry and was silent on the inverse, which is
  how `meta.lands` became an unremarked feature rather than a policy violation.)*

## Open implementation order

1. Lock bundle schema + `manifest.json`
2. Wire `tiles-build` + `display-certify` into `runVenuePipeline`
3. MapLibre renderer loading local PMTiles + global skin templates (baked tier — default and
   low-end fallback; zero shader cost)
4. Real-time PBR tier for capable devices: MapLibre custom style layer + three.js
   `MeshStandardMaterial` rendering KTX2-compressed material sets over extruded truth geometry — one
   sun + small IBL, no shadow maps (AO baked), DPR capped at 2. Additive to item 3, not a
   replacement — gated behind a device-capability check, falls back to the baked tier. Enables live
   time-of-day and Skin-swap without re-downloading raster pyramids. Detail:
   [custom map display factory](../research/2026-08-18-custom-map-display-factory.md) §4, Slice 4.
5. Venue download manager (prefetch, cache, delta)
6. Port `ParkMap.jsx`'s gesture handling (pinch/wheel zoom-about-point), Follow-mode/**Go** camera,
   and **Overlay** pin rendering (route, queue pins) into the MapLibre renderer — item 3 covers
   drawing the map; nothing above names who ports the interaction layer that currently lives
   entirely in the 1879-line SVG component, and item 7's "parity proven" gate is not met until this
   is done.
7. Retire SVG base geometry once parity proven on store WebView

Items 3, 6, and 7 are subsumed by [ADR-0019](./0019-zoomable-worlds.md) (Train H: MapLibre as the
one renderer, overlay port, camera, banded worlds, perf gate); item 5 landed as Train F. Item 4's
real-time PBR tier remains deferred and additive.

Canonical language: root `CONTEXT.md`.
