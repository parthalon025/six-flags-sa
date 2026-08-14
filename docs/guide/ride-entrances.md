# Ride entrances

[← README](../../README.md) · [Guide index](index.md)

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

`entrancesFromQueues()` in `packages/venue-builder/bin/build-venue.mjs` does that and hangs the result on the
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

---
[← README](../../README.md) · [Guide index](index.md)
