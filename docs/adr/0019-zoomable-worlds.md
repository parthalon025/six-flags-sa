# ADR-0019 — Zoomable worlds: banded LOD, one GL renderer, streamed pyramids

**Status:** Accepted (owner-confirmed through a structured design review, 2026-08-20) ·
Amended by [ADR-0021](./0021-zoomable-worlds-revised.md) (clauses 1, 2, 5, 10)
**Amends:** [ADR-0016](./0016-custom-map-worlds.md) (delivery slice 6.1, projection clause 5) ·
[ADR-0017](./0017-visual-factory-request-contract.md) (distribution clause 4) ·
[ADR-0018](./0018-factory-interaction-and-delivery.md) (delivery clauses 4–5)
**Depends on:** [ADR-0013](./0013-display-pipeline.md) ·
[design-language schema v2](../goals/design-language-axes.md) ·
[rating research](../research/2026-08-20-design-language-rating-research.md) ·
[performance playbook](../research/2026-08-20-perf-playbook.md)

## Context

ADR-0016 shipped worlds as one PNG on truth bounds — right for "phone zoom, one resolution," and
it explicitly deferred tiling ("only if budgets demand"). The owner's requirement set now demands
what that shape cannot do: **deep zoom, navigation, progressive detail at closer zooms, a camera
that softens pitch into zoom, clarity at every level, high resolution, and performance as a hard
requirement.** A single raster at one generalization level fails "clear at all levels" in both
directions — clutter when far out, blur when close in. This is the classic map/game LOD problem,
and both reference industries solved it the same way: authored detail per level, streamed by
viewport, cached aggressively.

## Decision

1. **Progressive detail = zoom-banded bakes (LOD for map art).** Every world bakes at three
   bands: **overview** (~4 px/cell — bold generalized shapes, landmarks only), **mid**
   (12 px/cell — today's bake, unchanged), **close** (48 px/cell ≈ 15 cm/px — path textures,
   props, signage). Content changes per band (cartographic generalization), not just sharpness.
   Schema v2's G-5 zoom-robustness gate certifies each band; per-band style-contract rows apply.
   *Amended 2026-08-20 by [ADR-0021](./0021-zoomable-worlds-revised.md):* bands are specified in
   ground sample distance on power-of-two steps — overview 2.4 m/px · mid 0.6 m/px · close
   0.15 m/px — and "signage" means sign *objects*, never legible words. No band bakes text;
   every string on the map comes from `pois.json`.
2. **Camera: pitch eases with zoom.** Flat top-down when zoomed out, easing toward ~30–45° tilt
   as the guest zooms in; bands cross-fade, pan has inertia. Camera feel (bearing/pitch presets)
   is a per-Skin declared trait of the design request.
   *Amended 2026-08-20 by [ADR-0021](./0021-zoomable-worlds-revised.md):* the pitch ease occupies a
   zoom range that does not overlap a band boundary, and content a closer band adds ramps in
   across the crossfade rather than at its edge — tilt and restyle never land in one instant.
3. **Renderer: MapLibre GL, converged.** The engine already shipping in the pack contract becomes
   *the* map view: vector tier, banded raster worlds (as raster tile sources), and camera all in
   one renderer. The SVG world viewer retires.
4. **The live overlay moves into MapLibre.** Party members, badges, quest nodes, and routes
   render as GeoJSON sources + symbol/line layers (bulk marks never as DOM; rich interactive
   elements may use engine-managed markers), so every element projects through the one camera —
   pitch, fade, collision, and zoom-density (schema v2 C2/G-1) come from the engine.
