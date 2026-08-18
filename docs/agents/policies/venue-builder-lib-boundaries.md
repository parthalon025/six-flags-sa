# venue-builder `lib/` internal boundaries

`packages/venue-builder`'s `package.json` only exports `src/` (3 files) as its public
interface — `lib/` (evidence engine, 19+ external-tool adapters, agent orchestration,
per-chain operators) is entirely internal, reached only through the `bin/` CLI entry
points. `.dependency-cruiser.cjs`'s package-level rules already stop anything *outside*
`venue-builder` from reaching into `lib/`'s internals. Nothing enforced the boundaries
*inside* `lib/` itself — until now.

## The three layers

Surveyed from the real import graph (2026-08-18, zero cycles at the time):

1. **`lib/operators/`** — per-theme-park-chain attraction-listing parsers (Six Flags,
   Cedar Fair, Disney, Universal, generic). The deepest leaf: nothing in it imports
   anything outside itself.
2. **`lib/adapters/`** — wrap layers around external tools/services (Overpass-adjacent
   research adapters, Mapillary, Wikidata, RCDB, ...). Depends outward only on a
   handful of core files (`venue-io.mjs`, `venue-judge.mjs`, `parks-api-entities.mjs`,
   `tiles-export.mjs`, `evidence-graph.mjs`, `venue-validate-html.mjs`) — never on
   `agents/` or `operators/`.
3. **`lib/agents/`** — the LangGraph-shaped orchestration layer (research, GIS, vision,
   QA, validation agents, plus the orchestrator that wires them together). Sits above
   both: every agent imports `adapters/runner.mjs` (or `adapters/index.mjs`) plus
   various core files.

Core `lib/*.mjs` is nominally the base layer, but isn't a clean one: `build-pipeline.mjs`
and `venue-official-site.mjs` (plus `external-claims.mjs`, `external-research.mjs`,
`venue-certify.mjs`, `venue-packet.mjs`) all deliberately reach *down* into `agents/`,
`operators/`, or `adapters/` — that's the orchestration seam, not a violation.

## The rule

Enforced in `.dependency-cruiser.cjs` (`npm run lint:boundaries`), not written down as
prose alone — per this repo's own scripts-over-instructions policy:

- `lib/operators/` may never import `lib/agents/` or `lib/adapters/`.
- `lib/adapters/` may never import `lib/agents/` or `lib/operators/`.
- A core `lib/*.mjs` file reaching into `agents/`, `operators/`, or `adapters/` must be
  one of the six files already doing so (`build-pipeline.mjs`, `venue-official-site.mjs`,
  `external-claims.mjs`, `external-research.mjs`, `venue-certify.mjs`,
  `venue-packet.mjs`). A new file that needs the same reach adds itself to that
  allowlist deliberately, in the same PR that introduces the import — not silently.

This isn't a new npm package boundary (nothing outside `venue-builder` needed that
isolation — see the research that led here), just enough structure that the package
can keep growing (this session alone adds several new adapters) without `lib/`
collapsing into one undifferentiated import-anything blob.
