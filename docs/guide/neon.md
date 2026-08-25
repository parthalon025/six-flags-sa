# Neon Postgres

Parkbound uses optional Postgres for profiles and contributions (`DATABASE_URL`). Without it the app stores contributions in memory — fine for `npm run dev` and unit tests, but not for durable production data.

This runbook covers **connection pooling** on Vercel serverless and the self-hosted `docker compose` path.

## Connection strings

Neon offers two endpoints per database:

| Endpoint | Host suffix | Use when |
| --- | --- | --- |
| **Direct** | `.neon.tech` (no `-pooler`) | Long-lived processes: `docker compose`, a VPS, local dev |
| **Pooled** | `-pooler.<region>.neon.tech` | Vercel serverless — many short-lived lambdas share one connection budget via PgBouncer |

Set `DATABASE_URL` to the pooled connection string on Vercel. Use the direct string for `docker compose` and local `npm run dev` against Neon.

Neon dashboard → **Connection details** → toggle **Pooled connection** to copy the right URL. Both accept the same credentials; only the host changes.

## `PG_POOL_MAX`

The app uses `node-postgres` (`pg`) with a lazily created pool in `apps/party-tracker/lib/db/postgres.js`:

```js
max: Number(process.env.PG_POOL_MAX || 4),
idleTimeoutMillis: 30_000,
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `PG_POOL_MAX` | **4** | Max connections held open **per Node process** |
| idle timeout | 30s | Idle sockets closed to release Neon slots |

### Why 4?

Each Vercel function instance is one Node process. A pool `max` of 4 is a conservative default: enough for a few concurrent queries inside one request without hoarding Neon connections across cold starts.

On **docker compose** (one long-running `party` container), 4 is also reasonable — you have a single process, not hundreds of lambdas.

Raise `PG_POOL_MAX` only when profiling shows queueing inside a single instance (slow `getPool()` waits under load). Lower it if Neon reports connection pressure from a small number of instances.

### Per-lambda math

```
approx peak connections ≈ (concurrent function instances) × PG_POOL_MAX
```

Vercel can spin many instances under traffic. Even with `PG_POOL_MAX=4`, twenty warm instances can hold up to **80** connections. That is why production Vercel deploys should use Neon's **pooled endpoint** — PgBouncer multiplexes many client connections onto fewer server backends.

## `pg` pool vs `@neondatabase/serverless`

| Approach | Pros | Cons |
| --- | --- | --- |
| **`pg` pool** (current) | Familiar API; works on docker-compose and Vercel; `pingPostgres()` is a simple `SELECT 1` | Each lambda holds its own pool; needs pooled endpoint on serverless |
| **Neon serverless driver** | HTTP/WebSocket — no persistent pool per instance; good fit for edge and burst traffic | Different API surface; migration touches every query site |

**Decision for this codebase:** keep `pg` with `PG_POOL_MAX` and Neon's pooled `DATABASE_URL` on Vercel. The pool module is already a single seam (`getPool`, `pingPostgres`, `usingPostgres`); switching drivers is a follow-up only if pooled-endpoint limits are still hit after tuning.

## Self-hosted docker compose

`docker compose up` runs Postgres 16 on port 5432 with migrations applied at first boot:

```bash
docker compose up -d
# DATABASE_URL defaults to postgres://parkbound:parkbound@db:5432/parkbound
```

The `party` service depends on `db` health. One container, one pool — no PgBouncer layer needed. Use the direct connection string (or the compose default).

## Readiness probe

`GET /api/ready` answers whether this instance can serve traffic. Today it probes the durable store (Upstash Redis or memory). `pingPostgres()` in `lib/db/postgres.js` is the Postgres seam:

- No `DATABASE_URL` → `{ ok: true, backend: 'memory' }` (contributions in-process)
- Configured and reachable → `{ ok: true, backend: 'postgres' }`
- Configured but failing → `{ ok: false, backend: 'postgres', error: '<message>' }`

When `/api/ready` includes Postgres (see #437), a 503 body will surface `postgres.error` alongside the durable-store probe. Until then, call `pingPostgres()` from a one-off script or watch Neon metrics directly.

## Connection exhaustion — symptoms and diagnosis

**Symptoms**

- `/api/ready` returns 503 with `postgres.error` mentioning `too many connections`, `remaining connection slots`, or timeouts
- Neon dashboard → **Monitoring** shows connections at the plan limit
- Intermittent 500s on contribution or profile routes under load, fine when cold

**Diagnosis**

1. Check Neon **Connections** graph — flat line at the limit means exhaustion, not slow queries.
2. Confirm Vercel uses the **pooled** `DATABASE_URL`, not direct.
3. Inspect `PG_POOL_MAX` — try lowering to 2 on Vercel if instance count is high.
4. Hit `/api/ready` (or run `pingPostgres()` locally with production env) and read `error`.
5. Look for connection leaks: long-running handlers holding transactions open (rare in this app; most queries are single-statement).

**Mitigations**

| Action | When |
| --- | --- |
| Switch to pooled endpoint | Vercel / any serverless deployment |
| Lower `PG_POOL_MAX` | Many concurrent instances, connections at cap |
| Upgrade Neon plan | Sustained legitimate load above free-tier connection limit |
| Adopt Neon serverless driver | Pooled endpoint still insufficient (file a follow-up) |

## Related

- [Databricks guide](./databricks.md) — free-tier Neon via Vercel Marketplace
- [API](./api.md) — `/api/health` vs `/api/ready`
- `db/migrations/` — schema applied on docker-compose first boot and via deploy pipeline
