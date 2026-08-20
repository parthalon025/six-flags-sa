# Goal rubrics — 20 design-language aspects per reference

Companion to [kings-island-goal-matrix.md](./kings-island-goal-matrix.md). Every goal is gauged on
the schema's 20 axes — see [design-language-axes.md](./design-language-axes.md) for the axis
definitions, the negation rule, and the machine-checkable subset; each axis below states the
reference image's target treatment. Scoring at the eye pass: 0 (misses), 1 (present but off),
2 (matches the reference's language) per axis. A goal ships at **≥ 32/40 with no axis at 0**;
the per-axis notes are what a kit brief must answer.

## G1 — Village green (RPG tilemap)

1. Bright, high-saturation spring greens/browns; cheerful primary accents (red/yellow flowers).
2. ~24-color feel; flat fills, two tones per material (base + shade), no gradients.
3. Sprites self-edged in darker material tone; no universal black outline.
4. Subtle per-tile mottle on grass (2-tone checker noise); wood grain lines on planks.
5. Grass base tile everywhere; darker grass variant for shade bands.
6. None — the world is flat; elevation implied only by tree-wall borders.
7. Medium-blue flat water with lighter animated-style inner ripple rows.
8. Autotiled rounded shoreline with light-blue edge band; plank bridges at path crossings.
9. Two-tone puff-canopy deciduous trees + bushes; each sprite sits on a soft shadow ellipse.
10. Timber-frame cottages: brown plank walls, black door/window insets, visible signage sprites (INN).
11. Gabled, darker-brown shingle roofs with ridge highlights; chimneys with smoke-ready stubs.
12. Orthogonal paths on the tile grid radiating from a central plaza; T-junctions square.
13. Sand/tan path tiles, rounded autotile corners, slightly mottled.
14. Dense prop clutter near buildings (barrels, crates, fences, wells, flowerbeds, statues); open lawn between.
15. Landmarks as bespoke multi-tile sprites (statue pair at plaza, market tent, garden plots in crop rows).
16. None in-world — signage sprites only; live overlay carries pins.
17. Straight top-down tile grid (RPG Maker convention), uniform tile rhythm.
18. Flat ambient light; the only shadows are sprite base ellipses.
19. Map fully enclosed by a dark tree-wall border — a contained diorama.
20. Cozy 16-bit village warmth; "a town you could enter."

## G2 — Quest atlas (painted node map)

1. Tropical high-saturation gouache: turquoise water, lush greens, ochre canyon, charcoal volcanic.
2. Continuous painted color; hue zones per biome rather than a count.
3. No line work — form built by painted value; hard rim highlights on cliff edges.
4. Airbrushed gradients with dabbed brush texture on canopies and strata.
5. Zone-coded ground: jungle green, savanna ochre, volcanic grey-brown, each with painted variance.
6. Dramatic vertical relief: layered cliff strata, gorges, a volcano; strong AO in recesses.
7. Turquoise-to-deep gradient water; waterfalls as white streaked columns with foam bases.
8. White foam rings hugging every coastline; rocky shear edges where cliffs meet sea.
9. Clustered painted canopies with single-dab highlights; silhouette species (palms, baobabs) as accents.
10. POI structures as oversized painted vignettes (huts, temple, skull cave) — symbolic scale.
11. Thatch/organic roofs rendered painterly, no hard geometry.
12. One serpentine master path winding through all zones — the composition's spine.
13. Path as dotted white bead line (not a drawn surface).
14. Sparse props; the terrain itself is the ornament.
15. Landmark vignettes oversized ~3× realistic scale, each unique.
16. **Uniform node sprites (gift-box style) evenly beaded along the dotted path; occasional portrait plaques; cloud occluders floating above.** The defining aspect: nodes are the game.
17. High oblique painted aerial, mild perspective, no true 3D.
18. Single global sun (upper-left), painted shadows and glow; waterfall highlights.
19. Map bleeds into open ocean at every edge; islands trail off.
20. Saturday-morning adventure epic; "which node is next?"

## G3 — Masterplan (3D aerial render)

1. Muted naturalistic: lawn greens dominant, beige-orange path ribbon, dark bay blue.
2. Continuous photographic color, restrained; no stylization.
3. None — pure rendered geometry, anti-aliased edges.
4. Subtle diffuse texture only (lawn tone variance, asphalt grain); no painterly grain.
5. Continuous groomed lawn as the ground plane.
6. Gentle real topography only; site reads nearly flat with soft berms.
7. Kidney-shaped ponds in light blue-green; the bay dark with specular glints and boat wakes.
8. Crisp mowed-lawn-to-water edges; thin sand/stone rim on ponds.
9. Individually placed 3D trees, two species mixes (dark rounded + lighter), each with a soft contact shadow.
10. Few buildings, simple archviz massing, glass/panel hints; one anchor building at the water.
11. Flat and low-slope roofs in muted orange/grey.
12. Curvilinear bezier path loops with clear width hierarchy (main promenade vs spurs); roads with lane realism.
13. Crushed-gravel beige paths; grey asphalt lots with painted stalls and parked cars.
14. Real-world furniture only (cars, courts, field striping); zero whimsy.
15. Landmarks are the actual buildings and sports fields — no iconography.
16. None — presentation render, label-free.
17. Oblique aerial ~35°, long perspective toward a hazed horizon.
18. Single sun with soft global shadows; light atmospheric haze at distance.
19. Peninsula site framed by the bay and highway bridge; world continues beyond frame.
20. Municipal masterplan serenity; "the park as built."

## G4 — Surveyor's sketch (ink hex map)

1. Duotone: sepia/bistre ink on cream parchment, plus a single muted teal for water.
2. Two inks + paper — the most constrained palette of the five.
3. Everything is line: varied-weight ink strokes; heavy coastlines, feather-light texture.
4. **Texture as tone**: repeated scalloped hatch strokes fill all ground; stipple bands shade coasts.
5. Parchment shows through everywhere; ground is hatch pattern, not fill.
6. Hills/ridges built from stroke stacks with hatched shadow flanks.
7. Flat teal water, no gradient; interior oases as teal blobs.
8. Double-line ink coast with a stippled water band hugging it.
9. Vegetation as pictorial glyphs — palm clusters at oases, hatched scrub.
10. Structures as illustrated vignettes (pyramids, ruined temple, huts) in the same ink hand.
11. N/A as geometry — roofs exist only inside vignettes.
12. Routes implied, not drawn; the map is territory, not circulation.
13. N/A — no path surfaces.
14. Sparse, storytelling props: camel, serpent, skeletons, shipwreck — each a one-off illustration.
15. Every landmark a unique hand-drawn vignette at symbolic scale.
16. **Thin brown hex-grid overlay fading in across the lower map — the game affordance laid over the art.**
17. Flat plan view with pictorial (side-on) vignettes — the antique-chart convention.
18. No lighting model; shadow exists only as hatching inside vignettes.
19. Composition runs off the parchment; hex grid dissolves at the edge.
20. Explorer's field chart; "here be side quests."

## G5 — Pixel overworld (SNES map)

1. SNES-bright primaries: mid-green land, royal-blue sea, tan cliffs, white snow zone.
2. Hard-quantized (~16 colors per zone); zero gradients; palette swaps per biome.
3. Dark contour outline on every sprite and landmass edge — non-negotiable.
4. Flat fills; texture only as sprite repetition (forest = tiled identical trees).
5. Flat green plateau fill; snow zone swaps to white with blue-grey shadows.
6. **Terraced cliff edges**: stacked brown ledges with highlighted lips — elevation as steps, not slopes.
7. Flat royal-blue ocean with sparse wave glyphs and a whirlpool sprite.
8. Tan cliff band where land meets sea — the floating-continent look.
9. One tree sprite per biome, grid-repeated into forests; snowy variant up north.
10. Landmark structures as chunky sprites: castles with towers, gates, domes — 2–3 tiles tall.
11. Castle roofs as colored caps (the red/grey SNES convention).
12. **Walk-dot paths**: tan dotted circles connecting node points; bridges as plank tiles.
13. Path dots on grass, not drawn roads.
14. Whimsy props: terrain with faces (hills with eyes), stars, skulls — Nintendo's wink.
15. Nodes ARE landmarks: castle = big node, dot = small node, star = secret.
16. Node-and-dot progression language shared with G2 but pixel-rendered.
17. Top-down with cheated 3/4 cliff faces (SNES overworld projection).
18. No cast shadows; shading baked into sprite palettes (top-lit ledges).
19. Landmass floats on ocean, edges terraced all round; vertical scroll composition.
20. 16-bit era joy; "world 3 unlocked."

## Using the rubric

- **Kit briefs** answer the axes: a brief that leaves an axis unaddressed will score 0 there.
- **Certification hooks**: axes 1–2 (palette/quantization), 7–8 (water), 12–13 (paths), 17
  (projection) are machine-checkable via the existing style-contract sample points; the rest are
  eye-pass axes.
- **Distinctness**: two shipped looks must differ on ≥ 8 of the 20 axes — the beyond-palette gate's
  concrete form.
