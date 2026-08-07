# Party Tracker

A live situational-awareness map for a group at a big, crowded place. It ships with
Kings Island (Mason, Ohio) and Six Flags Fiesta Texas (San Antonio), and one command
builds a map of anywhere else OpenStreetMap covers. Built with Next.js 15 (App Router)
and React 19.

- **Drawn map, not tiles.** Real OpenStreetMap geometry projected to Web Mercator and
  painted as SVG: midways, buildings, water, slides, and every coaster's actual track
  centreline. Pan with one finger, pinch or scroll to zoom.
- **Any location.** `npm run venues:build -- --place "Somewhere"` pulls the geometry and
  the places, and the app offers the new map next time it boots — see
  [Building a map of somewhere else](#building-a-map-of-somewhere-else). Nothing in the
  renderer is amusement-park specific; a zoo, a campus, a festival ground or a town
  centre all draw through the same code.
- **Height requirements where a venue has them.** Drag one slider to a rider's height and
  the map dims everything they can't get on, with a running tally of what's open, what
  needs an adult along, and what's closed. Kings Island ships with all 65. At a venue with
  no height rules the filter isn't there at all.
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
- **Bearing tape.** A HUD strip showing every party member, the meet-up and your selected
  destination at their true bearing — useful when you can't see over a crowd.
- **Daylight and night maps.** Daylight is a printed-park-map palette — white midways on
  paper, dark type, darker marker colours — meant to be readable on a phone in direct
  July sun. Night is the low-glare version for after the lights come on. It follows the
  phone's own appearance setting until you pick one, then remembers your choice. Toggle
  with the half-circle button in the header, or from the Me tab.
- **Meet-up pin** shared to the whole party, with distance and walk time.
- **Switches maps on its own, to where the party is.** Your first GPS fix picks the venue
  you are standing in; once you are in a party, the phone hosting it decides instead, so
  joining from the car park or the hotel the night before still draws the map everyone
  else is looking at. Pick one by hand in the Me tab and it stops second-guessing you.
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
and every GPS cadence band and broadcast-gate reason.

`test/functional.mjs` is the one that matters. Three phones in one browser: A hosts, B
joins by typing the code, C joins from the invite link, then A is taken away and the
other two have to keep the party alive between them. It asserts on behaviour, not
appearance — that the key never leaves the URL fragment, that a party id is not its code,
that NEED HELP reaches the other phone, that the roster never collapses while the host is
replaced, and that the map and ride heights still work with the network cut.

Both suites take `BASE_URL`, and `CHROMIUM_PATH` points them at a browser already on the
machine instead of Playwright's own copy.

## Building a map of somewhere else

`scripts/build-venue.mjs` turns a place into the two files the app loads. It asks
OpenStreetMap for the geometry over a bounding box, sorts it into the layers the renderer
draws, and writes a POI list beside it.

```bash
npm run venues:build -- --place "Six Flags Fiesta Texas"
npm run venues:build -- --bbox 39.3365,-84.2775,39.348,-84.2595 --name "Kings Island"
npm run venues:build -- --around 39.3434,-84.267,900 --name "Kings Island"
npm run venues:build -- --help
```

Each build writes `public/venues/<id>.map.json` and `public/venues/<id>.pois.json`, then
rebuilds `public/venues/manifest.json` and the generated `lib/venueIndex.js`. The client
*fetches* those files rather than importing them, which is the point: a venue added to the
manifest reaches a phone that already has the app installed, and the service worker caches
whichever one gets opened.

Which one loads, in priority order: a venue picked by hand, then the venue the party's
host phone is standing in, then the venue this phone's own first fix is inside, then the
one used last, then the manifest's default. The host outranks your own position because a
meet-up pin means nothing if two phones are drawing different places.

What the tag rules produce, in short: `path` and `service` from highways, `building`,
`water`, `wood`, `grass`, `parking`, `pool`, `coaster` from `roller_coaster=track`, `slide`
from `attraction=water_slide`, and `lands` — named districts, tinted and labelled — from
named park sections, neighbourhoods and campuses. A venue with no coasters just has an
empty coaster layer. Districts the day/night palettes have never heard of get a colour
derived from their own name, so an unfamiliar venue is still legible.

**Height requirements are not in OpenStreetMap and never will be.** They live in
`data/venues/<id>.overrides.json`, keyed by name, and are re-applied on every rebuild —
along with any name corrections, aliases and hand-added places. The build prints the
overrides it could not match so a rename doesn't go quietly missing.

Two flags worth knowing: `--dump <file>` saves the raw Overpass response and `--from-dump
<file>` rebuilds from it, so tuning the tag rules doesn't hammer a public mirror. Builds
try three Overpass endpoints in turn, because the busy ones answer 429 and 504 more often
than they answer.

One caveat on Kings Island specifically: its bundle is the hand-pulled one this app was
built around, and it is what ships. `--place "Kings Island"` reproduces it closely from
today's OpenStreetMap — the same 121 coaster track segments and 1 park outline — but OSM
names fewer of the water slides and flat rides than the shipped list does, so a rebuild
would match about three quarters of the height overrides. The build tells you which ones.

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
- **Height requirements** — for Kings Island, compiled from Kings Island Central and
  Theme Park Insider, reflecting the 2026 season. They live in
  `data/venues/kings-island.overrides.json`; a venue built from OpenStreetMap alone has
  none until somebody writes them. They change between seasons and the ride operator measures
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
lib/park.js  lib/theme.js     POI helpers and height eligibility; day/night palettes
lib/venue/store.js            which venue is loaded; manifest, geometry, places
lib/venue/useVenue.js         the hook components read it through
lib/venueIndex.js             generated: static POI imports for the API routes
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
  RidesPanel.jsx              height filter and place search
  GpsGate.jsx                 permission dialog with per-failure guidance
  InstallCard.jsx             add-to-home-screen, Android prompt or iOS steps
  CompassTape.jsx             bearing HUD
  useGeolocation.js           adaptive watchPosition, compass, battery
server/index.mjs              zero-dependency host: mailbox, REST, SSE, metrics
scripts/
  build-venue.mjs             OpenStreetMap → a venue the app can load
  lib/osm-tags.mjs            the tag → layer and tag → category rules
  lib/geometry.mjs            simplification, area, centroid, point-in-polygon
  lib/venue-io.mjs            where venues live; manifest and index generation
  phone.mjs                   one command to a QR you can scan
  setup.sh                    toolchain check, install, build
test/
  unit.mjs                    the pure layers, no browser
  functional.mjs              three phones, one browser, real behaviour
  browser.mjs                 shared plumbing; honours CHROMIUM_PATH and BASE_URL
  visual.mjs  theme.mjs  ux.mjs
public/
  sw.js                       offline cache: shell, map and places; never the roster
  venues/manifest.json        every venue this build ships
  venues/<id>.map.json        drawn map layers (~260-300 KB each)
  venues/<id>.pois.json       the places, with heights where a venue has them
  manifest.webmanifest        home-screen install
data/venues/<id>.overrides.json  heights and corrections, re-applied on rebuild
Dockerfile  docker-compose.yml
```
