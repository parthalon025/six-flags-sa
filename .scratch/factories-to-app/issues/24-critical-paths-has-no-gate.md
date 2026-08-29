# 24: critical-paths.json can claim coverage that does not exist

**What to build:** A gate asserting every `suite: functional` row in
`test/app/critical-paths.json` names a `check(...)` string that actually appears in
`test/app/functional.mjs` — then clear the two rows that fail it.

**Blocked by:** None

**Status:** resolved

## Evidence

`critical-paths.json` is the shipped-capability contract ("every user-visible capability we ship
must keep a named check"). Nothing verifies it. Grepping every `suite: functional` row's `check`
string against `functional.mjs`, two of 44 match nothing in the test tree:

| Row | Slice | `check` that does not exist |
|-----|-------|------------------------------|
| `clerk-profile-oauth` | EP | `Profile gate shows Sign in and Guest` |
| `iso-custom-map` | Adventure | `wearing Pixel tycoon draws the isometric custom map` |

Both strings appear exactly once in the whole repo — in `critical-paths.json` itself.

`iso-custom-map` looks like a leftover: slice `h14` is *"pixel-tycoon converts; **iso retires**"*
and reads BUILT. The capability the row describes was retired; the row claiming it is covered
was not.

## Why this matters

This is the same failure that let tickets 16, 20, and 21 close with ticked acceptance boxes for
bookkeeping that never happened — 20 and 21 both accepted *"row X in `shipped`; remove from
`upcoming`"*, shipped the implementation **and** the functional checks, and left both rows sitting
in `upcoming` with `check: "TODO …"`. (Those two rows were promoted to `paths` on
2026-08-27 with their real check strings; this ticket is about the missing gate, not those rows.)

An unguarded registry drifts silently in both directions: real coverage reported as `upcoming`,
and absent coverage reported as shipped. The second is the dangerous one.

## Acceptance

- [x] `test/app/coverage-contract.mjs` asserts every row's `check` appears verbatim in the file
      its suite names, and fails on its own message before the fix — verified by running it
      against the pre-fix contract, which refuses both rows by id.
- [x] Rows naming another suite are checked against **that suite's** file, not the first one:
      the gate resolves through the contract's own `suites` map and refuses a row whose suite the
      map does not resolve, saying so by name. `grandma`'s `check_includes` is matched as a
      substring against `grandma.mjs`. A suite is covered by being in the map; nothing is
      silently skipped.
- [x] `clerk-profile-oauth`: **the row named a shape the app retired.** `AuthGate` — the Profile
      gate that carried Sign in and Guest together — is mounted nowhere (in-place OAuth on it
      broke live; `functional.mjs` asserts it is absent at first paint). So there was no gate to
      write a check for. The row is split into the two entry points that do ship — the Settings
      sign-in card, and Google/Apple on `/sign-in` — and the Settings check it now names was
      strengthened to assert the card actually offers Sign in bound to `/sign-in`, which nothing
      asserted before. The EP sign-in path is covered rather than merely renamed.
- [x] `iso-custom-map`: the iso Custom map is retired (ADR-0021 clause 6, slice h14) and
      `functional.mjs` asserts the iso layer is *gone* after the Wear. The Wear itself still
      ships, so the row names that check instead of being deleted.
- [x] Registered in `scripts/ci/test-estate.mjs` and run by `test:unit`; the library beside it is
      declared in both exclusion lists with its reason.
- [x] `npm run test:pre-merge-vertical` green

The `--stamp` CLI the contract's own note pointed at did not exist either. It does now, and
restamps in place rather than re-serializing the file.

## Notes

Do not close this by deleting the two rows without deciding what happened to each capability —
`clerk-profile-oauth` is an EP sign-in path and its absence from the suite is the more serious of
the two.
