# 21: Offline pyramid download UI

**What to build:** Guest opt-in "make this park available offline" per ADR-0021 clause 5 — states download size before run, guest-triggered only, no pyramid download on Skin wear.

**Blocked by:** 17

**Status:** ready-for-agent

## Acceptance

- [ ] UI affordance (venue sheet or install card) shows total bytes for overview + close bands before download starts
- [ ] Download runs only on explicit guest action — not on wear or app start
- [ ] Mid band remains offline floor from seed bundle; optional bands fetch into `VENUE_BUNDLE_CACHE`
- [ ] Functional check in `test/app/functional.mjs` matching critical-paths user_action
- [ ] `test/app/critical-paths.json`: row `train-h-offline-download` in `shipped`; remove from `upcoming`
- [ ] Size estimate matches manifest file list (hash-addressed entries)

## Notes

Download manager: `apps/party-tracker/lib/venue/download.js`. On-wear sync withdrawn (ADR-0021).
