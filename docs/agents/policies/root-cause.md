# Root cause

The shipped change is the **cause**. A hide, a second zoom gate, a CSS clamp, or an invented fallback is not the product when a layer is missing.

## Find the layer that should have spoken

Name the guest-visible rest state first — World / Zone / Place on the park map, the contract field the builder already emits, the script that already owns the decision. Then change *that* layer so it does the job.

The map rest state is the teaching case: park-wide location is Zone names from `world.geometry.lands`, rides keep names as the destination layer, amenities wait for their zoom rank. Gating every Place title because Zones never painted was a hide.

## Otherwise

Ship a hide only when one of these is already true:

1. **Designed rank** — the layer is meant to wait (amenities at park-wide). Write that rank in the module that already owns zoom, not a second gate.
2. **Out of scope** — file an [agent-handoff](./agent-handoff.md) and leave the cause for that issue. Do not land a hide so the current PR looks clean.
3. **Named exception** — the user asked for a temporary hide *and* the follow-up issue is filed in the same turn. The PR says it is a hide.

If none of those apply, keep going until the cause is the merge.

## Review

`buildReviewPrompt` in `scripts/lib/matt-review.mjs` asks the standards review whether the diff ships the cause or a hide. Answer that finding; do not stamp past it.

---

**After editing:** add or update the policy in `scripts/lib/agent-docs/manifest.json`, then run `npm run agent-docs:build`.
