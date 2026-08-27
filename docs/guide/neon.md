# Neon Postgres

Parkbound uses optional Postgres for profiles and contributions (`DATABASE_URL`). Without it the app stores contributions in memory — fine for `npm run dev` and unit tests, but not for durable production data.

## `DATABASE_URL` and memory fallback

| `DATABASE_URL` | Contributions / profiles | `pingPostgres()` (dev/test) | `pingPostgres()` (production) |
| --- | --- | --- | --- |
| **Unset** | In-process memory (lost on restart; not shared across serverless instances) | `{ ok: true, backend: 'memory' }` | `{ ok: false, backend: 'memory', error: '…' }` |
| **Set and reachable** | Durable Postgres | `{ ok: true, backend: 'postgres' }` | `{ ok: true, backend: 'postgres' }` |
| **Set but failing** | Errors on write | `{ ok: false, backend: 'postgres', error: '…' }` | `{ ok: false, backend: 'postgres', error: '…' }` |

## Production guard (#436)

When Vercel **Production** (`VERCEL_ENV=production`), or self-hosted `NODE_ENV=production` without a Vercel preview/development env, and `DATABASE_URL` is missing:

1. **Deploy gate** — `scripts/lib/vercel-ignore.mjs` sets category `production-postgres-missing` and **skips** the production build (Vercel ignore exit `0`). The previous production deployment stays live; the skip reason names `DATABASE_URL` in the ignore-step log. This is not a red CI check — it prevents shipping a new production build without Postgres credentials.
2. **Probe seam** — `pingPostgres()` returns `ok: false` with `backend: 'memory'` when the guard fires, so any caller (including a future `/api/ready` merge in **#437**) can surface not-ready. **`/api/ready` does not call `pingPostgres` yet** — it still probes only the party store (Upstash).

Dev, test, and preview without `DATABASE_URL` are unchanged (memory backend, no guard noise).

### How to resolve

1. Open the Vercel project → **Settings** → **Environment Variables**.
2. Add `DATABASE_URL` to the **Production** scope with your Neon **pooled** connection string (`?sslmode=require`).
3. Optionally add `DATABASE_URL_UNPOOLED` for direct connections (migrations, one-off scripts).
4. Redeploy production (or merge an app change so the ignore step runs with credentials present).

Install Neon from the [Vercel Marketplace](https://vercel.com/marketplace/neon) or paste a pooled URL from the [Neon console](https://console.neon.tech). Never commit connection strings — only variable names appear in this repo (`.env.example`).

### Local development

```bash
# Memory mode (default) — no Postgres required
npm run dev

# With docker compose Postgres
docker compose up -d postgres
# copy DATABASE_URL from docker compose output into apps/party-tracker/.env.local
npm run postdb:migrate
npm run dev
```

See [Databricks guide](databricks.md) for when PostDB factory verbs require `DATABASE_URL`.

## Connection pool tuning (#440)

Serverless functions open many short-lived connections. Always use Neon's **pooled endpoint** (`-pooler` in the hostname) in `DATABASE_URL` for runtime traffic. Use the direct (unpooled) URL only for migrations and one-off scripts (`DATABASE_URL_UNPOOLED`).

Set `PG_POOL_MAX` to cap concurrent connections per instance. The default is **4** — enough for a single Vercel function without risking **connection exhaustion** on Neon's free tier. Raise it only when metrics show queueing, not preemptively.

The app uses `@neondatabase/serverless` with the pooled URL. `/api/ready` will call `pingPostgres()` alongside the party store once **#437** lands; until then the probe seam exists for tests and deploy guards.

## Preview branching (#439)

We **recommend** a **branch-per-preview** Neon branch for Vercel preview deployments so schema experiments never touch **production** data. A single **shared dev** branch is fine for local **development** when engineers coordinate migrations manually.

| Environment | Neon branch | `DATABASE_URL` scope |
| --- | --- | --- |
| **production** | `main` (pooled) | Vercel Production |
| **preview** | ephemeral per PR (pooled) | Vercel Preview |
| **development** | shared dev (pooled) | local `.env.local` only |

After creating a preview branch, run `npm run postdb:migrate` against it before expecting contributions to persist. Without Postgres, the app stays on **memory** — the **production guard** blocks shipping that configuration to Vercel Production.

## Related issues

- **#437** — combine Postgres probe into `/api/ready` alongside Upstash
- **#439** — Vercel preview branching strategy
- **#440** — serverless connection pool tuning
