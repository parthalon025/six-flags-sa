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

## G2 — "Quest atlas" (painted adventure world-map reference)

Reference: hand-painted terrain with dramatic relief (waterfalls, cliffs, volcano), saturated
airbrushed color, and — the product-relevant part — a **node-and-path quest overlay**: numbered
level nodes strung along dotted paths across the world.

- Pipeline: painted lane (watercolor-quest's displacement/wash machinery pushed toward opaque
  gouache rendering + terrain relief shading from the DEM/hillshade) **plus a quest-node overlay
  mode**: Side Quests / Gaps rendered as path-nodes — this goal ties the look to the XP loop
  directly (the map literally displays the quest ladder).
- Missing: relief-exaggerated shading pass, painted-texture fills, the node-path overlay renderer
  (live layer, geo-true — nodes are real Places/Gaps).
- Fixed cost: the largest procedural build of the five. Benefit: the strongest conversion asset —
  this is the "does my Skin feel like a prize / is there a game here" screenshot; the quest-node
  overlay doubles as a feature, not just a style.

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
  Sobel single-pixel outlines, terrace-step cliffs from the DEM, path-dot node overlay (shares G2's
  node renderer). Pixel-tycoon's world conversion IS this goal.
- Fixed cost: small-moderate (quantize + outline passes over the existing bake). Benefit: converts
  the already-shipped pixel-tycoon Skin from live SVG to a certified baked world — retires the last
  color-swap-era renderer.

## Sequencing (cost → benefit, per the standing frame)

1. **G1** rides Train E's rails immediately after (existing kit lane, days, proves sprite quality).
2. **G5** next (small fixed cost, retires legacy renderer, shares the node overlay with G2).
3. **G4** (generalizes NPR — mostly reuses Train E machinery).
4. **G2** (biggest procedural build; also delivers the quest-node feature — schedule when the
   reward loop needs its showcase).
5. **G3** with the Blender tier (E.1) — flagship-only economics.

## Acceptance per goal

Mechanical: full certification incl. geo-fidelity + beyond-palette distinctness vs every shipped
look; 20-point matrix extended with per-goal treatment assertions; byte-identical rerun (procedural
goals) or stated perceptual threshold (G3). Human: side-by-side with the owner's reference image at
the eye pass — the reference is the goal, resemblance is judged by the owner, not the machine.
