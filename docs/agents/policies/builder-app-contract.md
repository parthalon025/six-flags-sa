# Builder ↔ app contract

The venue builder (`packages/venue-builder/`, invoked as `npm run venues:*`) is the only thing allowed to write `apps/party-tracker/public/venues/*.map.json`, `apps/party-tracker/public/venues/*.pois.json`, `apps/party-tracker/public/venues/*.gaps.json`, `apps/party-tracker/public/venues/manifest.json` and the generated `apps/party-tracker/lib/venueIndex.js`. Everything the app reads at runtime comes out of that pipeline.

Package seams: [packages/README.md](../../packages/README.md).

## Builder output is wrong → fix the builder, not the output

If a generated file under `apps/party-tracker/public/venues/` or `apps/party-tracker/lib/venueIndex.js` is wrong — a missing ride, a wrong height, a bad tag mapping, a stale manifest entry — never hand-edit the generated JSON/JS to patch it. Fix it at the source instead:

- A tag rule, inference or pipeline bug → fix the builder code (`packages/venue-builder/bin/`, `packages/venue-builder/lib/`).
- A one-off correction for a single venue (height, area, alias, hand-added place, district tint, recipe/box/sources) → fix that venue's own input under `packages/venue-builder/data/venues/<id>/` (`overrides.json`, `sources.json`, `recipe.json`, `ids.json`, `attractions.json`, `heights.json`).

Then regenerate with `npm run venues:build`, `venues:rebuild`, `venues:overrides`, `venues:reindex` or `venues:attractions`. `packages/venue-builder/data/venues/` is builder input and is meant to be hand-edited; `apps/party-tracker/public/venues/*.json` and `apps/party-tracker/lib/venueIndex.js` are builder output and are not.

## Prove the fix works in the app

A fix isn't done when the regenerated JSON looks right on its own. After rebuilding, confirm it in the app:

- `npm run venues:report <id>` to sanity-check the rebuilt venue.
- The relevant suite (`npm test`, `npm run test:functional`, `npm run test:visual`, etc.) and/or a manual check of the affected screen, so the fix is proven against the running app and not just the file on disk.

## App change touches the builder's contract → validate against the builder

Going the other way: if an app change reads a new or changed shape from `apps/party-tracker/public/venues/*.json`, `manifest.json` or `apps/party-tracker/lib/venueIndex.js` (a new field, a renamed key, a new required invariant), don't assume the builder already produces it. Before shipping:

- Confirm the builder actually emits that shape for every shipped venue, or update the builder so it does.
- Rerun `npm run venues:build`/`venues:rebuild` (or at minimum `npm run venues:report`) for the affected venues to check the contract holds across all of them, not just the one you tested with.
- Update [docs/guide/venue-builder.md](../../docs/guide/venue-builder.md) if the on-disk contract changed, so the next person building a venue sees the same shape the app now expects.

## Ask before guessing

If it's unclear whether a file is builder input (edit it) or builder output (regenerate it, don't hand-edit it) — or whether a fix belongs in the builder vs. the app — ask before proceeding rather than guessing.

## Agents: warn before hand-waving builds or maps

When work touches the venue builder, display pipeline, World/Visual factory seams, or anything under `apps/party-tracker/public/venues/`, **tell the user explicitly** if you have not run the relevant build or map proof. Do not imply a map or bake is correct from code review alone.

**Must run (or say you have not yet):**

| Change touches… | Build / prove with… |
|-----------------|---------------------|
| Venue inputs, builder code, tags, POIs, gaps | `npm run venues:build` / `venues:rebuild` (or the scoped script the diff warrants), then `npm run venues:report <id>` |
| Display skins, visual/world packs, zone tones, bake output | Display bake/publish steps in [venue-builder guide](../../guide/venue-builder.md) for the affected venue(s) |
| App reads new/changed venue JSON shape | Regenerate all shipped venues; confirm shape in rebuilt output |
| Map rendering, LOD, icons, MapLibre layers | `npm run build -w @party-tracker/app` plus browser vertical or manual map check on a **fresh** build |

**Say out loud when skipping:**

- "I have **not** rebuilt venues — do not merge on this diff alone."
- "I have **not** regenerated display/map artifacts — output under `public/venues/` may be stale."
- "I am reviewing the seam only; the **map in the app** is unproven."

Hand-editing generated files under `apps/party-tracker/public/venues/` or `venueIndex.js` to "fix" a map is never acceptable — fix upstream and regenerate (see above).
