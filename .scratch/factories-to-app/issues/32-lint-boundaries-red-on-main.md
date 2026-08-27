# 32: the pre-merge gate cannot pass — lint fails before a single test runs

**What to build:** Clear seven dependency-boundary violations so `npm run test:pre-merge-vertical`
reaches its test legs.

**Blocked by:** None

**Status:** ready-for-agent

## Evidence

`npm run test:pre-merge-vertical` exits **7** at its first leg, `npm run lint` →
`lint:boundaries` → `depcruise apps packages scripts test`:

```
x 7 dependency violations (7 errors, 0 warnings). 997 modules, 2846 dependencies cruised.
```

**Pre-existing on `origin/main`** — I ran `depcruise` in a detached worktree at `origin/main` and
got the identical seven, same order. Nothing on this branch caused any of them.

The consequence is the important part: the gate has been failing at lint, so **every test leg
behind it — the app verticals, the browser checks, the builder suite — has not been running in
the local gate at all.** That is how six independent logic reds (tickets 25, 26, 28 and three
more) accumulated on `main` unnoticed.

## The seven, in three kinds — they do not share a fix

### A — core reaching into `adapters/` (3, allowlist by design)

```
venue-io.mjs        → adapters/_cache.mjs
inventory-gaps.mjs  → adapters/queue-times.mjs
inventory-gaps.mjs  → adapters/parks-api.mjs
```

Rule `venue-builder-core-orchestration-is-sanctioned` carries a `pathNot` allowlist and its own
comment says the intended remedy: *"a new core file that needs the same reach adds itself here
deliberately rather than importing silently."* So registration is the sanctioned move — **but
only after confirming each import is genuinely orchestration.** An accidental import that should
have gone through a seam must be fixed, not registered. Decide per file and say which.

### B — real cycles (2, actual restructuring)

```
venue-io.mjs      → venue-sources.mjs   → venue-io.mjs
adapters/_cache.mjs → venue-io.mjs      → adapters/_cache.mjs
```

`no-circular` has no allowlist and should not grow one. Both cycles run through `venue-io.mjs`,
which suggests it is carrying responsibilities that belong on either side of a seam. Break the
cycle; do not suppress the rule.

### C — importing package internals from outside (2)

```
test/scripts/venue-builder-guide.test.mjs → packages/venue-builder/lib/build-pipeline.mjs
scripts/lib/builder-app-contract.mjs      → packages/venue-builder/lib/delivery/builder-app-contract.mjs
```

`entrypoint-boundary-from-app` already exempts `test/builder/` as a documented white-box suite
(see `packages/README.md`, #476). These two are not in that suite. Either route them through the
package's exported entry point, or extend the exemption **with the same kind of written
justification the existing one carries** — not a bare path added to a list.

## Acceptance

- [ ] `npm run lint:boundaries` → 0 violations
- [ ] No rule's `severity` lowered, and `no-circular` gains no exemption
- [ ] Each allowlist entry, if any, carries a comment saying why that file legitimately needs the
      reach
- [ ] `npm run test:pre-merge-vertical` runs **past lint** and to completion, and
      `scripts/ci/local-ci-pass.json` `head` equals `git rev-parse HEAD`
- [ ] `npm run test:builder` and `npm run test:unit` stay green

## Notes

Read `packages/README.md` and `docs/repo-structure.md` first — packages are deep modules here, and
the entry-point rule is the mechanism that keeps them deep. The cycles in B are the real work; A
and C are judgement calls about which side of a seam a file belongs on.
