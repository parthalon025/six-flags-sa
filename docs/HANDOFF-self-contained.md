# Handoff — the fully self-contained phone version

Goal: after each phone has the app once, a group can run a party with **no server
in the loop at all**. No Vercel, no laptop, no relay, no tunnel.

This document is for whoever picks that up. It states what is already done, the
two things standing in the way, a design for the one that is solvable, and —
importantly — the network conditions under which this genuinely cannot work.

Read [docs/guide/index.md](guide/index.md) and [architecture-map.md](architecture-map.md) first. This assumes them.

---

## Where the line currently sits

The party is already phone-authoritative. A host phone holds the roster, decides
what is true, and broadcasts patches; everyone else runs a thin replica. That
part needs no server and is done.

What still reaches for infrastructure:

| Need | Can a phone do it? | Served today by |
|---|---|---|
| Hand the app to a phone that doesn't have it | **No** — a browser cannot listen on a socket | Vercel, or a laptop |
| Hold party state and decide truth | **Yes, already** | the host phone |
| Introduce two peers so they can connect directly | **Not yet** | the mailbox relay |
| Carry party traffic once connected | **Yes, via WebRTC** | (currently the relay — see prerequisites) |

Row 1 is unavoidable for a web app and is not worth fighting: it happens **once
per phone, ever**. After the PWA is installed the service worker holds the shell,
the 260 KB park map and the ride database, and the app boots with the network
off — that is already verified by the suite:

```
PASS the map still draws with the network cut
PASS ride heights still work with the network cut
```

Row 3 is the real work, and it is solvable.

---

## Why signalling needs a server today

Two WebRTC peers must exchange an SDP offer and answer before a direct channel
exists. That exchange has to travel over *something*. Today it goes through
`POST /api/mailbox/[partyId]` (see `lib/transport/signaling.js`), which is the
last reason a party touches a server after everyone has the app.

The fix is to carry the offer and answer **in the QR code itself**. The host
already renders a QR; make it carry the offer. The joiner scans it, produces an
answer, and shows its own QR back. The host scans that. Channel open, no server
ever contacted.

This is the same pairing trick used by offline crypto wallets. It is well-trodden
and it works — with the caveats below, which are the part that will bite.

---

## Design

### The exchange

```
host                                  joiner
────                                  ──────
create RTCPeerConnection
create data channel "party"
createOffer()
wait for ICE gathering COMPLETE   ←── this is the important bit
compress + encode SDP
render QR  ─────────────────────────► scan
                                      setRemoteDescription(offer)
                                      createAnswer()
                                      wait for ICE gathering complete
                          scan ◄────── render QR
setRemoteDescription(answer)
                    data channel opens
```

### Non-trickle ICE is mandatory

With a signalling channel you trickle candidates as they arrive. Here there is no
channel until the exchange completes, so **every candidate must already be inside
the SDP** before the QR is drawn. Wait for `icegatheringstate === 'complete'` (or
a null candidate) before encoding.

Budget 1–3 s for gathering. Show it — a QR that appears before it is scannable is
worse than a spinner.

### Making it fit in a QR

A QR code tops out around 2,953 bytes (version 40, error correction L), and low
error correction on a phone screen in July sun is optimistic. Target **under
~800 bytes** so you can use a higher correction level.

A raw SDP with gathered candidates runs 1.5–4 KB. Three things bring it down, in
order of effect:

1. **Strip everything that isn't the data channel.** No audio, no video, no
   codecs. An `application/DTLS/SCTP` m-line only. This is most of the win.
2. **Compress.** `CompressionStream('deflate-raw')` then base64url. Ships in
   Chrome 80+ and Safari 16.4+. SDP is extremely repetitive and compresses hard —
   expect 3–5×.
3. **Drop candidates you will not use.** On a shared LAN, host candidates are
   enough; srflx/relay candidates are dead weight if you are not using STUN.

Verify the result empirically rather than trusting this estimate — print the byte
count at each stage and check the worst case (a phone with several interfaces up:
wifi, cellular, and a VPN will each contribute candidates).

### Only the host needs a scanner

The stock camera app can carry one leg of the exchange but not the other, and
this asymmetry is worth designing around.

Encode the host's offer as a URL — `https://…/pair#<offer>` — and the **joiner
needs no scanner at all**: iOS and Android camera apps both recognise URL QR
codes and open them. That is already how the normal invite works
(`encodeInvite` produces `${origin}/join#…`, asserted by the suite).

The return leg cannot work that way. The host has to receive the joiner's
answer, and if the answer QR is a URL then the host's camera app *opens* it —
navigating the host's page and destroying the `RTCPeerConnection` that is
sitting in memory waiting for exactly that answer. An `RTCPeerConnection` cannot
be serialised or restored, and is not available in a service worker, so nothing
survives the navigation. **The host must scan in-page.**

Consequence: the bundled decoder is needed on the hosting phone only, and only
in self-contained mode. Everyone else uses the camera they already have. That is
a much smaller dependency than requiring it of every device — load it lazily, on
entering pairing mode, so a joiner never downloads it.

### Scaling past two phones

The host scans one answer per joiner. For a family of four to six that is
acceptable and honest. If it becomes annoying, the second joiner can be signalled
*through* the already-connected first peer — the mesh relays its own signalling —
which reduces it to one scan per new member. Do not build that until the two-phone
case is solid.

### The party key

