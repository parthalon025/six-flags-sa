# ADR-0015: Terrain belongs to Display, and flat is a real answer

**Status:** Accepted (2026-08-18)
**Depends on:** [ADR-0002 dual-layer park truth](./0002-dual-layer-park-truth.md), [ADR-0013 display pipeline](./0013-display-pipeline.md)
**Research:** [terrain/elevation ground truth](../research/2026-08-18-terrain-elevation-ground-truth.md), [GameRealisticMap comparison](../research/2026-08-18-gamerealisticmap-vs-parkbound.md)

## Context

The display builder had no Z axis: an eight-value land-cover enum, no
`fill-extrusion`, and no field anywhere to hold a height. Park maps read as
diagrams because the ground under them was assumed flat, which is wrong for
Kings Island (48 m of relief) and Fiesta Texas (80 m, built in a quarry).

Adding elevation raises two questions that are easy to get wrong: whether
height is evidence, and which source to use.

## Decision

**1. Terrain is a Display input and never touches Truth.**

`evidence.mjs` weights sources for claims of the form "this thing is *here*".
A DEM pixel says "the ground at this coordinate is 212 m above the ellipsoid",
which neither corroborates nor contradicts a queue entrance. A ride's entrance
is at the same lat/lng whether the ground under it is level or on a berm.

So every terrain adapter carries `evidence_sources: []`, and nothing under
`lib/terrain/` writes to `map.json`, `pois.json`, or `gaps.json`. Terrain
changes how ground is *drawn* — relief shading, slope-aware materials, and
eventually a mesh. It never moves a Place.

**2. Source order is fitness, not coverage: 3DEP first, Copernicus as fallback.**

The earlier research note ranked Copernicus GLO-30 first as a global default.
Measurement inverts that:

| | posting | vs. a 6.45 m bake cell |
| --- | --- | --- |
| Copernicus GLO-30 / SRTM | 30 m | ~5× coarser than the raster it paints |
| 3DEP 1/3 arc-second | 10 m | same order |
| 3DEP 1 m (where flown) | 1 m | resolves it outright |

A 30 m source under a 2.8–8.0 m grid means every value between posts is
interpolation, not measurement. Worse, SRTM and Copernicus are radar surface
models — their own producer calls the Copernicus source an "edited DSM" — so
over a park at 30 m a single sample blends canopy, rooflines and coaster
structure, reporting terrain *on top of a ride*. 3DEP's lidar products are the
only true bare-earth DTM among the candidates.

Copernicus stays wired as the international fallback, labelled `surfaceModel`,
and certification refuses to report it as resolving bare ground.

**3. A venue with no coverage renders flat, and says so.**

`resolveDem` returning `null` is a valid outcome. Certification records "no DEM
coverage — venue renders flat" rather than substituting a plausible surface.
A fabricated heightfield looks convincing and is wrong everywhere, which is
worse than being visibly absent.

**4. Display may echo truth's coordinates; it may not invent any.**

Terrain has to state which rectangle its hillshade covers, so a blanket "no
coordinates in the spec" rule is unworkable. `no_repositioning` now asserts
that every coordinate in a display file is one truth already published — which
is a stronger claim than the previous three-name key blacklist, and catches
both a 0.00001° nudge and a coordinate smuggled under a key like `center`.

## Consequences

- Hillshading works in both render paths today with no isometric tier: the
  canvas bake multiplies its ground raster, and the MapLibre style takes an
  image overlay placed on truth's own bounds.
- Kits may declare a `steep` variant per terrain, selected per cell above
  `steepDegrees` — slope-aware material choice without forking the terrain
  vocabulary with a new class.
- The constraint solver (`lib/terrain/constraints.mjs`) exists so paths, water
  and pads sit properly on measured ground rather than inheriting DEM ripple.
  It moves ~66% of cells by a mean of 0.36 m while leaving each venue's relief
  envelope unchanged — the features settle into the terrain rather than
  distorting it.
- Mesh export exists; #512's isoWorld is the consumer, not yet wired. The OBJ is
  gitignored (~10 MB per venue).

**Amendment — every capability defaults on.** These began as opt-in flags, on
the reasoning that terrain needs the network and the solver moves most cells, so
both should be deliberate. In practice the default was the trap: the committed
output was generated *with* `--terrain`, so a bare `venues:display` silently
produced less than what ships — no terrain block, no hillshade, an unsolved
heightfield — and regenerating looked like a large regression that was really a
forgotten flag. A default that does not reproduce the committed artifact is the
wrong default. `--no-terrain` / `--no-constrain` / `--no-mesh` opt out.

Two capabilities keep an exception. `--mesh` stays opt-in for a **catalog** run,
where a 10 MB OBJ per park across a 100-park catalog is a gigabyte of output
nothing reads; four shipped venues is 40 MB of gitignored files, so
`venues:display` defaults it on. `--bake` stays opt-in everywhere, because
passing it *claims a bake tier* — and a pack that claims one without a certified
bake is meant to fail, which is a rule with its own test. `venues:bake` needs a
browser and writes to `artifacts/`, so defaulting the claim on would fail every
venue on any machine that has not baked.

Defaulting `--tiles` also required separating two things its gate had conflated.
An **absent optional toolchain** is a recorded gap; a toolchain that **ran and
produced something wrong** is a failure. tippecanoe is a `wrap` dependency CI
does not install, so the old gate would have failed every venue on most machines
while saying nothing about any venue. `buildTiles` already described itself as
returning "a recorded gap, not a crash", and the sibling raster tier already
gapped a missing `go-pmtiles`; the tiles gate now matches both, and still fails
hard when tippecanoe runs and the archive is broken or over budget.
- 3DEP is US-only. Non-US venues get 30 m Copernicus, and the difference is
  recorded per venue rather than smoothed over.
