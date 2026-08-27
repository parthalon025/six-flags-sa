# 20: Band crossfade critical path

**What to build:** Guest-visible zoom-band handoff per ADR-0021 clauses 2/4 — parent placeholder during crossfade, ramped content, pitch ease staged off band boundaries. Promote `train-h-zoom-bands` from `critical-paths.json` `upcoming` to `shipped`.

**Blocked by:** 17

**Status:** ready-for-agent

## Acceptance

- [ ] `apps/party-tracker/lib/mapView.js` + MapLibre adapter implement band plan crossfade (see `bandPlan.js`, `BandedWorldMap.jsx` preview)
- [ ] Functional check in `test/app/functional.mjs` matching critical-paths user_action
- [ ] `test/app/critical-paths.json`: row `train-h-zoom-bands` in `shipped`; remove from `upcoming`
- [ ] No hard band cut; pitch ease and band boundary do not land in same instant
- [ ] Browser vertical or recording proves pinch-zoom on a flagship with banded pack (Kings Island or Big Kahuna's)

## Notes

Train H infra is built (`train:next` 18/18). This is app integration proof only.
