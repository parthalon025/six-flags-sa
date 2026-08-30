# Map — factories → app end-state

## Destination

Factories publish versioned truth and display packs through PostDB; the app consumes exported delivery artifacts (not git HEAD as the runtime bus). See ADR-0024 and ADR-0025.

## Notes

Committed wayfinder map for macro / Cloud resume fog tracking. Supersedes GitHub #625–630.

## Decisions so far

- Owner Round 1: PostDB bus ([ADR-0024](../../docs/adr/0024-postdb-factory-bus.md)), factory module seams ([ADR-0025](../../docs/adr/0025-factory-module-seams.md)), operating stack ([`scripts/lib/operating-stack.json`](../../scripts/lib/operating-stack.json)).
- Trains H and I: **built** (18/18 slices). Do not restart — factory epic is PostDB → Delivery (tickets 15–19).
- [Delivery closeout — authority, trigger, bundle shape](issues/19-delivery-closeout.md) (owner, 2026-08-25): delivery authority is **same-origin** static `public/venues/*.bundle.json` on Vercel (R2 deferred behind `addVendorWhen`); export trigger is **steward publish** — `venues:export` run by hand after a PostDB promote, no automatic job in v1; bundle shape at sync is **delta** via `?since=<revision_id>`.
- Epic NOW (machine-readable): tickets 15–21 resolved, epic merged to main. Remaining work is implementation only — see `npm run workflow:next`.

## Not yet specified

_Empty — the charted decision frontier is closed._ Every `Type: grilling` ticket on this map is
resolved; the open tickets are all `ready-for-agent` implementation work, which is why
`npm run workflow:next` derives phase `implement`.

## Out of scope

- Session-local resume caches (`.scratch/resume.json`) — stay gitignored.
