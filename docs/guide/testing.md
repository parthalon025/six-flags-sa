# Tests

[← README](../../README.md) · [Guide index](index.md)

```bash
npx playwright install chromium     # once
npm run test:unit                   # pure layers, no browser, seconds
npm run build && npm start &
npm test                            # unit, then the three-phone behavioural suite
npm run test:validate-ui            # e2e functional + grandma (required for UI changes)
npm run test:visual                 # screenshots to test/shots/
npm run test:theme                  # daylight and night, via the real toggle
npm run test:ux                     # glance rail with a live party
npm run test:grandma                # can a stranger actually use it
npm run readme:shots                # README stills + walkthrough.mp4 (app must be running)
npm run readme:shots:check          # gallery files exist, linked, and not stale vs --base
```

`test/unit.mjs` exercises the pure layers directly: version arithmetic, duplicate
suppression, seal/open against wrong keys and tampered ciphertext, the election ordering,
every GPS cadence band and broadcast-gate reason, and the router — the last of those
against the real park file rather than a fixture, because a graph that routes perfectly
over a toy and badly over Kings Island is the failure worth catching. Venue selection,
the OpenStreetMap tag rules and the geometry helpers the builder leans on are in there
too. So is the map's own layout logic: the decluttering grid checked against brute force,
glyph art checked to stay inside the shape drawn round it, every named piece of coaster
track checked to belong to a ride in that venue's catalogue, and the scale bar checked to
span the distance it claims at every zoom the map allows.

`test/functional.mjs` is the one that matters. Three phones in one browser: A hosts, B
joins by typing the code, C joins from the invite link, then A is taken away and the
other two have to keep the party alive between them. Phone A also walks to The Beast on
the way through — offered the route, picks a different one, starts, checks the map has
turned course-up, walks until the distance drops, opens the steps and arrives. It asserts on behaviour, not
appearance — that the key never leaves the URL fragment, that a party id is not its code,
that NEED HELP reaches the other phone, that the roster never collapses while the host is
replaced, and that the map and ride heights still work with the network cut. A fifth phone
sits in Austin, at neither park, to check that the intake asks about the nearer one, that
saying yes brings that park's places with it, and that it is not asked again.

`test/grandma.mjs` asks a different question from the other two. They ask whether the app
still does what it did; this asks whether an actual non-technical, older first-time visitor
can get what they need without having to search or deep scroll, with readable font sizes,
large icons, clear family/grandchild visibility, and big 44px tap targets. Two people are scored
separately — one on her own who needs a toilet, then food, then to walk there, and one who has
been handed a link and has to appear on her family's map, find a grandchild, see the meet-up, and
be able to call for help. Tasks score 0, 1 or 2, because "she got there after opening the panel" is a
different result from "she got there first try", and a suite that cannot tell those apart cannot tell
you whether the app improved.

The rule that keeps it honest: **its persona tasks may not use the `go()` helper**. That
helper knows where the tab bar is and pulls the sheet open by its handle, which are exactly
the two things she does not know. She taps things whose words she can read, and if nothing
on screen says it, that is the finding rather than a broken test. A single task scoring
zero fails the run.

All the suites take `BASE_URL`, and `CHROMIUM_PATH` points them at a browser already on the
machine instead of Playwright's own copy.

For UI work, see [docs/ui-enhancement-validation.md](../ui-enhancement-validation.md) —
`npm run test:validate-ui` runs the critical-path coverage contract, then the
functional e2e suite and the grandma test together. The contract
(`test/app/critical-paths.json`) is the middle ground: not every UI action, but
every shipped vertical capability (intake, walk, party, offline, grandma toilet
path) must keep a named check. New epics add a row + check in the same PR —
build vertically, don’t leave feature PRs without their user-action coverage.

CI splits that suite into **modules** (`test/app/modules.json`) and only runs
the ones that match the PR’s changed paths — including lint — see
`npm run test:modules` / `npm run test:validate-ui:changed`. Docs-only diffs
skip the expensive jobs. Push to `main` and edits to the workflow or
`functional.mjs` still run the full matrix.

Vercel preview deploys are **not** the default validation path — they consume the
user-reserved deploy budget (25/day). Use `npm run build -w @party-tracker/app` and the
suites above; see [contributing.md](contributing.md#vercel-deploys) and
`scripts/lib/vercel-ignore.mjs`.

---
[← README](../../README.md) · [Guide index](index.md)
