# 27: `venues:overrides --reapply` strips `osm` provenance from the ledger

**What to build:** Stop `--reapply` rewriting ledger records it has no OpenStreetMap source for.

**Blocked by:** None

**Status:** resolved

## Evidence

Running `npm run venues:overrides -- cedar-point` (i.e. `build-venue.mjs --reapply`) rewrites
`packages/venue-builder/data/venues/cedar-point/ids.json` and **removes the `osm` field from 427
of 434 records**. Key-order-insensitive diff of every record:

```
old: {"at": "41.482185,-82.685578", "c": "food", "n": "21° and Colder", "osm": "w841992298"}
new: {"at": "41.482185,-82.685578", "c": "food", "n": "21° and Colder"}
```

No keys added, none removed, names and coordinates unchanged — only the OSM element ids are gone.
`--reapply` runs without the OSM source data, so the POIs it processes carry no `.osm`, and the
ledger is rewritten from them.

## Why this matters

`osm` is step 1 of `assignKeys` — *"the same OpenStreetMap element, live or retired"* — and it is
the **only** stable rematch path. Step 2 falls back to `baseKeyFor(rec.n)`, comparing the ledger's
stored name against the incoming raw OSM name. When an override has renamed a place, those two
strings differ, the match fails, the key retires, and a fresh suffixed key is issued.

That is exactly the mechanism behind ticket 25: Cedar Point silently reverted two spelling
corrections and shipped *"Lake Eerie Nor'easter"* and *"Watterin' Hole"* to guests.

So running the documented reapply verb **re-arms that failure across the entire venue** — 427
records, every one of them one rename away from rotating its key and orphaning its override. The
repair verb is the thing that breaks it.

Caught during ticket 25 by diffing the ledger before committing; the change was reverted
(`git checkout -- ids.json`) and the corrected names were kept. Nothing shipped with the stripped
ledger. Had it been committed, the fix and the next instance of the bug would have landed together.

## Acceptance

- [ ] `--reapply` leaves `osm` intact on every record it does not have a source for — carry the
      prior ledger value forward rather than writing the field away
- [ ] A test asserts a reapply over a ledger with `osm` provenance preserves it, and fails on its
      own message before the fix
- [ ] Re-running `npm run venues:overrides -- cedar-point` produces no `ids.json` diff
- [ ] `npm run test:builder` green

## Notes

Consider whether the ledger should record the **raw** OSM name rather than the post-override name.
A ledger holding the corrected name is what makes step 2's `baseKeyFor` comparison fail after a
rename; holding the raw name would let step 2 work as a genuine fallback instead of a trap. That
is a larger change than this ticket and wants its own decision.