5. **Delivery is the platform pattern (stream + offline core + on-demand packs), on existing
   rails.** The **mid band ships in the venue pack** — the map works offline, day one, in every
   owned Skin. Overview + close pyramids live as raster PMTiles on the deployed origin
   (ADR-0018's origin-is-CDN) and **stream by viewport** over HTTP range requests; wearing a Skin
   triggers the download manager's background bundle sync (Train F, hash-verified) so the full
   pyramid lands for offline. Parent-band upscale is the placeholder while sharper tiles arrive —
   blank tiles never show.
   *Amended 2026-08-20 by [ADR-0021](./0021-zoomable-worlds-revised.md):* the on-wear background sync
   is withdrawn. Bands stream by viewport (cellular included) and cache normally; offline
   close-band coverage is an explicit guest download that states its size before it runs.
6. **Iso retires from the map path.** pixel-tycoon converts to top-down banded art with the iso
   flavor painted into the sprites (the G5 pixel-overworld reference's own convention) plus a
   camera preset; the live iso painter and per-rotation sweeps leave the map path. ADR-0016's
   per-world projection clause resolves to: top-down bands + declared camera preset.
7. **Certification boundary: our bytes, byte-identical; the engine, trusted with a tripwire.**
   Everything the factory produces certifies as today — deterministic bakes, byte-identical tile
   pyramids, per-band contract samples, geo rows, G-5 — while MapLibre is trusted platform (like
   the browser). A named registry trigger stands armed: the first visual regression that only
   manifests in engine rendering adopts headless perceptual certification
   (maplibre-gl-native + odiff threshold) as a new stage.
8. **Performance is a gate, not a goal.** 60 fps sustained pan/zoom/pitch on mid-range hardware
   (CI proxy: 4× CPU throttle), never below 30 fps on low-end; time-to-first-map ≤ 2 s warm /
   ≤ 4 s cold; zero blank tiles during normal pan. Enforced as perf rows in the pre-merge
   vertical (throttled Playwright traces) — a regression fails CI like a broken test.
   Optimization technique is constrained to **quality-preserving methods only** — the asset-reuse
   / LOD / precompute-offline families (one asset instanced many ways, atlases, banded detail,
   bake-time work over runtime work); techniques that trade visible quality for speed are named
   anti-patterns. The sourced playbook (90s console/PC practice + Google-scale map engineering)
   is committed as a research note beside this ADR.
9. **Sequencing.** Trains E (#558) and F (#559) merge first — E's bake is the mid band and its
   world tier/kits/schema stay load-bearing; F is the delivery rail clause 5 rides. **Train H**
   builds on top: banded bakes, the tiler → raster PMTiles, the MapLibre view + camera, the
   overlay port, the pixel-tycoon conversion, and the perf gate. Only ADR-0016 slice-2's small
   SVG world viewer is replaced.
10. **First ship: one venue, the whole catalog.** kings-island × every active Skin, fully banded —
    one venue proves every layer end to end *and* makes the beyond-palette distinctness gate
    visible: each Skin unmistakably its own world at every zoom. Fan-out to other venues follows
    as mechanical repeats.
    *Amended 2026-08-20 by [ADR-0021](./0021-zoomable-worlds-revised.md):* the first ship is
    kings-island × **three contrasting Skins**, pixel-tycoon first; the full catalogue is the
    second milestone. "Mechanical repeats" is load-bearing — no per-venue close-band art.

## Rejected

- **One ultra-res bake, tiled** (same art at all zooms) — sharper is not clearer; fails
  "clear at all levels" at both extremes.
- **CSS-3D pitch over the SVG renderer** — mobile WebViews jank on large transformed rasters; no
  tile streaming; a ceiling this requirement set hits immediately.
- **A custom WebGL engine** — rebuilds tile streaming, LOD fade, gestures, and collision that
  MapLibre gives free.
- **Keeping a legacy iso renderer** (double feature cost forever; the earned prize becomes the
  worst map in the app) and **true-iso custom GL layers** (weeks of shader work + a hand-projected
  overlay for one Skin, for a projection the G5 reference doesn't use).
- **Everything-in-pack for all bands** — ~80 MB+ per venue at four Skins, growing linearly with
  the catalog; the model both platform vendors abandoned.
- **Perceptual engine certification from day one** — guards a failure class not yet observed;
  adopted on trigger instead (clause 7).

## Consequences

- ADR-0016's image-on-truth-bounds stays the geometric contract *per band*; its "tiling only if
  budgets demand" clause has fired — budgets (and zoom) now demand it.
- ADR-0017's per-look size budget becomes per-band rows; the pack budget row covers the mid band,
  a pyramid budget row covers the streamed bands.
- ADR-0013 items 3 (MapLibre renderer), 6–7 (gesture port, SVG retirement) are subsumed by
  clauses 3–4; item 4's real-time PBR tier remains deferred and additive.
- The vector tier remains the never-fails fallback under every Skin.
- Guests pay bandwidth only for Skins they wear (the one variable dollar stays origin bandwidth,
  now proportional to engagement rather than catalog size).
