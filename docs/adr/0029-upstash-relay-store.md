# Upstash Redis as the ephemeral party relay store

**Status:** Accepted — 2026-08-28
**Related:** [`docs/guide/upstash.md`](../guide/upstash.md) (ops runbook), [`docs/guide/security.md`](../guide/security.md) (rate-limit semantics), [ADR-0024 postdb-factory-bus](./0024-postdb-factory-bus.md) (the durable, Postgres-backed side of this repo's storage split)

Closes #387 — part of the [Upstash roadmap](https://github.com/parthalon025/six-flags-sa/issues/369).

## Context

Park Bound's **party mesh** (live location, mailbox chat, push subscriptions, guest walk
traces, park-wide Marks) is not durable data — it is a relay between phones that are already
the source of truth for their own location. Vercel's serverless functions are stateless
between invocations, so two requests from the same party can land on different instances.
Something outside the function has to hold the relay state for the seconds-to-hours it
matters, then let it go.

Postgres (via Neon, see ADR-0024) is deliberately not that something: profile, contribution,
and billing rows need transactional durability and relational queries; party mesh state needs
neither — it needs a fast key-value hop that can vanish on its own schedule.

## Decision

Use **Upstash Redis over its REST API** (not the TCP protocol) as the relay store, with an
in-process `Map` fallback when no credentials are configured.

- **REST, not TCP** — Vercel's serverless functions are short-lived and do not keep a
  persistent socket pool between invocations; a REST call is one HTTP round trip per command
  with no connection to leak or exhaust. `apps/party-tracker/lib/serverStore.js` is the single
  seam (`redisCommand` / `redisPipeline` / `redisEval`); nothing else in the app touches Redis
  transport directly.
- **Fallback to memory, not to failure** — `usingRedis` in `serverStore.js` is `true` only when
  a full credential pair is present. Without one, every store function switches to a
  `globalThis`-scoped `Map`, and `POST /api/party/create` reports `"durable": false` so the
  client and ops both see the degradation. This keeps `npm run dev` and CI free of a Redis
  dependency while making production's requirement explicit and machine-checkable — see the
  deploy and readiness guards in `docs/guide/upstash.md`.
- **Every key expires** — nothing in this store is written without a TTL (see the key table in
  `docs/guide/upstash.md`). A party that nobody touches for `PARTY_TTL_MS` (8h) disappears on
  its own; there is no cleanup job, cron, or manual purge to maintain because there is nothing
  that survives past its TTL to clean up.
- **Fail-open rate limiting** — `apps/party-tracker/lib/rateLimit.js` counts hits in Redis
  (`INCR` + `EXPIRE` per hit) but treats a Redis error as "allow," never as a 500. Losing the
  relay's own bookkeeping is a strictly smaller failure than taking the relay down over it. See
  `docs/guide/security.md` for the full rationale and what remains a boundary.
- **Namespace stays `ki:`** — every key is prefixed `ki:` (Kings Island, the first venue this
  shipped for), documented rather than migrated; see the decision in
  `docs/guide/upstash.md#key-namespace`.

## Consequences

- **Phone-hosted parties are unaffected.** The common case — a party mesh formed directly
  between phones on the same network — never touches this store; Upstash only backs the
  optional cloud relay path.
- **A missing credential pair degrades silently in dev/preview, loudly in production.** The
  guards in `scripts/lib/production-redis-guard.mjs` (deploy-time) and `/api/ready`
  (runtime) are what make "loudly" true; without them this would be the same class of bug the
  Postgres guard (`production-postgres-guard.mjs`) exists to prevent.
- **Command volume is bounded by TTL and rate limits, not by a retention policy.** Capacity
  planning is a free-tier command budget question, not a storage-growth question — see the
  QPS model in `scripts/lib/upstash-budget.mjs` and its numbers in
  `docs/guide/upstash.md#free-tier-command-budget`.
- **Nothing here is durable across a Redis-region outage.** That is accepted, not mitigated —
  a party that loses its relay mid-visit can still re-form directly phone-to-phone; the guest
  loses convenience, not data they owned.

## Alternatives considered

- **Vercel KV directly** — same Upstash-backed product under Vercel's Marketplace integration.
  `serverStore.js` already accepts either credential pair (`UPSTASH_REDIS_REST_*` or
  `KV_REST_API_*`), so this is not a different decision, only a different provisioning path —
  see `docs/guide/upstash.md`.
- **A Postgres-backed relay (reuse Neon)** — rejected. TTL-per-row and INCR-style counters are
  native to Redis and require triggers or cron cleanup in Postgres; the relay's access pattern
  (many small, short-lived, high-frequency writes) is also a poor fit for a connection-pooled
  relational database on serverless.
- **No durable relay at all (phone-mesh only)** — rejected because it removes the "join a party
  after the mesh has already formed" and "come back after your phone died" cases that cloud
  relay exists to cover.
