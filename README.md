# Kings Island — Party Tracker

A live situational-awareness map for a group at Kings Island (Mason, Ohio). Built with
Next.js 15 (App Router) and React 19.

- **Drawn park map.** Not tiles and not the park's printed map — the whole thing is
  real OpenStreetMap geometry for Kings Island, projected to Web Mercator and painted
  as SVG: midways, buildings, water, Soak City slides, and every coaster's actual track
  centreline. Pan with one finger, pinch or scroll to zoom.
- **Height requirements on all 65 rides.** Drag one slider to a rider's height and the
  map dims everything they can't get on, with a running tally of what's open, what needs
  an adult along, and what's closed.
- **Live party tracking.** One person starts a party and hosts it on their own phone;
  everyone else joins by scanning the QR, opening the invite link, or typing the
  6-character code. Range in feet, compass bearing, nearest ride, status and staleness
  for each person. If the host walks off, the best-placed remaining phone takes over the
  roster on its own, keeping the same party code.
- **A glance rail instead of a menu.** The collapsed sheet is a live dashboard, not
  boilerplate: one card per party member plus the meet-up and your destination, each
  showing walking time as the headline, distance underneath, and an arrow aimed
  relative to the way you're facing when the compass is on. With no party running it
  falls back to the nearest restroom, food and first aid. Tap a card to fly to it.
- **Walking directions to anything on the map.** Tap Go on a card, or "Walk me there" on
  a ride, and the route is drawn along the park's actual footpaths — with the next turn,
  the distance to it and the time left in a strip under the header. Turns are named after
  what you can see from them ("bear right at Juke Box Diner") because almost none of the
  park's paths have names. Walk off the route and it works out a new one.
- **Bearing tape.** A HUD strip showing every party member, the meet-up and your selected
  destination at their true bearing — useful when you can't see over a crowd.
- **Daylight and night maps.** Daylight is a printed-park-map palette — white midways on
  paper, dark type, darker marker colours — meant to be readable on a phone in direct
  July sun. Night is the low-glare version for after the lights come on. It follows the
  phone's own appearance setting until you pick one, then remembers your choice. Toggle
  with the half-circle button in the header, or from the Me tab.
- **Meet-up pin** shared to the whole party, with distance and walk time.
- **Walking time is the headline everywhere**, with feet as the secondary figure — in a
  park "4 min" answers the question and "825 ft" doesn't.
- **NEED HELP status** pulses that person's marker, vibrates every phone in the party and
  reports their range and bearing.

## Get it running

**[INSTALL.md](INSTALL.md) is the guide for the people who will actually use this** — it
assumes no terminal and leads with why a plain link cannot work.

The two short versions:

```bash
npm run phone        # builds, starts, tunnels, prints a QR — scan it
```

or click Deploy in [INSTALL.md](INSTALL.md) for a permanent link. There is nothing to
configure either way: no database, no environment variables, no accounts. A party is
hosted by one of the phones in it.

For development:

```bash
npm run setup        # checks Node, installs, builds
npm run dev          # http://localhost:3000
```

`localhost` counts as a secure context, so GPS works there without a tunnel.

## Walking directions

Routes are worked out on the phone, from the same `public/parkmap.json` the map is drawn
from. There is no routing service, no API key and no network call: the file already
carries every midway, queue and service road as an OpenStreetMap polyline, and
`lib/routing.js` welds those polylines into a graph and runs A* across it.

The welding is the whole job. Raw OSM geometry looks connected on screen and is full of
holes as a graph, so the build runs four repair passes and says so in one place:

| Pass | What it fixes |
|---|---|
| weld | vertices within 6 m are one junction, whatever the source says |
| split | two ways that cross without sharing a node get one |
| stitch | a path that stops 15 m short of the midway it obviously joins |
| mend | two paths a few paces apart that need a quarter mile of walking between them |

Straight from the file the network is 221 disconnected pieces and half of all routes
between two rides have no path at all; after the passes it is two, and the second one is
the car parks and the north gate, which genuinely have no footpath drawn to them. Every
ride in the park lands on the main one. The mend pass will not cut through a building or
across water — where the gap is the mapper being right, it leaves it alone.

