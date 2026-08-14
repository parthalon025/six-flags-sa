# Databricks back-office

Parkbound’s runtime stays on the phone (precached JSON + party mesh). Databricks is the **batch intelligence layer**: ingest operator data, validate, graduate accepted contributions, and export sidecars for the venue builder.

## When to use Databricks

- Multi-venue consolidate with audit history
- Guest trace clustering at park scale
- Batched LLM venue research with Delta prompt cache

## When not to use it

- Party sync, map draw, or routing at walk time
- Replacing `public/venues/*.json` as the offline contract

## Free tier ($0 pre-launch)

Keep spend at **$0** until you have real data:

| Layer | Free approach |
|-------|----------------|
| Phone runtime | Precached venue JSON — no cloud reads at walk time |
| Local dev | `npm run dev` without `DATABASE_URL` (in-memory contributions) |
| Local Postgres | `docker compose up -d db` — free on your machine |
| Vercel | Hobby plan + [Neon free](https://neon.com/docs/introduction/plans) via Marketplace |
| Redis | [Upstash free](https://upstash.com/pricing/redis) (optional; skip if single Node process) |
| Databricks | OAuth CLI + MCP; **dev job schedules PAUSED**; no App deploy |
| LLM | `VENUE_LLM_PROVIDER=openai` or skip — not Databricks Model Serving |

One command (after `databricks auth login`):

```bash
npm run databricks:free-setup
```

That creates/updates `.env`, deploys bundle jobs to dev with **paused schedules** (catalog `workspace`), and runs local export/pytest smoke tests — **no Spark cluster spend**.

Run a job manually only when you choose (pay per run):

```bash
cd databricks && databricks bundle run parkbound_ingest -t dev --profile default
```

## One-time workspace setup

**Pre-launch:** use [free tier](#free-tier-0-pre-launch) and [decisions doc](./databricks-decisions.md) — do not enable crons or deploy the App.

### CLI onboarding (when promoting beyond free tier)

```bash
# Agent skills for Cursor / Claude (Databricks platform context)
databricks aitools install --scope project

# Optional AppKit steward app → https://<name>.databricksapps.com
# See databricks/apps/README.md
cd databricks && databricks apps init --name parkbound-backoffice --features lakebase,analytics
databricks apps deploy

# Batch jobs (Asset Bundle)
cd databricks && databricks bundle validate && databricks bundle deploy -t dev
```

Or print the full checklist: `node scripts/databricks-workspace-setup.mjs`

### Manual steps

1. Create an AWS Databricks workspace with Unity Catalog enabled ([account console](https://accounts.cloud.databricks.com/)).
2. Create catalog schemas (or let jobs create them): `parkbound_dev.bronze|silver|gold`.
3. Create a service principal for CI; grant `USE CATALOG`, `CREATE TABLE` on dev catalog.
4. Store GitHub secrets: `DATABRICKS_HOST`, `DATABRICKS_TOKEN` (or OAuth client id/secret).
5. Create secret scope `parkbound` with `DATABASE_URL`, `GUEST_TRACES_TOKEN`, `PARKBOUND_API_BASE`.

## Repo commands

| Command | Purpose |
|---------|---------|
| `npm run export:databricks` | Pull consolidate + traces JSON for local bronze |
| `npm run consolidate:export` | Dry-run Node consolidate from exported queue |
| `cd databricks && databricks bundle validate` | Validate Asset Bundle |
| `npm run databricks:free-setup` | $0 bootstrap: paused serverless jobs + local smoke |
| `npm run databricks:setup` | Full checklist (print only) |

## Data flow

Phones → `/api/contributions` + `/api/contributions/traces` → Postgres/Redis → Databricks Delta → gold exports → `data/consolidate/queue.json` + venue sidecars → `npm run venues:consolidate` → `npm run venues:rebuild`.

## LLM token savings

- `VENUE_LLM_PROVIDER=databricks` routes builder LLM through Model Serving
- Default orchestrator uses **one batched call** (`orchestratorBatchReview`); set `VENUE_LLM_VERBOSE=1` for per-agent calls
- `slimAgentContext()` trims agent payloads
- File + Delta `llm_cache` keyed by prompt hash

See [`packages/venue-builder/lib/venue-llm.mjs`](../../packages/venue-builder/lib/venue-llm.mjs).

## Related

- [ADR-0010 ops & free tier](../adr/0010-databricks-ops-free-tier.md) — **decision lock; read before changing Databricks setup**
- [Databricks decisions (quick ref)](./databricks-decisions.md)
- [ADR-0008 databricks back-office](../adr/0008-databricks-back-office.md)
- [E0 backlog](../superpowers/specs/park-bound-implementation-backlog.md)
- [`databricks/README.md`](../../databricks/README.md)
