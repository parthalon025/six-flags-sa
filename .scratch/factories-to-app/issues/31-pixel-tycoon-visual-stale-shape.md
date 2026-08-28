# 31: pixel-tycoon's compiled visual specs use a retired landTones shape

**What to build:** Regenerate kings-island's `pixel-tycoon` display pack so its `landTones` match
the current Visual-factory output shape.

**Blocked by:** None

**Status:** ready-for-agent

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

## Acceptance

- [ ] `npm run venues:display -- kings-island` (or the narrower skin-scoped verb) regenerates
      pixel-tycoon's `visual.json` and `style.json` onto the per-role `landTones` shape
- [ ] Builder-side and published copies agree, and bundle hashes/byte totals are refreshed through
      the export path — no hand-edits to `public/venues/*` (builder-app-contract policy)
- [ ] `node test/builder/display.mjs`, `display-style.mjs`, `skin-distinct.mjs` stay green
- [ ] `node test/builder/delivery-bundle-revision-gate.mjs` still passes — the cursor must survive
- [ ] Consider a check that a committed `visual.json` cannot carry a retired token shape; the
      degrade-to-no-tone path is exactly the kind of silence that let this sit

## Notes

Decide separately whether pixel-tycoon should get a baked world at all — the goal matrix has
**G5 "pixel overworld"** as the goal that converts pixel-tycoon from live SVG to a certified baked
world. Until G5 runs, 6/7 WARN is the honest reading.
