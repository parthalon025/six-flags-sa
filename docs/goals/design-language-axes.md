# Design-language schema v2 — gates, axes, anchors

The **Visual factory**'s vocabulary for describing any look, for any venue (ADR-0017: both
factories are output-agnostic). Every design request states a target on every axis; every shipped
look is scored on them; distinctness between looks is measured on them. The axes describe
*treatment*, never content — they apply identically to a theme park, a water park, or a
campground, and to any style from ink sketch to 3D render.

v2 is the schema after an industry-methods review (see
[the research note](../research/2026-08-20-design-language-rating-research.md)): the v1 twenty-axis
list is restructured into **five binary gates senior to all scoring** plus **seventeen scored
axes**, scoring is anchored to a named reference instead of the abstract, and distinctness is
weighted toward the axes that carry perceived style. The v1→v2 mapping is at the bottom.

## Reference anchor (required before any scoring)

Every design request declares:

- **A pillar line** — the one-sentence identity, with **2–3 named reference touchpoints**
  (studios settle arguments with pillars, not per-axis scores).
- **An exemplar** — the approved reference image or, after first ship, the shipped world itself.
  Scoring happens **against the exemplar**, never against taste. For the Kings Island goals the
  owner's five reference images are the exemplars
  ([kings-island-goal-matrix.md](./kings-island-goal-matrix.md)).

No exemplar, no review. Once a look ships, its certified world becomes the calibration exemplar
for its own refreshes.

**The negation rule** (unchanged from v1): a style may deliberately negate an axis — "no lighting
model", "no path surfaces, routes are implied" — and that counts as an answer *when the design
request declares it*. An axis the request is silent on scores 0. N/A does not exist; only declared
negation.

## Tier 0 — binary gates (pass/fail, senior to all scoring, non-tradeable)

Clarity is senior to mood: a gate failure cannot be bought back with axis points (the ordered-goals
rule — visual clarity for gameplay > minimize clutter > promote theme > surprise & delight).

| Gate | Test |
|---|---|
| **G-1 Figure-ground** | Squint/blur at target zoom: circulation and interactive nodes read as figure over terrain — the map's visual hierarchy matches its intellectual hierarchy |
| **G-2 Greyscale survival** | Desaturated, the map still reads: 2–3 value masses visible; legible at reward-card thumbnail size |
| **G-3 Color-alone** | No essential information carried by a fixed color alone (open/closed, node states); colorblind-simulator pass |
| **G-4 Semantic honesty** | No terrain/vegetation/water treatment implies a false class (the "forested Death Valley" misread); feature classes mutually distinguishable |
| **G-5 Zoom robustness** | The style holds at min and max shipped zoom; detail degrades gracefully, never into noise or blankness |

**Staged rating:** G-1 and G-2 are checked on a **blockout** (terrain + circulation only, greyscale)
before the full styling pass spends its budget; all five gates plus the axis score run on the
finished world.

## Tier 1 — scored axes (0/1/2 each)

Level semantics: **0** = unaddressed, or violates the declared target · **1** = present but off
the exemplar's language · **2** = matches the exemplar. Each design request writes a one-line "2"
anchor per axis (the per-goal rubrics are the template); without written anchors two raters' 1s
are not the same 1.

**A — global language (7 axes):**

| # | Axis | What the "2" must answer |
|---|---|---|
| A1 | Palette contract & saturation budget | The color world as a contract: hue families, temperature, quantization (continuous / stepped / hard-quantized); large areas muted, saturation reserved for small important marks |
| A2 | Value structure | The greyscale skeleton: 2–3 value masses, contrast budget proportional to importance; absolute black/white only if declared |
| A3 | Line, outline & edge control | Whether edges are drawn and how they behave: weight hierarchy, outline-vs-rim decision, hard/soft/lost edge hierarchy with the hardest edges at focal features |
| A4 | Texture grain & visual rest | How surfaces carry texture (flat fill, mottle, hatch, painted dabs, grain, sprite repetition) *and* where the rest areas are — the detail-frequency budget |
| A5 | Light, shadow & relief model | One consistent light source (upper-left bias for top-down); how height reads (flat, terraces, hillshade, strata, true 3D); no relief inversion, no content-obscuring cast shadows |
| A6 | Projection & camera | Top-down, iso rotations, oblique aerial, chart-with-vignettes; declared per world (ADR-0016) |
| A7 | Framing & edge-of-world | How the map ends: enclosed border, bleed to sea, floating landmass, dissolving grid, continues-beyond-frame |

