# 30: Snake River Falls disappeared from Cedar Point's map while still operating

**What to build:** Establish whether Snake River Falls still operates, and restore it to the
shipped map if it does.

**Blocked by:** None

**Status:** resolved

## Evidence

Commit `a065a0a` — *"fix(venues): rebuild drifted OSM bundles and fix drift detection (#461)"*,
2026-08-26 — took cedar-point from 428 shipped places to 427. Diffing that rebuild, **four places
left and three arrived**:

| Change | Place | Verdict |
|---|---|---|
| renamed | `dragon-s-inn` "Dragon's Inn" → `21-and-colder` "21° and Colder" | the park's own rename, same coordinates |
| re-keyed | `lake-eerie-nor-easter` → `…-2` | key rotation — the cause of ticket 25 |
| re-keyed | `watterin-hole` → `…-2` | key rotation — the cause of ticket 25 |
| **dropped** | `snake-river-falls` "Snake River Falls" | **nothing replaced it** |

Three of the four are accounted for. The fourth is a ride:

```json
{"i": "snake-river-falls", "n": "Snake River Falls", "lat": 41.484121, "lng": -82.691042,
 "c": "ride", "h": {"min": 48, "alone": null, "max": null}, "a": "Frontier Town", "e": [...]}
```

It is gone from `apps/party-tracker/public/venues/cedar-point.pois.json`, and
`packages/venue-builder/data/venues/cedar-point/ids.json` marks it `"retired": true`.

## Why this looks wrong

`packages/venue-builder/data/venues/cedar-point/heights.json` **still carries its rule**:

```json
"Snake River Falls": {"h": {"min": 48, ...}}
  source: "official_site", date: "2026-08-09",
  note: "Height requirements compiled from Cedar Point and third-party charts for the 2026 season."
```

The park publishes a 48-inch minimum for this ride for the **2026 season**. A ride the official
chart still gates on is a ride that operates. Meanwhile the map does not show it, and its key is
retired.

Two readings, and they need separating before anything is changed:

1. **The ride operates and the map lost it** — an OSM element was deleted or retagged upstream and
   the rebuild followed it off a cliff. Guest-facing: a 48-inch ride in Frontier Town is invisible,
   and its height rule can never reach a guest because there is no Place to attach it to.
2. **The ride closed and `heights.json` is stale** — then the height rule is the thing to retire,
   and the drop was right.

## How this surfaced

`test/builder/esa-worldcover.mjs` pins the count as an anti-vacuity assertion. It read `428` and
went red when the count became 427 — that is the assertion doing its job. It was corrected to 427
because the byte-for-byte reproduction underneath it is genuinely correct and the count is not a
claim about whether the rebuild was right. The comment there points at this ticket so the number
is not mistaken for a settled question.

Worth noting the drift detection that commit was fixing did not flag a ride leaving the map.

## Answer: it closed. Reading 2 — the drop was right, the height rule was the stale thing.

**The repo already knew, in the file the ticket quotes.** `heights.json` was read for its
`evidence` block; the rule's own `note` says it outright:

> `"note": "Closed for good at the end of the 2024 season — still on the OpenStreetMap
> drawing."`

Three independent sources agree, none of which lists it:

| Source | As of | Snake River Falls |
|---|---|---|
| ThemeParks.wiki (`parks-api-cache.json`, 155 attractions) | 2026-08-18 | absent |
| Queue-Times cache (`queue-times-cache.json`, 69 rides) | 2026-08-11 | absent |
| Queue-Times **live**, fetched while working this ticket (69 rides) | 2026-08-29 | absent |
| OpenStreetMap, via the `a065a0a` rebuild | 2026-08-26 | dropped |

So the rebuild did not follow OSM off a cliff — it followed the park. What the ticket read
as "the official chart still gates on it for the 2026 season" was the *compile date* of the
whole chart (2026-08-09), not a 2026 listing for this ride.

## What was actually wrong

Nothing about the map. The defect was that **a height rule addressing nothing is silent.**
`applyHeightsSidecar` resolved the rule to zero places and moved on, so the contradiction —
a 48-inch rule for a ride the World does not have — sat unremarked, and surfaced only when
a place count in `esa-worldcover.mjs` moved by one. That silence hides the *dangerous*
reading equally well: a ride that still operates and has fallen off the map would look
exactly the same.

## Acceptance

- [x] Determined from the park's published 2026 material: **it does not operate.** Closed at
      the end of the 2024 season.
- [x] **It closed** — so the height rule is retired, not deleted: it moves to a `retired` block
      in `heights.json` carrying the height it gated on, when it retired, and all four sources
      above. Deleting it would invite the next official-chart compile to re-add it as current.
- [x] The guard, in the form this reading needs: `applyHeightsSidecar` now returns `unresolved`,
      `build-venue.mjs` names each one — *"restore the place, or move the rule to retired with
      why"* — and `test/builder/unit.mjs` refuses a venue that has any, as the sibling of the
      overrides check that caught ticket 25. Verified by putting the rule back: it fails, by name.
      This covers the operates-branch too — a place with a live height rule that leaves the map
      now fails the build's own suite instead of moving a count in an unrelated one.
- [x] `npm run venues:overrides -- cedar-point` re-run: 73 of 74 rides carry a height rule, no
      unresolved rules, ride count reconciled.
- [x] `npm run test:pre-merge-vertical` green

## Still open, and not this ticket

`a065a0a` is worth auditing for the other three venues, as the ticket's Notes say. The new
guard is the cheap version of that audit for height rules specifically — it passes on all
four venues today, so no other venue is carrying a rule for a place it has lost.

Siren's Curse being 45 m off the cedar-point walk network is ticket 23, untouched here.

## Notes

Related: cedar-point already fails `route` certification on Siren's Curse being 45 m off the walk
network (ticket 23). Both are the shipped map disagreeing with the park. Ticket 25 came out of the
same rebuild — `a065a0a` is worth auditing for the other three venues too.
