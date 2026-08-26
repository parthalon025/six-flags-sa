# Map — G1 Village green (RPG tilemap Skin)

## Destination

Ship a **certified world-tier Skin** that reads as cozy 16-bit RPG village warmth — detail and
theme, not a palette recolor — using the Visual factory tile-and-sprite bake lane. Proof against
the G1 rubric ([kings-island-goal-rubrics.md](../../docs/goals/kings-island-goal-rubrics.md)) and
the owner's village reference (genre exemplar, not pixel matching). Geo-true Cedar Point / Kings
Island truth; Visual factory restyles, never repositions.

## Notes

- G1 is goal **#1** in the Kings Island validation suite ([kings-island-goal-matrix.md](../../docs/goals/kings-island-goal-matrix.md)) — nearest existing lane is `rpg-overworld` kit + bake.
- ADR-0017: palette-only looks are invalid; beyond-palette distinctness required.
- ADR-0017: design request must declare reward wiring and pass owner eye pass on first ship.
- Missing for reference quality (matrix): richer CC0 tilesheets, building facade variety, prop
  families (fences/barrels/planters), bridge sprites at path×water crossings.

## Decisions so far

- Owner rejects color-swap Skins — structural detail + thematic coherence are the bar (session 2026-08-26).

## Not yet specified

- **First proof venue** — Kings Island (validation suite home) vs Cedar Point (owner session context) vs fleet kit first.
- **Kit identity** — new `village-green` kit vs evolve `rpg-overworld`.
- **Ship surface** — certified bake + eye pass only vs world tier in venue pack on phones (Wear).
- **Diorama frame (A7)** — enclosed tree-wall border required for real parks or optional / negated.
- **Elevation (A5)** — flat-by-declaration vs subtle DEM terraces on real venues.
- **Reward wiring** — earnable Skin ladder vs venue-bound art vs seasonal.
- **Prop / landmark scope** — minimum prop set for ship vs full G1 B6/C1 (barrels, bridges, statues, signage).

## Out of scope

- Hand-authored fantasy village layout (truth geometry is OSM-derived).
- Pixel-matching the reference image.
- Runtime world generation on the phone.
- Palette-tier-only delivery (SVG token recolor without world bake).
