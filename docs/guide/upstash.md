# Upstash Redis runbook

Park Bound’s cloud party store on Vercel uses **Upstash Redis** (REST) so parties survive
serverless cold starts. Without a complete credential pair the store falls back to a
process-local `Map`, which is fine for `npm run dev` but **not** on Vercel production.

## When Redis credentials are required

| Environment | Upstash REST pair | Party store |
|-------------|-------------------|-------------|
| Local dev / CI tests | unset | In-memory (intentional) |
| Vercel preview | optional | Redis when set, else memory |
| Vercel **production** | **required** | Redis |

On Vercel without credentials, consecutive requests land on different instances and parties
appear to vanish at random.

## Runtime symptoms (before the deploy gate catches it)

| Signal | Meaning |
|--------|---------|
| `POST /api/party/create` returns `"durable": false` | Store is process-local — party will not survive redeploy |
| `GET /api/ready` reports `"backend": "memory"` | Upstash is not configured on this instance |
| Guests lose party codes after a cold start | Production is running without Redis |

Phone-hosted parties (the normal case) do not use the cloud store and are unaffected.

## Guards (#371)

1. **Deploy gate** — `scripts/lib/vercel-ignore.mjs` skips production builds when
   `VERCEL_ENV=production` and neither Upstash nor Vercel Marketplace KV credentials are
   complete. Check the Ignored Build Step log for
   `Upstash Redis credentials are required in production`.
2. **Readiness** — `/api/ready` reports `backend: "memory"` when Redis is not configured;
   with Upstash set it probes the store and returns **503** when Redis will not answer.

Accepted credential pairs (either is enough):

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — Upstash console
- `KV_REST_API_URL` + `KV_REST_API_TOKEN` — Vercel Marketplace integration

Dev and test without the variables behave as before: memory backend, no warning noise.

## Provision Upstash (human step)

1. Vercel dashboard → Storage → Create → Upstash Redis (or link existing).
2. Link the database to the **party-tracker** project.
3. Confirm the REST URL + token appear in Production environment variables.
4. Redeploy production or merge an app change so the Ignored Build Step runs.

This repo does not set dashboard secrets; it only documents and guards the contract.

## Verify after setup

```bash
curl -sS "https://<your-production-domain>/api/ready" | jq .
```

Expect `ready: true`, `backend: "redis"`, and `durable: true` on party create when the
store answers.

## Related issues

- **#373** — env drift detection for partial/mismatched credential pairs.
- **#443** — CI full-stack readiness gate consuming `/api/ready`.

See also [API guide](./api.md) and [Databricks ops](../adr/0010-databricks-ops-free-tier.md).
