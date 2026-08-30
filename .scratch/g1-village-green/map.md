# Map — G1 Village green (RPG tilemap Skin)

## Destination

Ship a **certified world-tier Skin** that reads as cozy 16-bit RPG village warmth — detail and
theme, not a palette recolor — using the Visual factory tile-and-sprite bake lane. Proof against
the G1 rubric ([kings-island-goal-rubrics.md](../../docs/goals/kings-island-goal-rubrics.md)) and
the owner's village reference (genre exemplar, not pixel matching). Geo-true Kings Island truth
first; Cedar Point after KI certifies. Visual factory restyles, never repositions.

## Notes

- G1 is goal **#1** in the Kings Island validation suite ([kings-island-goal-matrix.md](../../docs/goals/kings-island-goal-matrix.md)) — nearest existing lane is `rpg-overworld` kit + bake; **new kit `village-green`** supersedes that lineage for G1.
- ADR-0017: palette-only looks are invalid; beyond-palette distinctness required.
- ADR-0017: design request must declare reward wiring and pass owner eye pass on first ship.
- Minimum prop set (bridges, fence/barrel scatter, optional landmark signage) is a **ship gate**, not post-ship polish.

## Decisions so far

- Owner rejects color-swap Skins — structural detail + thematic coherence are the bar (session 2026-08-26).
- **Venue:** Kings Island first proof venue; Cedar Point bakes once KI passes eye pass and distinctness vs shipped Skins (grill Round 1, owner agreed 2026-08-26).
- **Kit:** New `village-green` kit — clean G1 pillar; do not extend `rpg-overworld` (overworld wasteland DNA).
- **Ship surface:** Phone Wear is the bar — mid-band world in venue display pack **plus** guest sees baked world under live overlay. Certified bake + eye pass alone is a milestone, not ship.
- **A7 diorama frame:** Declared **negation** for real venues — no synthetic tree-wall border; open park readability / G-1 figure-ground win over enclosed diorama.
- **A5 elevation:** Subtle DEM terraces allowed; **no cast shadows**; sprite base ellipses only. Not fully flat-by-declaration on real venues.
- **Reward wiring:** Earnable Skin with unlock rung on the world ladder (ADR-0017).
- **Props:** Block first ship until minimum prop vocabulary exists — bridges at path×water crossings, fence/barrel scatter near buildings; not full G1 B6 on day one, but enough to prove it is not a recolor.
- **Signage:** Category glyphs on live overlay carry names; optional in-world shop/INN sprites at landmark POIs only (G1 C3 partial negation).

## Goal line

G1 is goal #1 of five. Sequencing (G1 → G5 → G4 → G2 → G3), per-goal pipelines, and acceptance
live in [kings-island-goal-matrix.md](../../docs/goals/kings-island-goal-matrix.md) — canon, not
copied here, so the two cannot drift.

One decision from this effort landed in that file: **the quest-node overlay is split out of G2**
(owner, 2026-08-27). Drawing Side Quests and Gaps as numbered nodes on dotted paths is a product
feature, not a look — a live overlay layer that composes over whatever Skin the guest wears.
Binding it to G2 would have made a feature earnable and left four of the five goals unable to show
the quest loop at all. It is scheduled against the reward loop, not the Skin queue.

## Not yet specified

- Design request doc beside ledgers (pillar line, exemplar pin, per-axis targets for `village-green`).
- Ledger rows + `assets.json` GUIDs for minimum prop set (bridges, fences, barrels, optional signage).
- `skins.json` / unlock ladder row for `village-green`.

## Out of scope

- Hand-authored fantasy village layout (truth geometry is OSM-derived).
- Pixel-matching the reference image.
- Runtime world generation on the phone.
- Palette-tier-only delivery (SVG token recolor without world bake).
- Synthetic tree-wall border (A7) on real venue bakes.
- Extending `rpg-overworld` kit for G1.
