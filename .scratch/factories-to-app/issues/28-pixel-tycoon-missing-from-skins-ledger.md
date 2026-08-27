# 28: pixel-tycoon ships everywhere except the skins ledger

**What to build:** Register `pixel-tycoon` in `packages/venue-builder/data/display/skins.json`, and
strengthen `h14`'s probe so a skin cannot read BUILT while the app cannot resolve it.

**Blocked by:** None

**Status:** ready-for-agent

## Evidence

`node test/app/custom-map.test.mjs` throws at line 34:

```
TypeError: Cannot read properties of undefined (reading 'bakeKit')
  assert.ok(ledger['pixel-tycoon'].bakeKit, 'pixel-tycoon ledger binds a bake kit');
```

`skins.json` contains six skins and `pixel-tycoon` is not among them:

```
blueprint-survey, layered-atlas, midnight-carnival, park-midnight, trail, watercolor-quest
```

Yet pixel-tycoon exists everywhere else: it has a kit
(`data/display/kits/pixel-tycoon.json`), it certifies in kings-island's
`display-certification.json`, it is in `SHIP_SKIN_IDS`, and its `visual.json` is now published to
`public/venues/kings-island/display/`. The one place the app reads to resolve a worn Skin is the
one place it is missing.

**Pre-existing on `origin/main`** — confirmed by running the test in a detached worktree at
`origin/main`: identical throw. `skins.json` is untouched by every commit on this branch.

## The probe that let it through

`h14` — *"pixel-tycoon converts; iso retires; three Skins ship"* — reads BUILT on this:

```js
probe: (t) => t.has('packages/venue-builder/data/display/kits/pixel-tycoon.json'),
```

A kit file on disk. It says nothing about conversion, nothing about iso retiring, and nothing
about three Skins shipping. Same class as ticket 22, and the reason `train:next` can report a
slice done while the app crashes on it.

This is also the likely story behind ticket 24's orphan `iso-custom-map` critical-path row
(*"wearing Pixel tycoon draws the isometric custom map"*) — the row survives from before the
conversion h14 claims to have made.

## Acceptance

- [ ] `pixel-tycoon` is in `skins.json` with a `bakeKit` binding consistent with the other baked
      Skins (`layered-atlas`, `watercolor-quest`)
- [ ] `node test/app/custom-map.test.mjs` passes
- [ ] `h14`'s probe asserts the skin resolves through the ledger, not merely that a kit file
      exists — and still answers false against an empty tree
- [ ] Decide `iso-custom-map`'s fate alongside ticket 24
- [ ] `npm run test:pre-merge-vertical` green

## Notes

Check whether registering the skin changes what an existing venue's display pack compiles to
before committing — this is a shipped-Skin ledger, not a config file.