Costs are metres, weighted: a queue is priced at four and a half times its length because
it is a dead end with a ride at the bottom, not a through-route, and a service road at
two and a half because it is legal to draw and rude to walk down. Walking time uses the
same crowded-park pace as everything else in the app.

Instructions are read off a *smoothed* copy of the route rather than the drawn one — a
midway surveyed from aerial imagery bends every few metres, and reading turns off that
gives "bear left, bear right, bear left" for one gentle curve. Steps closer together than
35 m fold into the one before them.

When either end is nowhere near a path, when the network genuinely does not join them, or
when the walk it finds is more than three and a half times the straight line, the route
falls back to a dashed straight line and the banner says so rather than inventing a walk.
That last case is almost always two rides a few paces apart with a building between them,
where "it is right there" beats a 270 m lap of the block. A straight line is also what you
get for the second or two before the graph finishes building, which happens when the
browser is idle rather than during the first paint of the map.

## How the party works

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

## API

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
| `PATCH` | `/api/member/[partyId]`, `/api/favorites/[partyId]` |
| `GET` | `/api/rides`, `/api/rides/[id]` |
| `GET` | `/api/health`, `/api/ready`, `/api/metrics`, `/api/version` |

Parties expire after 8 hours; a member drops off the roster after 45 minutes of silence
and is dimmed as stale after 5.

Vercel's routes deliberately implement no SSE — serverless cannot hold a stream open — so
clients there fall back to polling. Upstash is optional and only makes a *cloud-hosted*
party durable across instances; it is not needed for phone-hosted parties, which is the
normal case.

## What a browser cannot do

Stated plainly rather than stubbed to look finished:

- **Background location.** There is no web API for it. When the screen locks, the page is
  suspended and positions stop updating — a phone in a pocket goes stale rather than
  reporting a stale position as live. The map dims that person after 5 minutes. Fixing
  this needs a native wrapper with the OS background-location permission.
- **BLE advertising and discovery**, as above.
- **A phone acting as an HTTP listener**, and `party.local` mDNS resolution. The host
  phone runs the party *service*; peers reach it over WebRTC, not a socket it opened.

## Tests

```bash
npx playwright install chromium     # once
npm run test:unit                   # pure layers, no browser, seconds
npm run build && npm start &
npm test                            # unit, then the three-phone behavioural suite
npm run test:visual                 # screenshots to test/shots/
npm run test:theme                  # daylight and night, via the real toggle
npm run test:ux                     # glance rail with a live party
```

`test/unit.mjs` exercises the pure layers directly: version arithmetic, duplicate
suppression, seal/open against wrong keys and tampered ciphertext, the election ordering,
every GPS cadence band and broadcast-gate reason, and the router — the last of those
against the real park file rather than a fixture, because a graph that routes perfectly
over a toy and badly over Kings Island is the failure worth catching.

`test/functional.mjs` is the one that matters. Three phones in one browser: A hosts, B
joins by typing the code, C joins from the invite link, then A is taken away and the
other two have to keep the party alive between them. It asserts on behaviour, not
appearance — that the key never leaves the URL fragment, that a party id is not its code,
that NEED HELP reaches the other phone, that the roster never collapses while the host is
replaced, and that the map and ride heights still work with the network cut.

Both suites take `BASE_URL`, and `CHROMIUM_PATH` points them at a browser already on the
machine instead of Playwright's own copy.

## A word on privacy

Party codes are six characters from a 32-symbol alphabet — short enough to read aloud in
a queue, and short enough to guess. The party key is not the code: it is 256 random bits
minted when the party starts, and it reaches the other phones inside the QR code or the
invite link's fragment, which browsers never send to a server. A phone joining by typed
code cannot be handed 256 bits by hand, so it asks the host for them once, over a single
exchange sealed with a key derived from the code — the only frame in a party's life a
guessed code can open, and only while the host is still answering. Treat a party as a
semi-public channel anyway, because a code given to the wrong person is an invitation: use
first names, and leave when you're done, which deletes your record from the server. Nothing
is sent anywhere until you actually join a party; before that your position stays in the
browser.

