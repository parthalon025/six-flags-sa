# 22: h11's probe is stale — Train H reads 17/18 when the work is done

**What to build:** Correct `h11`'s probe in `scripts/lib/train-plan.mjs` to read the file the
overlay port actually landed in, and move its fixtures in `test/scripts/train-plan.test.mjs` with it.

**Blocked by:** None

**Status:** ready-for-agent

## Evidence

`node scripts/train-plan.mjs status` reports **17/18** with `h11` READY —
*"MapLibre renderer and overlay ported, behind the renderer switch"* — while `h18`
(*"MapLibre becomes the shipped renderer; the SVG map retires"*), which `needs: ['h11','h15']`,
reads BUILT. A slice cannot be unbuilt underneath a built dependent.

`h11`'s probe is a four-clause conjunction. Three clauses hold; exactly one is false:

| Clause | Result |
|--------|--------|
| `apps/party-tracker/package.json` includes `maplibre` | ✅ |
| `apps/party-tracker/components/ParkMapGl.jsx` exists | ✅ |
| `apps/party-tracker/lib/mapLibreConfigured.js` includes `parkMapRenderer` | ✅ |
| `apps/party-tracker/components/ParkMap.jsx` includes `overlayGeo` | ❌ |

`overlayGeo` is no longer in `ParkMap.jsx`. It now lives in `ParkMapGl.jsx` and
`apps/party-tracker/lib/overlayGeo.js` — the port moved it into the GL component, and `h18`'s
retirement (`ParkMapSvg.jsx` is gone from the tree) rewrote what `ParkMap.jsx` holds.

So the port **did** happen. The probe is pointed at where the overlay used to be.

## Why this matters

The train plan's whole contract is that slice state is *derived from the tree, never stored*
([train-plan policy](../../../docs/agents/policies/train-plan.md)). A probe stuck on a moved
symbol is the plan telling the next session a lie — the exact failure the `h18` comment block in
`scripts/lib/train-plan.mjs` was written to prevent, reappearing one slice over. It sends a
session to rebuild work that is already shipped.

`.scratch/factories-to-app/map.md` already records Trains H/I as **built (18/18)**. The map is
right; the probe is wrong.

## Acceptance

- [ ] `h11`'s probe asserts `overlayGeo` where it now lives, not in `ParkMap.jsx`
- [ ] `test/scripts/train-plan.test.mjs` `h11` fixtures move with it — one `before` per clause,
      each withholding exactly one piece of evidence; `after` passes
- [ ] The probe still answers **false** against an empty tree (the suite asserts this)
- [ ] `node scripts/train-plan.mjs status` reports **18/18**, `h11` BUILT
- [ ] `npm run test:pre-merge-vertical` green

## Notes

Do not "fix" this by relaxing the probe to a clause that cannot go false — the suite checks that
every probe is satisfiable, discriminating, and minimal. The port is real; point the probe at it.
