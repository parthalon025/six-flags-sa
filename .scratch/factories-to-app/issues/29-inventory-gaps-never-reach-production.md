# 29: inventory gaps are built, tested, and never shipped

**What to build:** Wire the inventory gap lane into the production shipped-gaps path, or decide
it is not meant to ship and retire the machinery.

**Blocked by:** None

**Status:** ready-for-agent

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

## Acceptance

- [ ] Decide, explicitly: does the inventory lane ship? Record the answer.
- [ ] **If it ships** — `shippedGapsForVenue` accepts and forwards `inventoryGaps`, `venue-io.mjs`
      supplies it, and a real flagship venue build emits at least one `type: 'inventory'` row that
      the phone renders. Assert the *output*, not the seam (vertical-e2e policy).
- [ ] **If it does not ship** — retire the machinery and both allowlist entries rather than
      leaving tested dead code, and say why in the ticket.
- [ ] Golden output for shipped venues (kings-island, cedar-point, big-kahunas,
      six-flags-fiesta-texas) is reviewed either way — wiring this changes gaps documents
- [ ] `npm run test:pre-merge-vertical` green

## Notes

Wiring touches `packages/venue-builder/lib/venue-io.mjs`, which is why the agent that fixed the
suite deliberately stopped at the boundary rather than guessing the call site. That was the right
call — this is the decision it deferred, not a leftover.
