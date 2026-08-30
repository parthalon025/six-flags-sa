# 19: Delivery closeout — authority, trigger, bundle shape

**Type:** grilling
**Status:** resolved
**Blocked by:** None

## Question

Three decisions gate the PostDB → phone delivery path after export (tickets 15–18). Operating stack lists this ticket under `laterHuman`. Trains H/I are complete — do not reopen.

### Q20 — Delivery authority

Where do guest phones fetch manifests and blobs?

- **A** — Same-origin static (`public/venues/` or Vercel CDN) until fleet scale forces a move
- **B** — API manifest (PostDB head) + object storage blobs (Cloudflare R2) now that PostDB Slice 1 exists
- **C** — Hybrid: seed bundles stay in-app; production venues use API + R2

Research recommends **C** for dev/bootstrap; **B** for production at PostDB scale. Operating stack parks R2 until Vercel transfer would bill.

### Q21 — Export trigger

When PostDB head moves on certify, what runs?

- **A** — Automatic export job on every certify (staging channel)
- **B** — Steward publish action only (human promotes head to production)
- **C** — Automatic export to staging; steward promotes staging → production (Mapbox tile-publish pattern)

CONTEXT.md already names staging vs production for **World head**.

### Q22 — Bundle shape at sync

What does the phone download per revision?

- **A** — Full venue bundle every time (existing manifest model)
- **B** — Per-file delta from last `revision_id` (`?since=` — ticket 17 implements filtering)
- **C** — Full bundle v1; switch to delta when average venue exceeds ~15 MB

Ticket 17 ships `?since=` filtering; this decides whether the phone uses it on the happy path.

## Answer

_(pending owner Round 2)_

## Resolution

Answered 2026-08-25 by the owner; the decision text lives in
[`19-delivery-closeout-grill.md`](./19-delivery-closeout-grill.md) and is encoded in
[`scripts/lib/operating-stack.json`](../../../scripts/lib/operating-stack.json) + ADR-0024.

- **Q20 delivery authority** → **A**, same-origin. PostDB head → `venues:export` →
  revision-pinned `public/venues/*.bundle.json` on Vercel. R2 is deferred behind the
  `addVendorWhen` trigger ("Vercel transfer would bill"), not a v1 gap.
- **Q21 export trigger** → **steward publish**. `venues:export` is run by hand after a PostDB
  promote; an automatic job is out of scope for v1.
- **Q22 bundle shape** → **delta**. Per-file delta via `?since=<revision_id>` when the cached
  bundle carries a cursor; `planBundleSync` dedupes unchanged blobs client-side (ticket 17).

This file stayed `open` after the answer landed, which kept the executive brief and `map.md`
reporting a decision that had already been made.
