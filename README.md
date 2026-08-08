# Party Tracker

A live situational-awareness map for a group at a big, crowded place. It ships with
Kings Island (Mason, Ohio), Six Flags Fiesta Texas (San Antonio) and Cedar Point
(Sandusky, Ohio), and one command — or one form under Actions — builds a map of anywhere
else OpenStreetMap covers. Built with Next.js 15 (App Router) and React 19.

- **Drawn map, not tiles.** Real OpenStreetMap geometry projected to Web Mercator and
  painted as SVG: midways, buildings, water, slides, and every coaster's actual track
  centreline. Pan with one finger, pinch or scroll to zoom.
- **Any location.** `npm run venues:build -- --place "Somewhere"` pulls the geometry and
  the places, and the app offers the new map next time it boots — or run it from a form
  under Actions → Build a venue and get a pull request back. See
  [Building a map of somewhere else](#building-a-map-of-somewhere-else). Nothing in the
  renderer is amusement-park specific; a zoo, a campus, a festival ground or a town
  centre all draw through the same code. Three parks ship today: Kings Island, Six Flags
  Fiesta Texas and Cedar Point.
- **Symbols you can read, not dots you have to decode.** Every place carries three
  redundant channels — shape, colour and a glyph. A solid disc is something you came for,
  a light chip is something you need, a diamond is a landmark and a pin is a gate; inside
  it sits a fork and knife, a restroom pair, a shopping bag, a medical cross, an Eiffel
  Tower. Colour alone would fail the ~8% of men with a red-green deficiency, for whom the
  night palette's coaster red, ride purple and landmark pink are the same dot. The key
  lives on the map itself, bottom left, and every row in it is also the switch that turns
  that category on and off.
- **Nothing is drawn on top of anything else.** District names, markers and place names
  all bid for the same pixels in importance order, and whatever will not fit is dropped
  rather than overprinted. District names lie along their district the way a printed park
  map lays them out, clamped to the part of it you can actually see. A name that cannot go
  above its marker tries below, right and left before giving up.
- **Tap a coaster and its own track lights up.** Kings Island's 121 red polylines each
  carry a ride name in the source geometry, so Diamondback's helix stops being one
  squiggle among many. The tap also puts a callout on the map: name, distance, height rule.
- **Height requirements where a venue has them.** Drag one slider to a rider's height and
  every ride that is out today goes hollow and struck through on the map — not merely
  faded, because fading is what a party member we have not heard from looks like — while
  rides that need a grown-up along get a plus badge. Plus a running tally of what's open,
  what needs an adult, and what's closed. Kings Island ships with all 65. At a venue with
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
- **Four tabs at the bottom, and a sheet you pull.** Explore, Party, Rides and Me sit in
  a tab bar at the foot of the sheet, so the whole app is one thumb-reach away and never
  moves — and each tab keeps its own navigation stack, so leaving one and coming back
  finds it where you left it. Tapping the tab you are already on unwinds it to its root.
  The sheet itself follows your finger between three stops and snaps to whichever one you
  flicked it at, and screens slide in from the side they came from. The collapsed stop
  deliberately shows less: search, where you are, the rail, the tabs. Everything else is
  one pull away.
- **Back is the phone's back, not a button in a corner.** Every screen the app opens goes
  onto the browser's history stack, so the Android back button and the swipe in from the
  left edge walk back through the app one screen at a time and only leave when there is
  nothing left to go back to. The sheet's own back button takes the identical path — it
  is the same history move — so the two can never disagree about where they are.
- **Sized for a thumb, not a cursor.** Nothing you can tap is smaller than the 44px a
  fingertip actually covers. Where a control has to *look* small — a row of seven height
  tiers, a strip of filter chips, the Go button in the corner of a card — it keeps its
  looks and grows an invisible hit area instead, so taps that land near enough still
  count. There is no hover state anywhere, because there is no pointer to hover with.
- **Turn-by-turn walking directions, the way a phone map does them.** Tap Go on a card or
  "Walk me there" on a ride and you get the trip first — how long, when you arrive, and
  two or three genuinely different ways to go, drawn on the map and named after where they
  differ ("via Coney Mall"). Press Start and the screen hands itself over: the map turns
  course-up and zooms in, your marker snaps onto the path, the next maneuver and the
  distance to it sit across the top with the one after it underneath, and the bottom bar
  carries the arrival time. Turns are named after what you can see from them ("bear right
  at Juke Box Diner") because almost none of the park's paths have names. It can speak the
  directions, the part behind you greys out as you walk, walking off the route works out a
  new one, and arriving ends it.
- **Bearing tape.** A HUD strip showing every party member, the meet-up and your selected
  destination at their true bearing — useful when you can't see over a crowd.
- **Light and dark maps.** Light is Apple Maps in daylight — white footpaths on pale
  ground, dark type, deeper marker colours — meant to be readable on a phone in direct
  July sun. Dark is the low-glare version for after the lights come on. It follows the
  phone's own appearance setting until you pick one, then remembers your choice. Toggle
  with the moon button floating over the map, or on the Me tab.
- **What's open when the weather turns.** The park publishes no live feed this app can
  read, so it builds one from the two sources it actually has. Your party reports what it
  walks past — one tap, "it's down" or "it's running", propagated over the same peer mesh
  as everything else — and a forecast fills in the rest: lightning closes the outdoor
  rides and clears the pools first, wind takes the tall rides before anything else, rain
  is no news at all for a flume, and cold shuts the water park. A report always beats a
  forecast until it is half an hour old, at which point it stops being evidence. Nothing
  is ever stated as fact: the wording is "likely" and "watch" because a guess that reads
  as an operations feed is worse than no guess. On a clear day with nothing reported, none
  of it appears.
- **Meet-up pin** shared to the whole party, with distance and walk time.
- **Asks which park, once, on the way in.** The first GPS fix is the first moment the app
  can say anything useful about which of the maps it ships you want, so that is when it
  asks: "Going to Six Flags Fiesta Texas? — 70 mi away", with every other park it carries
  one tap below. Saying yes is what builds that park on the phone — its geometry and its
  places are fetched then, so nobody downloads a map for a park they are not going to.
- **Switches maps on its own, to where the party is.** Once you are in a party, the phone
  hosting it decides which map you are looking at, so joining from the car park or the
  hotel the night before still draws the map everyone else is looking at. Pick one by hand
  under Me → Which map and it stops second-guessing you.
- **Walking time is the headline everywhere**, with feet as the secondary figure — in a
  park "4 min" answers the question and "825 ft" doesn't.
- **NEED HELP status** pulses that person's marker, vibrates every phone in the party and
  reports their range and bearing.
- **A scale bar that is telling the truth.** It picks a distance people round to — 100 ft,
  250 ft, half a mile — and then measures it, rather than drawing a fixed width and naming
  it afterwards. A compass rose beside it keeps north findable once the map turns.

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

Routes are worked out on the phone, from the same venue file the map is drawn from —
`public/venues/<id>.map.json`, whichever one is loaded. There is no routing service, no
API key and no network call: the file already carries every midway, queue and service
road as an OpenStreetMap polyline, and `lib/routing.js` welds those polylines into a
graph and runs A* across it. Nothing in it is specific to one venue, so a map built by
`npm run venues:build` gets directions for free.

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

### What it looks like to use

The shape is the one both phone maps settled on, for reasons that hold up in a theme park
as well as on a motorway:

- **Choose, then go.** Asking for directions does not start anything. You get the route
  framed on screen, the time, the arrival clock and the alternatives — press Start and
  only then does the interface change. Cancel leaves you exactly where you were.
- **Alternatives are generated, not looked up.** The penalty method: take the best route,
  make its segments expensive, search again. A candidate is offered only if it shares less
  than 70% of the best route and is under 45% longer, and it is named after the land it
  passes through at the point where it most differs — so two routes are never both "via
  International Street". Choose one and a reroute later replays the same weights, rather
  than quietly putting you back on the line you turned down.
- **Course-up, snapped, lifted.** While walking, the map turns so the way ahead is up, the
  marker rides the *snapped* point on the route rather than the raw fix, and the centre of
  the map sits below the centre of the screen so you see where you are going rather than
  where you have been. The bearing comes from the compass when there is one and from the
  route otherwise, taken from a point 22 m up the line — the leg underfoot swings with
  every surveyed bend, and a camera that follows it is unusable.
- **Rotation lives in the projection**, not in a transform over the map. Turning the whole
  SVG would take every ride label round with it; doing it in the two lines that convert
  metres to pixels keeps the type upright for free.
- **It can talk.** The browser's own speech synthesiser names the maneuver once while
  there is still time to move across the midway, again as you reach it, and says when you
  have arrived — each at most once, because a phone that repeats itself gets muted.

### Under it

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

## Notifications

Everything the app has to say used to be said in a toast that lasts a few seconds and a
vibration nobody feels through a bag, which is no use at all for the one message the party
feature exists to carry. Web Push fixes that, and it is off unless you give it keys:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
# put the pair in .env.local as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY,
# plus VAPID_SUBJECT=mailto:you@example.com
```

Without them `/api/push/key` says so once, nothing asks again, and the app behaves exactly
as it did before.

A notification is the most revealing frame this app has — it says a name, and usually where
that name is — so it is sealed with the party key before it goes anywhere and opened again
by the service worker on the receiving phone. Our relay sees an endpoint and a blob; the
push service sees the same plus whose phone it is going to; only the phone sees the words.
The worker wakes with no page attached, so the key is kept in IndexedDB beside the party
id, written as the party changes and cleared on leaving — which is what makes a push from a
party you have left unreadable rather than merely unwelcome.

Four things are worth waking a phone for: somebody needing help, somebody joining or
leaving, the meet-up moving, and somebody going quiet. The last one can cry wolf — a queue
building eats signal for five minutes routinely — so it waits twelve and is off by default.
The first three are sent by whoever does them; going quiet is nobody's action, so the host
notices it alone.

On an iPhone this only works once the app is on the Home Screen. The button says so rather
than failing quietly.

## What a browser cannot do

Stated plainly rather than stubbed to look finished:

- **Background location.** There is no web API for it. When the screen locks, the page is
  suspended and positions stop updating — a phone in a pocket goes stale rather than
  reporting a stale position as live. After 5 minutes the map rings that person with a
  broken circle and prints how long ago it heard from them, and stops drawing the arrow
  for which way they were walking. Fixing this needs a native wrapper with the OS
  background-location permission.
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
npm run test:grandma                # can a stranger actually use it
```

`test/unit.mjs` exercises the pure layers directly: version arithmetic, duplicate
suppression, seal/open against wrong keys and tampered ciphertext, the election ordering,
every GPS cadence band and broadcast-gate reason, and the router — the last of those
against the real park file rather than a fixture, because a graph that routes perfectly
over a toy and badly over Kings Island is the failure worth catching. Venue selection,
the OpenStreetMap tag rules and the geometry helpers the builder leans on are in there
too. So is the map's own layout logic: the decluttering grid checked against brute force,
glyph art checked to stay inside the shape drawn round it, every named piece of coaster
track checked to belong to a ride in that venue's catalogue, and the scale bar checked to
span the distance it claims at every zoom the map allows.

`test/functional.mjs` is the one that matters. Three phones in one browser: A hosts, B
joins by typing the code, C joins from the invite link, then A is taken away and the
other two have to keep the party alive between them. Phone A also walks to The Beast on
the way through — offered the route, picks a different one, starts, checks the map has
turned course-up, walks until the distance drops, opens the steps and arrives. It asserts on behaviour, not
appearance — that the key never leaves the URL fragment, that a party id is not its code,
that NEED HELP reaches the other phone, that the roster never collapses while the host is
replaced, and that the map and ride heights still work with the network cut. A fifth phone
sits in Austin, at neither park, to check that the intake asks about the nearer one, that
saying yes brings that park's places with it, and that it is not asked again.

`test/grandma.mjs` asks a different question from the other two. They ask whether the app
still does what it did; this asks whether somebody who has never seen it can get anything
out of it. Two people are scored separately — one on her own who needs a toilet, then food,
then to walk there, and one who has been handed a link and has to appear on her family's
map, find a grandchild and be able to call for help. Tasks score 0, 1 or 2, because "she
got there after opening the panel" is a different result from "she got there first try",
and a suite that cannot tell those apart cannot tell you whether the app improved.

The rule that keeps it honest: **its persona tasks may not use the `go()` helper**. That
helper knows where the tab bar is and pulls the sheet open by its handle, which are exactly
the two things she does not know. She taps things whose words she can read, and if nothing
on screen says it, that is the finding rather than a broken test. A single task scoring
zero fails the run.

All the suites take `BASE_URL`, and `CHROMIUM_PATH` points them at a browser already on the
machine instead of Playwright's own copy.

## Building a map of somewhere else

`scripts/build-venue.mjs` turns a place into the two files the app loads. It asks
OpenStreetMap for the geometry over a bounding box, sorts it into the layers the renderer
draws, and writes a POI list beside it.

```bash
npm run venues:build -- --place "Cedar Point, Sandusky, Ohio" --locality "Sandusky, Ohio"
npm run venues:build -- --bbox 39.3365,-84.2775,39.348,-84.2595 --name "Kings Island"
npm run venues:build -- --around 39.3434,-84.267,900 --name "Kings Island"
npm run venues:build -- --help

npm run venues:report cedar-point     # what a built venue actually contains
```

**Name the place precisely.** The geocoder answers the question you asked, and plain
`"Cedar Point"` is a village of 264 people in LaSalle County, Illinois. `--place` prints
what it resolved to before it builds anything, and `--dry-run` stops there; when a name is
ambiguous or the park has no boundary mapped, `--bbox` is the way to say exactly what you
meant.

Or skip the terminal entirely: **Actions → Build a venue → Run workflow** fills the same
arguments in from a form, runs the build on a runner, checks the app still builds with the
result, and opens a draft pull request with the new park in it. That is the intended route
for adding a venue — the build needs nothing but node and OpenStreetMap, which is precisely
what a runner has.

Each build writes `public/venues/<id>.map.json` and `public/venues/<id>.pois.json`, then
rebuilds `public/venues/manifest.json` and the generated `lib/venueIndex.js`. The client
*fetches* those files rather than importing them, which is the point: a venue added to the
manifest reaches a phone that already has the app installed, and the service worker caches
whichever one gets opened.

Which one loads, in priority order: a venue picked by hand, then the venue the party's
host phone is standing in, then the venue you said yes to at intake, then the venue this
phone's own first fix is inside, then the manifest's default. The host outranks your own
position because a meet-up pin means nothing if two phones are drawing different places.

The intake question is asked from the first fix and answered once. `venueChoiceFor()` in
`lib/venue/store.js` decides whether there is anything to ask: nothing, if a map was picked
by hand, or if you already said yes to this park and have not since turned up inside a
different one. Answering calls `confirmVenue()`, which loads the park and remembers it —
deliberately softer than the hand-picked pin, so a party hosted from another park still
moves the map. Waving the question away falls back to the automatic behaviour above.

What the tag rules produce, in short: `path` and `service` from highways, `building`,
`water`, `wood`, `grass`, `parking`, `pool`, `coaster` from `roller_coaster=track`, `slide`
from `attraction=water_slide`, and `lands` — named districts, tinted and labelled — from
named park sections, neighbourhoods and campuses. A venue with no coasters just has an
empty coaster layer. Districts the day/night palettes have never heard of get a colour
derived from their own name, so an unfamiliar venue is still legible.

Two rules exist because Cedar Point broke them. Overpass returns whole shapes that merely
touch the query box, so a venue on the water gets the whole body of water at survey
detail: the first Cedar Point build carried Lake Erie as one 47,937-point ring reaching
into Canada, two thirds of a 1.5 MB file, without a single vertex inside the park. Filled
shapes are now clipped to the venue's own box, which is coverage-identical inside it and
about a third of the bytes. And water that covers the whole box is not a pond but the thing
the venue stands in, so it goes in a `sea` layer drawn *under* the ground rather than over
it — otherwise a park on a peninsula renders at the bottom of the lake.

**The boundary is chosen, not guessed.** A venue's outline is the ring that carries its
name and is tagged as somewhere you can visit — `tourism=theme_park`, `leisure=park`, a
campus — and civic boundaries are excluded outright. Kings Island is mapped as a 150-point
`tourism=theme_park` way and sits inside the census area of Landen, which TIGER mapped as a
named `place=locality` five times the size; the old biggest-ring-wins rule therefore drew a
census tract as the park's ground and then used it to decide which districts were "inside",
where one place out of 219 was. The chosen ring is written to the venue file as `boundary`,
drawn on the map as a dashed perimeter, and the build reports how many places fall inside
it — the number that gives a wrong ring away.

The other one is gates. A thoroughly mapped park has a `barrier=gate` on every ride queue
and service road — Cedar Point has 158 — and an unnamed one is furniture, not a place
anyone walks to. A gate earns a pin by being the entrance (`entrance=main`), by being a
ticket booth, or by having a name people use: "the North Gate".

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
  at the gate and has the final say, so the app says as much on the rider-height screen.
- **Weather** — Open-Meteo, at the active venue's centre from the manifest, so switching
  parks moves the forecast with the map. Which places care about which conditions is not
  data at all: `lib/weather.js` derives it from each POI's category, land and note, with
  no ride names anywhere in the file — so a venue built from OpenStreetMap alone, with no
  height overrides written for it yet, still gets a full weather picture.
- **Operating status** — nobody's but your own party's. There is no ride-status feed here
  and the app never claims one.
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
lib/park.js  lib/theme.js     POI helpers and height eligibility; day/night palettes
lib/weather.js                exposure traits and the outlook rules — no ride names
lib/rideStatus.js             merges a party report with a forecast into one verdict
lib/mapSymbols.js             the symbol vocabulary: shapes, glyphs, ranks, ink
lib/mapLabels.js              decluttering grid, district-name geometry, scale bar
lib/venue/store.js            which venue is loaded; manifest, geometry, places
lib/venue/ids.js              the one place-id rule, shared by browser and hosts
lib/venue/useVenue.js         the hook components read it through
lib/venueIndex.js             generated: static POI imports for the API routes
lib/serverStore.js            memory / Upstash backend for the cloud fallback
app/
  page.js                     client state, the tabs and the sheet
  join/page.js                invite landing; reads the fragment, never the query
  api/mailbox/…               the relay
  api/…                       party, members, location, rides, health, metrics
  api/weather/                the only outbound call in the app; cached, fails soft
components/
  ParkMap.jsx                 SVG renderer, pan + pinch zoom, label layout
  MapSymbols.jsx              marker silhouettes and glyphs, shared with the key
  MapLegend.jsx               the on-map key, which is also the category filter
  GlanceRail.jsx              the live card rail in the collapsed sheet
  TabBar.jsx                  the four bottom tabs, badges and all
  useSheetDrag.js             the sheet under a finger: follow, then snap
  PartyPanel.jsx              roster, QR, join, status, meet-up
  QrScanner.jsx               camera join; says so plainly where unsupported
  Diagnostics.jsx             active transport, probe results, queue depth
  PlaceList.jsx               place search, live status and reporting
  HeightPanel.jsx             the rider-height filter and what it unlocks
  SettingsPanel.jsx           name, appearance, which map, and the long tail
  WeatherBanner.jsx           the park-wide headline; renders nothing on a clear day
  useWeather.js               polls the forecast, caches it, survives losing signal
  GpsGate.jsx                 permission dialog with per-failure guidance
  ParkPrompt.jsx              which park, asked from the first fix and built on yes
  InstallCard.jsx             add-to-home-screen, Android prompt or iOS steps
  CompassTape.jsx             bearing HUD
  NavBanner.jsx               the maneuver strip: this turn, and the one after
  NavBar.jsx                  arrival time, distance left, mute, compass, End
  RoutePreview.jsx            the trip and its alternatives, before you set off
  DirectionsPanel.jsx         the whole step list, greying out behind you
  useVoiceGuidance.js         spoken maneuvers, once each
  useGeolocation.js           adaptive watchPosition, compass, battery
server/index.mjs              zero-dependency host: mailbox, REST, SSE, metrics
scripts/
  build-venue.mjs             OpenStreetMap → a venue the app can load
  venue-report.mjs            what a built venue contains, as markdown
  lib/osm-tags.mjs            the tag → layer and tag → category rules
  lib/geometry.mjs            simplification, clipping, area, centroid, point-in-polygon
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
