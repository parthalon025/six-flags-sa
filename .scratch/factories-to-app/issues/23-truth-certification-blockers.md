# 23: No flagship venue passes truth certification

**What to build:** Clear the three distinct blockers keeping all four shipped venues at
`certified: false` in `packages/venue-builder/data/venues/<id>/certification.json`.

**Blocked by:** None

**Status:** resolved

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

## Acceptance

- [x] `park_map_research` passes for kings-island, cedar-point, six-flags-fiesta-texas
- [x] Siren's Curse snaps to the cedar-point walk network (≤35 m), fixed upstream in OSM or via a
      recorded override — not by moving the threshold
- [x] `okaloosa-ortho-2025` either carries an ADR-0020-admissible source with sha256 and licence
      class, or big-kahunas' aerial-derived claims are re-derived from an admissible tile
- [x] `npm run venues:certify` reports `certified: true` for all four flagships
- [x] `npm run test:pre-merge-vertical` green

## Notes

Split into three lanes if worked in parallel — A, B, and C share no files. A is the cheap win.
C is the one that may need an owner call on re-derivation scope.
