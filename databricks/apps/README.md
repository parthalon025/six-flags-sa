# Databricks Apps (optional steward surface — **deferred**)

> **Default:** do not deploy. See [ADR-0010](../../docs/adr/0010-databricks-ops-free-tier.md). The registered app `park-bound` stays undeployed until stewards need a UI or Lakebase is chosen over Neon.

Parkbound's **batch pipeline** lives in the Asset Bundle ([`../databricks.yml`](../databricks.yml) + `resources/jobs/`). A **Databricks App** is optional — use it when you want a hosted operator UI or API on `*.databricksapps.com` with Lakebase Postgres.

## Quick start

From repo root, with CLI authenticated:

```bash
# Give Cursor/Claude Databricks platform context
databricks aitools install --scope project

# Scaffold AppKit app (interactive — pick Lakebase + Analytics)
cd databricks
databricks apps init --name parkbound-backoffice --features lakebase,analytics

# Deploy before local dev when using Lakebase (SP must own schema)
databricks apps deploy
```

The CLI prints:

```text
Access your app at:
https://parkbound-backoffice.databricksapps.com
```

## What the App is for (later)

- Steward review of consolidate queue and guest-trace clusters
- Read-only dashboards over `parkbound.gold.*` Delta tables
- **Not** phone runtime — phones still use precached venue JSON

## What stays in Asset Bundle

| Job | Purpose |
|-----|---------|
| `parkbound-ingest-*` | Postgres + traces → Delta |
| `parkbound-consolidate-*` | Export queue → Node consolidate |
| `parkbound-guest-traces-*` | Trace clustering → sidecar |
| `parkbound-llm-research-*` | Batched LLM + cache |

Deploy jobs separately:

```bash
cd databricks
databricks bundle deploy -t dev
```

## Lakebase vs docker Postgres

- **Local dev:** `docker compose up -d` + `DATABASE_URL` (see root `.env.example`)
- **Production:** Lakebase via `databricks apps init --features lakebase` — deploy first so the app service principal owns schemas

See [Databricks Apps quickstart](https://developers.databricks.com/docs/apps/quickstart).
