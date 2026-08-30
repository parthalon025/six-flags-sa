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

## Key namespace and TTLs (#370, #386, #390)

Every key this app writes to Redis is prefixed `ki:` — **Kings Island**, the first venue this
shipped for — and every key carries a TTL. There is no cleanup job or cron: a key that stops
being touched expires on its own within its row's window, so the store's size tracks *live*
parties and rate-limit windows, not history.

| Prefix | What it holds | TTL | Set by |
|--------|---------------|-----|--------|
| `ki:party:{id}` | Party state (members, positions) | `PARTY_TTL_MS` (8h), refreshed on every write | `writeParty()` |
| `ki:code:{code}` | Join-code → party id | `PARTY_TTL_MS` (8h) | `allocateParty()` / `writeParty()` |
| `ki:zbox:{id}` | Mailbox (sorted set, capped at `MAILBOX_DEPTH`=500) | `MAILBOX_TTL_S` (5 min) per entry via the append Lua script | `appendMailbox()` |
| `ki:seq:{id}` | Mailbox sequence counter | `PARTY_TTL_S` (8h) | `appendMailbox()` |
| `ki:subs:{id}` | Push subscriptions (hash, one field per endpoint) | `PARTY_TTL_S` (8h), refreshed on every subscribe; individual endpoints `HDEL`-ed on unsubscribe or push failure | `addSubscription()` / `removeSubscription()` |
| `ki:rl:{name}:{subject}:{window}` | Rate-limit bucket (INCR counter) | `ceil(windowMs / 1000) + 1` seconds — the bucket outlives its own window by one tick, then evicts itself | `rateLimit()` |
| `ki:guest-traces:{venueId}` | Guest walk traces (list, capped at 500/venue) | 90 days | `appendGuestTraces()` |
| `ki:world:{venueId}` | Park-wide Marks + Thanks | 90 days | `worldMarks.js` |

Because every write refreshes or sets its own TTL, `ki:subs:{partyId}`'s growth is bounded the
same way as the party itself: it cannot outlive the party by more than a redeploy cycle, and a
stale push endpoint (rotated or deleted) is `HDEL`-ed off the hash the moment a send to it
fails or the client resubscribes — it does not wait for the whole hash to expire. Run
`npm run redis:census` (or `node scripts/redis-key-census.mjs`) for a live grouped count by
prefix — see [operator census](#operator-key-census-389) below.

**Namespace decision:** document-only, not a `pb:` migration (#386). Migrating would mean a
dual-read window (write both prefixes, read `pb:` falling back to `ki:`, then delete the old
prefix once every key naturally expires — at most `PARTY_TTL_MS` after cutover, since nothing
here is retained longer). That is real code and real risk for a purely cosmetic rename: every
key already carries a short TTL, so `ki:` costs nothing beyond being a slightly dated name in
the SCAN output. Revisit only if this store is ever shared with an app that is not
Kings-Island-shaped enough for the prefix to read as misleading.

## Operator key census (#389)

```bash
npm run redis:census
```

Runs a `SCAN ki:*` and reports grouped counts per prefix (party, mailbox, rate-limit, guest
traces, …) plus an `(unrecognised prefix)` bucket that should always read zero — a non-zero
count there means a new key shape shipped without a matching row in `KEY_PREFIXES`
(`scripts/lib/redis-key-census.mjs`) and this table above. Useful for capacity planning and
confirming a suspected leak (a bucket that keeps growing across two runs an hour apart, when it
should be bounded by concurrent parties).

## Free-tier command budget (#374, #380)

```bash
node -e "console.log(require('./scripts/lib/upstash-budget.mjs'))"  # or import it directly
```

`scripts/lib/upstash-budget.mjs` models command volume as *members × poll interval ×
(read + write) + rate-limit INCRs*, reading its per-command costs from the actual code paths
(`readMailbox()` is a 2-command pipeline; `appendMailbox()` is one `EVAL` plus the durable
`mailboxWrite` rate-limit hit). At the model's defaults — a 6-member party, 4 active hours/day,
polling every `DEFAULT_POLL_MS` (2.5s), 20% of polls also producing a write — **one party costs
about 89,856 commands/day**.

That number is the reason this section exists: Upstash's free tier (500,000 commands/day, see
`FREE_TIER_DAILY_COMMAND_LIMIT`) sounds generous until you multiply — it comfortably covers
**5 concurrently active parties** at those defaults but is **already exceeded by 10**. A single
small park running this app for real, on a busy day, can plausibly leave the free tier during
peak hours. This is a capacity-planning input, not an alarm: `rateLimit()` fails open (see
[Security](./security.md)), so exceeding a paid Upstash plan's throughput degrades rate
limiting and mailbox latency, not correctness — but it is real dollars, so alert on it before
it becomes a surprise invoice or a degraded relay:

- **Upstash console → Usage** — watch daily command count against plan limit; set the
  dashboard's built-in usage alert (console → project → Notifications) rather than polling it
  by hand.
- **Escalate a plan change** once sustained daily volume crosses roughly 60–70% of the current
  plan's command budget (`freeTierHeadroom()` reports the exact fraction for a given
  `dailyCommands` figure) — not at 100%, since Upstash bills overage rather than hard-failing,
  but a plan bump is cheaper and calmer done ahead of the invoice than after it.
- Re-run the estimate with this park's actual concurrency (`estimateParkDailyCommands`) rather
  than trusting the defaults above once real traffic numbers exist.

## Credential scope: no read-only token (#393)

`serverStore.js` uses one credential pair for every command — reads and writes alike — and
`turbo.json` no longer lists `KV_REST_API_READ_ONLY_TOKEN` as a pass-through env var (it was
declared, unused, since the Vercel Marketplace KV integration injects it automatically whether
or not an app reads it). Splitting reads onto a read-only token was considered and rejected:
Upstash's read-only token is a credential-scoping feature, not an authorization boundary this
app needs — every Redis command already runs inside the operator's own serverless functions,
never a client's browser, so a leaked read-write token and a leaked read-only token both let an
attacker read party state, and only the read-write token additionally lets them write it. The
actual boundary that matters (guests cannot address Redis directly) does not change either way.
Revisit only if a future feature calls Redis from somewhere less trusted than this app's own
API routes.

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
- **#377** — CI optional smoke test against real Upstash test credentials.
- **#394** — exporting `ki:guest-traces:{venueId}` for the venue builder — see
  [venue builder guide](./venue-builder.md#guest-walk-traces-394).

See also [API guide](./api.md), [Security](./security.md),
[ADR-0026 Upstash relay store](../adr/0026-upstash-relay-store.md), and
[Databricks ops](../adr/0010-databricks-ops-free-tier.md).