**B — category vocabulary (6 axes):**

| # | Axis | What the "2" must answer |
|---|---|---|
| B1 | Terrain & ground vocabulary | The ground plane and its variation: base treatment, zone/biome logic, how terrain form is built |
| B2 | Water vocabulary | Body fill *and* the land–water seam as one treatment: flat/gradient/animated/specular, foam rings, stipple bands, autotile transitions, crisp lawn edges |
| B3 | Vegetation vocabulary | Tree/planting language: sprite species, painted canopies, glyphs, instanced 3D; density logic (carries the G-4 collision check against terrain) |
| B4 | Built form | Massing, facade and roofs as one read: tile sprites, painted vignettes, archviz massing, extrusions; roof treatment or its declared absence |
| B5 | Circulation | Route geometry *and* surface as one treatment: grid / serpentine / bezier / implied; tiles, ribbons, bead lines, or negated. A "2" requires circulation to read as figure (G-1) |
| B6 | Props & ornament density | Clutter language: what props exist, where they cluster, the big-medium-small budget, breathing room |

**C — function & identity (4 axes):**

| # | Axis | What the "2" must answer |
|---|---|---|
| C1 | Landmark iconography & salience hierarchy | How landmarks read (bespoke sprites, oversized vignettes, real massing, glyphs) and their three-tier salience: orienting / mid-range / local texture; scale exaggeration policy |
| C2 | Node & overlay affordances | In-art game affordances: quest nodes, walk dots, grids, plaques — a small consistent signifier vocabulary (restraint scores, icon soup doesn't); nodes instantly distinguishable from decor; relation to the live overlay |
| C3 | Typography & labeling | The type layer as a style decision: face, case, letterspacing, halos, placement grammar, hierarchy mirroring feature hierarchy — or its declared negation (label-free worlds; overlay carries names) |
| C4 | Mood signature & pillar fidelity | Does the world deliver the declared pillar line and touchpoints — the axis the other sixteen must add up to |

**Ship threshold: ≥ 27/34 (≈80%), no axis at 0, all five gates passed**, then the owner's eye pass
against the exemplar (ADR-0017's certify + eye pass on first ship). The sum triages and detects
drift; the gates and the eye pass decide.

**Motion/timing** is deliberately excluded while worlds are static. The moment any style animates
(water shimmer, node pulses), timing becomes an 18th axis.

## Distinctness gate (weighted)

Two shipped looks must differ on **≥ 6 axes, of which ≥ 3 from {A1, A2, A3, A4, B4, C1}** — the
axes that dominate perceived style distance. Terrain-category differences alone never make two
looks distinct (the concrete beyond-palette rule, v2 form). Calibrate periodically with a
forced-choice triplet test on the live catalog ("which two of these three are the same style?").

## Machine-checkable subset

A1 (palette/quantization), B2 (water), B5 (circulation), and A6 (projection) are verifiable
through the existing style-contract sample points and reference profiles (ADR-0014); G-2's
greyscale/thumbnail check and G-5's zoom sweep are automatable as bake-time checks; the remainder
are eye-pass dimensions. Certification asserts the machine subset; the owner's eye pass scores
everything.

## v1 → v2 mapping

| v2 | From v1 axes |
|---|---|
| A1 | 1 + 2 (quantization is a property of the palette contract) |
| A2 | new (value structure / notan) |
| A3 | 3 + edge control (new half) |
| A4 | 4 + the visual-rest half of 14 |
| A5 | 18 + the conventions half of 6 |
| A6 | 17 |
| A7 | 19 |
| B1 | 5 + the form half of 6 |
| B2 | 7 + 8 |
| B3 | 9 |
| B4 | 10 + 11 |
| B5 | 12 + 13 |
| B6 | 14 |
| C1 | 15 |
| C2 | 16 |
| C3 | new (typography/labeling) |
| C4 | 20 |

## Relationship to design requests (ADR-0017)

A design request = pillar line + exemplar + a target (statement or declared negation) on all 17
axes + reward wiring + size budget. A kit brief that leaves an axis unanswered is incomplete. The
five Kings Island goal rubrics ([kings-island-goal-rubrics.md](./kings-island-goal-rubrics.md))
are the first five instances of this schema.
