# 34: A test run rewrites a tracked fixture, so "dirty tree" stops meaning anything

**What to build:** Stop the builder suite leaving `fixture-park/google-places-cache.json` modified
in the working tree.

**Blocked by:** None

**Status:** resolved

## Evidence

Running the builder tests leaves exactly one tracked file dirty, every time:

```
 M packages/venue-builder/data/venues/fixture-park/google-places-cache.json
```

The whole diff is a timestamp:

```diff
-  "fetched": "2026-08-27T08:52:29.209Z",
+  "fetched": "2026-08-28T00:21:15.163Z",
```

`packages/venue-builder/lib/adapters/google-places.mjs:74` stamps `fetched: new Date()
.toISOString()` and line 78 calls `writeCache(id, 'google-places', out)`. The adapter has an
`ctx.offline` path (line 39) that returns cached claims **without** writing — the fixture run is
not taking it.

## Why it is worth fixing

It is one timestamp, so it is tempting to shrug at. The cost is that the working tree is dirty
after every run, which trains everyone — human and agent — to treat a dirty tree as normal noise
and `git checkout --` it away without reading. In this session alone three separate actors
(two subagents and me) independently hand-reverted this file to get a clean commit. Any *real*
unintended change riding alongside it would have been discarded with the same reflex, unread.

A test that mutates tracked state is also a test whose second run starts from different inputs
than its first.

## The sibling adapters — checked, and what was done about them

`writeCache` is called non-injectably, with an inline `new Date().toISOString()`, by
`parks-api`, `queue-times`, `mapillary-api`, `mapillary-video`, `guest-traces`,
`open-meteo`, `openhistoricalmap`, `openrouteservice`, `project-sidewalk`, `rcdb`,
`ropedrop`, `wikidata`, `accessibility-cloud`, `esa-worldcover`, `naip-planetary` and
`overture-buildings`. So the *shape* is everywhere.

None of them dirties the tree: a full `npm run test:builder` leaves
`git status --porcelain` empty once google-places is fixed, because no suite drives them
against a tracked venue with a live-looking key. Retrofitting a sink into sixteen adapters
no test exercises would be sixteen seams added for a need nothing has — the speculative
generality the standards pass exists to catch.

So the pattern is closed by a gate rather than by a sweep. `scripts/lib/tree-mutation.mjs`
snapshots tracked state around pre-merge-vertical's test legs and refuses to stamp a pass
over a run that rewrote its inputs, naming the files and saying to inject the sink. That
covers every adapter in the list above, and every one written after it — including the case
this ticket could not have anticipated. The adapter that *did* write gets the seam; the
fifteen that might get the alarm.

## Acceptance

- [x] `npm run test:builder` leaves `git status --porcelain` empty
- [x] The fix is in how the fixture run reaches the adapter — the cache sink and the clock are
      injectable, same shape as `writeOsmProposalFile`'s `write`, and the suite passes a sink.
      The `offline` path was not usable: the test asserts the fetch path's claims, which that
      path skips. Nothing is gitignored and nothing is reverted in a teardown.
- [x] `fetched` still records real fetch time on a genuine run — the first run stubs only the
      sink, and the stamp it captures is asserted to fall between a `Date.now()` taken before
      and after the call; a second run with an injected clock is asserted to carry that instant
      instead. The default is proven unpinned rather than assumed.
- [x] `npm run test:pre-merge-vertical` green
- [x] Sibling adapters checked — see above; closed with a gate, not a sweep

## Notes

Adapter: `packages/venue-builder/lib/adapters/google-places.mjs`, cache plumbing in
`adapters/_cache.mjs`. Check whether the sibling adapters that also carry `*-cache.json` fixtures
(`parks-api`, `queue-times`, `mapillary`, …) have the same shape — this is likely one instance of
a pattern, and the ticket should close the pattern, not just this file.
