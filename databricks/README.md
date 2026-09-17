# Databricks back-office for Parkbound

Parkbound phones stay offline-first on precached venue JSON. Databricks ingests contributions, guest traces, and builder artifacts — then exports sidecars the existing Node consolidate and venue-builder pipelines consume.

**Full setup:** [docs/guide/databricks.md](../docs/guide/databricks.md)  
**Decisions (do not relitigate):** [docs/adr/0010a-databricks-ops-free-tier.md](../docs/adr/0010a-databricks-ops-free-tier.md)  
**ADR:** [docs/adr/0008a-databricks-back-office.md](../docs/adr/0008a-databricks-back-office.md)

## Free tier (default pre-launch)

```bash
npm run databricks:free-setup
```

Deploys **serverless** jobs with **PAUSED** schedules — $0 while idle. Do **not** deploy the App until ADR-0010a deferred-work triggers are met.

## Quick start (when promoting beyond free tier)

```bash
# 1. Agent skills (Cursor / Claude)
databricks aitools install --scope project

# 2. Optional AppKit app → https://parkbound-backoffice.databricksapps.com
#    See apps/README.md
cd databricks && databricks apps init --name parkbound-backoffice --features lakebase,analytics
databricks apps deploy

# 3. Batch jobs (Asset Bundle)
databricks bundle validate
databricks bundle deploy -t dev
```

Or: `npm run databricks:setup` from repo root.

## Local bronze export (no Databricks)

```bash
npm run export:databricks   # writes data/databricks/bronze/
npm run consolidate:export  # dry-run consolidate from exported queue
```

## Layout

| Path | Role |
|------|------|
| `databricks.yml` | Asset Bundle targets (dev/prod) |
| `resources/*.yml` | Scheduled ingest, consolidate, traces, LLM jobs (dev schedules PAUSED) |
| `src/ingest/` | Postgres JDBC + guest traces API → Delta |
| `src/transform/` | Consolidate queue + trace clustering |
| `src/llm/` | Batched research with prompt cache |
| `src/export/write_sidecars.py` | Gold → `queue.json` / `*.guest-traces-cache.json` |
| `fixtures/` | CI smoke inputs |

## Secrets (Databricks secret scope `parkbound`)

- `DATABASE_URL` — Postgres E0 store
- `GUEST_TRACES_TOKEN` — operator trace export
- `PARKBOUND_API_BASE` — deployed app URL
- `DATABRICKS_TOKEN` — LLM batch job (or use workspace default)

Never commit tokens. See root `.env.example`.

## Cloud e2e (fixture mode, per-run cost)

Dev target uses catalog `workspace` and bundled fixtures — no Neon or live API required.

```bash
npm run databricks:e2e              # all four jobs
npm run databricks:e2e -- --skip-llm  # ingest + consolidate + guest traces only
```

Jobs route through `src/parkbound_job.py` (serverless-safe entry point). LLM job dry-runs when `DATABRICKS_TOKEN` is unset; set a Databricks secret scope before expecting live model calls.
