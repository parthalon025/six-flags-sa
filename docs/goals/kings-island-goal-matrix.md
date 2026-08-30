# Kings Island goal matrix — visual factory validation suite

Owner-supplied 2026-08-20: five reference images defining `/goal` targets for Kings Island output.
The suite is the factory's acceptance test for ADR-0017's output-agnostic claim: one venue's truth,
five radically different certified worlds. Reference images to be pinned into
`data/display/references/images.json` per ADR-0014 (`committed: false` until the files land in the
repo — owner holds the originals).

Each goal is a design request (ADR-0017): it must compile to Skin template + kit + harvested
reference profile, declare reward wiring, pass certification + the beyond-palette distinctness
gate, and clear the owner eye pass on first ship.

## G1 — "Village green" (RPG Maker village reference)

Reference: classic 2D tile-and-sprite village — autotiled grass/sand paths with clean rounded
transitions, blue water channels with bridges, wooden building sprites with signage, prop clutter
(barrels, fences, flowerbeds, statues), dense tree sprites with shadow bases, saturated
green-dominant palette.

- Pipeline: the existing tile-and-sprite bake (rpg-overworld lineage) — dual-grid autotiling,
  scatter, kit sprites. **Nearest goal to what exists.**
- Missing for goal quality: richer CC0 tilesheet set (Kenney has these), building sprites with
  facade variety, prop sprite families (fences/barrels/planters), bridge sprites at water
  crossings (derivable from truth path×water intersections).
- Fixed cost: days (kit + sprite ledger rows). Variable: ~0. Benefit: proves the sprite lane at
  reference quality; the closest thing to a shipped look today.

## G2 — "Quest atlas" (painted adventure world-map style)

**Split from the quest-node overlay by owner decision, 2026-08-27.** The reference image bundles
two things that are not one thing: a painted look, and a way of drawing the quest ladder on a map.
The look is a Skin. The overlay is a product feature that belongs to every Skin. G2 is now the
look only — see [Quest-node overlay](#quest-node-overlay-universal-feature-not-a-goal) below.

Reference: hand-painted terrain with dramatic relief (waterfalls, cliffs, volcano), saturated
airbrushed color.

- Pipeline: painted lane — watercolor-quest's displacement/wash machinery pushed toward opaque
  gouache rendering, plus terrain relief shading from the DEM/hillshade.
- Missing: relief-exaggerated shading pass, painted-texture fills.
- Fixed cost: the largest procedural build of the five, even without the overlay. Benefit: the
  painted pole of the Skin range — the "is this Skin worth earning" screenshot.

## Quest-node overlay (universal feature, not a goal)

Side Quests and Gaps drawn as numbered nodes strung along dotted paths — the map displaying the
quest ladder directly.

This is **not** part of any goal and does not ship with a Skin. It is a live overlay layer,
geo-true (nodes are real Places and Gaps), and it composes over **whatever Skin the guest is
wearing** — painted, pixel, ink, tilemap or the base map. Binding it to G2 would have made a
product feature earnable, and made four of the five goals unable to show the quest loop at all.

- Pipeline: overlay renderer on the live layer, beside the existing category-glyph overlay. Reads
  the same truth the Skins restyle; restyles nothing itself.
- Per-Skin cost after the renderer exists: node and path token values in the Skin's style
  contract, so the overlay reads correctly against that ground. Not a new renderer per Skin.
- Sequence it against the **reward loop**, not against the Skin queue — it is wanted the moment
  Side Quests need to be visible on the map, whichever Skins happen to have shipped by then.
- Certification: the overlay is judged on legibility over every shipped Skin (Tier-0 figure-ground
  and colour-alone gates against each ground), not on resemblance to the G2 reference.

## G3 — "Masterplan" (3D aerial park-render reference)

Reference: architectural visualization — 3D aerial of a green park: modeled tree canopies, curving
paths, ponds, parking lots with cars, buildings with simple massing, soft daylight shadows.

- Pipeline: **Blender tier** (E.1) — truth-extruded massing + OSM2World-style scene assembly,
  scattered tree billboards/meshes, orthographic-oblique camera, baked AO/shadows. bpypolyskel
  roofs. This is the flagship beauty target the Blender tier exists for.
- Fixed cost: the Blender stage itself (days) + perceptual certification. Variable: CPU-minutes per
  regen (flagships only). Benefit: store-listing-grade imagery; the "does this World look worth
  exploring" answer for grown-ups.

## G4 — "Surveyor's sketch" (vintage ink hex-map reference)

Reference: sepia hand-inked cartography — hatched dune/terrain strokes, illustrated vignettes
(palms, ruins, creatures), teal water against parchment, and a **hex-grid overlay** fading in at
the map edge.

- Pipeline: NPR hand-drawn lane — seeded stroke displacement, hachure fills (rough.js's hachure
  primitive is purpose-built), parchment ground, sparse illustrated-vignette sprites at POI
  classes, optional hex overlay as a declared world trait.
- Missing: hachure/ink painter pass, vignette sprite set (CC0 or brief-authored `original` art),
  hex overlay option.
- Fixed cost: moderate — most of it is the layered-atlas line-work machinery pointed at ink.
  Benefit: proves the NPR lane generalizes past watercolor; strongest "souvenir" aesthetic
  (ADR-0012's calm-at-rest pole).

## G5 — "Pixel overworld" (SNES world-map reference)

Reference: 16-bit pixel world map — hard-quantized palette, terraced cliff edges, path dots
connecting landmark nodes, chunky landmark sprites (castles, gates), water dither patterns.

- Pipeline: pixel pass from the research — low-res offscreen bake, palette quantization (image-q),
  Sobel single-pixel outlines, terrace-step cliffs from the DEM. Pixel-tycoon's world conversion IS
  this goal. (The path-dot look of the reference is the universal quest-node overlay drawn over a
  pixel ground, not a G5 renderer — see Quest-node overlay above.)
- Fixed cost: small-moderate (quantize + outline passes over the existing bake). Benefit: converts
  the already-shipped pixel-tycoon Skin from live SVG to a certified baked world — retires the last
  color-swap-era renderer.

## Sequencing (cost → benefit, per the standing frame)

1. **G1** rides Train E's rails immediately after (existing kit lane, days, proves sprite quality).
2. **G5** next (small fixed cost, retires legacy renderer).
3. **G4** (generalizes NPR — mostly reuses Train E machinery).
4. **G2** (biggest procedural build, now the painted look alone).
5. **G3** with the Blender tier (E.1) — flagship-only economics.

The **quest-node overlay** is not in this sequence. It is a universal feature (see above) and is
scheduled against the reward loop — whenever Side Quests need to be visible on the map — not
against the Skin queue. Every Skin shipped before or after it gains the overlay for the cost of a
few style-contract token values.

## Acceptance per goal

Mechanical: full certification incl. geo-fidelity + beyond-palette distinctness vs every shipped
look; 20-point matrix extended with per-goal treatment assertions; byte-identical rerun (procedural
goals) or stated perceptual threshold (G3). Human: side-by-side with the owner's reference image at
the eye pass — the reference is the goal, resemblance is judged by the owner, not the machine.
