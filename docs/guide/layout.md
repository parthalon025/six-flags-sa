# Layout

[← README](../../README.md) · [Guide index](index.md)

Visual overview: [docs/architecture-map.md](../architecture-map.md).
Package seams: [packages/README.md](../../packages/README.md).
Short tree: [docs/repo-structure.md](../repo-structure.md).

```
apps/party-tracker/          phone PWA (Next.js)
  app/  components/  lib/    UI, domain, party mesh
  public/venues/             generated map + POI JSON (do not hand-edit)
packages/shared/             contracts both runtimes import (ontology, wayFlags, mapSymbols)
packages/venue-builder/      OSM → venue bundle
  bin/                       CLIs (`npm run venues:*`)
  lib/                       implementation (private)
  data/venues/<id>/          builder input — overrides, recipe, heights, attractions
scripts/                     repo automation (version bump, worktrees, GitNexus)
test/app/  test/builder/
docs/adr/  CONTEXT.md        domain language (Matt layout)
ios/  android/  fastlane/    store shells — see [fastlane/README.md](../../fastlane/README.md)
```

Phone-layer file names (under `apps/party-tracker/`) are in the architecture map, not restated here.

---
[← README](../../README.md) · [Guide index](index.md)
