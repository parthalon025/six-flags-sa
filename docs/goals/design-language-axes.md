# Design-language schema — the 20 universal axes

The **Visual factory**'s vocabulary for describing any look, for any venue (ADR-0017: both
factories are output-agnostic). Every design request states a target on all 20 axes; every shipped
look is scored on them; distinctness between looks is measured on them. The axes describe
*treatment*, never content — they apply identically to a theme park, a water park, or a
campground, and to any style from ink sketch to 3D render.

**The negation rule** (what makes 20 axes universal): a style may deliberately negate an axis —
"no lighting model", "no path surfaces, routes are implied" — and that counts as an answer *when
the design request declares it*. An axis the request is silent on scores 0. N/A does not exist;
only declared negation.

**Scoring** (eye pass): 0 = unaddressed or misses the stated target · 1 = present but off ·
2 = matches the stated language. Ship threshold **≥ 32/40, no axis at 0**. **Distinctness gate**:
two shipped looks must differ on **≥ 8 axes** (the concrete beyond-palette rule).

| # | Axis | What it describes (any style, any venue) |
|---|---|---|
| 1 | Palette family & saturation | The color world: hue families, saturation level, temperature; zone/biome color logic if any |
| 2 | Color count & quantization | Continuous color vs stepped vs hard-quantized; how many tones per material |
| 3 | Line & outline language | Whether edges are drawn: weight hierarchy, contour rules, or lineless form |
| 4 | Texture grain | How surfaces carry texture: flat fill, mottle, hatching, painted dabs, photographic grain, sprite repetition |
| 5 | Ground base treatment | What the neutral ground plane is and how it varies |
| 6 | Relief & elevation | How height is depicted: none/flat, terraces, hillshade, painted strata, stroke-built ridges, true 3D |
| 7 | Water body rendering | Fill treatment of water areas: flat, gradient, animated bands, specular render |
| 8 | Shoreline & water edges | The land–water seam: foam rings, stipple bands, autotile transitions, cliff shears, crisp lawn edges |
| 9 | Vegetation vocabulary | Tree/planting language: sprite species, painted canopies, glyphs, instanced 3D; density logic |
| 10 | Structure massing & facade | How buildings read: tile sprites, painted vignettes, archviz massing, extrusions; facade detail level |
| 11 | Roof treatment | Roof forms and rendering — or the declared absence of roof geometry |
| 12 | Circulation geometry | Path/route shape language: orthogonal grid, serpentine spine, bezier curves, implied routes |
| 13 | Path surface treatment | How walkable surfaces are drawn: tiles, ribbons, bead/dot lines, or negated |
| 14 | Props & ornament density | Clutter language: what props exist, where they cluster, how much breathing room |
| 15 | Landmark iconography | How landmarks read: bespoke sprites, oversized vignettes, real massing, symbolic glyphs; scale exaggeration policy |
| 16 | Node & overlay affordances | In-art game affordances: quest nodes, walk dots, grids, plaques — and their relation to the live overlay |
| 17 | Projection & camera | Top-down, iso rotations, oblique aerial, chart-with-vignettes; declared per world (ADR-0016) |
| 18 | Light & shadow model | Global sun, baked AO, sprite base shadows, palette-baked shading, or declared no-light |
| 19 | Framing & edge-of-world | How the map ends: enclosed border, bleed to sea, floating landmass, dissolving grid, continues-beyond-frame |
| 20 | Mood signature | The one-line identity a viewer would say out loud — the axis the other 19 must add up to |

## Machine-checkable subset

Axes 1–2 (palette/quantization), 7–8 (water), 12–13 (circulation/paths), and 17 (projection) are
verifiable through the existing style-contract sample points and reference profiles (ADR-0014);
the remainder are eye-pass axes. Certification asserts the machine subset; the owner's eye pass
scores all 20.

## Relationship to design requests (ADR-0017)

A design request = 20 axis targets (statements or declared negations) + reward wiring + size
budget. A kit brief that leaves an axis unanswered is incomplete. The five Kings Island goal
rubrics ([kings-island-goal-rubrics.md](./kings-island-goal-rubrics.md)) are the first five
instances of this schema.
