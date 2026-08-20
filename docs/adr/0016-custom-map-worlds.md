# ADR-0016 — Custom map worlds: the bake reaches the phone

**Status:** Accepted (owner-confirmed through a structured design review, 2026-08-20) · Amended by [ADR-0019](./0019-zoomable-worlds.md) (zoom bands, tiled streaming, iso retirement) · [ADR-0021](./0021-zoomable-worlds-revised.md) (band units)
**Depends on:** [ADR-0012](./0012-map-visual-design.md) · [ADR-0013](./0013-display-pipeline.md) · [ADR-0014](./0014-display-reference-contract.md) · [ADR-0015](./0015-terrain-in-display.md) · [display factory design](../research/2026-08-18-custom-map-display-factory.md) · [OSM stylized-map research](../research/2026-08-20-osm-stylized-game-maps.md)

## Context

The display factory produces two certified render targets that never meet. The **bake**
(#508/#506/#512) — kit-authored sprites, autotiled tilesheets, dart-scattered trees, hillshaded
terrain, four iso rotations — writes PNGs to a gitignored artifacts directory. The **pack** —
`base.pmtiles` plus a MapLibre style of flat fills — is what could ship, and its one consumer is a
flag-gated spike. `buildRasterTier()` records a gap on every path; the sprite atlas has no reader;
`Wear` drives the app's SVG palette painter. The owner's verdict on the shipped Skins — "it's a
color swap" — is the symptom: the expressive half of the factory never reaches a guest.

## Decision

1. **Worlds are baked, overlays are live.** A mapSkin's look is produced by the factory into the
   display pack; the phone renders it under the live layer (members, route, puck, Rally Point,
   pins) and never generates world art at runtime.
2. **Strictly geo-true.** World art may stylize strokes, textures, silhouettes, and palettes but
   never relocates geometry; bounded displacement is certified. (Restates and tightens ADR-0013's
   "skins restyle, never reposition" for the baked tier.)
3. **Production is procedural first** — the bake compositor implements the stylization algorithms
   from the 2026-08-20 research (seeded noise displacement, distance-field pigment pooling,
   hatching/line-work, dual-grid autotiling, palette quantization), deterministic by construction.
   A **Blender orthographic bake tier** (pinned version, perceptual certification) may follow for
   flagship venues; the design doc's §5 generative tier remains the ceiling, conditioned on the
   same bake model. Hybrid authored art per flagship venue rides the existing per-venue override
   slot.
4. **Every Skin becomes a world eventually**; the palette tier retires per Skin as its world lands.
   First: `watercolor-quest` and `layered-atlas`.
5. **Per-world projection.** The pack declares each world's projection (iso rotations or top-down
   plate); the app's camera and overlay math honor it.
6. **Delivery slices:** (1) world tier in the pack — bake output as an image-on-truth-bounds layer
   (the hillshade mechanism), tiling only if budgets demand; (2) app consumption behind `Wear`;
   (3) the two style-pass kits; (4) Blender / generative tiers.

7. **PBR textures reach the bake** (amended 2026-08-20, owner-confirmed). The MaterialSet
   ledger's declared texture sets become real: `venues:materials --fetch` pulls each row's CC0
   set from its declared source (ambientCG today), compiles albedo + normal/roughness to a
   512 px phone budget under `assets/vendor/materials/` with sha256 pins (the vendor-assets
   discipline), and the bake compositor tiles a bound material's compiled albedo under the
   skin's authored tint — preserving the `mixHex(authored, avgColor, materialMix)` relation
   with the pattern standing in for the average. A source that cannot be fetched (authored
   material-maker graphs) records a `compiled.gap`, the missing-tippecanoe pattern.
   Certification gains `material_textures_resolve`; byte-identical double-render stays the
   gate. The runtime three.js/KTX2 tier stays deferred per ADR-0013 item 4 — this is
   bake-side only. Both factories remain request-driven and output-agnostic: any venue's
   truth from the **Map factory**, any prompted design visual from the **Visual factory**.

8. **Zoom bands and streamed pyramids** (amended 2026-08-20 by [ADR-0019](./0019-zoomable-worlds.md),
   owner-confirmed). Slice 6.1's "tiling only if budgets demand" clause has fired: a world is no
   longer one image but **three zoom-banded bakes** (overview 4 px/cell · mid 12 px/cell · close
   48 px/cell — LOD with real generalization per band), delivered as the mid band in the pack
   plus streamed raster tile pyramids. Image-on-truth-bounds remains the geometric contract *per
   band*; strictly geo-true and byte-identity are unchanged.
   *Amended 2026-08-20 by [ADR-0021](./0021-zoomable-worlds-revised.md) (clause 2):* band units
   are ground sample distance on power-of-two steps — 2.4 / 0.6 / 0.15 m/px. Clause 5's iso projections resolve
   to top-down bands plus a declared per-Skin camera preset — the live iso painter retires from
   the map path (pixel-tycoon converts per the G5 goal). ADR-0019 carries the renderer, camera,
   delivery, and performance contract.

## Rejected / deferred

- Runtime world generation on the phone (battery, art ceiling, duplication of the factory).
- Game engines (Godot/Unity/Unreal) anywhere certification or the phone can see — GPU
  nondeterminism breaks byte-identity; engines stay a possible beauty lane only.
- Corridor-tolerance art displacement (owner: strictly geo-true instead).
- Planet-scale tile tooling (Planetiler/PostGIS) — venues are park-bbox scale; tippecanoe stays.

## Consequences

- `buildRasterTier()`'s permanent gap is closed by the world tier; the manifest and download path
  gain world entries per Skin.
- Certification gains a geo-fidelity row (bounded displacement sampled against truth) and keeps
  byte-identical reruns for the procedural tier; a Blender tier certifies perceptually.
- ADR-0013 items 6–7 (gesture port, SVG retirement) remain open; this ADR does not move them —
  the SVG renderer keeps drawing the live overlay and the non-world Skins.
