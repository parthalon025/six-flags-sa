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

## Goal line — G1 and beyond

Sequencing is fixed by [kings-island-goal-matrix.md](../../docs/goals/kings-island-goal-matrix.md)
(cost → benefit). G1 is goal #1 of five; the four after it are not open questions, they are
queued work:

| Order | Goal | Look | Lane | Cost | Why it is next |
|-------|------|------|------|------|----------------|
| 1 | **G1 village-green** | cozy 16-bit RPG village | new `village-green` kit on the tile-and-sprite bake | days (kit + sprite ledger rows) | closest to what exists; proves the sprite lane at reference quality |
| 2 | **G5 pixel overworld** | SNES world map | pixel pass over the existing bake — quantize (image-q), Sobel outlines, DEM terrace cliffs, path-dot nodes | small–moderate | converts shipped `pixel-tycoon` from live SVG to a certified baked world; retires the last color-swap-era renderer |
| 3 | **G4 surveyor's sketch** | sepia ink hex-map | NPR lane — hachure fills, stroke displacement, parchment ground, vignette sprites, optional hex overlay | moderate | proves NPR generalizes past watercolor; mostly re-points `layered-atlas` line-work machinery |
| 4 | **G2 quest atlas** | painted adventure world-map | painted lane pushed to gouache + relief shading, **plus a quest-node overlay renderer** | largest procedural build | the node-path overlay is a *feature*, not a style — the map draws the XP ladder; schedule when the reward loop needs its showcase |
| 5 | **G3 masterplan** | 3D aerial park render | **Blender tier (E.1)** — truth-extruded massing, bpypolyskel roofs, scattered canopies, baked AO | the Blender stage itself | store-listing-grade imagery; flagship-only economics |

Shared machinery worth noting: **G5 and G2 share the node-path overlay renderer**, so whichever
ships first pays for both. G3 is the only goal that needs a new tier (E.1 Blender,
`operating-stack.json` `local-blender`, "$0 software").

Acceptance is identical per goal: full certification including geo-fidelity and beyond-palette
distinctness vs every shipped look, the 20-point matrix extended with per-goal treatment
assertions, byte-identical rerun (procedural goals) or a stated perceptual threshold (G3) — then
the owner eye pass side-by-side with the reference image. The reference is the goal; resemblance
is judged by the owner, not the machine.

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