It already rides in the QR (`lib/core/session.js`, `encodeInvite`). Nothing
changes: the same QR carries session credentials and the offer. Keep the key in
the fragment for the link path, and keep the two payload shapes distinguishable
so a scanner can tell an invite from an offer.

---

## The honest network reality

**This will not work on typical park guest wifi, and that must be said in the UI
rather than discovered in a queue.**

- **AP isolation.** Public guest wifi almost always isolates clients from each
  other. Two phones on Kings Island's wifi will very likely be unable to reach
  each other at all, no matter how good the signalling is. Nothing in the app can
  defeat this; it is the network refusing to forward the packets.
- **mDNS candidate obfuscation.** Browsers hide local IPs behind
  `<uuid>.local` mDNS candidates unless the page holds camera/mic permission.
  Resolution between two phones usually works on a normal LAN and often fails on
  a locked-down one.
- **Cellular.** Two phones on cellular are behind carrier-grade NAT on different
  networks. Direct connection needs STUN to discover reflexive candidates and
  frequently TURN to relay — both are servers, which defeats the goal.

**The configuration where this genuinely works with zero infrastructure is a
personal hotspot**: one phone shares its connection, the others join it. That
makes a real LAN with the host at the centre, no AP isolation, and host
candidates that resolve. The product spec already lists Personal Hotspot as a
transport — this is what makes it meaningful.

Recommendation: present self-contained mode as **"works when you're all on the
same hotspot"**, not as a general-purpose replacement for the relay. Keep the
relay as the fallback it already is. Automatic transport selection
(`lib/transport/registry.js`) already handles falling back; the honest framing is
that this adds a better path, not that it removes the old one.

---

## Prerequisites — do not start before these

1. **WebRTC must actually carry traffic.** As of this writing it does not: a host
   with no peers has no data channel, its first beacon throws, the manager fails
   it over to the relay, and then nobody is listening for offers. QR signalling
   is pointless until a data channel works over the existing relay-based path.
2. **Of the three open behavioural defects this doc originally listed, two are
   closed** (#311):
   - **Split-brain election** — `lib/party/election.js`'s `noteHostSeen` stands
     an open election down the moment host traffic is heard; `handleClaim` /
     `handleVictory` reassert (rate-limited by `reassertGapMs`) or step down by
     the same total order (`outranks`) every peer computes independently.
     Regression coverage: `test/app/election.test.mjs` (host-traffic-cancels,
     reassert rate limiting, yield-to-a-genuinely-better-rival) and
     `test/app/party-protocol.test.mjs` ("two phones that promote at once
     settle on the total order", "the election margin DOES resolve a split
     brain once the battery gap clears it").
   - **Range between phones** — `components/PartyPanel.jsx` computes per-member
     distance and bearing for located Members and range to the Rally Point.
     Covered by `test/app/functional.mjs`'s "roster shows a real walk and
     bearing to phone B".
   - **Leave not propagating** is still open — tracked in #367, out of scope
     for #311. Debugging QR signalling on top of a leave that can strand a
     ghost Member on some replicas will waste your time; close #367 first.

---

## Implementation sketch

| File | Change |
|---|---|
| `lib/transport/qrSignal.js` *(new)* | `encodeOffer(sdp)` / `decodeOffer(s)` / `encodeAnswer` / `decodeAnswer`. Strip → deflate → base64url, and the inverse. Pure and unit-testable — no DOM. |
| `lib/transport/webrtc.js` | Add a `signal: 'qr'` mode alongside the mailbox one. Force non-trickle: resolve only on `icegatheringstate === 'complete'`. Accept `iceServers: []` so no STUN is contacted. |
| `components/PairQr.jsx` *(new)* | The two-sided pairing UI: render our QR, scan theirs, show gathering/scanning/connected states. |
| `components/QrScanner.jsx` | Needs a real decoder for iOS — Safari has no `BarcodeDetector`. `jsQR` (~40 KB) or `zxing-wasm`. The only new dependency this work needs, and only the hosting phone loads it: import it lazily when pairing mode opens, so a joiner using its stock camera never downloads it. |
| `lib/partyRuntime.js` | Offer "pair without a server" as a join path next to QR/link/code. |
| `test/unit.mjs` | Round-trip the codec; assert the encoded payload stays under the QR budget for a realistic multi-interface SDP. |
| `test/functional.mjs` | Two contexts, offer/answer passed directly between them (no camera), asserting the data channel opens and a roster converges with the relay blocked via `context.route()`. |

Blocking the relay in the functional test is the assertion that matters. If the
party still forms with `/api/mailbox/**` routed to `abort()`, it is genuinely
self-contained. Anything less proves nothing.

---

## Open questions for whoever picks this up

- Does a stripped, deflated, host-candidates-only SDP reliably fit one QR on a
  phone with wifi + cellular + VPN up? Measure before designing around it.
- Is two-way scanning acceptable to real users, or does the mesh-relay
  optimisation need to land in the same change?
- Should self-contained mode be automatic (try it, fall back) or an explicit
  "we're all on one hotspot" toggle? Automatic is nicer when it works and
  confusing when it half-works — an explicit mode may be the honest choice given
  the AP-isolation reality.
- iOS PWA storage eviction: an installed PWA's cache can be evicted after periods
  of disuse, which would silently reintroduce the app-delivery dependency at the
  worst moment. Worth measuring before promising "install once, works forever".
