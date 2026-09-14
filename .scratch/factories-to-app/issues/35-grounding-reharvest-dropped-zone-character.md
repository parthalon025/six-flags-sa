# 35: the grounding re-harvest dropped per-Zone character, and every pack on disk is now unreproducible

**What to build:** Decide where hand-authored Zone character belongs so a harvest cannot
drop it again, and restore it for the three venues still missing it.

**Blocked by:** None

**Status:** resolved

## Evidence

`display-pack.mjs` compiles a Zone's tone from three terms — `cover` (what the land cover
looks like in this Skin), `lean` (the Skin's token for the Zone's declared **character**),
and a ramp rung. `readGrounding` supplies `lean` by reading `grounding.zones[zone].character`.

Ticket 26 re-harvested `kings-island/display/grounding.json` onto the current `classes`
schema. The harvester does not emit `zones`, so the record was rewritten without it — and
`validateGrounding` never checks for `zones`, so the loss was green everywhere. The
character map itself was hand-authored curation, not harvest output:

```json
"Rivertown": { "character": "woodland" }, "Action Zone": { "character": "steel" }, …
```

The consequence is not visible until someone recompiles. On this branch, a bare
`npm run venues:display -- kings-island` flattened **all seven** skins' Zone tones toward
bare ground — e.g. Trail's Action Zone `#AEA8A0` → `#E8E3DB`. The committed packs still
carried the leaned tones, so the map looked right while being unreproducible from its own
inputs.

kings-island's map was restored under ticket 31 (its acceptance required a recompile that
agrees with the committed packs, so it could not be deferred), and five of seven skins then
reproduce byte for byte. **The other three venues were not touched:**

```
cedar-point            grounding.zones — absent
big-kahunas            grounding.zones — absent
six-flags-fiesta-texas grounding.zones — absent
```

## Why it is worth fixing properly

Restoring three more `zones` blocks repeats the setup, not the fix: the next harvest drops
them again, and nothing fails. Two things are missing —

1. **A home the harvest cannot overwrite.** Character is a venue relationship (ADR-0020:
   design owns treatment, the venue owns relationships) and is hand-authored; the harvest
   writes measured classes. Two authorities, one file, last writer wins.
2. **A gate.** Either `validateGrounding` requires character for every Zone the venue has,
   or the display-pack certification reports a World whose Zones all resolve to bare ground
   — which is what "no character anywhere" looks like and is indistinguishable, today, from
   a Skin that means it.

## Acceptance

- [x] Decide where per-Zone character lives so a re-harvest cannot drop it, and record why
- [x] cedar-point, big-kahunas and six-flags-fiesta-texas carry character for every Zone, or
      the record says explicitly that they are meant to read as uncharacterised
- [x] A committed grounding record that lost its character map fails a gate, on its own message
- [x] `npm run venues:display -- <id>` for all four flagships is a no-op against the
      committed packs — the reproducibility this ticket is really about
- [x] `npm run test:pre-merge-vertical` green

## Notes

Found while working ticket 31. The kings-island restoration is in that ticket's commit with
the reasoning in the body; this ticket is the part that was out of scope — the other three
venues and the mechanism that let it happen.
