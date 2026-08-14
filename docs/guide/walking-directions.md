# Walking directions

[← README](../../README.md) · [Guide index](index.md)

Routes are worked out on the phone, from the same venue file the map is drawn from —
`apps/party-tracker/public/venues/<id>.map.json`, whichever one is loaded. There is no routing service, no
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

---
[← README](../../README.md) · [Guide index](index.md)
