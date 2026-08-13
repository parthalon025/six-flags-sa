# Packages

Each package is a **deep module**: callers import only its **entry points**. Anything in a subfolder is private. Do not add a barrel `index.js` that re-exports a whole subtree — expose several small entry points instead.

Layout: [docs/repo-structure.md](../docs/repo-structure.md). Visual tour: [docs/architecture-map.md](../docs/architecture-map.md).

## `shared` (`@party-tracker/shared`)

Entry points are the root files listed in `package.json` `exports`:

- `ontology.js` / `ontology.json`
- `wayFlags.js`
- `mapSymbols.js`
- `schemas.js`

Import them as `@party-tracker/shared/ontology.js` (and the other export paths). The phone may re-export the same modules from `apps/party-tracker/lib/` so existing relative imports keep working — do not copy the implementation.

## `venue-builder` (`@party-tracker/venue-builder`)

Public surface:

- `bin/*.mjs` — CLIs, reached with `npm run venues:*` from the repo root
- `src/paths.mjs` and `src/compare.mjs` — the `package.json` `exports`

`lib/` is implementation. `data/venues/<id>/` is builder **input** (hand-edit). The phone app must not import this package.

Shipped venue JSON is builder **output** under `apps/party-tracker/public/venues/` plus generated `apps/party-tracker/lib/venueIndex.js`. Fix output at the source, then regenerate — see the builder ↔ app contract in `AGENTS.md`.
