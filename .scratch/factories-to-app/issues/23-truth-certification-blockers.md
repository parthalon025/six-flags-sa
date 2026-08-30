# 23: No flagship venue passes truth certification

**What to build:** Clear the three distinct blockers keeping all four shipped venues at
`certified: false` in `packages/venue-builder/data/venues/<id>/certification.json`.

**Blocked by:** None

**Status:** blocked — lane B cleared; A and C need the owner

## Evidence

Display certification is green everywhere — all four venues report `certified: true` in
`display/display-certification.json`. **Truth** certification is red everywhere. Three separate
causes, not one:

| Venue | Failing check | Cause |
|-------|---------------|-------|
| kings-island | `park_map_research` | never run |
| six-flags-fiesta-texas | `park_map_research` | never run |
| cedar-point | `park_map_research`, `route` | never run; one ride off-network |
| big-kahunas | `imagery_ledger` | licence, not plumbing |

### A — `park_map_research` (3 venues)

> claim: Official park map image is local or LLM park-map search recorded candidates
> evidence: `local_images=0; parkMap_candidates=0; llm_park_map_search=false`, `searchQueries: []`

Zero on every axis with an empty query list. This is not a failed search — the verb was never
run for these venues. Needs `park-map-research` with network/LLM access, then re-certify. Cheapest
of the three and it clears three of the four venues.

### B — `route`, cedar-point

> evidence: `1 component(s), 1 ride(s) >35 m from network`
> farRides: `[{ name: "Siren's Curse", metres: 45 }]`

One ride, 45 m from the walk network against a 35 m threshold; the graph is otherwise a single
component. An OSM path gap at Siren's Curse — either an upstream OSM path addition (the factory
has `osm-writeback.mjs`) or an override. **Offline routing cannot reach a ride that is not on the
walk network**, so this is a real guest-facing defect, not a scoring nit.

### C — `imagery_ledger`, big-kahunas

> `okaloosa-ortho-2025: no sha256` · `no licence class` ·
> `served via "Esri World Imagery" — ADR-0020 clause 2 rejects esri for derivation
> ("viewable is not derivable")`

Three faults on one ledger row, and the third is not fixable by filling in fields: ADR-0020
clause 2 does not admit Esri as a derivation channel. Any shipped coordinate signed
`by:aerial` that traces to this tile needs a different source (NAIP via Planetary Computer is
already wired — `lib/imagery-claims.mjs`, `test/builder/naip.mjs`) or the claims must be
re-derived. Do **not** close this by adding a sha256 to an inadmissible row.

## Where each lane landed

### B — `route`, cedar-point: **cleared, and the diagnosis was wrong**

The ticket read the 45 m as an OpenStreetMap path gap stranding a ride, and called it "a real
guest-facing defect, not a scoring nit". Measured, it is neither:

| Measured from | to the walk network |
|---|---|
| Siren's Curse **centroid** (what the gate snapped) | 64 m |
| Siren's Curse **track**, in this venue's own `map.json` | **9.5 m** |
| Siren's Curse **track**, in live OpenStreetMap (fetched 2026-08-29) | **14.9 m** |
| ParksAPI queue entrance, in live OpenStreetMap | 25.8 m |

Siren's Curse is a 225-vertex coaster; the centroid of a ride that big sits in the middle of
its own footprint, far from any walkway, exactly as it should. OSM is not missing a path and a
rebuild would not have changed anything — **a guest can walk right up to this ride.** The gate
was measuring the wrong point.

`qaVenueRouting` now snaps where a guest could actually be standing: the recorded queue
entrance if the bundle has one, else the ride's own mapped structure, else the point. All four
flagships pass `route`, and the gate still catches what it was built for — a ride stranded off
the network fails, pinned by its own check.

Had this been "fixed" upstream, the repo would have proposed an OpenStreetMap edit for a path
that is already there.

### A — `park_map_research` (3 venues): **blocked, root cause found**

The ticket said the verb "was never run". True, and it could not have been: `agents/research.mjs`
passed `fetch: false, offline: true` to `runOpenResearch` unconditionally, while every other step
around it took the caller's `fetch`. So neither route into the lane could run — not `--ai`, and
not the deterministic HTML extract that needs no model. That is fixed: the call now honours the
caller, defaulting to offline so builds stay reproducible.

Running it does not clear the check, and **should not**:

```
kings-island  10 candidates — 1 map-like (the page's own URL), 9 SVG legend icons
cedar-point   10 candidates — same shape
six-flags-fiesta-texas  0 — https://www.sixflags.com/fiestatexas/park-map returns 404
```

Passing on nine legend icons would be the shape of green gate, absent capability this whole
certification exists to refuse — so the check was tightened to count only a local image, a
map-like candidate, or a real LLM search hit, and it now reports `(of N recorded)` so a thin
pass cannot hide inside a big number. Clearing the lane honestly needs one of:

1. **`VENUE_LLM_API_KEY`** — then `npm run venues:research -- <id> --ai` runs the park-map search.
2. **A licensed official map image** committed at `data/venues/<id>/maps/`, the way big-kahunas
   has one. That is a licensing decision about the park's copyrighted artwork, not a build step.

Neither is available to an agent, and six-flags-fiesta-texas needs its dead map URL replaced
first either way.

### C — `imagery_ledger`, big-kahunas: **blocked, by design**

The ledger row answers this itself:

> `"review": "UNADJUDICATED. … Three things are true at once and only a human can weigh them. …
> Resolving it means finding the county's imagery licence and its direct download"`

The check agrees, ending its own detail with *"a human must adjudicate this row"*. The question
is whether a **county** ortho reached through an Esri endpoint is Esri's basemap under ADR-0020
clause 2, or a county programme with its own licence — and no licence was ever recorded either
way. Nothing was touched here: adding a sha256 to a row that may be inadmissible is what the
ticket explicitly forbids.

## Acceptance

- [ ] `park_map_research` passes for kings-island, cedar-point, six-flags-fiesta-texas
      — **blocked**: needs an LLM key or a licensed map image (see A)
- [x] Siren's Curse snaps to the cedar-point walk network — at **9.5 m**, and always did. Fixed
      by measuring the right point, not by moving the threshold (which is untouched at 35 m) and
      not by an OSM edit for a path that already exists.
- [ ] `okaloosa-ortho-2025` — **blocked**: the row is marked UNADJUDICATED and needs a licensing
      determination (see C)
- [ ] `npm run venues:certify` reports `certified: true` for all four flagships — **0/4**, held by
      A and C alone; `route` is green everywhere now
- [x] `npm run test:pre-merge-vertical` green

## What the owner needs to decide

1. **Lane A** — provide `VENUE_LLM_API_KEY`, or approve committing each park's official map image
   under a stated licence. Also: six-flags-fiesta-texas' catalogued map URL 404s and needs replacing.
2. **Lane C** — adjudicate the Okaloosa row: is a county ortho served through an Esri endpoint
   admissible under ADR-0020 clause 2, and under what licence? If not, big-kahunas' `by:aerial`
   claims need re-deriving from NAIP.

## Notes

Split into three lanes if worked in parallel — A, B, and C share no files. A is the cheap win.
C is the one that may need an owner call on re-derivation scope.
