# 25: Cedar Point ships two misspelled ride names; the corrections never land

**What to build:** Make the two orphaned Cedar Point name overrides address the POIs that
actually survived deduplication — at the cause, not by renaming the override key to match.

**Blocked by:** None

**Status:** resolved

## Evidence

`test/builder/unit.mjs` — *"every override is filed under a name the venue actually has"* — fails:

```
cedar-point: overrides with no POI to land on: lake-eerie-nor-easter, watterin-hole
```

Both overrides are spelling corrections:

| Override key | Patch | POI actually in the tree |
|---|---|---|
| `lake-eerie-nor-easter` | `{"n": "Lake Erie Nor'easter"}` | id `lake-eerie-nor-easter-**2**`, name `Lake Eerie Nor'easter` |
| `watterin-hole` | `{"n": "Waterin' Hole"}` | id `watterin-hole-**2**`, name `Watterin' Hole` |

The surviving POIs carry a `-2` suffix and a `note` beginning *"OpenStreetMap double…"*. The
override keys address the pre-dedup id, so the resolver finds nothing and **the correction
silently does not happen** — precisely what that assertion's comment warns about
("usually the park renamed the ride and the alias was not moved").

Guest-visible result: Cedar Point ships **"Lake Eerie Nor'easter"** and **"Watterin' Hole"**.
Erie is a lake, not a mood.

## This is pre-existing on main

Neither `packages/venue-builder/data/venues/cedar-point/overrides.json` nor
`apps/party-tracker/public/venues/cedar-point.pois.json` has been modified on this branch — both
are byte-identical to `main`. The gate reads those two files and nothing else, so **`test:builder`
is red on `main` for this reason**, independently of the delivery revision gate (ticket 16).

It is also blocking `git push`: the husky pre-push hook runs local CI, so any branch cutting from
`main` inherits this failure.

## Root cause question — answer before patching

Do **not** close this by renaming the override key to `lake-eerie-nor-easter-2`. That makes the
gate green while leaving the real question unanswered:

- If OSM genuinely has a double and dedup correctly kept one twin, why did the survivor take the
  `-2` id rather than the base id? An override keyed to the base id is the natural thing to write,
  and it will keep breaking.
- If the *other* twin was dropped, the base id is free — the survivor arguably should hold it.

Per [root-cause policy](../../../docs/agents/policies/root-cause.md), fix whichever of those is
the actual defect. `assignKeys` / `addressBook` / `resolveOverride` are the code paths; the
adjacent check *"a key written into an overrides file addresses one place, not every twin"* is the
test that already covers the intended behaviour.

## Acceptance

- [ ] Cedar Point's pois carry `Lake Erie Nor'easter` and `Waterin' Hole`
- [ ] `test/builder/unit.mjs` override check passes without weakening the assertion
- [x] A test covers whichever cause was found (survivor id assignment, or override key resolution
      across dedup suffixes) and fails on its own message first
- [ ] `npm run test:pre-merge-vertical` green

## Root cause (answered 2026-08-27)

The `-2` suffix is **not** a bug. `assignKeys` treats issued keys as permanent —
*"Every key this venue has ever issued, live or retired… A number leaves this set never."*
The ledger confirms two records per ride at identical coordinates:

| key | name | osm | state |
|---|---|---|---|
| `lake-eerie-nor-easter` | `Lake Erie Nor'easter` (**corrected**) | — | retired |
| `lake-eerie-nor-easter-2` | `Lake Eerie Nor'easter` (**raw OSM**) | `w106356823` | live |

What happened: the override used to work, and the ledger recorded the **post-override** name.
On a later rebuild the incoming OSM POI carried the **raw** name again. `assignKeys` step 1
(match by OSM element) could not help — the old record had no `osm` field — so it fell through to
step 2, which compares `baseKeyFor(rec.n)`. Ledger held `lake-erie-nor-easter`; the incoming POI
hashed to `lake-eerie-nor-easter`. **The bases did not match**, so the key was retired, a fresh
`-2` was issued, and the override — filed under the retired slug — became an orphan. The
correction stopped applying and the park started shipping the misspelling.

## Fix

Re-keyed both overrides to the live ledger keys (`lake-eerie-nor-easter-2`, `watterin-hole-2`) and
re-applied. This is the documented pattern, not a workaround — the adjacent suite already asserts
it: *"slug-key overrides resolve via addressBook, not display name"* and *"KI Xtreme Skyflyer
override is ledger-keyed and survives rename"*.

Keying by **display name** cannot work for a rename override: `test/builder/unit.mjs` builds its
address book from the *published* (post-override) pois, so an override naming the old spelling
orphans itself the moment it succeeds. The ledger key is the only stable address across a rename.

It is durable going forward because the live record now carries `osm: w106356823`, so step 1
rematches on the OSM element and the key never rotates again.

**Result:** Cedar Point ships `Lake Erie Nor'easter` and `Waterin' Hole`.
`test/builder/unit.mjs` — 576 passed, 0 failed.

Follow-on filed as ticket 27 (`--reapply` strips ledger `osm` provenance).

## Regression coverage (added 2026-08-27)

The two-axis Spec review caught that the fix shipped with **no test** — this ticket's own
acceptance asked for one and `dce60a1` touched no test file. Closed now by
`test/builder/unit.mjs :: a rename override survives rebuild only while the ledger pins the OSM
element`, pinned in `check-names.json`.

It pins **both halves** of the mechanism rather than just the happy path:

- a ledger record carrying the post-override name and **no `osm`** rotates its key on rebuild, and
  an override filed under the base key resolves to `null` — the silent failure itself
- the same record **with the OSM element pinned** keeps its key through the rename, which is why
  re-keying to the live key is durable rather than a reprieve

Verified discriminating: disabling `assignKeys` step 1 (the OSM-element rematch) makes it fail on
its own message.
