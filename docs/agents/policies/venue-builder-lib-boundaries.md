# venue-builder `lib/` internal boundaries

`packages/venue-builder`'s `package.json` only exports `src/` (3 files) as its public
interface — `lib/` (evidence engine, 19+ external-tool adapters, agent orchestration,
per-chain operators) is entirely internal, reached only through the `bin/` CLI entry
points. `.dependency-cruiser.cjs`'s package-level rules already stop anything *outside*
`venue-builder` from reaching into `lib/`'s internals. Nothing enforced the boundaries
*inside* `lib/` itself — until now.

## The four layers

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
4. **`lib/terrain/`** — Display-layer elevation maths (added 2026-08-18): the elevation
   grid, hillshade, the constraint solver, mesh export, and the DEM resolver. Reads
   *down* into `adapters/` for a DEM (`usgs-3dep`, `copernicus-dem`) and nothing else.

   Two directions matter here, and both are enforced rather than described:

   - **`adapters/` must not import `terrain/`.** The shared COG window reader lives at
     `adapters/cog.mjs`, not under `terrain/`, precisely so the DEM adapters and the
     terrain maths do not import each other. It was briefly the other way round and
     that was a cluster-level cycle the old rules could not see, because
     `venue-builder-adapters-are-leaf` only named `agents|operators`.
   - **`terrain/` must not import the evidence engine.** Height is not evidence — a
     ride entrance is at the same coordinate whether the ground under it is level or
     on a berm ([ADR-0015](../../adr/0015-terrain-in-display.md)). A terrain module
     importing `evidence.mjs` has started fusing elevation as if it were a claim about
     where something is, which is the failure the Truth/Display split exists to stop.

Core `lib/*.mjs` is nominally the base layer, but isn't a clean one: `build-pipeline.mjs`
and `venue-official-site.mjs` (plus `external-claims.mjs`, `external-research.mjs`,
`venue-certify.mjs`, `venue-packet.mjs`) all deliberately reach *down* into `agents/`,
`operators/`, or `adapters/` — that's the orchestration seam, not a violation.

## The rule

Enforced in `.dependency-cruiser.cjs` (`npm run lint:boundaries`), not written down as
prose alone — per this repo's own scripts-over-instructions policy:

- `lib/operators/` may never import `lib/agents/` or `lib/adapters/`.
- `lib/adapters/` may never import `lib/agents/`, `lib/operators/`, or `lib/terrain/`.
- `lib/terrain/` may never import `lib/agents/`, `lib/operators/`, or the evidence
  engine (`evidence.mjs` / `evidence-graph.mjs`). It reads `lib/adapters/` for a DEM
  and nothing else — height is a Display input, never a claim about where a Place is
  ([ADR-0015](../../adr/0015-terrain-in-display.md)).
- A core `lib/*.mjs` file reaching into `agents/`, `operators/`, or `adapters/` must be
  one of the six files already doing so (`build-pipeline.mjs`, `venue-official-site.mjs`,
  `external-claims.mjs`, `external-research.mjs`, `venue-certify.mjs`,
  `venue-packet.mjs`). A new file that needs the same reach adds itself to that
  allowlist deliberately, in the same PR that introduces the import — not silently.

This isn't a new npm package boundary (nothing outside `venue-builder` needed that
isolation — see the research that led here), just enough structure that the package
can keep growing (this session alone adds several new adapters) without `lib/`
collapsing into one undifferentiated import-anything blob.
