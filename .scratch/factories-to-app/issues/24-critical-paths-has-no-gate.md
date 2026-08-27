# 24: critical-paths.json can claim coverage that does not exist

**What to build:** A gate asserting every `suite: functional` row in
`test/app/critical-paths.json` names a `check(...)` string that actually appears in
`test/app/functional.mjs` — then clear the two rows that fail it.

**Blocked by:** None

**Status:** ready-for-agent

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

- [ ] A test asserts every `suite: functional` row's `check` appears verbatim in
      `test/app/functional.mjs`, and fails on its own message before the fix makes it pass
- [ ] Rows naming a suite other than `functional` are checked against that suite's file, or the
      gate states plainly which suites it does not cover
- [ ] `clerk-profile-oauth` either gets its real check written, or the row is corrected to name
      the check that does cover it
- [ ] `iso-custom-map` is removed if the iso Custom map is retired (`h14`), or restored to a real
      check if it still ships
- [ ] Registered in `scripts/ci/test-estate.mjs` and in the suite that runs it
- [ ] `npm run test:pre-merge-vertical` green

## Notes

Do not close this by deleting the two rows without deciding what happened to each capability —
`clerk-profile-oauth` is an EP sign-in path and its absence from the suite is the more serious of
the two.
