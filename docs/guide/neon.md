# Neon Postgres

Parkbound uses optional Postgres for profiles and contributions (`DATABASE_URL`). Without it the app stores contributions in memory — fine for `npm run dev` and unit tests, but not for durable production data.

This runbook covers **Vercel preview database strategy**, **connection pooling** on serverless, and the self-hosted `docker compose` path.

## `DATABASE_URL` and memory fallback

| `DATABASE_URL` | Contributions / profiles | `pingPostgres()` |
| --- | --- | --- |
| **Unset** | In-process memory (lost on restart; not shared across serverless instances) | `{ ok: true, backend: 'memory' }` |
| **Set and reachable** | Durable Postgres | `{ ok: true, backend: 'postgres' }` |
| **Set but failing** | Errors on write | `{ ok: false, backend: 'postgres', error: '…' }` |

A Vercel **preview** without `DATABASE_URL` therefore boots quietly in memory mode — contributions from that preview vanish on the next cold start. That is intentional for local dev and tests, but previews that exercise the contribution path should set `DATABASE_URL`.

**Production guard (#436):** when `NODE_ENV=production` (or Vercel **Production** environment) and `DATABASE_URL` is missing, the planned deploy gate / readiness path will fail closed with a message naming `DATABASE_URL` — memory backend must not report fully ready in production. Dev, test, and preview without the variable stay unchanged until you opt in. Track implementation in issue #436; until it lands, treat any production deploy without `DATABASE_URL` as misconfigured.

## Vercel preview database strategy

Vercel scopes environment variables to **Production**, **Preview**, and **Development**. Each scope can carry its own `DATABASE_URL`.

### Option A — branch-per-preview (Neon branching)

Neon can create a **database branch** per Vercel preview deployment (via the [Neon ↔ Vercel integration](https://neon.com/docs/guides/vercel) or a CI step that calls the Neon API).

| Pros | Cons |
| --- | --- |
| Schema and data isolated per PR | Branch count hits Neon free-tier limits (~10 branches) |
| Safe to run migrations without touching shared dev | Stale branches need periodic cleanup |
| Matches production topology (separate DB per deploy) | Slightly more dashboard / integration setup |

**`DATABASE_URL` wiring**

| Vercel scope | Value |
| --- | --- |
| **Production** | Neon **main** branch, **pooled** endpoint (see below) |
| **Preview** | Integration-injected URL for the preview branch (pooled) |
| **Development** | Optional — local `docker compose` or a long-lived **dev** branch |

**Migrations on preview branches**

1. Schema source of truth: `db/migrations/*.sql` in this repo.
2. After the preview branch exists, apply migrations once against that branch's connection string:

   ```bash
   DATABASE_URL='postgres://…preview-branch…' npm run postdb:migrate
   ```

3. With the Neon/Vercel integration, enable **"Apply migrations on deploy"** or wire `postdb:migrate` into a preview deploy hook so new SQL files land before traffic.

4. Re-running `postdb:migrate` is idempotent for already-applied objects only when migrations are written to tolerate re-apply; today each file is applied in lexical order — treat preview branches as disposable if a migration fails mid-way.

### Option B — shared dev database

One Neon database (or `docker compose` on a shared host) serves all previews via the same `DATABASE_URL` on the **Preview** scope.

| Pros | Cons |
| --- | --- |
| Simple — one URL in the Vercel dashboard | PRs stomp each other's data |
| No branch cleanup | Migration drift: one preview's migration can break others |
| Fits free tier when branch limits bite | Does not mirror production isolation |

Point **Preview** and optionally **Development** at the shared dev connection string; keep **Production** on main.

**`DATABASE_URL` wiring (recommended default)**

| Vercel scope | Value |
| --- | --- |
| **Production** | Neon **main** branch, **pooled** endpoint |
| **Preview** | Shared **dev** branch connection string (pooled) — same URL for every preview |
| **Development** | Optional — local `docker compose`, or the same shared dev branch |

**Migrations on the shared dev database**

1. Apply new `db/migrations/*.sql` to the shared dev branch **once** when they merge to `main` (not per preview deploy):

   ```bash
   DATABASE_URL='postgres://…shared-dev…' npm run postdb:migrate
   ```

2. Coordinate with other open PRs — a migration that renames or drops objects can break previews still on old code. Prefer additive migrations until the PR ships.
3. Previews without `DATABASE_URL` still run memory mode and never touch the shared DB.

### Recommendation

For this project's scale (small team, contribution store still maturing): **start with Option B (shared dev Neon branch)** on the Preview scope while PR volume is low. Move to **branch-per-preview** when you need isolated migration experiments or hit data collisions between concurrent PRs. Production always uses the main branch with the pooled endpoint.

Document which option you chose in the Vercel project's environment-variable notes so agents do not assume memory mode on previews.

### Maintainer console steps (out of scope for code changes)

- Install Neon from the Vercel Marketplace (or paste a pooled `DATABASE_URL` per scope).
- For branch-per-preview: enable the integration's preview branching and set branch expiration.
- Never commit connection strings — only variable names appear in this repo (`.env.example`).

See also [Vercel previews policy](../agents/policies/vercel-previews.md) — previews are user-reserved for builds; this doc covers **data**, not deploy quotas.

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

`GET /api/ready` answers whether this instance can serve traffic. **Today** it probes only the durable store (Upstash Redis or memory) — not Postgres.

Postgres liveness lives in `pingPostgres()` (`lib/db/postgres.js`):

- No `DATABASE_URL` → `{ ok: true, backend: 'memory' }` (contributions in-process)
- Configured and reachable → `{ ok: true, backend: 'postgres' }`
- Configured but failing → `{ ok: false, backend: 'postgres', error: '<message>' }`

Use `pingPostgres()` for connection-exhaustion diagnosis until #437 wires it into `/api/ready`. After #437 lands, a 503 from `/api/ready` will include a `postgres` field with the same `error` surface.

## Connection exhaustion — symptoms and diagnosis

**Symptoms (today)**

- Neon dashboard → **Monitoring** shows connections at the plan limit
- Intermittent 500s on contribution or profile routes under load, fine when cold
- `pingPostgres()` returns `{ ok: false, error: '…too many connections…' }` (or similar) when run with production env

**Symptoms (after #437 — `/api/ready` probes Postgres)**

- `/api/ready` returns 503 with `postgres.error` mentioning `too many connections`, `remaining connection slots`, or timeouts

**Diagnosis**

1. Check Neon **Connections** graph — flat line at the limit means exhaustion, not slow queries.
2. Confirm Vercel uses the **pooled** `DATABASE_URL`, not direct.
3. Inspect `PG_POOL_MAX` — try lowering to 2 on Vercel if instance count is high.
4. Run `pingPostgres()` with production env (or, after #437, read `postgres.error` from `/api/ready`).
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
- `db/migrations/` — schema applied on docker-compose first boot and via `npm run postdb:migrate`
- [Vercel previews policy](../agents/policies/vercel-previews.md) — deploy budget (orthogonal to database wiring)
