# Map — factories → app end-state

## Destination

Factories publish versioned truth and display packs through PostDB; the app consumes exported delivery artifacts (not git HEAD as the runtime bus). See ADR-0024 and ADR-0025.

Full spec: [`spec.md`](./spec.md)

## Notes

Committed wayfinder map for macro / Cloud resume fog tracking. Supersedes GitHub #625–630.

## Decisions so far

- **PostDB is the factory bus** (ADR-0024, owner Round 1) — git holds inputs/code; factory outputs live in Postgres.
- **Three module seams** in one package: `map-factory/` · `visual-factory/` · `delivery/` (ADR-0025).
- **Phone contract locked** — hash manifest, truth/display split, `planBundleSync`; delta via `?since=revision_id` (ticket 17).
- **Trains H/I complete** — guest Train H gaps shipped (tickets 20–21, PRs #714–#716).
- **Scoped bundle sync** — boot uses `floor` scope; overview/close pyramid bands are guest opt-in only (ADR-0021 §5, ticket 21).
- **Band crossfade** — `createBandViewport` in ParkMapGl; parent placeholder + pitch staging off band handoffs (ticket 20).
- **Delivery v1 complete** — PostDB export → Vercel same-origin blobs → hash-verified app cache (ADR-0024 Slice 1). R2 only when Vercel transfer bills (`addVendorWhen`, ticket 19 resolved).
- **Operating stack frozen** — Docker Postgres + CI `postgres:16` author-time; Vercel + Neon hosted; Cloudflare DNS only; Databricks PAUSED (`scripts/lib/operating-stack.json`).
- **Tickets 15, 18 resolved** — PostDB Slice 1 and display-schema gate shipped (#667).

## Not yet specified

- _(none — epic complete; PR stack merge pending)_

## Out of scope

- Session-local resume caches (`.scratch/resume.json`) — stay gitignored.
- Kings Island G1–G5 visual acceptance (#700) — separate effort after this epic.
- Real-time PBR tier, generative fleet (Phase 8), Blender E.1.
