# Spec — Factories → app end-state (PostDB delivery bus)

## Goal

Stop treating "committed to git" as "live in the app." Factories publish versioned
truth and display packs through PostDB; the app consumes exported delivery
artifacts, never git HEAD directly. See [map.md](map.md) for the destination,
ADR-0024 and ADR-0025 for the accepted decisions.

## Scope

1. PostDB schema + IO — append-only `truth_revisions`, promotable `venue_heads`.
2. Delivery export (`npm run venues:export`) from a promoted PostDB head to
   revision-pinned, same-origin bundle files under `apps/party-tracker/public/venues/`.
3. Delta sync — the phone fetches per-file deltas via `?since=<revision_id>`.
4. Display-schema CI gate on the exported bundle shape.
5. Delivery authority/trigger/bundle-shape (ticket 19): same-origin static,
   steward-run publish (no auto-export-on-certify), delta over full bundle.
6. Module seams — `map-factory/`, `visual-factory/`, `delivery/` behind
   `buildTruth`/`compileDisplay`/`publishBundle`, with CI-enforced
   dependency-cruiser import boundaries (ADR-0025).

## Out of scope

- Object storage (Cloudflare R2) — parked behind the `addVendorWhen` trigger
  ("Vercel transfer would bill"), not a v1 gap.
- Automatic export on every PostDB certify — steward publish only for v1.
- A second npm package for map/visual factories — deferred until the module
  boundaries prove stable.

## Acceptance

- ADR-0024 and ADR-0025 are Accepted and match shipped code (verified: PostDB
  schema/IO/sync/export exist and are exercised by tests; the app consumes
  venue-builder only through package entry points, not git HEAD).
- `apps/party-tracker/public/venues/*` bundles are populated by `venues:export`
  from a promoted PostDB head — not assumed to follow from `venues:build` alone.
- `npm run lint:boundaries` (dependency-cruiser) enforces the map-factory /
  visual-factory / delivery import boundaries in CI.
- Ticket 23 (truth certification) stays blocked on an owner decision (an LLM
  API key or licensed map images for `park_map_research`; an imagery-licensing
  call for `imagery_ledger` under ADR-0020) — tracked separately, not required
  for this spec.
