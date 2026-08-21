# Trains H and I — derive the plan, don't remember it

Trains H (zoomable worlds, ADR-0019 as amended by ADR-0021) and I (imagery
ground truth, ADR-0020) are built slice by slice across many sessions. A cloud
session's container is reclaimed when it ends, so the next session starts
knowing nothing about the last one.

**Start by asking the tree, not by reading a checklist:**

```
npm run train:next     # the session brief: what is startable, and how to run it
npm run train:plan     # the full board: built / ready / waiting / blocked
node scripts/train-plan.mjs blocked   # the questions that are the owner's
```

Doneness is not stored anywhere. Every slice in `scripts/lib/train-plan.mjs`
carries a `probe` — a predicate over the working tree — and `status()` runs
them. That is deliberate: a hand-maintained checklist drifts the moment someone
lands a slice and forgets to tick it, and a plan that lies sends the next
session to rebuild what already exists.

## Rules

- **Never mark a slice done.** There is nothing to mark. If a slice you finished
  still reads unbuilt, either it is not finished or its probe is wrong — say
  which, in the PR, rather than editing the probe to agree with you.
- **A probe checks reachability, not existence.** `wiredInto` is the common
  case: a module that nothing imports is not built. Satisfy what a probe is
  looking for, never the literal string it greps.
- **Never answer a blocked decision.** `DECISIONS` records them verbatim from
  ADR-0021's Open section. `next()` withholds a blocked slice even when its
  dependencies are met, because building it would decide the question. Work
  around it and leave it for the owner.
- **Fan out with the workflow, integrate yourself.** `.claude/workflows/train-slices.mjs`
  takes the startable rows and gives each slice its own worktree and an
  adversarial verifier. Lanes must not touch `package.json`, `scripts/ci/manifest.mjs`,
  or any shared registry — a lane that needs wiring reports `NEEDS WIRING` and
  the integrator lands it. Seven suites once shipped that nothing ran because
  every lane correctly called the wiring someone else's job.
- **One mega PR.** Slices accumulate on `claude/train-h-i-quiz-nxieu1` and merge
  only when the trains are complete.

## Adding a slice

Add it to `SLICES` with a `probe`, and add a before/after fixture to
`test/scripts/train-plan.test.mjs` — the suite fails a slice without one. The
fixture is where "done" is written down concretely enough to argue with, and it
is the only thing proving the probe can move. Conjunctive probes get one
`before` per clause, so a probe that quietly drops half of what it claims to
check fails on the clause it dropped.
