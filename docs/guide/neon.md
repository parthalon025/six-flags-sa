# Neon Postgres runbook

Park Bound’s live API on Vercel uses **Neon Postgres** (via Vercel Marketplace) for profiles and contributions. Redis/Upstash remains optional for the party store.

## When DATABASE_URL is required

| Environment | DATABASE_URL | Contribution storage |
|-------------|--------------|----------------------|
| Local dev / CI tests | unset | In-memory (intentional) |
| Vercel preview | set (recommended) | Postgres when set |
| Vercel **production** | **required** | Postgres |

Production without `DATABASE_URL` silently accepted contributions into process memory and lost them on cold start. **#436** adds guards so that misconfiguration is caught at deploy and readiness.

## Guards (#436)

1. **Deploy gate** — `scripts/lib/vercel-ignore.mjs` skips production builds when `VERCEL_ENV=production` and `DATABASE_URL` is unset. Check the Ignored Build Step log for `DATABASE_URL is required in production`.
2. **Readiness** — `/api/ready` probes Postgres in parallel with the party store. In production without `DATABASE_URL`, the postgres probe reports `ok: false` and the route returns **503** with the error message naming `DATABASE_URL`.

Dev and test without the variable behave as before: memory backend, no warning noise.

## Provision Neon (human step)

1. Vercel dashboard → Storage → Create → Postgres (Neon).
2. Link the database to the **party-tracker** project.
3. Confirm `DATABASE_URL` appears in Production (and Preview if desired) environment variables.
4. Redeploy production or merge an app change so the Ignored Build Step runs.

This repo does not set dashboard secrets; it only documents and guards the contract.

## Verify after setup

```bash
curl -sS "https://<your-production-domain>/api/ready" | jq .
```

Expect `ready: true`, `postgres.ok: true`, and `postgres.backend: "postgres"` when the pool answers.

## Related issues

- **#437** — combine Postgres + Upstash probes in `/api/ready` (parallel probes, per-backend fields).
- **#443** — CI full-stack readiness gate consuming `/api/ready`.
- **#439** — branching strategy for preview environments.
- **#440** — connection pool tuning.

See also [ADR-0010 ops & free tier](../adr/0010-databricks-ops-free-tier.md) and [Databricks guide](./databricks.md#free-tier-0-pre-launch).
