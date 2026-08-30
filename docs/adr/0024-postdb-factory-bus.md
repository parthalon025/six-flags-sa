# ADR-0024 — PostDB is the factory bus

**Status:** Accepted (owner-confirmed, factories-to-app Wayfinder Round 1, 2026-08-24)  
**Amends:** [ADR-0018](./0018-factory-interaction-and-delivery.md) clauses **1** and **5**  
**Depends on:** [ADR-0018](./0018-factory-interaction-and-delivery.md) · [ADR-0013](./0013-display-pipeline.md) · [ADR-0017](./0017-visual-factory-request-contract.md)

## Context

ADR-0018 recorded factory coupling as an **artifact contract in the repo**: Map factory truth in git, Visual factory packs stamped with `basedOn`, and delivery through `apps/party-tracker/public` merged via reviewed PRs. That model shipped Train E and remains the phone's hash-verified offline contract.

Fleet-scale factory work now needs:

- Append-only **truth revisions** with a promotable head — rollback is repointing, not rewriting git history
- Factory outputs (truth JSON, display packs, blob manifests) addressable by revision id and content hash
- **Delivery** as export from a canonical store, not "the latest commit on `main`"
- Git reserved for **builder inputs** (sources, adapter caches, ledgers, code) — not the runtime source of truth for factory outputs

Owner Round 1 (factories-to-app Wayfinder) confirmed **PostDB** as that canonical store.

## Decision

1. **Supersedes ADR-0018 clause 1 (coupling).** Factory coupling is an **artifact contract on PostDB**, not "the repo is the bus" for factory outputs.
   - The **Map factory** appends versioned truth revisions (`truth_revisions`) and updates `venue_heads`.
   - The **Visual factory** writes display packs keyed by `based_on_revision_id` (the `basedOn` field in visual specs maps to this id).
   - Either factory can run alone against PostDB; no runtime link between them.
   - **Git** still holds builder inputs, factory code, certification scripts, and seed bundles — not the authoritative head of factory outputs at scale.

2. **ADR-0018 clauses 2–4 and 6 stand, with the 2026-08-25 operating-stack pause.** CI freshness gates, CDN + download manager delivery, and Train F sequencing stay. Databricks remains back-office only (ADR-0008 / ADR-0010) but jobs stay **PAUSED** — not Lakebase, not a Databricks App. Spark is the add-vendor trigger when DuckDB/Postgres cannot finish the join. Machine-readable list: [`scripts/lib/operating-stack.json`](../../scripts/lib/operating-stack.json).

3. **Supersedes ADR-0018 clause 5 (publication).** Publication is **export from PostDB to Delivery**, not "merge into `public/` as source of truth."
   - **Slice 1:** API manifest + same-origin blobs; seed bundles remain in the app for flagship venues. Query `?since=<revision_id>` is reserved (stub in `packages/venue-builder/lib/delivery/delta-sync.mjs`); delta filtering is ticket 17.
   - **Later:** object storage (`storage_uri` + sha256) behind the same manifest contract — **Cloudflare R2** only when Vercel Fast Data Transfer would bill.
   - Reviewed deploys still gate what reaches production origins; the diff may be an export job output rather than hand-edited `public/venues/` JSON.
   - ADR-0019 / ADR-0021 amendments to clause 5 (PMTiles streaming, on-wear sync withdrawn) apply to **exported** packs, not to where those packs are authored.

4. **Phone contract unchanged.** Hash-verified manifest, offline cache, truth/display split — only the upstream bus moves from git HEAD to PostDB head + export.

5. **Factory verbs require `DATABASE_URL`.** File fixtures are for unit tests only; CI and dev factory commands fail closed without PostDB.

6. **Operating stack (owner 2026-08-25).** Author-time PostDB is laptop **Docker Postgres** + CI `postgres:18`. Hosted app/API is **Vercel + Neon Marketplace** (Upstash if Party runs on Vercel). Cloudflare is **DNS only**. Clerk Pro, Cursor + Claude Code Max, Google AI, Apple Developer, and Google Play stay. Do not add vendors from the parked / do-not-add lists. Epic NOW (ticket 16 closeout, then 17; Trains H/I already built) lives in the same JSON so `npm run workflow:next` does not remember it. Narrative: [2026-08-25 research note](../research/2026-08-25-free-tier-databricks-vs-postgres.md).

## Consequences

- `venues:factory-validate` and `factory-types` become the ontology API over PostDB-backed stages, not directory walks alone.
- ADR-0018's freshness gate evolves from "pack `basedOn` matches git truth stamp" to "`based_on_revision_id` matches `venue_heads.truth_revision_id`" — enforced in CI before merge.
- Docs that say "the repo is the bus" for **factory outputs** must cite this amendment; git-as-bus for **code and builder inputs** remains accurate.

## Rejected

- Dual-write git JSON and PostDB as co-equal sources of truth.
- PostDB as a phone-facing query API (PostDB is author-time; Delivery is wear-time).
- Keeping `public/venues/` as the canonical store after PostDB Slice 1 lands.
- Databricks Lakebase as PostDB; Databricks App; Cloudflare Workers/D1 as the factory bus.
- Relitigating Docker vs Neon vs R2 vs Databricks as the author-time store.
