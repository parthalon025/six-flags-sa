# ADR-0008a: Databricks as back-office (not runtime truth)

**Status:** Accepted  
**Date:** 2026-08-14  
**Depends on:** [ADR-0002 dual-layer park truth](./0002-dual-layer-park-truth.md)

## Context

Parkbound needs to scale contribution ingest, guest trace analytics, consolidate audit trails, and batched LLM venue research. The phone contract remains offline-first precached venue JSON.

## Decision

Use **Databricks (Delta Lake + Jobs + optional Foundation Models)** as the back-office layer:

1. Ingest Postgres contributions, guest trace exports, and builder snapshots into `parkbound.{bronze,silver,gold}`.
2. Export gold artifacts consumed by existing Node seams:
   - `data/consolidate/queue.json` → [`packages/venue-builder/lib/consolidate.mjs`](../../packages/venue-builder/lib/consolidate.mjs)
   - `data/venues/<id>.guest-traces-cache.json` → guest-traces adapter
   - `data/venues/<id>.llm-research-cache.json` → open research
3. **Do not** reimplement consolidate graduation rules in Spark.
4. **Do not** expose Databricks to phones or party mesh.

LLMs on Databricks follow master spec §8: research/extract only; code decides coordinates, heights, eligibility.

## Consequences

- New repo folder [`databricks/`](../../databricks/) (Asset Bundle + Python jobs).
- New operator APIs: `POST/GET /api/contributions`, `GET /api/admin/consolidate/export`.
- Optional `pg` dependency when `DATABASE_URL` is set; in-memory fallback for dev.
- GitHub workflow validates bundle on demand (manual dispatch — no Vercel coupling).

See [ADR-0010a operations & free tier](./0010a-databricks-ops-free-tier.md) for setup defaults, deferred work, and cost guardrails — **do not relitigate** App vs bundle, Lakebase vs Neon, or cron enablement without superseding that ADR.

## Non-goals

- PostGIS on phones
- Real-time streaming from party state
- Auto-merge consolidate PRs without steward review
