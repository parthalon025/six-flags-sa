# Repository structure

This monorepo separates the **Park Bound** app from the **venue builder** pipeline.

Packages are deep modules — import only through entry points. See [packages/README.md](../packages/README.md).
Visual tour: [architecture-map.md](./architecture-map.md).

```
apps/party-tracker/     Next.js PWA — map, party sync, directions
packages/shared/        Contracts both sides share (ontology, wayFlags, mapSymbols)
packages/venue-builder/ OSM → venue bundle CLI, data, and inspection UI
scripts/                Repo automation (version bump, worktrees, GitNexus) — not the venue builder
test/app/               Playwright behavioural suites (functional, grandma, validate-ui, visual)
test/builder/           Node unit tests + manifest compare suite
docs/adr/  CONTEXT.md   Domain language (Matt layout)
```

## Commands

| Command | What it runs |
|---------|----------------|
| `npm run dev` | App dev server |
| `npm run build` | Production app build |
| `npm run venues:build` | Build a venue from OpenStreetMap |
| `npm run venues:compare` | Compare built bundles to manifest |
| `npm run venues:inspect` | Standalone builder inspection UI (port 3921) |
| `npm run test:builder` | Builder unit + compare tests |
| `npm run test:app` | Three-phone functional suite |
| `npm run test` | Both builder and app suites |

## Venue inspection

- **In app:** Settings → Venue inspection, or `/admin/venues`
- **Standalone:** `npm run venues:inspect` → http://127.0.0.1:3921

Built venues ship in `apps/party-tracker/public/venues/`. Source recipes and overrides live in `packages/venue-builder/data/venues/`.
