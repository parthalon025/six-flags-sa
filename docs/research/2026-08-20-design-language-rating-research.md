# How designers and game studios rate visual style — research behind schema v2

Source: four-lens research sweep (art bibles / studio review process / cartography / formal
visual-design systems) synthesized as an art-director verdict on the v1 twenty-axis
design-language schema, 2026-08-20. This note records what the industry actually does, the
verdict, and the changes it drove in
[docs/goals/design-language-axes.md](../goals/design-language-axes.md). Sources at the bottom.

## What the industry actually does

- **Pillars → bible → exemplar → gates.** Studios start with 2–3-touchpoint visual pillar
  statements (Overwatch's "diversity, a hopeful future, a vibrant world"; Sable's Moebius + Ghibli
  + Scarpa), keep the rules in an art bible whose most-consulted section is side-by-side
  do's-and-don'ts, and calibrate against a **proven exemplar asset** (Overwatch's Torbjörn; the
  vertical-slice "beautiful corner"). Day-to-day review is **binary sign-off against that named
  reference**, not numeric scoring; numeric rubrics live at pipeline edges (vendor selection,
  education, marketing checklists).
- **Style rules are testable properties.** TF2's five written shading conventions plus a
  silhouette gate (all nine classes identifiable in pure silhouette); Riot's LoL VFX guide with
  **ordered goals — visual clarity for gameplay > minimize clutter > promote theme > surprise &
  delight** — clarity senior to style, not tradeable; Dota 2's value-gradient rules ("no absolute
  black/white", "areas of visual rest").
- **Cartography is the domain literature for a map product.** Figure-ground tested by squint
  (Axis Maps / Dent); Imhof's rules (large areas muted, saturation for small important marks;
  colors interwoven for unity); Bertin's visual variables and selectivity; relief conventions
  (single upper-left light, no inversion, no content-obscuring shadows); **labeling is a symbol
  layer** (Imhof 1975 → Maplex); game-map specifics — ToCHI taxonomy validates interactivity
  affordances and view geometry as first-class, Ghost of Tsushima shows restraint in signifier
  vocabulary beats icon soup, BotW's triangle rule gives landmarks a three-tier salience
  hierarchy.
- **Distinctness is measured, not asserted.** Garces et al. (SIGGRAPH 2014) built style distance
  from four feature families (color / shading / texture / stroke) with weights learned from human
  triplet judgments — and the weights were sparse and radically unequal. Set consistency is scored
  by embedding similarity (StyleAligned); style metrics silently fail without per-corpus
  validation (CSD-failure).

## The verdict on v1 (grade: B−)

What v1 got right: the axis decomposition (axes 1–4 ≈ Garces' four families; the domain block ≈
art-bible reference sheets), declared negation (the do's-and-don'ts section made mechanical), the
no-zeros floor, and catalog-level distinctness — all with direct precedent.

Four faults an art director would catch:

1. **No reference anchor** — v1 scores in the abstract; industry scores against an exemplar.
2. **No value-structure or figure-ground dimension** — the two most-cited readability criteria in
   painting pedagogy and cartography alike.
3. **Everything tradeable** — one sum lets mood points buy off clarity failures; Riot's ordered
   goals forbid exactly this.
4. **No typography axis** — for a map product, the loudest omission (Imhof treats lettering as a
   map symbol layer with its own hierarchy and placement grammar).

Also: the eleven-axis domain block double-counts material vocabulary (terrain outvotes palette
11-to-2 in both the sum and the distinctness metric, opposite to Garces' learned weights), and
0/1/2 without per-level descriptors means two raters' 1s aren't the same 1.

## What v2 adopts

- **Reference anchor**: pillar line + 2–3 touchpoints + a named exemplar per design request;
  scoring happens against the exemplar; a shipped world becomes the exemplar for its refreshes.
- **Tier-0 binary gates, senior and non-tradeable**: figure-ground squint, greyscale survival
  (incl. thumbnail size), color-alone accessibility, semantic honesty (Patterson's "forested
  Death Valley" misread), zoom robustness. Staged: G-1/G-2 run on a greyscale blockout before the
  styling budget is spent.
- **Merges** (six): palette+quantization, water body+edge, massing+roofs, circulation
  geometry+surface, ground+relief-form, texture+visual-rest — the domain block stops outvoting
  the style-bearing axes.
- **Two new axes**: A2 value structure (notan), C3 typography & labeling.
- **17 scored axes, ship ≥ 27/34 (~80%), no zeros, all gates, owner sign-off** against the
  exemplar. Per-level descriptors required (the goal rubrics carry the "2" anchors).
- **Weighted distinctness**: ≥ 6 axes apart including ≥ 3 of {A1, A2, A3, A4, B4, C1};
  periodic human triplet test to calibrate.
- **Motion/timing** flagged as the 18th axis the moment styles animate.

Deliberately not adopted: collapsing to pure binary sign-off (the numeric sum stays as a triage /
drift-detection instrument — the vendor-QA context where scoring *is* industry practice, and this
catalog is generated, not hand-reviewed daily); dropping the B block entirely (vegetation keeps
the G-4 collision check; landmarks/nodes are the product's hero features per the ToCHI taxonomy).

## Source key

Valve NPAR 2007 (TF2) · Riot LoL VFX Style Guide 2017 · Dota 2 Character Art Guide (via Game
Developer) · NastyRodent "Game Art Bible" + "Lookdev Explained" · NextMars milestone/RFP posts ·
Tim Cain 9 stages (Game World Observer) · Treadwell "Beautiful Corners" · SteamAnalyser capsule
checklist · Smartsheet Art Grading Rubric · Game Accessibility Guidelines + Xbox AG 103 · Cook &
Becker "Designing Overwatch" · Kotaku/GDC 2017 (Overwatch) · Axis Maps (visual variables,
hierarchy) · Imhof via Tufte ch. 5 + Imhof 1975 (PSU GEOG 486) · ETH ikgrelief · Patterson
shadedrelief.com/hypso · Toups et al. ToCHI 2019 · GMTK / Nintendo Life (BotW triangles) ·
MobileSyrup + Game Developer (Tsushima) · TCRF/snesmaps (SMW hardware path layer) · Garces et al.
SIGGRAPH 2014 · Hertz et al. StyleAligned · Frochte 2026 (CSD failure) · Cohen-Or et al. SIGGRAPH
2006 · Gurney (gamut masking) · Dow via artincontext (notan) · Draw Paint Academy (edges) · Sea of
Thieves SIGGRAPH 2018 · kiwitrek + AENO art bibles · Juego/SunStrike/RocketBrush (outsourcing QA)
· Feldman model · NIMA (Google Research).
