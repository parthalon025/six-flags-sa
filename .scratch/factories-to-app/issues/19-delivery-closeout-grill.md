# 19: Delivery closeout grill (human)

**Type:** grilling

**Question:** Is the Delivery architecture complete for v1 — PostDB export → Vercel same-origin blobs → hash-verified app cache — or do we need R2/object-storage before fleet scale?

**Blocked by:** 17

**Status:** resolved

## Context

- ADR-0024 Slice 1: API manifest + same-origin blobs; R2 only when Vercel transfer bills
- `docs/research/2026-08-24-factory-industry-comparison.md` Q21–Q22
- Wayfinder PR #699 opened for this grill

## Answer

**Yes — v1 is complete on the Slice 1 path already shipped.** No R2 before fleet scale.

Owner decision (2026-08-25, `scripts/lib/operating-stack.json` + ADR-0024):

1. **Publish path:** PostDB head → `venues:export` → revision-pinned `public/venues/*.bundle.json` on Vercel same-origin. Git holds builder inputs; PostDB holds the promotable factory head.
2. **Phone contract:** `GET /api/venues/:id/bundle?since=<revision_id>` for delta manifests; hash-verified bytes in `VENUE_BUNDLE_CACHE` (ticket 17 shipped).
3. **R2 deferred:** Cloudflare R2 enters only when **Vercel Fast Data Transfer would bill** (`operating-stack.json` `addVendorWhen`). Until then, same-origin blobs + API manifest are the delivery adapter — not a gap.
4. **Fleet scale trigger:** Revisit R2 when transfer cost or bundle size forces object storage behind the same manifest contract (`storage_uri` + sha256 per ADR-0024 Slice 2). No new vendor without `addVendorWhen` firing.

Research Q21 (export trigger): steward publish via `venues:export` after PostDB promote — automatic job is out of scope for v1.

Research Q22 (partial vs full): per-file delta via `?since=revision_id` when the cached bundle carries a cursor; hash planning dedupes unchanged blobs client-side (ticket 17).

**Gist for map.md:** Delivery v1 = PostDB export → Vercel same-origin → hash cache. R2 is a cost trigger, not a v1 blocker.
