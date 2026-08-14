# ADR-0010: Databricks operations, free tier, and deferred work

**Status:** Accepted  
**Date:** 2026-08-14  
**Depends on:** [ADR-0008 databricks back-office](./0008-databricks-back-office.md), [ADR-0002 dual-layer park truth](./0002-dual-layer-park-truth.md)

## Context

Parkbound’s Databricks MVP landed on a serverless-only workspace with OAuth CLI, Cursor MCP, and a registered but undeployed Databricks App (`park-bound`). Agents and humans were re-debating the same choices: App vs bundle only, Lakebase vs Vercel Postgres, lakehouse vs Postgres, offline-first impact, and $0 pre-launch setup.

This ADR records **operational defaults** so future work does not relitigate them.

## Decisions (do not relitigate)

### Runtime split

| Layer | Technology | Role |
|-------|------------|------|
| Phone | Precached `public/venues/*.json` + party mesh | Offline-first runtime — **never** calls Databricks |
| E0 API | Vercel + Postgres (Neon free tier) + optional Upstash Redis | Live writes: contributions, profiles, trace upload |
| Back-office | Databricks Asset Bundle (serverless jobs) + Delta in Unity Catalog | Batch ingest, audit, clustering, sidecar export |
| Map graduation | Node `consolidate.mjs` + venue builder | **Only** path into shipped venue JSON |

### What we are **not** doing (pre-launch / free tier)

1. **Do not deploy** the Databricks App `park-bound` — avoids 24/7 MEDIUM compute (~$100–400/mo). App is for steward UI + Lakebase **later**.
2. **Do not enable** dev job schedules until Postgres has durable data worth ingesting. Dev target deploys jobs with `pause_status: PAUSED`.
3. **Do not use** Lakebase for E0 while the Next.js API stays on Vercel — use **Neon Postgres via Vercel Marketplace** (free tier).
4. **Do not use** `VENUE_LLM_PROVIDER=databricks` on free tier — keep `openai` or skip LLM; Model Serving costs tokens.
5. **Do not hand-edit** builder output under `apps/party-tracker/public/venues/` — fix builder or venue input, then regenerate.
6. **Do not reimplement** consolidate graduation in Spark — export gold JSON; Node owns rules.

### Databricks workspace defaults (this repo)

| Setting | Value | Why |
|---------|-------|-----|
| Auth (local) | OAuth CLI profile `default` | MCP via `uc-mcp-proxy`; no PAT in `mcp.json` |
| Auth (CI) | Service principal PAT in GitHub secrets | Unattended bundle deploy only when needed |
| Compute | **Serverless** job environments | Workspace rejects classic `i3.xlarge` clusters |
| Dev catalog | `workspace` | New workspaces use Default Storage; CLI catalog create needs UI |
| Dev schemas | `workspace.bronze`, `.silver`, `.gold` | Created by jobs via `ensure_schemas()` |
| Prod catalog (later) | `parkbound` | Create in Catalog Explorer when promoting |
| Bundle target | `dev` default; schedules **PAUSED** | `$0` while idle |
| Cursor MCP | `uc-mcp-proxy` → `/api/2.0/mcp/functions/system/ai` | Official managed MCP |

### Free-tier bootstrap

```bash
databricks auth login --host https://<workspace>.cloud.databricks.com --profile default
npm run databricks:free-setup
```

Script: [`scripts/databricks-free-setup.mjs`](../../scripts/databricks-free-setup.mjs) — validates bundle, deploys paused serverless jobs, runs local export/pytest smoke **without Spark spend**.

Manual job run (pay per run only):

```bash
cd databricks && databricks bundle run parkbound_ingest -t dev --profile default
```

### Offline-first preserved

Contributions and traces are **write-behind** when online. Databricks never serves map geometry, party sync, or routing. Shipped venue truth changes only after batch export → Node consolidate → `npm run venues:rebuild` → phones refresh cache.

### Cost guardrails

| Scale | Expected monthly (no App, paused schedules) |
|-------|---------------------------------------------|
| 0 users | **$0** Databricks + **$0** Vercel Hobby/Neon/Upstash free |
| Manual job run | Pay per serverless run only |
| App deployed | +$100–400/mo — **defer** until steward UI needed |
| Schedules enabled (all 4 daily) | ~$15–40/mo empty; scales with data |

## Deferred work (explicit backlog — not open questions)

| Item | Trigger to pick up |
|------|-------------------|
| Deploy `park-bound` App | Multiple stewards need web UI, or Lakebase chosen over Neon |
| Create `parkbound_dev` / `parkbound` catalogs in UI | Default Storage catalog; before prod isolation |
| Enable job schedules (one at a time) | `DATABASE_URL` live on Vercel + contribution volume justifies ingest |
| Secret scope `parkbound` | Before first scheduled ingest from cloud Postgres |
| `PARKBOUND_API_BASE` + `GUEST_TRACES_TOKEN` on jobs | Before guest-trace ingest from production API |
| GitHub `DATABRICKS_TOKEN` + CI deploy | When merging bundle to `main` and automating validate/deploy |
| `VENUE_LLM_PROVIDER=databricks` | When batch LLM research job runs with budget for Foundation Models |
| Merge `worktree-databricks-mvp` → `main` | When E0 API + docs reviewed |
| Serverless job `dependencies` in bundle | If ingest tasks need extra PyPI packages beyond base env |

## Consequences

- [`databricks/databricks.yml`](../../databricks/databricks.yml) dev target: paused schedules, catalog `workspace`.
- Job YAML lives in [`databricks/resources/*.yml`](../../databricks/resources/) with serverless `environment_key`.
- [`docs/guide/databricks.md`](../guide/databricks.md) is the operator runbook; this ADR is the **decision lock**.
- Agents: read this ADR before proposing Lakebase, App deploy, classic clusters, or enabling cron.

## Non-goals

- Replacing ADR-0008 architecture (batch back-office only)
- Committing secrets or PATs to the repo
- Auto-merge consolidate PRs without steward review
