# Vertical e2e with output validation

**All code work ships proven end to end, with the run's output asserted.** Not "the tests I added pass" — the change exercised through the stack it ships in, and assertions over what that run produced.

The gate is `scripts/lib/vertical-e2e.mjs`, enforced by `npm run test:pre-merge-vertical` and recorded in `scripts/ci/local-ci-pass.json`. Read the `VERTICALS` table there for the current map of paths → command → the output that command validates. This file is the judgment the script cannot make.

That record is also the `local-ci-verified` tag: a run that proved every vertical this diff owes lets GitHub skip the jobs it already ran ([CI](../ci.md#local-ci-verified--skipping-github-ci)). Which is the point — the pre-merge run is not a tax on top of CI, it *is* CI, run where the code is.

## The two words

**Vertical** — the change run in the real thing: a browser against the production build, the builder over real venue data, the workflow entry points CI actually calls. A test that stops at the seam you changed is a unit test. Units are necessary and never sufficient; they are the floor of the pre-merge run, not the proof.

**Output validation** — assertions over what the run produced: DOM and behaviour, the generated venue files, the decision a script returned. An exit code is not output. "The server started", "the command didn't throw", "the screenshot was written" — none of those read the output, so none of them validate it.

## Before you call code work done

1. `npm run test:pre-merge-vertical` — it prints the verticals your diff owes, runs them, and refuses to stamp a pass when one did not run.
2. Every vertical it names must actually run. `--skip-browser` is refused for diffs that touch app behaviour: static steps prove the build compiles, not that a guest can still use it.
3. If the run is green but nothing in it would have failed had your change been wrong, the vertical is decorative — fix the test, not the gate.

## Adding to the map

A new area of the repo, or a new way to ship: add a row to `VERTICALS` with its `command` and its `validates`. If you cannot fill `validates` with output a suite actually reads, it is not a vertical yet — write the assertion first.

Machine-written diffs owe nothing: post-merge version stamps and the session-local GitNexus index are not behaviour, and are exempt exactly as they are in module selection.

Code the map does not claim fails closed: the diff owes *every* vertical until a row claims it. That is deliberate — a hole in the map must cost more than filling it.

## Where the assertions go

| The change touches… | Assert on… |
|---------------------|------------|
| Guest-visible behaviour | a functional check in `test/app/functional.mjs`, and a grandma task when discoverability is the point ([ui-enhancement-validation.md](../../ui-enhancement-validation.md)) |
| A shipped vertical capability | a named row + check in `test/app/critical-paths.json` — a written inventory a reviewer reads, not a gate; new epics add theirs in the same PR |
| Venue generation | the regenerated files, via `test/builder/` — never the builder internals ([builder-app-contract policy](./builder-app-contract.md)) |
| CI, deploy or stamp decisions | the exported function's return value, via `test/scripts/*.test.mjs` wired into `scripts/ci/manifest.mjs` |
| A new suite anywhere under `test/` | itself — add it to a run list in `scripts/ci/test-estate.mjs`, or record why nothing runs it |

## Never

- Never stamp, waive, or `--skip-browser` past a vertical because it is slow or the environment is awkward. Fix the environment, or say in the PR that the change is unproven.
- Never widen a `VERTICALS` path glob to make a diff select fewer verticals.
- Never let a suite assert only that something ran.
