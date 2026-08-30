# 35: the pre-merge gate reports ok — and stamps — while real code work sits uncommitted

**What to build:** Make `pre-merge-vertical` refuse to report a pass, and refuse to write
`local-ci-pass.json`, when the working tree carries uncommitted code changes the run did not
prove. Either fail closed on a dirty tree, or include the working tree in the diff it plans from.

**Blocked by:** None

**Status:** ready-for-agent

## Evidence

Observed live on 2026-08-29 while fixing the delivery delta pin. Four files were modified in the
working tree — two of them shipped builder code — and the gate said this:

```
pre-merge-vertical: verticals required — none (no code work in this diff)
pre-merge-vertical: static steps — none
pre-merge-vertical: no code work in this diff — skipping static floor and verticals

pre-merge-vertical: ok
```

It then wrote the stamp. Committing the same four files and re-running produced
`verticals required — builder`, which is the honest answer.

The cause is that the gate plans from the **committed** diff only:

```
scripts/ci/pre-merge-vertical.mjs:71  export function gitChangedFiles(baseRef = 'origin/main', …)
scripts/ci/pre-merge-vertical.mjs:79    git diff --name-only ${mergeBase}...HEAD
```

and the empty-diff branch treats "nothing committed" as "nothing to prove", then stamps it:

```
scripts/ci/pre-merge-vertical.mjs:167  'pre-merge-vertical: no code work in this diff — skipping static floor and verticals'
scripts/ci/pre-merge-vertical.mjs:171  writeLocalCiPass({ context, browserVertical: false, verticals: [] }, cwd);
```

`grep -n 'dirty\|status --porcelain\|uncommitted\|isClean'` across `scripts/ci/pre-merge-vertical.mjs`,
`scripts/lib/local-ci-pass.mjs` and `scripts/lib/vertical-e2e.mjs` returns nothing — there is no
dirty-tree guard at any layer.

The stamp it wrote, over a committed one that recorded real coverage:

```
-  "diffHash": "983ee5831b63da91",   →  "e3b0c44298fc1c14"   (the empty-input hash)
-  "head": "551a3eb…"                →  mergeBase == head == 2a97bdc
-  "modules": [ …13 modules… ]       →  []
-  "verticals": ["backside"]         →  []
-  "staticSteps": ["test:ci-gate"]   →  []
```

## Why this matters

**Not** because CI would skip work it should have run. The stamp is keyed by `diffHash`, computed
with the stamp files excluded (`scripts/lib/local-ci-pass.mjs:172`, documented at :10-12), so a
stamp recorded against the empty diff is only ever honoured for the empty diff. An earlier reading
of this as "CI skips real jobs" was wrong.

The damage is to the two things the gate exists to provide:

1. **A false green.** `pre-merge-vertical: ok` is the sentence an agent or a human reads before
   deciding the work is proven. Printed over unproven code in the tree, it says the opposite of the
   truth. The vertical-e2e policy's own words — "If the run is green but nothing in it would have
   failed had your change been wrong, the vertical is decorative" — describe this exactly: the run
   was green and *nothing in it ran at all*.
2. **It destroys a committed record.** `local-ci-pass.json` is repo truth about what was proven for
   a real diff. A no-op run silently replaces it with an empty record, so the file has to be reverted
   by hand or the branch carries the downgrade. That also dirties the tree on a run that did nothing,
   the same class of noise as
   [ticket 34](./34-test-run-dirties-tracked-fixture.md) — and it lands on the file whose whole job
   is to be trustworthy.

The failure is quiet in the worst way: the more natural the workflow (edit, run the gate, then
commit), the more reliably it fires.

## Acceptance

- [ ] Decide and record which way it should go: **fail closed** on a dirty tree ("commit first, the
      gate plans from commits"), or **plan from the working tree** so uncommitted code owes its
      verticals. Fail-closed is the smaller change and matches how `diffHash` already works.
- [ ] With uncommitted code changes present, `npm run test:pre-merge-vertical` does **not** print
      `ok` and does **not** write `scripts/ci/local-ci-pass.json`.
- [ ] A genuinely empty diff (clean tree, nothing ahead of merge-base) still passes and still stamps
      — the no-op path is legitimate, it is only the dirty-tree case that is not.
- [ ] Assert on the exported function's return value in `test/scripts/*.test.mjs`, wired into
      `scripts/ci/manifest.mjs` — the decision the script returns, not its exit code
      (vertical-e2e policy, "CI, deploy or stamp decisions").
- [ ] A run that aborts before completing its verticals leaves the existing stamp untouched rather
      than downgrading it.
- [ ] `npm run test:pre-merge-vertical` green.

## Notes

Found while working the delivery delta pin, not by looking for it — the gate was run before the fix
was committed, which is the ordinary order of operations. Sibling of
[ticket 34](./34-test-run-dirties-tracked-fixture.md) (a test run rewriting a tracked fixture): both
are "a routine local run dirties committed truth", and both make `git status` stop meaning anything.
Fixing them together may be cheaper than fixing either alone.
