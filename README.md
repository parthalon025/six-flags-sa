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

## Get it running, free, in about ten minutes

You need an HTTPS address for GPS to work at all, so "just open the file" is not an
option. Two free routes — pick the first one.

### The easy way: Vercel (free, permanent link)

1. Make a free account at **github.com** and at **vercel.com** (sign in to Vercel with
   GitHub — no card, no trial).
2. Upload this folder to a new GitHub repository. On github.com: **New repository** →
   name it `kings-island-tracker` → **Create** → **uploading an existing file** → drag
   in everything from this folder except `node_modules` and `.next` → **Commit**.
3. On vercel.com: **Add New → Project** → pick that repository → **Deploy**. Nothing to
   configure; leave every setting alone. About a minute later you get a link like
   `https://kings-island-tracker.vercel.app`.
4. Open that link on your phone, allow location, and add it to your home screen.

That gets you the map, your own position, every ride height, search and the meet-up pin.
**Party sharing needs one more step**, because Vercel runs each request on a different
machine and there's nowhere to keep the roster between them:

5. In your Vercel project: **Storage** → **Upstash Redis** (labelled Marketplace) →
   **Create** → accept the free plan. Vercel writes the two environment variables in for
   you.
6. **Deployments** → the three dots on the newest one → **Redeploy**. Party codes now
   work across everybody's phones.

Free-tier limits are far beyond what a family trip uses — Upstash gives 10,000 commands
a day, and six phones polling all day is a few thousand.

### The no-account way: your own laptop plus a tunnel

Good for a single trip, and nothing to sign up for. The laptop has to stay awake and
online at home while you're at the park.

```bash
npm install
npm run build
npm start                      # now serving on http://localhost:3000
```

In a second terminal:

```bash
npx localtunnel --port 3000
```

It prints an `https://…loca.lt` address. That address works on any phone, GPS included,
and party sharing works with no database because it's all one Node process. The address
changes each time you restart the tunnel.

If you don't have Node yet, install it from **nodejs.org** (the LTS button) and reopen
your terminal.

### Put it on the home screen

Open the site on the phone, go to the **Me** tab, and follow the **Install on this
phone** card. On Android there's a button. On iPhone it's Share → Add to Home Screen —
iOS gives no automatic prompt, so the app just tells you the taps.

Once installed it opens full screen with no browser bars, and the entire park map is
cached on the phone: it draws instantly and keeps working when the signal dies in a
queue line. Location and party sync still need a connection.

## Run it locally for development

```bash
npm install
npm run dev          # http://localhost:3000
```

`localhost` counts as a secure context, so GPS works there without any tunnel.

## Deploying

Push to GitHub and import into Vercel — no configuration needed for the app itself.

**One thing to set up:** party state defaults to an in-memory store on the server. That's
fine for `npm run dev` or a single long-running Node process, but Vercel runs serverless
functions across instances, so parties won't be shared. Create a free Redis database at
[upstash.com](https://upstash.com) and set:

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

`lib/store.js` picks these up automatically and switches backends. Parties expire after
8 hours; a member's position drops off the roster after 45 minutes of silence.

### Or run the standalone sync server

`server/index.mjs` is a zero-dependency `node:http` server speaking the same wire
protocol, plus a server-sent-event stream so the roster pushes instead of polling. It
runs anywhere you get a long-lived Node process (Render, Fly.io, Railway, a laptop behind
a Cloudflare Tunnel):

```bash
node server/index.mjs                                  # :8787
PORT=8080 DATA_FILE=./parties.json node server/index.mjs
```

Point the app at it and the client switches from 8-second polling to the live stream,
falling back to polling by itself if a proxy eats the connection:

```
NEXT_PUBLIC_SYNC_URL=https://your-sync-server.example.com
```

`lib/partyRuntime.js` is the only file that knows which transports are in play; point
`NEXT_PUBLIC_SYNC_URL` at the standalone server and it goes into the transport list ahead
of the cloud relay, and into the invite so joiners try it first.

## API

| Method | Route | Does |
|---|---|---|
| `POST` | `/api/party` | Allocate a party, returns `{ code }` |
| `GET` | `/api/party/[code]` | Roster and meet-up point |
| `PUT` | `/api/party/[code]` | Upsert your position and status |
| `DELETE` | `/api/party/[code]?id=` | Leave, deleting your record |
| `PUT` / `DELETE` | `/api/party/[code]/meet` | Set or clear the meet-up |

Clients push their own position every 15 seconds, and either poll every 8 seconds or
hold open `GET /api/party/[code]/stream` when the standalone server is configured.

## Tests

`test/visual.mjs` drives the app in headless Chromium at 390x844 with a mocked GPS fix,
walks the height filter and a two-phone party, and writes screenshots to `test/shots/`.
Those checked-in shots are what the map and the height filter actually render.

The suites drive a real browser, so Playwright needs one downloaded the first time:

```bash
npx playwright install chromium
```

Then start the app and point the suites at it:

```bash
npm run build && npm start      # leave this running in one terminal
npm run test                    # 25-check audit: every control, two phones, offline
npm run test:visual             # GPS gate, height filter, two-phone party
npm run test:theme              # daylight and night map, via the real toggle
npm run test:ux                 # glance rail with a live party, height panel
```

All four expect the app on `http://127.0.0.1:3000`; `test:visual` takes a `BASE_URL` if
yours is elsewhere. If the machine already has a Chromium you'd rather use — a CI image,
a sandbox, a distro package — point `CHROMIUM_PATH` at it and the suites skip
Playwright's own copy:

```bash
CHROMIUM_PATH=/usr/bin/chromium npm run test
```

`test/functional.mjs` is the one that matters. It drives two independent browser
contexts as two phones, exercises every control, and asserts on behaviour rather than
appearance: that a party code round-trips, that NEED HELP reaches the other phone, that
leaving actually deletes the record server-side, that height verdicts flip at the right
threshold, and that the map still draws with the network switched off.

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
app/
  page.js                     all client state, party polling, sheet
  layout.js  globals.css
  api/party/…                 party create / roster / position / meet-up
public/
  sw.js                       offline cache: shell + map, never the roster
  manifest.webmanifest        home-screen install
components/
  ParkMap.jsx                 SVG renderer, pan + pinch zoom
  GlanceRail.jsx              the live card rail in the collapsed sheet
  InstallCard.jsx             add-to-home-screen, Android prompt or iOS steps
  GpsGate.jsx                 permission dialog with per-failure guidance
  CompassTape.jsx             bearing HUD
  PartyPanel.jsx              roster, status, meet-up
  RidesPanel.jsx              height filter and park search
  useGeolocation.js           watchPosition + compass, manual fallback
server/index.mjs              optional zero-dependency SSE sync server
test/visual.mjs               headless browser walkthrough -> test/shots/
test/browser.mjs              shared Chromium launcher, honours CHROMIUM_PATH
eslint.config.mjs             flat config, next/core-web-vitals
lib/
  partyRuntime.js             the seam: session, transports, host service or client
  theme.js                    daylight + night palettes (lands, category colours)
  park.js                     POIs, height eligibility
  rides.json                  152 places, 65 with height rules
  geo.js                      distance, bearing, Mercator projection
  store.js                    memory / Upstash backend
public/parkmap.json           drawn map layers (~260 KB)
```
