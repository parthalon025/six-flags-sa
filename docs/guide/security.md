# Security notes

[← README](../../README.md) · [Guide index](index.md)

This page collects the deliberate security tradeoffs that live in code comments —
`apps/party-tracker/lib/rateLimit.js` above all — so an operator or reviewer does not have to
find them by reading the implementation. It documents decisions already made in the code, it
does not introduce new ones.

## Rate limiting fails open (#388)

`rateLimit()` in `apps/party-tracker/lib/rateLimit.js` counts a hit in Redis (`INCR` +
`EXPIRE`, or an in-process `Map` when Redis is not configured) and compares the count to a
per-endpoint limit. When the counting step itself throws — a Redis timeout, a bad response, a
transient network error — the function returns `{ ok: true, retryAfter: 0 }`: the request is
allowed through, uncounted.

This is deliberate, not an oversight:

> A limiter that 500s when its own backend hiccups would take the relay down for a reason
> unrelated to the traffic, which is a strictly worse failure than briefly not counting.

Rate limiting here exists to protect the relay's own capacity (Redis command budget, mailbox
depth, party-creation storms) from a runaway client — not as a security boundary against a
motivated attacker. The file's own header comment is explicit about why that boundary would be
weak anyway: this app runs on park wifi, where a family of six and several hundred strangers
share one NAT egress address, so `x-forwarded-for` identifies a *network*, not a person, and a
limit tight enough to matter to an attacker would lock out the crowd the app exists for.

**What actually bounds abuse**, in order:

1. **TTLs on everything.** Every key this app writes — party, mailbox, subscription, rate-limit
   bucket, guest trace, world mark — expires on its own; see the table in
   [`docs/guide/upstash.md`](./upstash.md). There is nothing for an attacker to make permanent.
2. **The party-existence check on the mailbox write path.** A mailbox write requires a party
   that already exists; it cannot be used to mint storage from nothing the way party creation
   can, which is why `storeCreate` (not `mailboxWrite`) carries the tighter, IP-keyed limit.
3. **`MAILBOX_DEPTH` (500).** A mailbox is capped regardless of how many messages arrive —
   `ZADD` + a bounded trim in the same Lua script that assigns the sequence number, so the cap
   holds even under a burst that outruns the rate limiter's own window.
4. **The rate limits themselves**, as a backstop against a script rather than a wall against an
   adversary — see `LIMITS` in `rateLimit.js` for the full table and the per-endpoint reasoning
   (party-create is IP-keyed and generous for NAT; mailbox and push traffic are party-keyed,
   which is NAT-safe by construction).

## The one durable exception: `mailboxRead`

Every other named limit in `LIMITS` is `durable: true` by default — it spends a Redis round
trip so the count survives across serverless instances. `mailboxRead` is the one endpoint
called with `{ durable: false }` in `apps/party-tracker/app/api/mailbox/[partyId]/route.js`:
reads create no storage, so the limit is a runaway-client backstop rather than a quota, and
paying a Redis round trip to police the cheapest endpoint in the app would cost more (in
Upstash command budget — see [free-tier budget](./upstash.md#free-tier-command-budget)) than
the traffic it is meant to police. The tradeoff: an in-process counter is per-instance, so the
effective ceiling on a multi-instance deployment is `limit × (concurrent instances)`, not
`limit` — acceptable because the limit exists to catch a client polling far faster than any
UI would, not to meter legitimate traffic precisely.

## Rate-limit key cardinality (#391)

Every durable limit writes one Redis key per fixed window:

```text
ki:rl:{name}:{subject}:{window}
```

`window = floor(now / windowMs)` — the key changes automatically at each window boundary and
carries its own `EXPIRE` (`ceil(windowMs / 1000) + 1` seconds), so old windows evict themselves
without a sweep job. Cardinality at any instant is bounded by
**(number of limit names) × (distinct subjects active in the current window)** — it cannot grow
unboundedly the way an un-expiring counter would, because a key that stops receiving hits
simply expires within one window past its last write.

Worst case at park scale, using the limits in `rateLimit.js` and the venues this repo ships
(a handful of parks, thousands of concurrent guests during a peak day):

| Limit | Keyed by | Window | Distinct subjects (worst case) |
|-------|----------|--------|-------------------------------|
| `partyCreate`, `storeCreate`, `guestTraceUpload`, `worldMark`, `contributionPost` | IP | hourly/etc. | Bounded by distinct egress IPs touching the deployment — in practice a handful per venue's wifi NAT, not per guest |
| `partyJoin` | IP | 10 min | Same IP pool as above |
| `mailboxWrite`, `pushSubscribe`, `pushSend`, `partyMutate` | party id | varies | Bounded by **concurrent active parties**, not guests — a party of six shares one set of keys |
| `mailboxRead` | — | — | Zero Redis keys — in-process only, see above |

Because every limit is keyed by IP or by party (never by individual guest), key count tracks
*parties and networks*, not *people*. A park with thousands of simultaneous guests organized
into a few hundred parties on a handful of NAT egress IPs produces on the order of a few
hundred to a few thousand live rate-limit keys at any moment — small next to the free-tier
storage this store is designed to fit inside (see [`upstash.md`](./upstash.md)). See
`estimateDailyCommands()` in `scripts/lib/upstash-budget.mjs` for the command-volume side of
the same math.

---
[← README](../../README.md) · [Guide index](index.md)
