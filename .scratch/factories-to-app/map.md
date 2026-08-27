# Map — factories → app end-state

## Destination

Factories publish versioned truth and display packs through PostDB; the app consumes exported delivery artifacts (not git HEAD as the runtime bus). See ADR-0024 and ADR-0025.

## Notes

Committed wayfinder map for macro / Cloud resume fog tracking. Supersedes GitHub #625–630.

## Decisions so far

Owner Round 1 decisions are recorded in repo ADRs (PostDB bus, factory module seams).

## Not yet specified

- Frontier decision tickets will live under `issues/` as they are opened.

## Out of scope

- Session-local resume caches (`.scratch/resume.json`) — stay gitignored.
