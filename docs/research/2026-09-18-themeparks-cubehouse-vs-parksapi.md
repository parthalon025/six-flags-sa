# themeparks-cubehouse vs ParksAPI — venue-data adapter bake-off

**Date:** 2026-09-18  
**Status:** Decision recorded (issue #413)  
**Venues tested:** kings-island, cedar-point, six-flags-fiesta-texas

## Question

The adapter registry listed `themeparks-cubehouse` (legacy cubehouse/themeparks 5.x npm library) with `adopt: evaluate` while `parks-api` was already wrapped against `api.themeparks.wiki`. Should the builder adopt the legacy library, or settle on the existing REST wrap?

## Method

1. **Static comparison** of acquisition models on fields the builder consumes: park identification, attraction inventories, hours, wait-time concepts, maintenance, license, integration cost.
2. **Inventory coverage** — for each committed `parks-api-cache.json` sidecar, `compareParksApiToBundle` against shipped `public/venues/<id>.pois.json` ride names.
3. **Coordinate coverage** — fraction of ParksAPI attractions carrying `at.lat` / `at.lng` (builder-relevant geometry hints).

Reproduce: `npm run venues:venue-data-bakeoff` (writes `packages/venue-builder/data/venue-data-adapter-bakeoff-summary.json`).

## Findings

### Acquisition model

| Dimension | Legacy `cubehouse/themeparks` 5.x | Successor ParksAPI / ThemeParks.wiki |
| --- | --- | --- |
| Status | README: **no longer maintained**; directs to ThemeParks.wiki | Active; powers hosted API |
| Park ID | Hard-coded per-park class (`Themeparks.Parks.*`) | Entity UUID (`parks-api-entity-map.json`) |
| Inventory | `GetWaitTimes()` per park instance | `GET /entity/{id}/children` (recursive entities) |
| Hours | `GetOpeningTimes()` per park instance | `GET /entity/{id}/schedule/{year}/{month}` |
| Wait times | Live scrape per park class | `GET /entity/{id}/live` |
| Integration | npm dependency + SQLite cache; must reuse park object | `lib/adapters/parks-api.mjs` — fetch-only, sidecar cache |
| License | MIT | MIT |
| Registry maintenance | 2/5 | 4/5 |

The legacy library and the hosted API are not independent data sources — upstream explicitly replaced 5.x scrapers with the ThemeParks.wiki entity API that ParksAPI implements. Wrapping the legacy npm package would duplicate the same operator endpoints with more brittle per-park classes.

### Inventory coverage (committed caches)

| Venue | API attractions | Bundle rides | Matched | Coverage % | Coords % |
| --- | ---: | ---: | ---: | ---: | ---: |
| kings-island | 178 | 68 | 50 | 73.5 | 100 |
| cedar-point | 155 | 74 | 55 | 74.3 | 100 |
| six-flags-fiesta-texas | 118 | 70 | 56 | 80.0 | 100 |

Mean bundle inventory coverage: **75.9%**. Mean coordinate coverage: **100%**.

Re-run `npm run venues:venue-data-bakeoff -- --json` after cache refresh. Coverage is research QA signal, not publish authority — official site + OSM evidence still govern coordinates.

### Freshness (committed sidecars)

| Venue | ParksAPI cache `fetched` | Legacy sidecar |
| --- | --- | --- |
| kings-island | 2026-08-11 | none — legacy npm package not wrapped |
| cedar-point | 2026-08-18 | none |
| six-flags-fiesta-texas | 2026-08-11 | none |

Freshness comparison is asymmetric by design: the legacy library was never adopted, so there is no `themeparks-cache.json` to diff. ParksAPI sidecars refresh on `venues:research --fetch`; legacy 5.x would have required per-park scraper instances with SQLite — higher operational cost for the same hosted data path upstream now serves via ThemeParks.wiki.

## Decision

**Reject** `themeparks-cubehouse`. **Keep** `parks-api` as `adopt: wrap`.

Rationale:

1. Upstream abandoned 5.x; maintenance signal is decisively worse than the REST successor.
2. No builder field is available only through the legacy npm surface — inventories, hours, and live waits are on ThemeParks.wiki endpoints we already call.
3. Adding the legacy package would increase dependency weight and cold-start cost without improving coverage on tested venues.
4. Grep confirms no builder import of `themeparks` npm package.

Registry cross-reference: `parks-api` row remains the canonical venue-data adapter; `themeparks-cubehouse` notes point here.

## Out of scope

- Live wait-time ingestion to the phone (tracked elsewhere).
- Running ParksAPI backend (`@themeparks/parksapi`) directly — credentials per park are intentionally withheld; hosted API is the supported path.
