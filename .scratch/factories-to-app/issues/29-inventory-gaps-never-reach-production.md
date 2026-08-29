# 29: inventory gaps are built, tested, and never shipped

**What to build:** Wire the inventory gap lane into the production shipped-gaps path, or decide
it is not meant to ship and retire the machinery.

**Blocked by:** None

**Status:** resolved

## Evidence

Ticket 29 exists because fixing the inventory-gaps suite made it green **without making the
feature real**. After that fix:

- `shippedGapsDocument()` accepts `inventoryGaps` and folds `{ type: 'inventory', target }` rows in
- `'inventory'` is on both allowlists — builder `SHIPPED_GAP_TYPES` and the phone's Set in
  `apps/party-tracker/lib/venue/store.js`
- `test/builder/inventory-gaps.mjs` — 11 passed, 0 failed

But nothing in production ever passes it:

```
venue-io.mjs:134  shippedGapsForVenue({ venueId, meta, pois, map, attractions,
                                        imageryGaps, adapterCaches, gapNotes })
ship-gaps.mjs:269 export function shippedGapsForVenue({ venueId, meta, pois, map,
                                        attractions, imageryGaps, adapterCaches,
                                        gapNotes, asOf })
```

`shippedGapsForVenue` neither accepts nor forwards `inventoryGaps`, and its only production caller
does not pass it. `inventoryAsksFromAdapters`, `inventoryShipArtifacts` and
`questSeedsFromInventory` in `inventory-gaps.mjs` are called **only from tests**.

(Note: the `inventoryGaps` key in `open-research.mjs` and `build-pipeline.mjs` is a different
thing — LLM research output naming attractions on an official listing but missing from the bundle.
It does not feed the shipped-gaps document.)

## Why this matters

A real venue build will never emit a `type: 'inventory'` row. The suite proves the machinery
works in isolation and proves nothing about what guests receive — the shape of green test, dead
feature that the vertical-e2e policy exists to prevent.

It also means the allowlist entry is currently inert on both sides: the phone will accept a gap
type the builder never produces.

## Decision — it ships

**It ships.** The lane is a *floor*, not routine output: nothing is emitted until an
adapter matches fewer than half a venue's rideables. Measured on the four flagships at
the time of wiring:

| Venue | rideables | ParksAPI | Queue-Times |
|---|---|---|---|
| kings-island | 68 | 50 (0.74) | 50 (0.74) |
| cedar-point | 74 | 55 (0.74) | 55 (0.74) |
| six-flags-fiesta-texas | 70 | 56 (0.80) | 55 (0.79) |
| big-kahunas | — | cache holds an `error` and zero attractions | no cache |

All well over the 0.5 threshold, so **no flagship emits a `type: 'inventory'` row today,
and none should.** That is why the acceptance below could not be met as written — a
flagship build cannot be made to emit one without gaming the threshold, which would fire
the lane on healthy venues and be worse than leaving it unwired. Retiring the machinery
instead was rejected: it is complete, ADR-consistent, on both allowlists, and the only
thing missing was the call.

The vertical is proven on a venue that is genuinely below threshold, asserting the bytes
a phone downloads — the document is serialized the way `writeVenue` does and parsed back
through the phone's own `normalizeGapsDocument`, and the inventory rows are looked for
there. Both above- and below-threshold cases are pinned.

### The cycle the wiring exposed

`ship-gaps.mjs` importing `inventory-gaps.mjs` closed a dependency cycle:
`inventory-gaps → adapters/parks-api → venue-io → imagery-claims → ship-gaps`. The
comparison is pure name work; the adapters it lived in also read venue sidecars. Two
leaves now carry it — `lib/name-matching.mjs` (the similarity primitive, previously in
`venue-judge.mjs`, which also reads the ledger) and `lib/inventory-compare.mjs` (the two
`compare*ToBundle` functions). Both adapters and `venue-judge.mjs` re-export, so every
existing caller is unchanged, and two of the core→adapters allowlist entries from ticket
32 are gone rather than registered.

### Follow-up, not this ticket

`cedar-point.gaps.json` on disk is missing a `camping` row the current code produces.
That drift predates this change — it reproduces with the wiring reverted — so the shipped
artifact was left alone rather than regenerated under a ticket that did not cause it.

## Acceptance

- [x] Decide, explicitly: does the inventory lane ship? Recorded above.
- [x] **It ships** — `shippedGapsForVenue` computes and folds both the gaps and the seeds,
      reading the `parks-api` and `queue-times` caches `venue-io.mjs` already supplies through
      `adapterCaches`. Output asserted through the serialized document and the phone's own
      normalizer, not the seam. **Deviation:** no *flagship* emits a row, because none is below
      threshold — see the decision above.
- [x] Golden output reviewed for all four: unchanged by this wiring, zero inventory rows each.
- [x] `npm run test:pre-merge-vertical` green

## Notes

Wiring touches `packages/venue-builder/lib/venue-io.mjs`, which is why the agent that fixed the
suite deliberately stopped at the boundary rather than guessing the call site. That was the right
call — this is the decision it deferred, not a leftover.
