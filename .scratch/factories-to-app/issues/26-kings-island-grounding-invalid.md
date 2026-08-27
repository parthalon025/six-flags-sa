# 26: kings-island committed grounding record does not validate

**What to build:** Make `packages/venue-builder/data/venues/kings-island/display/grounding.json`
satisfy `validateGrounding`, and make the relationships check survive a record that is missing the
object it reads.

**Blocked by:** None

**Status:** ready-for-agent

## Evidence

`node test/builder/display-grounding.mjs` — **36 passed, 2 failed**:

```
FAIL the record carries relationships, never geometry or names
     -> Cannot convert undefined or null to object
FAIL every committed record validates and still matches the truth it was measured on
     -> kings-island: committed grounding does not validate
```

`test/builder/display-grounding.mjs:739` asserts `validateGrounding(record)` returns no errors for
every venue carrying a `display/grounding.json`. kings-island's committed record fails it.

The first failure is a different shape of problem: `Cannot convert undefined or null to object` is
an `Object.keys`/`Object.entries` on something absent — the check crashes rather than reporting
what is wrong with the record. A gate that dies on malformed input cannot tell you which
relationship is bad.

## This is pre-existing on main

Confirmed by checking out `origin/main` into a detached worktree and running the test there:
**identical two failures**. Neither this branch's delivery-export work (`c7a737d`) nor the
cedar-point override fix touches it — the test reads
`packages/venue-builder/data/venues/*/display/grounding.json`, and no commit on this branch
modifies any builder-side venue data.

## Standing of `test:builder` on main

Three independent reds, of which two are now closed on this branch:

| Failure | Status |
|---|---|
| `delivery-bundle-revision-gate` — seed bundles missing `basedOn.revisionId` | fixed, ticket 16 (`c7a737d`) |
| `unit.mjs` — cedar-point overrides with no POI to land on | fixed, ticket 25 |
| `display-grounding.mjs` — kings-island grounding invalid (×2) | **this ticket, still red** |

Until this closes, `npm run test:pre-merge-vertical` cannot stamp on any branch cut from `main`.

## Acceptance

- [ ] `validateGrounding` returns no errors for kings-island's committed record
- [ ] The relationships check reports a useful failure instead of throwing on an absent object,
      and a test covers the malformed-record case
- [ ] `node test/builder/display-grounding.mjs` — 38 passed, 0 failed
- [ ] `npm run test:builder` green
- [ ] `npm run test:pre-merge-vertical` runs to completion and stamps
      (`scripts/ci/local-ci-pass.json` `head` equals `git rev-parse HEAD`)

## Notes

Find out **why** the committed record drifted from what `validateGrounding` expects before
regenerating it — a record that was written by a pipeline the validator no longer agrees with is a
contract break worth naming, not just a stale file to rebake.
