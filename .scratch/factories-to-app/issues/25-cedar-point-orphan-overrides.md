# 25: Cedar Point ships two misspelled ride names; the corrections never land

**What to build:** Make the two orphaned Cedar Point name overrides address the POIs that
actually survived deduplication — at the cause, not by renaming the override key to match.

**Blocked by:** None

**Status:** ready-for-agent

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
- [ ] A test covers whichever cause was found (survivor id assignment, or override key resolution
      across dedup suffixes) and fails on its own message first
- [ ] `npm run test:pre-merge-vertical` green
