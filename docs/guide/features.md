# Features

[← README](../../README.md) · [Guide index](index.md)

An explorer’s companion for a group at a big, crowded park. It ships with
Kings Island (Mason, Ohio), Six Flags Fiesta Texas (San Antonio), Cedar Point
(Sandusky, Ohio) and Big Kahuna's (Destin, Florida), and one command — or one form under
Actions — builds a map of anywhere else OpenStreetMap covers. Built with Next.js 16
(App Router) and React 19.

Parkbound turns a complicated park day into an adventure you can actually enjoy —
live party coordination, walking trails, and a drawn park map.

**New to the codebase?** Start with the
[architecture map](../architecture-map.md) — system diagram, venue build
pipeline, phone layers, and party mesh visuals — then come back here for the
full feature prose.

- **Drawn map, not tiles.** Real OpenStreetMap geometry projected to Web Mercator and
  painted as SVG: midways, buildings, water, slides, and every coaster's actual track
  centreline. Pan with one finger, pinch or scroll to zoom.
- **Any location.** `npm run venues:build -- --place "Somewhere"` pulls the geometry and
  the places, and the app offers the new map next time it boots — or run it from a form
  under Actions → Build a venue and get a pull request back. See
  [Building a map of somewhere else](venue-builder.md). Nothing in the
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
  squiggle among many. The tap also puts a callout on the map: name, distance, walk time,
  height rule — and opens a place sheet with the full details and a navigate control.
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
  [Height rules](venue-builder.md#height-rules-and-other-corrections).
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
- **Five tabs at the bottom, and a sheet you pull.** Explore, Party, Side Quests, Plan and
  Me sit in a tab bar at the foot of the sheet, so the whole app is one thumb-reach away
  and never moves — and each tab keeps its own navigation stack, so leaving one and coming
  back finds it where you left it. Tapping the tab you are already on unwinds it to its
  root. Screens slide in from the side they came from. The map itself is the canvas
  underneath — shut the sheet to live in it. Opt-in **Walk history** (path log, ground-truth
  pins, upload) is not a tab: it lives under **Me → Walk history**.

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
  with the moon button floating over the map, or under Me.
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
  under Me → Which park and it stops second-guessing you.
- **Walking time is the headline everywhere**, with feet as the secondary figure — in a
  park "4 min" answers the question and "825 ft" doesn't.
- **NEED HELP status** pulses that person's marker, vibrates every phone in the party and
  reports their range and bearing.
- **A scale bar that is telling the truth.** It picks a distance people round to — 100 ft,
  250 ft, half a mile — and then measures it, rather than drawing a fixed width and naming
  it afterwards. North lives on the **Compass** strip (and Watch dial) as a quiet tick —
  the map stays north-up except during Go, so a separate map-edge rose is not used.
- **Facing Compass** — phone strip and Apple Watch dial: party pins, Meet, and one primary
  Place relative to facing. Me → Watch Compass holds density / Always On / what shows.

---
[← README](../../README.md) · [Guide index](index.md)
