# UI enhancement validation

Use this workflow when changing anything a guest sees or taps: map chrome, bottom sheet, glance rail, navigation banners, party screens, search, gates, toasts, or touch targets.

The goal is **two lenses on the same build**:

1. **E2E functional suite** — does the app still do what it did? (regression, multi-phone party, routing, heights)
2. **Grandma test** — can a stranger get anything out of it without insider knowledge? (discoverability, copy, tap targets)

Neither replaces the other. Functional tests may use helpers like `go()` that know the tab bar; grandma tasks may **not**, because that would hide UX failures.

## Quick start (local)

```bash
npx playwright install chromium   # once
npm run build && npm start &      # wait for /api/health

npm run test:validate-ui          # functional + grandma
```

Partial runs:

```bash
npm run test:app                  # e2e only
npm run test:grandma              # grandma only
npm run test:validate-ui -- --functional-only
npm run test:validate-ui -- --grandma-only
```

Optional env:

- `BASE_URL` — default `http://127.0.0.1:3118` (not 3000 — dev servers fight for it)
- `CHROMIUM_PATH` — use a system Chromium instead of Playwright's download

## What each suite checks

### E2E functional (`test/app/functional.mjs`)

Three phones in one browser: host, code joiner, invite-link joiner. Covers:

- GPS gate, map geometry, glance rail, theme toggle
- Party create/join, NEED HELP, host migration when host leaves
- Walking directions (route preview, course-up map, arrival)
- Ride heights, venue switch, Cedar Point queue-entrance routing
- Console must stay clean on all phones

**Pass criteria:** zero failed checks.

### Grandma test (`test/app/grandma.mjs`)

Two personas, scored **0 / 1 / 2** per task (not just pass/fail):

| Persona | Scenario |
|---------|----------|
| **B — Solo** | At Fiesta Texas: find toilet/food without typing or deep scroll, category chips, search quality, walk route, sheet ergonomics, large reading & icon sizes, 44px tap targets, plain-English rider height |
| **A — Joiner** | Invite link / code join → appear on family map → find grandchild & device-less kids on roster → family meet-up → help flow |

**Pass criteria:**

- No task scores **0** (complete miss)
- Overall score ≥ **85%** of maximum
- No uncaught page errors on any persona phone

A score of **1** is a warning (e.g. "only after opening the panel") — fix before shipping if the task is on your critical path.

## CI

GitHub Actions workflow **Test app** is modular and change-scoped:

1. **Select modules** — `test/app/select-modules.mjs` maps the PR diff to modules in `test/app/modules.json` (push to `main` = full suite).
2. **Lint** — ESLint on party-tracker, when app JS/JSX, `eslint.config.mjs`, or ESLint deps change.
3. **Builder** — only when venue-builder / venue data paths change.
4. **UI matrix** — one job per selected module (`smoke`, `heights`, `walk`, `party`, `intake`, `venues`, `offline`, `grandma`), sharing one Next.js build artifact. Jobs run in parallel.
5. **Visual shots** — soft (`continue-on-error`), when any UI module runs.
6. **CI** — aggregator: skipped jobs are fine; a required job failure fails the check.

Local equivalents:

```bash
npm run test:modules                  # print modules for this branch vs origin/main
npm run test:validate-ui:changed      # only matching modules
npm run test:validate-ui -- --modules=party,grandma
npm run test:module-select            # unit test for the selector
```

UI PRs should not merge with a red **Test app** check for the modules they touch.

## When to add or extend tests

| You changed… | Extend… |
|--------------|---------|
| New tab, sheet state, or visible label guests must find | Grandma task (tap by visible text only) |
| Party/sync/routing/height logic | Functional check |
| Glance card layout or rail behaviour | Both — functional for state, grandma for discoverability |
| Pure CSS that does not change flows | `test:visual` or `test:theme`; run validate-ui if touch targets or contrast changed |
| A new area of the app | Path globs (and optional `pulls`) in `test/app/modules.json` |

### Adding a grandma task

1. Add a `score('B'|'A', 'id', 'plain-english task', async () => { … })` block in `test/app/grandma.mjs`.
2. Do **not** import or call `go()` inside persona tasks.
3. Prefer `tapText()`, `typeSearch()`, and `.tabItem[data-tab=…]` only when the tab label is visible to the user.
4. Return `2` (great), `1` (worked with friction), or `0` (failed).

### Adding a functional check

1. Add `await check('description', async () => { … })` in `test/app/functional.mjs`.
2. Reuse `openPhone`, `go`, `until` from `test/app/browser.mjs`.
3. Assert behaviour and DOM state, not screenshot pixels.

## Supplementary suites

| Script | Purpose |
|--------|---------|
| `npm run test:visual` | Screenshot baselines to `test/shots/` |
| `npm run test:theme` | Light/dark via real theme toggle |
| `npm run test:ux` | Glance rail with injected party (manual shots) |
| `npm run test:unit` | Pure logic in `test/builder/unit.mjs` (no browser) |

For a UI enhancement PR, **validate-ui is the required bar**; run visual/theme when appearance changed materially.
