# 31: pixel-tycoon's compiled visual specs use a retired landTones shape

**What to build:** Regenerate kings-island's `pixel-tycoon` display pack so its `landTones` match
the current Visual-factory output shape.

**Blocked by:** None

**Status:** resolved

## Evidence

`pixel-tycoon.visual.json` and `.style.json` — in both
`packages/venue-builder/data/venues/kings-island/display/` and the published
`apps/party-tracker/public/venues/kings-island/display/` — carry `landTones` in the **old flat
shape**:

```json
{ "day": "#hex", "night": "#hex" }
```

Current code produces the per-role shape introduced by commit `5e2cebc`
("the Visual factory owns Zone tone"):

```json
{ "day": { "fill": "...", "stroke": "...", "label": "..." } }
```

`layered-atlas.visual.json` for the same venue already uses the current shape. The drift is
specific to pixel-tycoon, and traces to its spec being compiled out of band at `8e12eb4` — the
same out-of-band compile that produced a `pixel-tycoon.visual.json` while never committing the
`skins.json` row that ticket 28 had to add.

## Why it has not bitten

`apps/party-tracker/lib/zoneTones.js` degrades a mismatched-shape zone to "no tone" rather than
throwing. So pixel-tycoon's Zones currently render **untinted** — a silent visual downgrade, not a
crash, which is why no test catches it.

## Why it should self-heal, and why that is not enough

Now that ticket 28 put `pixel-tycoon` in `skins.json`, it joins the default active-skin set, so the
next bare `npm run venues:display` for kings-island will recompile it onto the current shape.
Leaving it to chance means the next person to run a rebuild gets an unexplained diff in a file
they did not mean to touch — better to regenerate deliberately and say so.

## Related consequence, already correct

`factory-validate`'s `validateVisualBake` now reports **6/7** bake-kit skins (WARN) rather than 6/6
(PASS), because pixel-tycoon has no baked PNG or bake certification anywhere. That is the gate
surfacing a real gap it had been silently excluding, not a regression — do not "fix" it by
removing pixel-tycoon from the ledger.

## What the recompile turned up — and why it was not deferred

The first bare `npm run venues:display -- kings-island` changed **all seven** skins, not
pixel-tycoon alone: every Zone tone flattened toward bare ground. That traced to ticket 26's
grounding re-harvest dropping the hand-authored per-Zone `character` map the Visual factory's
`lean` term reads. Restoring it was not optional here — this ticket's own acceptance is that
the recompiled packs agree with what ships, and without the character map a recompile
rewrites six packs nobody asked to change. With it restored, five of seven reproduce byte
for byte and the only diffs left are the two this ticket is about: pixel-tycoon onto the
current shape, and watercolor-quest catching up with the `structureEdge` edit commit 5437a6a
made to `skins.json` and never recompiled.

The out-of-scope half — the other three venues, still missing their character maps, and the
mechanism that let a harvest silently overwrite curation — is filed as
[ticket 35](35-grounding-reharvest-dropped-zone-character.md) rather than fixed here.

## Acceptance

- [x] `npm run venues:display -- kings-island` regenerates pixel-tycoon's `visual.json` and
      `style.json` onto the per-role `landTones` shape
- [x] Builder-side and published copies agree (`display-publish.mjs --specs`), and bundle
      hashes/byte totals refreshed through `venues:export` — no hand-edits to `public/venues/*`
- [x] `display.mjs`, `display-style.mjs`, `skin-distinct.mjs` green
- [x] `delivery-bundle-revision-gate.mjs` passes — the cursor survives
- [x] A committed `visual.json` carrying a retired token shape now fails: `landToneErrors` in
      `display-schema-gate.mjs` rejects the flat `{day: hex}` form and names the recompile verb,
      and the suite sweeps all 50 committed specs rather than one hand-picked fixture. Verified
      against the pre-fix pack: it fails on that file, by name.

## Notes

Decide separately whether pixel-tycoon should get a baked world at all — the goal matrix has
**G5 "pixel overworld"** as the goal that converts pixel-tycoon from live SVG to a certified baked
world. Until G5 runs, 6/7 WARN is the honest reading.
