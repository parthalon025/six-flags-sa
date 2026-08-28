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

## Acceptance

- [x] `npm run test:builder` leaves `git status --porcelain` empty
- [x] The fix is in how the fixture run reaches the adapter — take the existing `offline` path, or
      inject the clock — not by gitignoring the file or by reverting it in a test teardown, both of
      which keep the write and only hide it
- [x] `fetched` still records real fetch time on a genuine (non-fixture) run, and a test proves
      that distinction rather than assuming it
- [ ] `npm run test:pre-merge-vertical` green

## Notes

Adapter: `packages/venue-builder/lib/adapters/google-places.mjs`, cache plumbing in
`adapters/_cache.mjs`. Check whether the sibling adapters that also carry `*-cache.json` fixtures
(`parks-api`, `queue-times`, `mapillary`, …) have the same shape — this is likely one instance of
a pattern, and the ticket should close the pattern, not just this file.
