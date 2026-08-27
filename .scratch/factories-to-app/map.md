# Map — factories → app end-state

## Destination

Factories publish versioned truth and display packs through PostDB; the app consumes exported delivery artifacts (not git HEAD as the runtime bus). See ADR-0024 and ADR-0025.

## Notes

Committed wayfinder map for macro / Cloud resume fog tracking. Supersedes GitHub #625–630.

## Decisions so far

- Owner Round 1: PostDB bus ([ADR-0024](../../docs/adr/0024-postdb-factory-bus.md)), factory module seams ([ADR-0025](../../docs/adr/0025-factory-module-seams.md)), operating stack ([`scripts/lib/operating-stack.json`](../../scripts/lib/operating-stack.json)).
- Trains H and I: **built** (18/18 slices). Do not restart — factory epic is PostDB → Delivery (tickets 15–19).
- Epic NOW (machine-readable): ticket 16 closeout → 17; ticket 18 parallel-not-now; ticket 19 human.

## Not yet specified

- **Ticket 19** ([`issues/19-delivery-closeout.md`](issues/19-delivery-closeout.md)) — grilling open:
  - Q20 delivery authority (static vs API manifest + R2)
  - Q21 export trigger (auto vs steward publish)
  - Q22 bundle shape (full vs delta on sync)

## Out of scope

- Session-local resume caches (`.scratch/resume.json`) — stay gitignored.
