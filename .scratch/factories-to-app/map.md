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
- **Trains H/I complete** — do not start new H/I slices; remaining work is app integration (tickets 20–21).
- **Operating stack frozen** — Docker Postgres + CI `postgres:16` author-time; Vercel + Neon hosted; Cloudflare DNS only; Databricks PAUSED (`scripts/lib/operating-stack.json`).
- **Delivery v1** — same-origin blobs + API manifest; R2 deferred until Vercel transfer bills (pending ticket 19 grill).
- **Tickets 15, 18 resolved** — PostDB Slice 1 and display-schema gate shipped (#667).

## Not yet specified

- _(none — collapsed into spec.md 2026-08-27)_

## Out of scope

- Session-local resume caches (`.scratch/resume.json`) — stay gitignored.
- Kings Island G1–G5 visual acceptance (#700) — separate effort after this epic.
- Real-time PBR tier, generative fleet (Phase 8), Blender E.1.
