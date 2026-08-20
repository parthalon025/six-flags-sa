# Goal rubrics — design-language targets per reference

Companion to [kings-island-goal-matrix.md](./kings-island-goal-matrix.md). Every goal is gauged on
the schema-v2 axes — see [design-language-axes.md](./design-language-axes.md) for the gates, axis
definitions, negation rule, and machine-checkable subset. Each line below is the goal's **"2"
anchor**: the reference image's target treatment for that axis. Scoring at the eye pass: 0
(unaddressed or violates), 1 (present but off the reference's language), 2 (matches). A goal ships
at **≥ 27/34, no axis at 0, all five Tier-0 gates passed**. The owner's reference image is the
exemplar the scoring anchors to.

Tier-0 gates (figure-ground squint, greyscale survival, color-alone, semantic honesty, zoom
robustness) apply to every goal identically; a per-goal note appears only where a gate needs
goal-specific interpretation.

## G1 — Village green (RPG tilemap)

- **A1** Bright high-saturation spring greens/browns, cheerful primary accents (red/yellow
  flowers); ~24-color feel, flat fills, two tones per material (base + shade), no gradients.
- **A2** Mid-value green field with the dark tree-wall border as the heaviest mass; each material
  reads one value step from its neighbor (path lighter than grass, water darker) — the tile
  contract *is* the value structure.
- **A3** Sprites self-edged in a darker tone of their own material; no universal black outline;
  hardest edges on buildings and props, soft autotile transitions on ground.
- **A4** Subtle per-tile mottle on grass (2-tone checker noise), wood grain on planks; open lawn
  between prop clusters is the declared rest area.
- **A5** Flat ambient light, no global sun; the only shadows are sprite base ellipses; elevation
  negated — the world is flat by declaration.
- **A6** Straight top-down tile grid (RPG Maker convention), uniform tile rhythm.
- **A7** Map fully enclosed by a dark tree-wall border — a contained diorama.
- **B1** Grass base tile everywhere; darker grass variant for shade bands.
- **B2** Medium-blue flat water with lighter inner ripple rows; autotiled rounded shoreline with a
  light-blue edge band; plank bridges at path crossings.
- **B3** Two-tone puff-canopy deciduous trees + bushes; each sprite sits on a soft shadow ellipse.
- **B4** Timber-frame cottages: brown plank walls, black door/window insets; gabled darker-brown
  shingle roofs with ridge highlights, chimneys with smoke-ready stubs.
- **B5** Orthogonal sand/tan path tiles on the grid radiating from a central plaza; rounded
  autotile corners, square T-junctions; paths one value lighter than lawn (the G-1 figure read).
- **B6** Dense prop clutter near buildings (barrels, crates, fences, wells, flowerbeds, statues);
  open lawn between — big (buildings) / medium (props) / small (flowers) budget visible.
- **C1** Landmarks as bespoke multi-tile sprites: statue pair at the plaza (orienting), market
  tent (mid-range), garden crop rows (local texture).
- **C2** None in-world — signage sprites only; the live overlay carries pins (declared).
- **C3** Declared negation of cartographic labels: lettering exists only as in-world signage
  sprites (INN); the overlay carries names.
- **C4** Cozy 16-bit village warmth; "a town you could enter."

## G2 — Quest atlas (painted node map)

- **A1** Tropical high-saturation gouache: turquoise water, lush greens, ochre canyon, charcoal
  volcanic; continuous painted color, hue zones per biome rather than a count.
- **A2** Strong three-mass value structure: dark volcanic/canyon shadow, mid jungle/savanna,
  bright beaches and waterfall whites; nodes and path the brightest marks on the map.
- **A3** No line work — form built by painted value; hard rim highlights on cliff edges, lost
  edges inside canopy masses.
- **A4** Airbrushed gradients with dabbed brush texture on canopies and strata; open water and
  savanna flats are the rest areas.
- **A5** Single global sun (upper-left), painted shadows and glow, strong AO in gorge recesses;
  dramatic painted relief — layered cliff strata, gorges, a volcano.
- **A6** High oblique painted aerial, mild perspective, no true 3D.
- **A7** Map bleeds into open ocean at every edge; islands trail off.
- **B1** Zone-coded ground: jungle green, savanna ochre, volcanic grey-brown, each with painted
  variance.
- **B2** Turquoise-to-deep gradient water; waterfalls as white streaked columns with foam bases;
  white foam rings hugging every coastline, rocky shear edges where cliffs meet sea.
- **B3** Clustered painted canopies with single-dab highlights; silhouette species (palms,
  baobabs) as accents.
- **B4** POI structures as oversized painted vignettes (huts, temple, skull cave) at symbolic
  scale; thatch/organic roofs rendered painterly, no hard geometry.
- **B5** One serpentine master path winding through all zones — the composition's spine — drawn
  as a dotted white bead line, not a surface; unmistakably the figure (G-1).
- **B6** Sparse props; the terrain itself is the ornament.
- **C1** Landmark vignettes oversized ~3× realistic scale, each unique; volcano as the orienting
  landmark, temple/cave as mid-range, waterfalls as texture.
- **C2** **Uniform node sprites (gift-box style) evenly beaded along the dotted path; occasional
  portrait plaques; cloud occluders floating above. The defining aspect: nodes are the game** —
  one signifier vocabulary, instantly distinct from decor.
- **C3** Bold outlined numerals on node sprites — chunky, white-on-dark, readable at thumbnail
  size; no other lettering in-world.
- **C4** Saturday-morning adventure epic; "which node is next?"

## G3 — Masterplan (3D aerial render)

- **A1** Muted naturalistic: lawn greens dominant, beige-orange path ribbon, dark bay blue;
  continuous photographic color, restrained, no stylization; saturation reserved for the path
  ribbon — the map's one bright mark.
- **A2** Soft high-key values: pale paths as the lightest figure over mid lawn, the bay as the
  single dark anchor mass; contrast concentrated where circulation meets water.
- **A3** No drawn lines — pure rendered geometry, anti-aliased edges; edge hierarchy from focus
  and haze, hard at foreground structures, dissolving at the horizon.
- **A4** Subtle diffuse texture only (lawn tone variance, asphalt grain), no painterly grain; the
  groomed lawn is the rest area.
- **A5** Single sun with soft global shadows, light atmospheric haze at distance; gentle real
  topography only — the site reads nearly flat with soft berms.
- **A6** Oblique aerial ~35°, long perspective toward a hazed horizon.
- **A7** Peninsula site framed by the bay and highway bridge; world continues beyond frame.
- **B1** Continuous groomed lawn as the ground plane.
- **B2** Kidney-shaped ponds in light blue-green with thin sand/stone rims and crisp mowed-lawn
  edges; the bay dark with specular glints and boat wakes.
- **B3** Individually placed 3D trees, two species mixes (dark rounded + lighter), each with a
  soft contact shadow.
- **B4** Few buildings, simple archviz massing with glass/panel hints; flat and low-slope roofs
  in muted orange/grey; one anchor building at the water.
- **B5** Curvilinear bezier crushed-gravel loops with clear width hierarchy (main promenade vs
  spurs); grey asphalt lots with painted stalls; roads with lane realism.
- **B6** Real-world furniture only (cars, courts, field striping); zero whimsy.
- **C1** Landmarks are the actual buildings and sports fields — no iconography; the anchor
  building orients, fields read mid-range.
- **C2** None — presentation render; the live overlay is the only game layer (declared).
- **C3** Declared negation — label-free presentation render; names live in the overlay.
- **C4** Municipal masterplan serenity; "the park as built."

## G4 — Surveyor's sketch (ink hex map)

- **A1** Duotone contract: sepia/bistre ink on cream parchment plus a single muted teal for
  water — the most constrained palette of the five.
- **A2** Value is stroke density: parchment is the light mass, hatch fields the mid, coastlines
  and vignette shadows the dark accents — the map must read as a 3-value notan of ink coverage.
- **A3** Everything is line: varied-weight ink strokes, heavy coastlines, feather-light texture
  strokes; hard edges only at coasts and vignette silhouettes.
- **A4** **Texture as tone**: repeated scalloped hatch strokes fill all ground, stipple bands
  shade coasts; bare parchment is the rest area.
- **A5** No lighting model (declared); shadow exists only as hatching inside vignettes; hills and
  ridges built from stroke stacks with hatched shadow flanks.
- **A6** Flat plan view with pictorial side-on vignettes — the antique-chart convention.
- **A7** Composition runs off the parchment; the hex grid dissolves at the edge.
- **B1** Parchment shows through everywhere; ground is hatch pattern, not fill.
- **B2** Flat teal water, no gradient; double-line ink coast with a stippled band hugging it;
  interior oases as teal blobs.
- **B3** Vegetation as pictorial glyphs — palm clusters at oases, hatched scrub.
- **B4** Structures as illustrated vignettes (pyramids, ruined temple, huts) in the same ink
  hand; roof geometry negated — roofs exist only inside vignettes.
- **B5** Declared negation: routes implied, not drawn — the map is territory, not circulation.
  (G-1 note: with circulation negated, the figure read falls to landmarks and the hex overlay.)
- **B6** Sparse storytelling props: camel, serpent, skeletons, shipwreck — each a one-off
  illustration.
- **C1** Every landmark a unique hand-drawn vignette at symbolic scale; the pyramid group
  orients, ruins read mid-range, fauna as texture.
- **C2** **Thin brown hex-grid overlay fading in across the lower map — the game affordance laid
  over the art.**
- **C3** Hand-lettered place names in the same ink hand: antique letterspaced caps, curved
  placement along features — typography is part of the drawing.
- **C4** Explorer's field chart; "here be side quests."

## G5 — Pixel overworld (SNES map)

- **A1** SNES-bright primaries, hard-quantized (~16 colors per zone), zero gradients; palette
  swaps per biome (mid-green land, royal-blue sea, tan cliffs, white snow zone).
- **A2** Hard value steps by layer: sea darkest field, land mid, cliff lips and snow the light
  accents; sprites pop one full value from their ground — quantization *is* the notan.
- **A3** Dark contour outline on every sprite and landmass edge — non-negotiable; single-pixel
  weight, no soft edges anywhere.
- **A4** Flat fills; texture only as sprite repetition (forest = tiled identical trees); open
  plateau fill is the rest area.
- **A5** No cast shadows; shading baked into sprite palettes (top-lit ledges); **terraced cliff
  edges** — stacked brown ledges with highlighted lips, elevation as steps, not slopes.
- **A6** Top-down with cheated 3/4 cliff faces (SNES overworld projection).
- **A7** Landmass floats on ocean, edges terraced all round; vertical scroll composition.
- **B1** Flat green plateau fill; snow zone swaps to white with blue-grey shadows.
- **B2** Flat royal-blue ocean with sparse wave glyphs and a whirlpool sprite; tan cliff band
  where land meets sea — the floating-continent look.
- **B3** One tree sprite per biome, grid-repeated into forests; snowy variant up north.
- **B4** Landmark structures as chunky sprites: castles with towers, gates, domes — 2–3 tiles
  tall; roofs as colored caps (the red/grey SNES convention).
- **B5** **Walk-dot paths**: tan dotted circles connecting node points, bridges as plank tiles;
  dots on grass, not drawn roads — the brightest small marks on land (G-1).
- **B6** Whimsy props: terrain with faces (hills with eyes), stars, skulls — Nintendo's wink.
- **C1** Nodes ARE landmarks: castle = big node, dot = small node, star = secret — the salience
  hierarchy is the progression ladder.
- **C2** Node-and-dot progression language shared with G2 but pixel-rendered; one signifier set,
  no icon soup.
- **C3** Declared negation in-world: no map lettering; names appear in the UI layer outside the
  art (overlay's job).
- **C4** 16-bit era joy; "world 3 unlocked."

## Band anchors (ADR-0019)

The anchors above describe the **mid band** — the everyday view. With zoom-banded worlds each
goal also answers two more generalization levels, in the same language:

- **Overview band**: only what survives the squint — G-1's figure (circulation/nodes), C1's
  orienting landmarks, A2's value masses. Prop clutter (B6), texture grain (A4), and typography
  (C3) generalize away or simplify; negating them *at this band* needs no extra declaration.
- **Close band**: the lean-in reward — A4's grain becomes authored micro-texture, B6's props gain
  variants, C3's signage becomes readable, without violating the declared rest areas or G-1.
  Example (G1): at overview the village reads as green mass + tree-wall + plaza landmark; at
  close, plank grain, individual flowers, and the INN sign are real painted detail.

The eye pass scores the mid band on all axes and spot-checks overview/close against G-1/G-2 and
the band handoffs (G-5).

## Using the rubric

- **Kit briefs** answer the axes: a brief that leaves an axis unaddressed will score 0 there.
- **Gates first**: G1–G5 blockout/finish checks run before and above the axis sum — a goal that
  fails figure-ground or greyscale cannot ship at any score.
- **Certification hooks**: A1 (palette/quantization), B2 (water), B5 (circulation), A6
  (projection) are machine-checkable via the existing style-contract sample points; greyscale and
  zoom checks are automatable bake-time gates; the rest are eye-pass axes.
- **Distinctness**: two shipped looks must differ on ≥ 6 axes including ≥ 3 of
  {A1, A2, A3, A4, B4, C1}. The five goals clear it pairwise by construction — e.g. G1 vs G5
  differ on A1 (24-color soft vs 16-color hard), A3 (self-edge vs black contour), A5 (flat
  ambient vs terraced top-lit), B4 (cottages vs castles), plus B5, C1, C2.
