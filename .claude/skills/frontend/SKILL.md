---
name: frontend
description: "Use when editing the Parkbound app's UI — a screen, a component, a CSS class, a token, or anything a guest sees. Examples: \"Restyle the Party panel\", \"Which component owns the Plan screen?\", \"Change the chip colour\", \"Is this class shared?\""
---

# Front-end work in this repo

The whole front end is `apps/party-tracker/`: `app/page.js` holds the screen registry and the
sheet, `components/*.jsx` hold the panels, `app/globals.css` holds every token and rule.

**Run this first, every time:**

```
npm run frontend:map        # regenerate docs/agents/frontend-map.md, then read it
```

It answers, from the code rather than from a list: which component owns each screen, which
classes are shared, which CSS tokens are paired with a JS constant, and which paths are
factory output. A hand-written version of that table shipped with a design import naming
`components/WorldPicker.jsx` and `lib/worlds.js`, and neither existed.

## Before you edit

| Question | Command |
|----------|---------|
| Which component draws this screen? | `npm run frontend:map`, then the screen table |
| Is this class shared? | the shared-class table — **2+ files means a cross-screen edit** |
| Did I break the map, or a paired constant? | `npm run frontend:map:check` |
| Does this colour pairing read? | `npm run frontend:contrast` |
| Is the design-system bundle still true? | `npm run design:check` (`npm run design:build` to refresh) |

## The four things that go wrong

**Shared classes.** `.btn`, `.label`, `.chip`, `.row`, `.on` are each written by a dozen
components. Four agents each adding a local override of the same rule is worse than one
considered change to `globals.css`. Check the table; settle the rule centrally, once.

**Invented tokens.** `globals.css` already carries the design language, in two palettes, with
the reasoning in its comments. Map a colour to the nearest real token; never add one to
satisfy a mock. Full argument: [claude-design policy](../../../docs/agents/policies/claude-design.md).

**Contrast.** 4.5:1 for text (WCAG 2.1 SC 1.4.3), 3:1 for graphical objects (SC 1.4.11).
This app is used outdoors in direct sun and the stylesheet already records that a lighter
treatment "fails on outdoor glare" — clear the floor comfortably, do not skim it.
`npm run frontend:contrast` measures both palettes and fails only on a *new* failure or a
tracked one that got worse; the known debt is in
`scripts/lib/frontend-map/contrast-known.mjs` with the issue tracking it.

**A number that exists twice.** A CSS custom property and a JS constant holding the same
value will drift — `--peek` shipped at `308px` against a `SHEET_PEEK_PX` of `236` and no test
failed. If you write one, say so in the CSS comment as `CONSTANT in lib/<file>.js` and
`frontend:map:check` starts guarding it.

## The map is factory-fed

`apps/party-tracker/public/venues/*` and `lib/venueIndex.js` are venue-builder output, not a
design surface. The cartography is not yours to restyle; the chrome floating above it is.
[builder-app-contract policy](../../../docs/agents/policies/builder-app-contract.md).

## Before you call it done

Guest-visible behaviour owes a functional check and a row in `test/app/critical-paths.json` —
a redesign is not exempt because it is "just UI", it is the part the guest touches.
[vertical-e2e policy](../../../docs/agents/policies/vertical-e2e.md); run
`npm run test:pre-merge-vertical`.

`docs/agents/frontend-map.md` is generated. Never hand-edit it — change the app and rebuild.
