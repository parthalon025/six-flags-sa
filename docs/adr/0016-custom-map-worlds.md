# ADR-0016 — Custom map worlds: the bake reaches the phone

**Status:** Accepted (owner-confirmed through a structured design review, 2026-08-20)
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
