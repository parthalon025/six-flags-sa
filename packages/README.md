# Packages

Each package is a **deep module**: a lot of behaviour behind a small **interface**. Callers import only a package's **entry points** (its root files). Anything in a subfolder is private. Do not add a barrel `index.js` that re-exports a whole subtree — expose several small entry points instead.

```
packages/
  <name>/
    index.ts        ← an entry point (public). Import this from outside.
    client.ts       ← another entry point. Packages may expose several.
    lib/            ← implementation: hidden from outside, free to import each other.
    tests/          ← co-located tests + fixtures (a subfolder, so private).
```

`packages/example/` is a copy-me starter. Copy it for a new package, or delete it.

Check the seams with `npm run lint:boundaries` (dependency-cruiser). That runs as part of `npm run lint`.

Layout: [docs/repo-structure.md](../docs/repo-structure.md). Visual tour: [docs/architecture-map.md](../docs/architecture-map.md).

## The four rules

**Entry-point boundary.** Code outside a package (app code or another package) may import only that package's entry points, never anything in its subfolders.

**Intra-package freedom.** A package's own files import each other freely. Depth lives behind the interface; internals may nest as deep as they need.

**Tests through the entry points.** Files under `<pkg>/tests/` may import any package's entry points and their own `tests/` fixtures, but never any package's subfolder internals — not even their own. The interface is the test surface.

**No cycles.** No dependency cycles.

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

`lib/` is implementation. `bin/` and `src/` are subfolders, so other packages must not import them — reach CLIs with `npm run venues:*`. `data/venues/<id>/` is builder **input** (hand-edit). The phone app must not import this package.

Shipped venue JSON is builder **output** under `apps/party-tracker/public/venues/` plus generated `apps/party-tracker/lib/venueIndex.js`. Fix output at the source, then regenerate — see the builder ↔ app contract in `AGENTS.md`.
