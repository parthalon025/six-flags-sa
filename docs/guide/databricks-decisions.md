# Databricks decisions — do not relitigate

**Canonical ADR:** [ADR-0010](../adr/0010-databricks-ops-free-tier.md)

Quick reference for agents and future sessions. If a proposal contradicts this page, cite ADR-0010 and stop unless the user explicitly wants to supersede it.

## Stack (accepted)

```text
Phones (offline JSON + mesh)
  → Vercel API + Neon Postgres (+ optional Upstash)
  → Databricks serverless jobs (PAUSED schedules) → Delta
  → gold sidecars → Node consolidate → venue builder → phones
```

## Yes / No

| Question | Answer |
|----------|--------|
| Keep phone offline-first? | **Yes** — Databricks never on hot path |
| Databricks App for MVP? | **No** — bundle jobs only; App deferred |
| Lakebase vs Vercel Postgres? | **Vercel Postgres (Neon free)** while API on Vercel |
| Lakehouse vs Postgres? | **Both** — Postgres = OLTP, Delta = batch analytics |
| Enable job crons pre-launch? | **No** — dev schedules PAUSED |
| Deploy `park-bound` app? | **No** until steward UI or Lakebase decision |
| LLM on Databricks free tier? | **No** — `VENUE_LLM_PROVIDER=openai` or skip |
| Classic i3.xlarge clusters? | **No** — workspace is serverless-only |
| Spark consolidate rules? | **No** — export queue; Node `consolidate.mjs` graduates |
| Hand-edit `public/venues/*.json`? | **No** — builder pipeline only |

## One command (free bootstrap)

```bash
npm run databricks:free-setup
```

Requires prior `databricks auth login`.

## Workspace facts (2026-08-14)

- Host: `https://dbc-e989baa1-6212.cloud.databricks.com`
- Dev jobs: `[dev parthalon025] parkbound-*-dev` — schedules **PAUSED**
- Catalog: `workspace` (bronze/silver/gold created on first job run)
- App `park-bound`: registered, **not deployed**
- MCP: Cursor `databricks` via `uc-mcp-proxy`

## When to revisit

See **Deferred work** table in ADR-0010. Do not reopen App/Lakebase/cron questions until the listed trigger is met.
