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
  It is opt-in (`--constrain`) because it moves ~66% of cells by a mean of
  0.36 m and that should be a deliberate choice.
- Mesh export exists and nothing renders it. That is stated rather than hidden:
  the OBJ is gitignored (~10 MB per venue) and produced on demand.
- 3DEP is US-only. Non-US venues get 30 m Copernicus, and the difference is
  recorded per venue rather than smoothed over.
