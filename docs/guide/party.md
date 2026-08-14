# How the party works

[← README](../../README.md) · [Guide index](index.md)

One device is the **host**: it holds the authoritative roster and decides what is true.
Everyone else runs a thin client that submits commands and applies the patches that come
back. The host is normally a phone. It can also be a long-running Node process if you
want parties that outlive every phone leaving.

```
lib/core/state.js     the rules — pure, no I/O, identical on phone and server
lib/core/protocol.js  the wire — sealed envelopes, versioned frames, dedupe
lib/transport/types.js  the pipe — moves opaque blobs, holds no key
```

Every accepted command bumps `version` by exactly one. A replica holding N that receives
N+2 knows it missed a patch and asks for a resync, so gaps repair themselves rather than
silently diverging.

### Transports

Chosen automatically, in this order, with failover and replay:

| Rank | Transport | When it wins |
|---|---|---|
| 1 | `local-http` | a self-hosted Node host is reachable on the LAN |
| 2 | `webrtc` | phones can reach each other directly — the intended path |
| 3 | `bluetooth-le` | never, in a browser (see below) |
| 4 | `cloud-relay` | phones are on different networks |
| 5 | `offline` | nothing is reachable; frames queue and replay on reconnect |

Nothing above the transport layer knows which is active, and no transport can read what
it carries — the key never leaves the phones.

**Bluetooth is deliberately a stub that reports the truth.** Web Bluetooth exposes only
the GATT *central* role, so a page can connect outward to something already advertising
but can never advertise, never run a GATT server, and never scan raw advertisements. Two
phones running this app are both centrals and cannot see each other. `probe()` returns
`no-peripheral-mode` and the manager skips it. Making it real needs a native shell, not
more JavaScript; the file header says exactly what.

### If the host walks off

The remaining phones elect a new one on battery, then signal, then network, then device
performance, then join order, with ties broken so every peer independently reaches the
same winner. The new host takes leadership through the reducer, so the change lands on
every replica as an ordinary patch at `version + 1` — no resync, no empty roster, same
party code. Nobody is asked anything.

### Or run the standalone host

`server/index.mjs` is a zero-dependency `node:http` server running the *same*
`lib/core/state.js`, plus a server-sent-event stream so the roster pushes instead of
polling. It runs anywhere you get a long-lived Node process:

```bash
node server/index.mjs                                  # :8787
PORT=8080 DATA_FILE=./parties.json node server/index.mjs
```

```bash
docker compose up -d          # app on :3000, host on :8787
```

Point the app at it and it goes into the transport list ahead of the cloud relay, and
into the invite so joiners try it first:

```
NEXT_PUBLIC_SYNC_URL=https://your-host.example.com
```

Self-hosting buys long-lived parties and `/api/metrics`. It is not required.

---
[← README](../../README.md) · [Guide index](index.md)