## Where the data came from

- **Map geometry and ride positions** — OpenStreetMap contributors, pulled via the
  Overpass API and licensed ODbL. Positions are building footprints, not queue entrances.
- **Height requirements** — compiled from Kings Island Central and Theme Park Insider,
  reflecting the 2026 season. They change between seasons and the ride operator measures
  at the gate and has the final say, so the app says as much on the Rides tab.
- Flight of Fear is not mapped in OpenStreetMap; it's placed on its show building and
  flagged as approximate in the app.
- Two renames are reflected: Backlot Stunt Coaster is now Queen City Stunt Coaster, and
  Boo Blasters on Boo Hill is now Phantom Theater: Opening Nightmare.
- The Bat's posted minimum is reported inconsistently across sources (42–54"); the app
  uses 48" and tells you to confirm at the gate.

The park's own printed map artwork is copyrighted and is deliberately not used here.

## Layout

```
lib/core/                     the domain — pure, no I/O, runs anywhere
  state.js                    party/member/ride model, op reducer, versioning
  protocol.js                 message kinds, frames, duplicate suppression
  crypto.js                   AES-GCM sealing; party id bound as additionalData
  session.js                  the join credential; invites, key in the fragment
  ids.js                      party codes, member ids, tokens
lib/transport/                the pipe — moves sealed blobs, holds no key
  types.js                    the contract every transport is built with
  registry.js                 probing, rank order, failover, replay
  webrtc.js  signaling.js     star topology, host at the centre
  localHttp.js  cloudRelay.js  mailboxClient.js
  bluetooth.js                honest capability probe; see its header
  offlineQueue.js             durable outbox, replayed on reconnect
lib/party/                    the halves of the protocol
  hostService.js              authoritative state, broadcasts patches
  client.js                   thin replica, submits commands, requests resyncs
  election.js                 scoring, leader election, host migration
lib/gps/adaptive.js           motion classification, cadence, broadcast gating
lib/partyRuntime.js           the seam: session, transports, host service or client
lib/geo.js                    distance, bearing, Mercator projection
lib/routing.js                path graph, repair passes, A*, turn-by-turn
lib/park.js  lib/theme.js     POIs and height eligibility; day/night palettes
lib/rides.json                152 places, 65 with height rules
lib/serverStore.js            memory / Upstash backend for the cloud fallback
app/
  page.js                     client state and the sheet
  join/page.js                invite landing; reads the fragment, never the query
  api/mailbox/…               the relay
  api/…                       party, members, location, rides, health, metrics
components/
  ParkMap.jsx                 SVG renderer, pan + pinch zoom
  GlanceRail.jsx              the live card rail in the collapsed sheet
  PartyPanel.jsx              roster, QR, join, status, meet-up
  QrScanner.jsx               camera join; says so plainly where unsupported
  Diagnostics.jsx             active transport, probe results, queue depth
  RidesPanel.jsx              height filter and park search
  GpsGate.jsx                 permission dialog with per-failure guidance
  InstallCard.jsx             add-to-home-screen, Android prompt or iOS steps
  CompassTape.jsx             bearing HUD
  NavBanner.jsx               the next turn, the distance to it, the time left
  DirectionsPanel.jsx         the whole step list, greying out behind you
  useGeolocation.js           adaptive watchPosition, compass, battery
server/index.mjs              zero-dependency host: mailbox, REST, SSE, metrics
scripts/
  phone.mjs                   one command to a QR you can scan
  setup.sh                    toolchain check, install, build
test/
  unit.mjs                    the pure layers, no browser
  functional.mjs              three phones, one browser, real behaviour
  browser.mjs                 shared plumbing; honours CHROMIUM_PATH and BASE_URL
  visual.mjs  theme.mjs  ux.mjs
public/
  sw.js                       offline cache: shell, map and rides; never the roster
  parkmap.json                drawn map layers (~260 KB)
  manifest.webmanifest        home-screen install
Dockerfile  docker-compose.yml
```
