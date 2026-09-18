# Map — factories → app end-state

## Destination

Factories publish versioned truth and display packs through PostDB; the app consumes exported delivery artifacts (not git HEAD as the runtime bus). See ADR-0024 and ADR-0025.

## Notes

Committed wayfinder map for macro / Cloud resume fog tracking. Supersedes GitHub #625–630.

## Live status — run the tooling, don't read a stale snapshot here

This file used to hand-list ticket numbers and statuses. It drifted twice: once by a
few tickets (#19), once by sixteen (#20–35) — because nothing regenerates it when a
ticket is filed or resolved. The tickets themselves, and the tools that read them, are
the source of truth:

- `npm run workflow:next -- --effort factories-to-app` — current phase, frontier ticket, one-line epic summary
- `npm run train:next` — Trains H/I slice progress
- [`issues/`](issues/) — one file per ticket, `Status:` field per file, in filing order

## Stable decisions

- Owner Round 1: PostDB bus ([ADR-0024](../../docs/adr/0024-postdb-factory-bus.md)), factory module seams ([ADR-0025](../../docs/adr/0025-factory-module-seams.md)), operating stack ([`scripts/lib/operating-stack.json`](../../scripts/lib/operating-stack.json)).
- Trains H and I: **built**. Do not restart.
- [Delivery closeout — authority, trigger, bundle shape](issues/19-delivery-closeout.md) (owner, 2026-08-25): delivery authority is **same-origin** static `public/venues/*.bundle.json` on Vercel (R2 deferred behind `addVendorWhen`); export trigger is **steward publish** — `venues:export` run by hand after a PostDB promote, no automatic job in v1; bundle shape at sync is **delta** via `?since=<revision_id>`.

## Out of scope

- Session-local resume caches (`.scratch/resume.json`) — stay gitignored.
