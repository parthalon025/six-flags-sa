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

## Acceptance

- [x] Determine from the park's published 2026 material whether Snake River Falls operates
- [x] **If it closed** — retire the height rule too, and say so here
- [x] `npm run venues:certify -- cedar-point` re-run; ride count reconciled with the chart
- [x] `npm run test:pre-merge-vertical` green

## Resolution (2026-08-29)

Snake River Falls **closed permanently** on 2024-09-02 (announced 2024-08-02; demolished
offseason). The OSM rebuild that dropped it from the shipped map was correct. Retired the stale
`heights.json` rule and gated committed sidecars with `test/builder/heights-retired.mjs` so a rule
with no live place cannot sit quietly again.

