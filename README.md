# Parkbound

**Explore more. Stress less.**

An explorer’s companion for a group at a big, crowded park. It ships with
Kings Island (Mason, Ohio), Six Flags Fiesta Texas (San Antonio), Cedar Point
(Sandusky, Ohio) and Big Kahuna's (Destin, Florida), and one command — or one form under
Actions — builds a map of anywhere else OpenStreetMap covers. Built with Next.js 15
(App Router) and React 19.

Parkbound turns a complicated park day into an adventure you can actually enjoy —
live party coordination, walking trails, and a drawn park map.

**New to the codebase?** Start with the
[architecture map](docs/architecture-map.md) — system diagram, venue build
pipeline, phone layers, and party mesh visuals — then come back here for the
full feature and layout prose.

- **Drawn map, not tiles.** Real OpenStreetMap geometry projected to Web Mercator and
  painted as SVG: midways, buildings, water, slides, and every coaster's actual track
  centreline. Pan with one finger, pinch or scroll to zoom.
- **Any location.** `npm run venues:build -- --place "Somewhere"` pulls the geometry and
  the places, and the app offers the new map next time it boots — or run it from a form
  under Actions → Build a venue and get a pull request back. See
  [Building a map of somewhere else](#building-a-map-of-somewhere-else). Nothing in the
  renderer is amusement-park specific; a zoo, a campus, a festival ground or a town
  centre all draw through the same code. Four parks ship today: Kings Island, Six Flags
  Fiesta Texas, Cedar Point and Big Kahuna's — the last of which is a water park, and
  came through the same pipeline with nothing added to it but a tag rule for mini golf.
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
- **Height requirements, at every park here.** Drag one slider to a rider's height and
  every ride that is out today turns solid alarm red on the map, ringed and struck
  through — not faded, because fading is what a party member we have not heard from looks
  like, and not its category colour either, because the whole reason to set a height is to
  see at a glance what is out. Rides that need a grown-up along get a plus badge. Plus a
  running tally of what's open, what needs an adult, and what's closed. All four parks
  ship with theirs: 74 rules at Cedar Point, 65 at Kings Island, 60 at Six Flags Fiesta
  Texas, 15 at Big Kahuna's — which is every ride there, at a park where the rule is as
  likely to be "no minimum" as a number, and the app says which.
  A venue built from OpenStreetMap alone has none until somebody writes them, and
  the builder says so rather than quietly shipping a park without its Rides tab — see
  [Height rules](#height-rules-and-other-corrections).
- **Every location is the same data about a different place.** Nothing in the renderer, the
  builder or the app names a park: the rules are tag-driven and everything true of one place
  lives in that place's own file. Even the hand-picked district tints, which used to be a
  table of Kings Island's themed areas sitting in the renderer — two parks can use the same
  district name, and one of them did. `npm run venues:report` prints a checklist of what a
  location has to carry, per venue and all at once, and the suite holds the required half of
  it so the next park cannot ship half-built the way the first three did.
- **The campground, where a park has one.** Cedar Point's Lighthouse Point is drawn as a
  district of the park with its name lying along it, and everything in it is on the map and
  in search: all 145 numbered pitches, so "site 247" is a thing you type at eleven at night
  and get a walking time to; the registration desk and store; the shower and toilet blocks;
  cabin, registration and departure parking; the shuttle stops back to the gate; and the
  campground's own telephone number, one tap from dialling. Campgrounds are tagged
  `caravan_site` as often as `camp_site` and their pitches are usually drawn as named
  driveways rather than as pitches, which is why none of it used to be in the app at all.
  Hookups too — full hookup, 30/50 amp, water, sewer, pull-through, pad surface — read from
  OpenStreetMap where a mapper has tagged them and from the venue's own file where nobody
  has, and searchable either way, because "50 amp" is what somebody towing types and not one
  pitch has it in its name.
- **Where you parked.** One tap on the car button over the map saves the spot; after that
  the same button takes you back to it, and a card on the glance rail carries the walking
  time and an arrow the whole way. Violet pin, its own icon, nothing like the crimson
  meet-up pin. It stays on this phone — nobody in your party is told where you parked — and
  each park remembers its own car park.
- **It opens on the nearest park, or the last one.** Whatever was on screen last time, before
  the GPS has answered; the venue the fix is inside, or the nearest one, a second later. The
  manifest has a `default`, and it is only what a phone that has never opened the app looks
  at for those two seconds — a placeholder, not an opinion about where anybody is. Treating
  it as an opinion is how a visitor in San Antonio opened the app and was shown a park in
  Ohio.
- **Live party tracking.** One person starts a party and hosts it on their own phone;
  everyone else joins by scanning the QR, opening the invite link, or typing the
  6-character code. Range in feet, compass bearing, nearest ride, status and staleness
  for each person. If the host walks off, the best-placed remaining phone takes over the
  roster on its own, keeping the same party code.
- **A glance rail instead of a menu.** The collapsed sheet is a live dashboard, not
  boilerplate: one card per party member plus the meet-up and your destination, each
  showing walking time as the headline, distance underneath, and an arrow aimed
  relative to the way you're facing when the compass is on. With no party running it
  falls back to the nearest restroom, food and first aid, and it carries the car once you
  have told it where the car is. Tap a card to fly to it. A card that appears at the head of
  the rail brings the rail back to the start, because a scroll-snap container that gains one
  otherwise keeps the card it was snapped to and lands the new one off the left edge, unseen.
- **Four tabs at the bottom, and a sheet you pull.** Explore, Party, Plan and Day sit in
  a tab bar at the foot of the sheet, so the whole app is one thumb-reach away and never
  moves — and each tab keeps its own navigation stack, so leaving one and coming back
  finds it where you left it. Tapping the tab you are already on unwinds it to its root.
  Screens slide in from the side they came from. The map itself is the canvas underneath —
  shut the sheet to live in it.
- **The sheet stops where you let go of it, and shows what fits there.** The handle
  follows your finger and the sheet stays at whatever height you leave it at — not one of
  four the app picked. Only the ends of the travel are magnetic, so shut and full stay
  easy to hit without aiming, and a flick still carries. What is on the sheet is then a
  budget rather than a switch: each row has a measured cost in pixels and they are paid
  for in the order they answer a question, so pulling up buys the next one as the room
  for it appears. Nearly shut, the rail is one line — an arrow, a walking time and a name.
  A little more and the search field arrives, then the cards, then the venue's own line,
  then the list. Nothing is ever squashed to fit and nothing that has appeared drops out
  again on the way up. Where you left it is where it is next time you open the app.
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
- **The weather, in three steps.** A chip in the top corner whenever there is a reading at
  all — a glyph and the temperature, the size of the buttons opposite it. Tap it for the
  headline, what is affected, what the reading was based on and how old it is. It opens
  itself only when the weather is actually stopping rides or somebody has reported one down.
  It used to be a full-width banner that appeared when something was wrong and rendered
  nothing at all otherwise, which meant the app had a forecast and no way to be asked for one.
- **Light and dark maps.** Light is Apple Maps in daylight — white footpaths on pale
  ground, dark type, deeper marker colours — meant to be readable on a phone in direct
  July sun. Dark is the low-glare version for after the lights come on. It follows the
  phone's own appearance setting until you pick one, then remembers your choice. Toggle
  with the moon button floating over the map, or on the Day tab.
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
  under Day → Which park and it stops second-guessing you.
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
npm run test:validate-ui            # e2e functional + grandma (required for UI changes)
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

For UI work, see [docs/ui-enhancement-validation.md](docs/ui-enhancement-validation.md) —
`npm run test:validate-ui` runs the functional e2e suite and the grandma test together.

## Building a map of somewhere else

`scripts/build-venue.mjs` turns a place into the two files the app loads. It asks
OpenStreetMap for the geometry over a bounding box, sorts it into the layers the renderer
draws, and writes a POI list beside it.

```bash
npm run venues:build -- --place "Cedar Point, Sandusky, Ohio" --locality "Sandusky, Ohio"
npm run venues:build -- --bbox 39.3365,-84.2775,39.348,-84.2595 --name "Kings Island"
npm run venues:build -- --around 39.3434,-84.267,900 --name "Kings Island"
npm run venues:build -- --bbox 30.38729,-86.4742,30.39112,-86.47061 --name "Big Kahuna's" \
    --id big-kahunas --locality "Destin, Florida" --center 30.3883,-86.4730
npm run venues:build -- --help

npm run venues:report cedar-point     # what a built venue actually contains
npm run venues:certify -- kings-island  # birth certificate: report + compare + route-qa + ask
npm run venues:build -- --catalog --from 1 --to 10   # batch: loop the universal builder
npm run venues:build -- --pipeline --place "Cedar Point, Sandusky, Ohio" --locality "Sandusky, Ohio"
```

### Building the same park again

Every build writes `data/venues/<id>.recipe.json` beside the venue's overrides — the box,
the pad, the tolerance, the merges, everything that shaped what came out. `--rebuild` reads
it back:

```bash
npm run venues:rebuild -- cedar-point            # exactly as it was built before
npm run venues:rebuild                           # every park on disk
npm run venues:rebuild -- cedar-point --dry-run  # would anything change?
npm run venues:rebuild -- cedar-point --tolerance 2   # …but tighter, and remember that
```

This exists because a venue that cannot be rebuilt is stuck at whichever tag rules were in
force the day somebody typed a command line. When water slides started supplying rides,
Fiesta Texas stood to gain eighteen of them *on its next rebuild* — a rebuild that first
needed somebody to reconstruct the arguments out of a merged pull request. The manifest was
no help: the bounds it keeps are the **padded** ones, and there is no `--pad` you can pass
with them that reproduces the build. Kings Island was built with a pad of 0 and Cedar Point
was not, and nothing on disk said so.

So the recipe records the box as it stood *before* the pad, which is the one field that
serves all three ways of asking — a `--place` that resolved, a `--bbox` that was typed, an
`--around` that was expanded all land there, and padding it again gives back the identical
bounds. A place-built venue replays its box rather than the name it was found by: a geocoder
is free to change its mind about where "Cedar Point" is, and a rebuild asked to reproduce a
venue must not be the thing that moves it. `--refresh-place` asks again, deliberately.

A flag typed alongside `--rebuild` beats the recipe for that run **and is written back**,
because the second reason to reach for this is "again, but tighter" and that has to stick.

A rebuild that changes nothing changes nothing on disk, down to the `generated` date — which
makes "does OpenStreetMap still say what we shipped?" a question a diff can answer.

**Name the place precisely.** The geocoder answers the question you asked, and plain
`"Cedar Point"` is a village of 264 people in LaSalle County, Illinois. `--place` prints
what it resolved to before it builds anything, and `--dry-run` stops there; when a name is
ambiguous or the park has no boundary mapped, `--bbox` is the way to say exactly what you
meant.

Or skip the terminal entirely: **Actions → Build a venue → Run workflow** fills the same
arguments in from a form, runs the build on a runner, works out the ways into every ride from
the result, checks the app still builds with it, and opens a draft pull request with the new
park in it. That is the intended route
for adding a venue — the build needs nothing but node and OpenStreetMap, which is precisely
what a runner has.

**`--center` is worth setting once.** Where the map opens defaults to the middle of the
bounding box, and a box has to be drawn wide enough to hold the car park — so at a venue
that owns a lot of tarmac the map opens on the tarmac. Big Kahuna's own polygon runs north
over its parking, far enough that the box midpoint and the boundary centroid agree to
within two metres and both of them miss the water park. A rebuild never moves a centre the
venue already has, so this is a decision made once rather than a flag to remember.

A place has two strings and they are not the same string. `i` is its **key** — what a ride
report on the wire, a favourite and a nav target are addressed by. `n` is its **title** —
what a visitor reads. A park renaming a ride changes the title and must not change the key,
because an edit is filed under the key and an edit whose key moved is not moved, it is
lost. Keys are issued once, at build time, from a ledger committed at
`data/venues/<id>.ids.json`; a rebuild matches each place back to the number it already had
by its OpenStreetMap element, then by position within its name group, and anything the
rebuild cannot claim is retired rather than freed so its number is never handed to a
different place. The reasoning, including why the OpenStreetMap id is provenance rather
than identity, is in `scripts/lib/venue-ids.mjs`. Overrides stay filed under the display
name — those files are edited against a park's published height chart — with the key
available as the escape hatch for the entries a name cannot address on its own, such as one
of twenty-six places called "Restrooms".

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

The path layer is not only drawn. `lib/routing.js` welds it into the route graph, so a
walkable way missing from it is not a faint line on a map — it is a route the app will not
send anyone down, and a detour it will send them on instead. Three kinds of walkable ground
carry no `highway` tag at all and were being dropped: fixed piers and boardwalks
(`man_made=pier`), station platforms (`public_transport=platform`, `railway=platform`) and
crossings drawn as ways. Cedar Point had 830 m of boardwalk in that state — Boggy Bridge,
two 200-metre decks, the walkways around Lighthouse Point. Twelve of the nineteen ways this
recovers shorten the walk across them by more than 15 m, one of them by 169 m.

`floating=yes` is what keeps the marina out, and it has to: Cedar Point's boat basin is 228
finger docks and 6.5 km of them, tagged exactly like the boardwalks. A person standing on
one is not in the water; no route through a park goes down a boat slip.

A ride whose only trace is its track becomes a place anyway, positioned at the middle of
its own geometry. Track is a line, so it never reaches the closed-ring path that produces
POIs, and a mapper who has drawn and named a flume or a coaster does not always add a node
for the ride — which leaves it lit up on the map with nothing in the list to tap. That has
always been true of coasters; it was not true of water slides until Big Kahuna's, which is
mapped as twenty-five slides, fourteen of them named, and produced a bundle containing one
ride. Fiesta Texas gained eighteen water rides from the same fix — Bonzai Pipelines,
Tornado, Thunder Rapids Water Coaster, the four Texas Treehouse slides and the rest of
White Water Bay, all of them drawn on the map and none of them on the list until now.

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

<a id="height-rules-and-other-corrections"></a>

**Height requirements are mostly not in OpenStreetMap.** Mostly, not entirely: the
`minimum_height_requirement` tag is real, and Cedar Point carries it on fifty-two
attractions, surveyed off the sign at the ride entrance. Where it exists it is the best
source there is — somebody stood in front of the ride and read it — so the build takes it,
and a park that tags its signs gets its Rides tab for free the day it is added. It agreed
with the hand-compiled figures on all fifty rides where both existed, and filled two gaps
the charts had left.

The rest live in `data/venues/<id>.overrides.json`, keyed by name, applied *after* the
tags so a hand-written correction still beats a stale one — along with any name
corrections, aliases and hand-added places. The build prints the overrides it could not
match so a rename doesn't go quietly missing.

Which makes them the one part of a venue that can be silently missing, and the app has no
way to tell "this place has no height rules" from "nobody wrote them down": either way
`hasHeights` is false and the Rides tab, the slider, the tally, the badge over the map and
the struck-through markers all cease to exist at once. Two of the three parks shipped that
way for a while. So the build now **refuses** to write a venue that has rides and no height
rules, names the file to write, and takes `--allow-no-heights` for a venue that genuinely
has none — a zoo, a campus, a festival ground. It also lists the rides still missing one,
which is how you find the ride the park renamed last winter.

The same file carries `areas`: the named areas this venue owns that its own OpenStreetMap
polygon does not cover. A park is routinely more than one ring — Cedar Point is three on
one peninsula, the amusement park, the water park and the campground — and the rule that
drops "the retail park over the road" could not tell the difference. It had been dropping
Cedar Point Shores' thirty-one places since the venue was added, and would have dropped all
hundred and fifty-seven of Lighthouse Point's. It is a list rather than a cleverer test
because no test tells a water park that belongs to this venue from one that does not; the
build prints every area it dropped and how many places went with it, so the list is written
from what it says.

The same file also carries `camping` — what is true of a campground as a whole, which is
where a fact like "every site is full hookup, 30/50 amp, concrete pad" belongs. It is one
fact about the place, not a hundred and forty-five facts about pitches, so it sits on the
venue and a pitch's own details are read *over* it. `rules` narrows it by name where a park
does publish per-row detail.

And `lands`, the hand-picked tints for a venue's districts. Every district not named there
takes a colour derived from its own name, which is what a venue nobody has hand-tuned looks
like and is fine.

Correcting a height does not need a rebuild — the geometry is not what changed:

```
npm run venues:overrides              # re-apply every overrides file, no network
npm run venues:overrides -- cedar-point              # just the one
```

### The ride inventory: every way into every ride

A place in the bundle is one point, and a ride is not one point. It has a queue that starts
out on the midway, a station, and an exit that puts you somewhere else entirely — and for
getting a family across a park, the **queue entrance** and the **exit** are the two
coordinates anybody actually walks to.

```
npm run venues:attractions -- cedar-point --report
npm run venues:attractions -- cedar-point --trace data/venues/cedar-point.traced.geojson
npm run venues:attractions -- --all
npm run venues:attractions -- cedar-point --geojson entrances.geojson
```

It assembles them from every source available, per ride, per feature —
`queue_entrance`, `queue_path`, `ride_entrance`, `station`, `unload`, `ride_exit`,
`queue_exit`. A park map prints one arrow and calls it the entrance; on the ground the queue
entrance is on the midway and the ride entrance is at the far end of forty metres of
switchback, and those are different places.

**Nothing is stored bare.** Every coordinate carries the sources behind it, a fused score and
the dates, because a park moves a queue between seasons and an *expired* coordinate and a
*wrong* one are indistinguishable in a file that stores only numbers.

| Source | Worth |
| --- | ---: |
| the park's own map or site | 5 |
| `entrance=*` in OpenStreetMap | 4 |
| a way named for its ride (`Maverick Standby Queue`) | 4 |
| current aerial imagery | 4 |
| a guest photo, a ride walkthrough, a georeferenced trace | 3 |
| a historical map | 2 |
| a forum thread, or this repo's own inference from geometry | 1 |

0–3 unknown · 4–6 low · 7–9 moderate · 10–12 high · 13+ very high. Only **moderate** and above
reaches the app.

That bar is deliberately above what any automatic source can reach alone, and the numbers
from the three parks are why. Cedar Point has 22 ways named for their ride, Kings Island 8,
Fiesta Texas none; Fiesta Texas carries exactly **one** `entrance` tag against 53 rides. So
running the whole pipeline over all three parks today publishes **nothing**. That is the
system working: every ride in every park can be given a plausible entrance from the path
network, and if that were enough to publish then none of them would ever be checked.
Geometry proposes. One corroborating source — a trace, a mapped entrance — carries a ride
over the line.

Two rules that took a wrong turn first:

- **A guess disagreeing with a survey is not a dispute.** The first fusion rule treated any
  spread as a standoff, and a coaster's nearest footpath is somewhere along its own track —
  so it lands a hundred metres from the queue every time, and the weakest source in the
  pipeline was vetoing the strongest. Cedar Point's three best-evidenced coasters came out
  disputed. Now the heaviest source picks the spot, lighter ones that disagree are recorded
  as `dissent`, and a **conflict** is only two sources of equal standing pointing at
  different places — which is never published, and never averaged into a point neither of
  them supports.
- **One ride often has four mapped lanes.** Cedar Point draws Maverick's standby lane, its
  Fastlane lane and two more segments as separate ways, all carrying the ride's name. They
  are not four entrances, and the evidence model dedupes by *source*, so whichever way came
  last in the file used to win. They are reconciled to the end that reaches furthest into the
  park — the one somebody walking up actually meets.

The evidence lives in `data/venues/<id>.attractions.json`, beside the bundle rather than in
it: the bundle is overwritten by every rebuild and the evidence is the expensive part. Only
what clears the bar is copied in, as `e` and `out` on the place, stamped `fused` so that the
next run can tell the pipeline's own conclusion apart from the evidence behind it.

**The conclusion stands beside its inputs, not on top of them.** A fused entrance goes first
in `e`, because that is the one the app walks to, and every pin another writer put there —
the builder's queue-derived one, a traced one — stays behind it. That used to be conditional
on standing more than 20 m away, which is exactly backwards: the fused point sits *on* its
heaviest source rather than between them, so the pin that argued for it was normally a few
metres away and publishing deleted it. Those pins are what the next run reads back as
evidence, so a bundle that dropped them could no longer re-derive what it was asserting. A
conclusion that eats its premises is not derived, it is self-perpetuating. Only the previous
run's own `fused` entry is replaced, which is what makes publishing twice leave one entry.

**It runs inside the build.** `public/venues/<id>.pois.json` has two writers — the builder,
wholesale from OpenStreetMap, and this — and for a while only the builder ran in the
**Build a venue** workflow, so every rebuild silently reverted the published entrances and
the sidecar was the one artifact on the graph with nothing scheduled at all. The workflow now
runs the inventory straight after the build, in that order, and the two are a pipeline rather
than two writers racing: the builder emits the bundle, the inventory derives on top of it,
and both files are committed together in the same pull request. Nothing writes back upstream
— an override is raw hand input and a fused coordinate is derived output, and putting the
second in the first would only move the violation one file to the left.

That is affordable only because a run which learns nothing changes nothing. Publishing is
re-derivation rather than accumulation, and the sidecar's `generated` date is the day the
file last said something different rather than the day the script last ran — the same rule
`addEvidence` applies to a single claim's date, applied to the file around it. So a rebuild
that finds OpenStreetMap unchanged still produces an empty diff, and "does OpenStreetMap
still say what we shipped?" stays a question a diff can answer.

**What this does not do**, and does not pretend to: it does not look at aerial imagery, run
computer vision over it, watch a ride walkthrough or fetch a park's PDF. Each of those is a
real source and a project of its own. What is here is what can be done from data already on
disk — plus the door for the rest, since every one of those sources already has a weight and
lands through the same call the automatic ones use.

### Getting things off the park's own map

The map a park hands out at the gate knows things OpenStreetMap does not, and until now none
of it was reachable: `--merge` takes points that are already surveyed, which is exactly what
a picture's are not. `trace-venue.mjs` ties the picture to the ground.

```
npm run venues:trace -- data/venues/big-kahunas.trace.json
npm run venues:trace -- <file> --model tps --max-error 6
npm run venues:trace -- <file> --report          # the fit, as markdown
npm run venues:build -- --rebuild big-kahunas --trace data/venues/big-kahunas.traced.geojson
```

The input is one JSON file: **control points** — places you can identify in the picture *and*
read a real coordinate for out of OpenStreetMap — and the **features** somebody clicked out
of it, both in pixels.

```json
{
  "venue": "big-kahunas",
  "image": "docs/big-kahunas-2026-parkmap.png",
  "controls": [{ "n": "Wave pool, NE corner", "px": [1204, 880], "lat": 30.38871, "lng": -86.47262 }],
  "features": [
    { "kind": "entrance", "of": "Jumanji", "px": [990, 640] },
    { "kind": "exit",     "of": "Jumanji", "px": [1010, 700] },
    { "kind": "place", "n": "Toilets, by the wave pool", "c": "restroom", "px": [880, 910] },
    { "kind": "route", "n": "Boardwalk", "px": [[880, 910], [905, 940], [960, 980]] }
  ]
}
```

Each kind lands somewhere different. An **entrance** and an **exit** go onto the ride they
belong to as `e` and `out` — a place here has always been one point, and for a ride the
builder took from its track that point is the middle of the track, so "walk me to Diamondback"
aimed at the top of the lift hill, over a fence. The ride keeps its own position for the
marker; only the destination moves. A **route** goes into the drawn paths, which is also the
routing graph, so a traced cut-through is walkable the moment it lands with no other change
anywhere. A **place** is a new POI, for what OSM has not got at all.

**Every pin says it was traced, or it is refused.** The tracer stamps each feature — and the
collection — with the image, the model, the control count and the RMS error, and both readers
of that file require it: `applyTrace`, folding a trace into a venue being built, and
`npm run venues:attractions -- <id> --trace <file>`, the short way round a rebuild. Neither of
them mints one. They used to, and it was the same laundering as on `e` one file to the left —
a point became a signed weight-3 coordinate with an image and an error figure that were
nowhere in the file, because of *which tool had been invoked*. A person types that command, so
it was a smaller lie; it is the same lie. An unsigned point is reported as skipped and lands
nowhere.

**The accuracy is the whole design.** Big Kahuna's map was georeferenced by hand once, came
out at 33 m RMS with residuals to 55 m in a park 400 m across, and every pin from it was
thrown away — correctly, and only because somebody happened to check. So the checking is the
tool. Four models are offered: `similarity` and `affine` for a scan, `projective` for a
photograph of a map board, and `tps` — a thin-plate spline — for a drawing, which is not a
photograph of anything and is stretched wherever the artist needed room. `auto` fits every
one the controls can carry and keeps whichever *measures* best, because which suits a picture
is a fact about the picture, not about the control count.

And it is measured by **leave-one-out cross-validation**: fit on every control but one,
predict that one, see how far off it lands. A spline passes exactly through its own controls,
so its residual against them is zero however wrong it is in between — quote that and you have
proved that arithmetic works. The in-sample number is printed and immediately undercut, and
the cross-validated one is what the gate reads. Nothing is written above `--max-error`,
ten metres by default: about the width of a midway, and the point past which a pin is
pointing at the wrong side of the path.

Its advice when it refuses is the advice that works — more control points, spread to the
corners. On a synthetic warped drawing, six controls cross-validate at 17 m and twenty at
3 m, while the rigid fits stay stuck in the twenties throughout. What comes out carries the
image, the model and the error on every feature, so a pin surveyed off a sign and a pin read
off a drawing at nine metres never quietly become the same claim.

### Asking for what OpenStreetMap does not have

Everything above is a fact a build cannot produce, and the gap between "the build is done"
and "the venue is finished" is exactly that list. `venues:ask` writes it out:

```
npm run venues:ask                    # every venue that still needs something
npm run venues:ask -- kings-island    # one venue
npm run venues:ask -- kings-island --json     # the same thing as data
```

What comes out is a brief somebody — or something — can work from without this repo in
front of them: which rides carry no rule, by the exact name the bundle spells them, the
shape of the answer as JSON, and every convention this file has that is not obvious from
looking at it. Each of those conventions is in there because it has already been got wrong
once. That an override keyed to a name nothing answers to is a correction that *silently did
not happen*, and belongs under `_unmapped` instead — Big Kahuna's carries thirteen published
rules there. That `min: 0` is a park saying out loud there is no floor, which the app reads
back as "No minimum", and is not the same as `null`, which means nobody has looked. That
weight limits and life-jacket exceptions go in `note` rather than being rounded off into a
height. That a coordinate is never estimated: Big Kahuna's own illustrated park map
georeferences to 33 m RMS against eleven control points, in a park 400 m across, so nothing
was placed from it.

A venue that needs nothing prints nothing and exits 0, which is what makes it safe to run at
the end of every build — and it does run there, and in the **Build a venue** workflow, which
folds the brief into the pull request it opens. The half-built park is the failure mode this
whole pipeline is arranged against, and the last thing a build says is now which half.

It only ever asks for what an outside source can settle. A town centre is never asked for
its ride heights and a park with no campground is never asked what its pitches have.

### Bringing in data OpenStreetMap does not have

`--merge` folds an outside dataset onto the places, matched by name first and by position
second. It is how any surveyed layer reaches a venue that was built from OSM alone — pitch
hookups, locker banks, a fresh set of height signs — and nothing about it is
campground-specific.

```
npm run venues:build -- --place "Somewhere" --merge pitches.csv --merge lockers.geojson
```

A CSV wants a header row and a pair of coordinate columns under any of the usual names
(`lat`/`latitude`/`y`, `lng`/`lon`/`longitude`/`x`); every other column becomes a property,
and a dotted name nests one, so `camp.drive` sets `camp: { drive }`. That is what makes a
spreadsheet of pitch hookups a one-line import rather than a script. GeoJSON works the
same way through its `properties`.

A feature carrying `name` or `ref` merges onto the place with that name wherever it sits; a
nameless one merges onto the nearest place within `--merge-metres` (25 by default). Anything
that matches nothing is reported rather than added, because a point that landed nowhere near
a place is far more likely to be the wrong projection than a new place.

### The checklist

```
npm run venues:report                 # every venue, one row each
npm run venues:report -- cedar-point  # one venue, in full

npm run venues:adapters               # external OSS dependency matrix (wrap targets)
npm run venues:adapters -- matrix     # markdown table for docs
npm run venues:build-agent -- cedar-point --offline   # multi-agent orchestrator (no network)
npm run venues:build-agent -- cedar-point --ai --apply  # LLM agents + publish entrances
```

Guest walk uploads (`Me → Walk history`, opt-in) post anonymised LineStrings and ground-truth
Points (queue entrances, ride exits, park gates, amenities) to `/api/contributions/traces`. The
`guest-traces` adapter reads the Redis queue (or a dumped `data/venues/<id>.guest-traces-cache.json`)
and proposes walkway / entrance candidates where guests disagree with the published graph — research
only; it never writes `public/venues`.

Every location here is the same data about a different place, and the failure mode that
comes with that is a park that is *almost* built. Nothing crashes — the map draws, the list
fills, and some whole feature of the app is silently not there because the one file that
feeds it was never written. Two of the three parks shipped with no height rules; a third had
its campground dropped entirely by a tag rule; Fiesta Texas had no way in on the map at all
until the checklist said so, which turned out to be a rule that had never heard of
`barrier=toll_booth`.

So the list lives in `scripts/lib/venue-checklist.mjs`, each item knowing whether it applies
to this venue, whether it passed, and what to type if it did not. `npm run test:unit` holds
the required half of it. Items that do not apply are never failures — a town centre has no
ride heights and a campus has no campground.

It reads the venue bundles back off disk, runs them through the same `applyOverrides` the
build uses, refreshes the manifest and reports the tally per park. An override is applied
to **every** POI carrying that name: OpenStreetMap routinely holds one ride as two nodes,
and Fiesta Texas ships two Poltergeists for exactly that reason — patching one of them
left its twin saying "check at the ride", which reads as the app disagreeing with itself.

The `credits` line in an overrides file is where the height data came from, and the app
prints it under the slider. Say it: these are somebody's compilation, and the ride operator
measures at the gate.

Two flags worth knowing: `--dump <file>` saves the raw Overpass response and `--from-dump
<file>` rebuilds from it, so tuning the tag rules doesn't hammer a public mirror. Builds
try three Overpass endpoints in turn, because the busy ones answer 429 and 504 more often
than they answer.

One caveat on Kings Island specifically: its bundle is the hand-pulled one this app was
built around, and it is what ships. A rebuild from today's OpenStreetMap reproduces it
closely — the same 121 coaster track segments, the same 1 park outline, the same 10
districts — and it now matches **all 65** height overrides, where it once matched about
three quarters of them. OSM caught up.

Rebuild it anyway and the park loses ground: the walkable network drops from 106.2 km to
95.9 km, most of it service roads the hand-pulled bundle carries and a fresh query does
not. That is 10 km of route the app would stop offering, against a gain of four station
platforms, so Kings Island is deliberately left as it is. Cedar Point and Fiesta Texas were
rebuilt because they gain (+0.74 km and +0.12 km); this is the check worth running before
rebuilding any venue that already ships.

## Ride entrances

A ride's marker is where the ride *is* — a building footprint, the middle of its track, the
centroid of its area. It is not where you queue, and this app does not claim it is. Whether
it could be is worth writing down, because the answer is a fact about OpenStreetMap rather
than an unfinished job here.

There is no ride-entrance tag in the data. What exists is unnamed gates, and they do not
reach far enough:

| | Cedar Point | Kings Island | Fiesta Texas | Big Kahuna's |
| --- | :-: | :-: | :-: | :-: |
| gate / entrance / booth objects | 185 | 71 | 57 | 0 |
| of those, carrying a name | 4 | 3 | 0 | 0 |
| **naming a ride's queue** | **0** | **0** | **0** | **0** |
| rides with some gate within 45 m | 53% | 25% | 23% | 0% |
| those matches that are ambiguous | 20% | 22% | 53% | – |

Across 235 rides in four parks, not one gate names the ride it serves. The seven that carry
a name at all are the car park and admission booths — Cedar Point's *Main Gate*, *Magnum
XL-200 Gate*, *Valravn Gate* and *Windseeker Gate* are all `barrier=toll_booth` on the
approach roads, named after whatever they are nearest to, and Kings Island's third is
*South BOH Gate*, back of house. They are in the app, correctly, as gates. None of them is
a queue.

"Ambiguous" means a second ride sits nearly as close as the nearest one, so picking by
proximity is a coin toss. Seventeen rides at Cedar Point have more than one gate within
45 m and nothing says which is theirs. Nothing anywhere distinguishes an entrance from an
exit either — a queue gate, a service gate and a fence gate all carry the same
`barrier=gate`. So the best a proximity rule could do is put an unlabelled pin on somewhere
between a quarter and a half of rides, one in five of them on the wrong ride, and none of
them able to say whether it is the way in or the way out. That reads as authoritative and
is not, which is worse than saying nothing, so it is not done.

### What is derived, and from what

Distance is the wrong instrument. Two things a mapper actually wrote down are the right
ones, and where both exist the entrance follows exactly, with nothing estimated:

- **the queue's name.** `Millennium Force Standby Queue` says whose queue it is. That is
  attribution, not inference.
- **`oneway`.** A queue runs one way, towards the ride. Chain one ride's queue ways together
  and the vertex that is never any way's end is where the queue begins.

`entrancesFromQueues()` in `scripts/build-venue.mjs` does that and hangs the result on the
ride as `e`, a list of `{lat, lng, n}` — a list, because a standby queue and a Fastlane
queue are two ways in, merged only when they start within 8 m of each other, which at
Top Thrill 2 and Snake River Falls they do.

Six rides at Cedar Point carry one today: Top Thrill 2, Millennium Force, Snake River Falls,
Rougarou, Steel Vengeance and Gemini. Every one lands within 0.8 m of the walking network,
as an entrance must, and between 16 m and 146 m from the ride's own marker — which is the
size of the problem it fixes on the park's biggest queues. Maverick's queues carry no
`oneway`, so it is reported and skipped rather than approximated. Kings Island's Racer has
two named queues and will pick them up whenever its bundle is next rebuilt.

Nothing else in the app reads `e` yet; it is data first, and moving routing onto it is a
separate decision.

The rest needs no code either: name the gate, or the queue, in OpenStreetMap and it appears.

What the app does instead is route to the walking network. `findRoute` snaps both ends of
every route to the real footpaths before searching, so navigating to a ride walks you to
the nearest point of the midway that actually serves it, not to a coordinate inside the
ride's footprint. For a coaster whose marker sits in the middle of its own layout, that
snap *is* the useful answer — which is also why the walking network being complete
matters more here than a marker moving a few metres.

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
  Overpass API and licensed ODbL. Positions are building footprints, track midpoints and
  centroids, **not queue entrances** — see [Ride entrances](#ride-entrances) for why not,
  and for what the app does instead.
- **Height requirements** — for Kings Island, compiled from Kings Island Central and
  Theme Park Insider, reflecting the 2026 season. For Big Kahuna's, from the park's own
  2026 attraction pages, which state a minimum in prose for the thrill rides and file
  every attraction under the park's own Over 42"/44"/48" headings. For Six Flags Fiesta
  Texas, from the park's Guest Safety and Accessibility Guide, topped up for the water park
  from its own per-attraction pages, which post a Min and Max Height each. They live in
  `data/venues/<id>.overrides.json`; a venue built from OpenStreetMap alone has
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

Visual overview first: [docs/architecture-map.md](docs/architecture-map.md).
The tree below is the same map as prose.

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
lib/gps/movementLog.js        opt-in walk sessions, anonymise, upload validation
lib/guestTraces.js            server queue for guest LineStrings (builder research)
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
lib/sheet.js                  the sheet's heights, and what fits at each of them
lib/venue/useVenue.js         the hook components read it through
lib/venueIndex.js             generated: static POI imports for the API routes
lib/serverStore.js            memory / Upstash backend for the cloud fallback
app/
  page.js                     client state, the tabs and the sheet
  join/page.js                invite landing; reads the fragment, never the query
  api/mailbox/…               the relay
  api/…                       party, members, location, rides, health, metrics
  api/contributions/traces    guest walk uploads (POST) + operator export (GET)
  api/weather/                the only outbound call in the app; cached, fails soft
components/
  ParkMap.jsx                 SVG renderer, pan + pinch zoom, label layout
  MapSymbols.jsx              marker silhouettes and glyphs, shared with the key
  MapLegend.jsx               the on-map key, which is also the category filter
  GlanceRail.jsx              the live card rail in the collapsed sheet
  TabBar.jsx                  the four bottom tabs, badges and all
  useSheetDrag.js             the sheet under a finger: follow, then stay put
  PartyPanel.jsx              roster, QR, join, status, meet-up
  QrScanner.jsx               camera join; says so plainly where unsupported
  Diagnostics.jsx             active transport, probe results, queue depth
  PlaceList.jsx               place search, live status and reporting
  HeightPanel.jsx             the rider-height filter and what it unlocks
  SettingsPanel.jsx           name, appearance, which map, and the long tail
  MovementHistoryPanel.jsx    opt-in walk log, history, upload / GeoJSON export
  WeatherBanner.jsx           the park-wide headline; renders nothing on a clear day
  useWeather.js               polls the forecast, caches it, survives losing signal
  useMovementLog.js           records in-park GPS into IndexedDB when opted in
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
  lib/venue-ids.mjs           the primary key of a place, and the ledger that remembers it
  attractions.mjs             the ride inventory: every way into every ride, and who says so
  lib/evidence.mjs            what a source is worth, how claims fuse, when one has expired
  lib/candidates.mjs          plausible entrances proposed from the shape of the park
  trace-venue.mjs             a park's own map, georeferenced → entrances, routes, places
  lib/georef.mjs              the transforms, and honest error by cross-validation
  lib/venue-trace.mjs         where a traced feature lands in a venue
  lib/venue-recipe.mjs        how a venue was built, so it can be built that way again
  lib/venue-requests.mjs      what a build cannot answer, as a brief somebody can
  lib/venue-checklist.mjs     what a location has to carry before it is finished
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
data/venues/<id>.overrides.json  heights, areas, corrections — re-applied on rebuild
data/venues/<id>.ids.json        the key issued to each place, and every number already spent
data/venues/<id>.recipe.json     the box, pad and flags that built it — replayed by --rebuild
data/venues/<id>.trace.json      control points and features clicked off the park's own map
data/venues/<id>.attractions.json  per-ride features, their evidence and confidence
Dockerfile  docker-compose.yml
```
