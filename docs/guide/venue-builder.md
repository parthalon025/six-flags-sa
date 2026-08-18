# Building a map of somewhere else

[← README](../../README.md) · [Guide index](index.md)

`npm run venues:build` turns a place into the two files the app loads. It asks
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

`npm run venues:reindex` rebuilds `manifest.json`, `venueIndex.js`, and the App Store
routing coverage file (`fastlane/metadata/ios/routing_app_coverage.geojson`) from whatever
venue bundles are already on disk. A new park is not done until that GeoJSON lists it.

### Building the same park again

Every build writes `packages/venue-builder/data/venues/<id>/recipe.json` inside the venue package — the box,
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
`packages/venue-builder/data/venues/<id>/ids.json`; a rebuild matches each place back to the number it already had
by its OpenStreetMap element, then by position within its name group, and anything the
rebuild cannot claim is retired rather than freed so its number is never handed to a
different place. The reasoning, including why the OpenStreetMap id is provenance rather
than identity, is in `packages/venue-builder/lib/venue-ids.mjs`. Overrides stay filed under the display
name — those files are edited against a park's published height chart — with the key
available as the escape hatch for the entries a name cannot address on its own, such as one
of twenty-six places called "Restrooms".

Each build writes `apps/party-tracker/public/venues/<id>.map.json`, `apps/party-tracker/public/venues/<id>.pois.json`, and `apps/party-tracker/public/venues/<id>.gaps.json`, then
rebuilds `apps/party-tracker/public/venues/manifest.json` and the generated `apps/party-tracker/lib/venueIndex.js`. Gaps are facts the builder cannot settle (height, queue, path, restroom, food, gate, camping); the phone ranks them by Location and does not invent them from POI fields. The client
*fetches* those files rather than importing them, which is the point: a venue added to the
manifest reaches a phone that already has the app installed, and the service worker caches
whichever one gets opened. A missing Gaps file is an empty list — it must not fail the park load.

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

The rest live in `packages/venue-builder/data/venues/<id>/overrides.json`, keyed by name, applied *after* the
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

Accepted durable guest fixes graduate the same way — into `packages/venue-builder/data/venues/<id>/`, never into
`apps/party-tracker/public/venues/` by hand (E0.5). Cadence lives on each venue’s `recipe.json`
(`consolidate.cadence`: `daily` | `weekly` | `manual`; default weekly):

```
npm run venues:consolidate -- --dry-run --force
npm run venues:consolidate -- --apply --queue data/consolidate/queue.json
```

### The ride inventory: every way into every ride

A place in the bundle is one point, and a ride is not one point. It has a queue that starts
out on the midway, a station, and an exit that puts you somewhere else entirely — and for
getting a family across a park, the **queue entrance** and the **exit** are the two
coordinates anybody actually walks to.

```
npm run venues:attractions -- cedar-point --report
npm run venues:attractions -- cedar-point --trace packages/venue-builder/data/venues/cedar-point/traced.geojson
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

The evidence lives in `packages/venue-builder/data/venues/<id>/attractions.json`, beside the bundle rather than in
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

**It runs inside the build.** `apps/party-tracker/public/venues/<id>.pois.json` has two writers — the builder,
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
npm run venues:research -- big-kahunas --ai   # required LLM park-map search → llm-research-cache.json
npm run venues:trace -- --scaffold big-kahunas
npm run venues:trace -- packages/venue-builder/data/venues/big-kahunas/trace.json
npm run venues:trace -- <file> --model tps --max-error 6
npm run venues:trace -- <file> --report          # the fit, as markdown
npm run venues:build -- --rebuild big-kahunas --trace packages/venue-builder/data/venues/big-kahunas/traced.geojson
```

The input is one JSON file: **control points** — places you can identify in the picture *and*
read a real coordinate for out of OpenStreetMap — and the **features** somebody clicked out
of it, both in pixels.

```json
{
  "venue": "big-kahunas",
  "image": "packages/venue-builder/data/venues/big-kahunas/maps/2026-parkmap.webp",
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

### Display packs: skins as certified data

The map's look is data, not renderer code. Two committed ledgers under
`packages/venue-builder/data/display/` hold the display ontology: `materials.json`
(PBR material sets — each row carries its license and source, and only CC0,
original, or licensed-with-proof rows ship) and `skins.json` (skin templates
binding surface classes — walkway, water, vegetation, structure, coaster-track —
to materials, with ids matching the app's `world.js`).

```
npm run venues:display -- cedar-point   # compile + certify one venue's packs
npm run venues:display -- --all         # every shipped venue
npm run venues:build -- --pipeline --display …   # as a pipeline stage after certify
```

Per venue × skin this writes `data/venues/<id>/display/<skin>.visual.json` and a
`display-certification.json` beside it. The certification enforces the standing
rule — *skins restyle, never reposition*: a spec that carries any coordinate
fails, as does an unresolved material, a disallowed license, a land tone naming
a district the map does not have, or a pack over the phone budget. Specs are
compiled from truth only (`basedOn` records the map's `generated` date; there is
no clock anywhere), so rerunning the stage on an unchanged venue is
byte-identical. Publishing display files into `public/venues/` stays a separate,
human-gated step. Design doc:
[custom map display factory](../research/2026-08-18-custom-map-display-factory.md).

### The checklist

```
npm run venues:report                 # every venue, one row each
npm run venues:report -- cedar-point  # one venue, in full

npm run venues:adapters               # external OSS dependency matrix (wrap targets)
npm run venues:adapters -- matrix     # markdown table for docs
npm run venues:sync-sources -- cedar-point          # cache datasets.external (offline/cache)
npm run venues:sync-sources -- cedar-point --fetch  # refresh adapters from the network
npm run venues:build-agent -- cedar-point --offline   # multi-agent orchestrator (no network)
npm run venues:build-agent -- cedar-point --ai --apply  # LLM agents + publish entrances
```

Declare open-data adapters in `packages/venue-builder/data/venues/<id>/sources.json` under `datasets.external`
(ids from `npm run venues:adapters`). Offline scaffolds omit token-gated adapters
(Mapillary, Accessibility Cloud, OpenRouteService); list them when bounds exist.
Adapters that do not apply (e.g. RopeDrop on Cedar Fair) belong in `gaps.adapters`.
Research caches feed `normalizeExternalClaims` → attractions evidence; live waits and
weather stay builder-only and never land in `pois.json`.

Guest walk uploads (`Me → Walk history`, opt-in) post anonymised LineStrings and ground-truth
Points (queue entrances, ride exits, park gates, amenities) to `/api/contributions/traces`. The
`guest-traces` adapter reads the Redis queue (or a dumped `packages/venue-builder/data/venues/<id>/guest-traces-cache.json`)
and proposes walkway / entrance candidates where guests disagree with the published graph — research
only; it never writes `public/venues`.

Every location here is the same data about a different place, and the failure mode that
comes with that is a park that is *almost* built. Nothing crashes — the map draws, the list
fills, and some whole feature of the app is silently not there because the one file that
feeds it was never written. Two of the three parks shipped with no height rules; a third had
its campground dropped entirely by a tag rule; Fiesta Texas had no way in on the map at all
until the checklist said so, which turned out to be a rule that had never heard of
`barrier=toll_booth`.

So the list lives in `packages/venue-builder/lib/venue-checklist.mjs`, each item knowing whether it applies
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

---
[← README](../../README.md) · [Guide index](index.md)
