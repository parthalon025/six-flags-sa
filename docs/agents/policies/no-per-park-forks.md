# No per-park forks

Every venue is the same data about a different place (`packages/venue-builder/lib/venue-checklist.mjs`). The app reads that data; it does not branch on which park is open.

## What counts as a fork (reject in review)

- **Venue-id conditionals in app code** — `if (venueId === 'kings-island')`, `switch (venue.slug)`, or equivalent runtime branches that change behavior per park.
- **Per-park components or CSS** — duplicated screens, copied components, or stylesheet forks scoped to one venue instead of driven by venue JSON or display packs.
- **Copied app variants** — a second route tree, feature flag, or build target that exists only to serve one park.

These are forks even when the change is "small" or "temporary." Park-specific behavior belongs in data, not in divergent app code paths.

## Sanctioned alternatives

| Need | Put it here |
|------|-------------|
| One-off height, area, alias, recipe | `packages/venue-builder/data/venues/<id>/` (`overrides.json`, `sources.json`, `recipe.json`, …) |
| How a Zone is painted | `packages/venue-builder/data/venues/<id>/display/` (grounding, zone-character, display packs) |
| Reusable park-family behavior | Builder pipeline stages, OSM tag rules, operator parsers |
| Shared template for a class of parks | Config templates and ingest checklists (#344) — not app forks |
| Runtime appearance | Display packs and venue bundle fields the app already reads generically |

See also the [builder ↔ app contract](./builder-app-contract.md) — generated venue output is never hand-edited in the app tree.

## Review checklist

Before approving a PR that touches `apps/party-tracker/`:

1. Does any new branch key off a specific `venueId`, park name, or operator slug?
2. Could the behavior be expressed as venue JSON, an override, or a display-pack field instead?
3. If the answer to (1) is yes and (2) is no, the PR needs a redesign — not a merge with a TODO.

## Agents

When proposing app changes, default to venue-agnostic interfaces. If you reach for a per-park conditional, stop and move the variation into builder input or bundle schema instead.

**After editing:** add or update the policy in `scripts/lib/agent-docs/manifest.json`, then run `npm run agent-docs:build`.
