# API

[← README](../../README.md) · [Guide index](index.md)

The mailbox is the only thing the networking needs. It moves opaque sealed blobs between
peers and cannot read them:

| Method | Route | Does |
|---|---|---|
| `POST` | `/api/mailbox/[partyId]` | Post `{ from, to, kind, data }`; `to` is a peer id or `*` |
| `GET` | `/api/mailbox/[partyId]?for=&since=` | Drain what is addressed to you |
| `GET` | `/api/mailbox/[partyId]/stream?for=` | The same, pushed (standalone host only) |

A REST surface exists for self-hosted deployments and for clients that would rather not
speak the protocol:

| Method | Route |
|---|---|
| `POST` | `/api/party/create`, `/api/party/join`, `/api/party/leave` |
| `GET` / `DELETE` | `/api/party/[partyId]` |
| `GET` | `/api/members/[partyId]` |
| `POST` | `/api/location/[partyId]`, `/api/heartbeat/[partyId]` |
| `PATCH` | `/api/member/[partyId]`, `/api/favorites/[partyId]`, `/api/ride-status/[partyId]` |
| `GET` | `/api/rides`, `/api/rides/[id]` |
| `GET` | `/api/weather?lat=&lng=` |
| `GET` | `/api/health`, `/api/ready`, `/api/metrics`, `/api/version` |

Parties expire after 8 hours; a member drops off the roster after 45 minutes of silence
and is dimmed as stale after 5. A ride report is hedged as possibly out of date after 30
minutes and dropped entirely after 90 — an hour-old "closed" is worse than no report,
because it sends a family walking to a ride that reopened forty minutes ago.

`/api/weather` is the one route that reaches outside this app. It proxies
[Open-Meteo](https://open-meteo.com), which needs no key and no account, so "there is
nothing to configure" stays true. Responses are cached for ten minutes per coordinate, and the
route serves a stale reading rather than an error when upstream is unreachable. Phones
keep the last good reading in `localStorage` and show it with its age, so losing signal
degrades the feature to the app that existed before it rather than to a spinner.

Because it is the one response in the app with no party in it, it is also the one the
CDN is allowed to hold: it ships `s-maxage`, so a park full of guests is one upstream
request per region per ten minutes rather than one per server instance. The failure case
is deliberately excluded — a 503 is `no-store`, so an outage cannot be cached past itself.

Vercel's routes deliberately implement no SSE — serverless cannot hold a stream open — so
clients there fall back to polling. Upstash is optional and only makes a *cloud-hosted*
party durable across instances; it is not needed for phone-hosted parties, which is the
normal case.

Polling is therefore the deployment's whole cost model, and the relay is written around
that. A mailbox is a sorted set scored by message sequence, so a poll asks for what is
past its cursor instead of reading the box and discarding most of it — a caught-up member
transfers nothing. Clients back off to fifteen seconds while their screen is off and catch
up the instant it comes back on; the messages that cannot wait for that go by push instead,
which is the division the two features make between them. Party creation and joining are
rate limited per address, relay traffic per party — per party rather than per address
because a park is one enormous NAT, and metering the address would meter the venue.

---
[← README](../../README.md) · [Guide index](index.md)
