# Research: GameRealisticMap vs Park Bound — two OSM pipelines

**Date researched:** 2026-08-18
**Subject:** [`jetelain/ArmaRealMap`](https://github.com/jetelain/ArmaRealMap) → `GameRealisticMap`, pinned at commit `2aef204` (2026-05-18)
**Status:** Research complete — claims verified against a local clone, not a web survey.
**Companion:** [`../adr/0002-dual-layer-park-truth.md`](../adr/0002-dual-layer-park-truth.md), [`../adr/0009-ship-gaps.md`](../adr/0009-ship-gaps.md), [`../adr/0013-display-pipeline.md`](../adr/0013-display-pipeline.md), [`../universal-venue-builder-architecture.md`](../universal-venue-builder-architecture.md)

GameRealisticMap (GRM) is the most complete open-source OpenStreetMap→map generator we have found, and it is a genuinely serious piece of engineering: 49 builders, a constrained elevation solver, Clipper/NTS geometry, a WPF Studio, four test projects. This note asks one question — **what does our venue builder do better?** — and answers it without flattering ourselves.

The short answer is that the two projects disagree about what OSM *is*.

> **GRM treats OpenStreetMap as truth and renders it.**
> **Park Bound treats OpenStreetMap as one witness and runs a verification system around it.**

Every genuine advantage we have sits in that gap. Everything GRM does better sits outside it.

---

## Executive summary

| Axis | GameRealisticMap | Park Bound |
|---|---|---|
| Input | OSM + SRTM + Sentinel-2 + ERA5, four hardcoded endpoints | OSM + official park sites + ~19 adapters + guest field reports |
| Scale | 84 × 84 km, whole regions | ~1 km, one venue; 4 shipped of a 100-park catalog |
| Output | Arma 3 `.wrp`/`.pbo`/`.paa`, or GeoJSON/SHP/OBJ via the Generic layer | `map.json` + `pois.json` + `gaps.json`, 259 KB gzip for four parks |
| Consumer | a game engine | phones in a park, offline |
| Per-feature confidence | **none** | weighted fusion, publish gate at `moderate` |
| Per-feature provenance | **none** | source kind + read-date per claim |
| Unknowns | silently invented | shipped as `*.gaps.json` |
| Data-quality gate | **none** — nothing fails a build | `certification.json`, routing QA thresholds |
| Durable human correction | patch the generated artifact | correct the build inputs; identity survives rebuild |
| Input pinning | **none in production** | `recipe.json` + committed source caches |
| Routing graph | **none** | on-device A* over a repaired walk graph |
| Lines of C#/JS | 25,178 core / 79,113 solution | ~12,800 builder + 1,144 router |

**Where we are ahead:** provenance, verification, correction, reproducibility, routability. Five things, and they are all the same thing.

**Where GRM is ahead:** terrain. Elevation, rasters, geometry robustness, feature breadth, coverage area, and a better regression-test methodology than ours.

---

## Method — and why this note is trustworthy

An earlier pass at this comparison was done by fetching GitHub HTML and raw file URLs and summarizing them. That was good enough for architecture and file listings and **not good enough for the load-bearing claims**, four of which are *absence* claims — no confidence model, no validation gate, no durable override, no input pinning. An absence claim is exactly what a partial read gets wrong.

So the repository was cloned and the claims were tested against it. Where a grep is the evidence, the grep is given, so any reader can re-run it and falsify the claim.

```
git clone --depth 50 https://github.com/jetelain/ArmaRealMap.git
git -C ArmaRealMap log -1   # 2aef204  2026-05-18
```

Measured, not estimated:

| Project | Files | Lines |
|---|---|---|
| `GameRealisticMap` (core) | 340 | 25,178 |
| `GameRealisticMap.Studio` | 358 | 28,909 |
| `GameRealisticMap.Arma3` | 176 | 11,215 |
| `GameRealisticMap.Test` | 70 | 6,387 |
| `GameRealisticMap.Arma3.Test` | 49 | 5,004 |
| `GameRealisticMap.Generic` | 29 | 949 |
| `GameRealisticMap.Generic.Test` | 1 | 29 |
| **Solution total (excl. submodules)** | **1,055** | **79,113** |

Read in full: `BuildContext.cs`, `BuildersCatalog.cs`, `IDataBuilder.cs`, `Osm/OsmDataOverPassLoader.cs`, `Osm/OsmDataSource.cs`, `Nature/Ocean/OceanBuilder.cs`, `Nature/Lakes/LakesBuilder.cs`, `Nature/Forests/ForestEdgeBuilder.cs`, `ManMade/Buildings/BuildingsBuilder.cs` + `Building.cs`, `ElevationModel/ElevationBuilder.cs`, `Conditions/`, `Reporting/`, `Configuration/`.

Still survey-level, and flagged as such wherever it matters: the Arma 3 output stage (`WrpCompiler`, `ImageryTiler`, `PboProject`), the Studio UI internals, and the bodies of most of the 49 builders.

---

## What Park Bound does better

### 1. Nothing publishes without evidence, and unknowns ship as data

`packages/venue-builder/lib/evidence.mjs` scores every claim about a place by the kind of source it came from — `official_map: 5`, `osm_entrance: 4`, `mapillary: 4`, `parks_api: 3`, `llm_extract: 1`, `geometry: 1` — fuses them into a band, and publishes a coordinate only at `PUBLISH_AT = 'moderate'`. Our own inference from path shape is weighted lowest *deliberately*, because it is the only evidence that scales to every ride in every park and therefore the one most likely to quietly become the whole dataset.

Two things follow that a bare coordinate cannot express. Claims carry the date their source was read, so the module can distinguish wrong from **expired** — "a park moves a queue, adds an accessible entrance, reroutes a path or demolishes the ride, and a coordinate that was right in 2024 is not wrong so much as *expired*." And claims can **disagree**: `slot.conflict` survives into certification instead of being averaged away.

What cannot be settled from open sources ships as a **Gap** (`lib/ship-gaps.mjs`, [ADR-0009](../adr/0009-ship-gaps.md)) — seven types, one row per unique Place key, invented once in the builder so the phone cannot hallucinate them. The map states its own holes.

**GRM has none of this, and the grep is decisive:**

```
$ grep -rniE '\b(confidence|provenance|uncertain|reliability)\b' --include='*.cs' GameRealisticMap/
0
```

Zero matches across all 340 core files. Nor does any data type carry a source reference back to the OSM element it came from.

It is worse than absence, because absence is filled with invention. `ManMade/Buildings/BuildingsBuilder.cs:65` synthesizes buildings from `man_made` and `generator:source=wind` **nodes**, sizing them from a library and orienting them to the nearest road (randomly if isolated). The resulting type is:

```csharp
public class Building : ITerrainEnvelope
{
    public BoundingBox Box { get; }
    public BuildingTypeId TypeId { get; }
    public List<TerrainPolygon> Polygons { get; }
    public BoxSide EntranceSide { get; }
}
```

There is no field distinguishing a surveyed footprint from a rectangle invented around a point. `Nature/Ocean/OceanBuilder.cs:19-22` does the same at tile scale — `if (coastlines.Count == 0) { // No coastlines, assume land-only }` — and the `Default*AreasBuilder` family invents land use for untagged ground. Downstream, nothing can tell mapped from guessed.

### 2. Corrections survive a rebuild, because identity does

`packages/venue-builder/lib/venue-ids.mjs` exists to stop one specific failure: every join in the app used to be a lowercased display string plus a numeric suffix counted off in file order, so renaming a ride or rebuilding in a different order silently reassigned identity — and an edit keyed to the old key was not moved, it was *lost*.

The fix is that `i` is **issued once into a committed ledger and never recounted**, and is not derived from the display name after first issue. Rename the ride and `n` changes while `i` holds. The module also records why the OSM element id was rejected as identity: `buildPois` has no 1:1 relationship with OSM elements (the dedupe deliberately collapses a track way, a station building and a name node into one place), and a mapper who deletes and redraws a way mints a new `way/id` for the same physical coaster. The OSM element is kept as provenance and a matching tiebreaker, in the ledger, not the bundle.

On top of that identity, `lib/consolidate.mjs` graduates steward-accepted field contributions into `data/venues/<id>/` **build inputs** — never into generated output — on a `daily | weekly | manual` cadence. Hand knowledge is an input to the next build, not a patch on the last one.

**GRM's model is regenerate-and-repatch.** The wiki's documented fix for wrong data is *go edit OpenStreetMap*. Manual work lives in `GameRealisticMap.Arma3/Edit/WrpEditBatch.cs`, which carries `public int Revision { get; set; }` and is applied to the **already-generated `.wrp`**; `Arma3WorldEditorViewModel.cs:321` does `ConfigFile.Revision++` on save and keeps backups. The wiki warns that importing Eden edits "will cause major issues if the revision of the map mismatch."

`BuildContext.SetData<T>()` is the one in-process seam that could inject corrected data before the build, and its callers are exactly the demo generators and the test suite:

```
$ grep -rn 'SetData' --include='*.cs' .
./GameRealisticMap/Demo/DemoMapGenerator.cs          (13 calls)
./GameRealisticMap.Arma3/Demo/…                       (3 calls)
./GameRealisticMap.Test/…                             (tests)
./GameRealisticMap/BuildContext.cs:126                (the definition)
```

No file format, no UI, no persistence. There is no way to say "OSM is wrong here, my value wins, forever."

### 3. A build can fail for data reasons

`lib/venue-certify.mjs` writes `certification.json` recording, per check: **claim, evidence, confidence, falsifier, so-what**. Below threshold, certification fails and an ask brief is attached for a maintainer. The routing gates in `lib/venue-route-qa-core.mjs` are numeric and hard — `MAX_ROUTING_ISLANDS = 2`, `MAX_RIDE_SNAP_METRES = 35` — so a park whose walk network fragments, or whose rides drift off the paths, does not ship. `src/compare.mjs` catches manifest↔disk drift; `bin/drift-watch.mjs` dry-run-rebuilds the whole fleet to catch upstream OSM movement.

**GRM's `Reporting/` is progress reporting, and only that.** Eleven files, and the only failure concept in them is an exception sink:

```
$ grep -rniE 'severity|warning|error|fail' --include='*.cs' GameRealisticMap/Reporting/
Reporting/IProgressTask.cs:9:        void Failed(Exception e);
Reporting/ConsoleProgressSystem.cs:45:  public void Failed(Exception e)
```

No severities, no warning collection, no aggregation. The only `IsValid` in the entire core library is NetTopologySuite's polygon-validity check inside `TerrainPolygon.cs:110`. Nothing can fail a GRM build for a data-quality reason — it is best-effort, always produces something.

The quality-shaped logic that does exist is defensive workaround, not validation. `Nature/Lakes/LakesBuilder.cs:16-22`:

```csharp
protected override TerrainPolygon GetClipArea(IBuildContext context)
{
    return base.GetClipArea(context).Offset(-25).First();
    // Having lakes on edge tends to crash Mikero's MakePbo / tends binarize to produce corrupted WRP files
    // It's not yet clear which tools is getting things wrong
}
```

Every lake is inset 25 m from the map edge to dodge a downstream tool bug — in the *game-agnostic* core, silently, for every consumer.

### 4. Reproducibility is wired into the product, not just the tests

Each venue has a committed `recipe.json` (the rebuild spec), committed `*-cache.json` adapter sidecars, `meta.generated`, and `meta.coverage` counters; `drift-watch` re-runs the fleet to detect when upstream moved. It is not perfect — we still hit live Overpass — but the inputs and the intent are in the repository.

**This is the sharpest contrast in the comparison.** Every GRM production generator constructs its OSM loader directly:

```
GameRealisticMap.Arma3/Arma3MapGenerator.cs:120        new OsmDataOverPassLoader(progress, sources)
GameRealisticMap.Arma3/Arma3TerrainBuilderGenerator.cs:79   new OsmDataOverPassLoader(...)
GameRealisticMap.Generic/GenericMapGenerator.cs:27     new OsmDataOverPassLoader(...)
GameRealisticMap/Preview/PreviewRender.cs:43,82        new OsmDataOverPassLoader(...)
```

`IOsmDataLoader` is an interface, but no production path uses the seam. `OsmDataSource.CreateFromFile()` — which would accept a pinned `.pbf` extract — has exactly one caller in the repository: `tests/DatasetsLoader/Datasets.cs:50`. `CreateFromXml` and `CreateFromPBF` are `internal`.

The loader itself caches by bounding box with a one-day TTL into the system temp directory (`OsmDataOverPassLoader.cs`), and **records nothing about the snapshot in the output** — no date, no hash, no extract version. Satellite tiles cache for seven days. Re-run the same config next month and you get a different map, with nothing to tell you why or how much.

*A disambiguation, so the claim survives a skeptical grep:* `SnapshotDb` appears throughout `Osm/`. That is OsmSharp's read-only in-memory index type, not a versioned snapshot of the input.

The telling detail is that **GRM's own test suite pins OSM to files** — `tests/Datasets/*.pbf.zst`, ten fixtures, loaded via the `CreateFromFile` path that production never touches. The maintainer clearly understands the problem and solved it for tests only. That is the single best idea in the repository for us to steal, and it is described in "What to steal" below.

### 5. The output is routable, repaired, and proven so

`apps/party-tracker/lib/routing.js` (1,144 lines; "no DOM, no fetch, no clock") turns venue geometry into a walk graph on the phone. Raw OSM is not routable, so it is repaired in five phases:

1. **Weld** vertices within 6 m — without it the graph "looks complete and is quietly in a hundred pieces."
2. **Split at crossings** — segments that visually cross without sharing a node.
3. **Stitch** loose ends ≤ 26 m — a path stopping short of the midway it obviously joins.
4. **Bridge** marooned components ≤ 70 m, one bridge each; anything further stays unreachable on purpose.
5. **Mend** ≤ 25 m, but only when the detour it saves exceeds 300 m *and* the link does not cross an obstacle wall built from `water ∪ pool ∪ building`.

Then A* with a binary heap over a **local equirectangular projection** rather than Web Mercator, which would inflate length by 1/cos(lat) — 29 % at Kings Island. Cost is length × `{path 1, service 2.6, queue 4.5, stitch 1.4, bridge 2, mend 2.2}` at 1.15 m/s. Queues are not excluded, just made expensive, so they remain a last resort. Narration is anchored to **landmarks** rather than street names, because park OSM way names are nearly all empty.

And it is tested against the shipped bundles rather than fixtures — "a fixture that routes perfectly and a park that does not is the failure mode worth catching." Two assertions carry most of the weight: the largest connected component must exceed **85 %** of nodes (it was 60 % before the repair passes existed), and an attribute-perturbation test synthesizes flags on 300+ ways then asserts `JSON.stringify` equality across **100+ route pairs** — carrying the attributes must move no route at all.

**GRM has no routing graph.** `ManMade/Roads/RoadsBuilder.cs` does not model junctions:

```
$ grep -rniE 'dijkstra|pathfind|routing|graph|junction|intersection' --include='*.cs' GameRealisticMap/ManMade/Roads/
0
```

Roads are classified, clipped, merged where endpoints coincide, and emitted as buffered polygons; junctions emerge visually where those polygons overlap. That is the right call for its target — Arma 3 has its own AI pathing over the generated road network — but it means the artifact is not independently routable, and nothing verifies that the road network is connected.

### Honourable mentions

**`lib/georef.mjs`** fits similarity, affine, projective and **thin-plate-spline** transforms to hand-drawn park maps, and reports error by **leave-one-out cross-validation** — because a spline passes exactly through its own control points, so quoting its residual "proves nothing except that arithmetic works." The illustrated map handed out at the gate is the richest source of park data that exists, and it is not a photograph of anything: the entrance plaza gets a third of the page. GRM only ingests already-georeferenced sources.

**The adapter registry** — ~19 implementations behind one `EvidenceClaim[]` contract, versus GRM's four hardcoded URIs in `Configuration/DefaultSourceLocations.cs`. A declared adapter with no cache must carry a gap note or certification fails.

**`packages/shared/ontology.js`** — builder and phone import the same capability interfaces (`Rideable`, `Queueable`, `MeetCandidate`), so they cannot drift apart about what a coaster is.

---

## What GameRealisticMap does better

Stated plainly, because a comparison that only flatters its author is worthless.

**The constrained elevation solver** (`ElevationModel/Constrained/`, 766 lines with its builder) is the most sophisticated thing in either project. It gathers hard and soft constraints from roads, watercourses and lakes into a node graph over the elevation grid and solves them **simultaneously** in `SolveAndApplyOnGrid()`. Bridges `PinToInitial()` at both endpoints so the terrain under them keeps its surveyed height; embankments get smoothed segments scaled to `road.Width * 4f`; normal roads flatten to road width; watercourses are sampled at ¼ cell size with each downstream segment constrained below the last, so rivers actually run downhill. We have nothing comparable, and would need it the moment terrain mattered to us.

**Coastline topology.** `OceanBuilder` merges fragmented `natural=coastline` ways by orientation, then walks the map boundary E→S→W→N inserting corner points to close open coastlines, using winding order for land/ocean semantics. Island detection is a single ocean polygon covering > 99 % of the area.

**Building footprint reconciliation.** Six passes, with the constants verified verbatim: merge thresholds `size = 6.5f`, `lsize = 2f`, `mergeLimit = 100f`; collision resolution deletes the smaller building when overlap exceeds `other.Polygon.Area * 0.15`, otherwise merges when the combined bbox stays within `* 1.05` of the summed area.

**A real rules DSL.** `Conditions/TagFilterLanguage.cs` compiles text expressions to `Expression<Func<T,bool>>` LINQ trees via `StringToExpression`, with `Slope`, `DistanceToRoad`, `DistanceToOcean`, `IsUrban`, `IsResidential` and friends in scope, stored as strings inside asset-config JSON and edited in a Studio tool. Our equivalent is hardcoded rule arrays in `osm-tags.mjs`.

**Geometry.** Vendored Clipper for boolean ops and offsetting, NetTopologySuite for predicates and distance, a parallel quadtree merge for large polygon sets. Ours is 226 lines of hand-rolled helpers — adequate for a 1 km park, not a substitute.

**Scale and breadth.** 84 × 84 km on a single UTM zone with disk-backed huge-image tiling to keep an 80,000² px satmap tractable, and 49 feature builders against our dozen-odd layers.

**Test methodology.** GRM's golden-dataset harness — ten pinned `.pbf.zst` OSM extracts with integration assertions on ocean area and island detection — is **better than ours**. Our strongest determinism test compares one run against another run in the same process; there is no on-disk golden bundle. Theirs would catch a class of regression ours cannot.

*Two caveats on GRM's own claims.* Reproducibility is strong-but-not-guaranteed: randomness is deterministically seeded from position (`new Random((int)Math.Truncate(seed.X + seed.Y))`), but builders run concurrently and several merges partition in parallel; whether output ordering is stabilized was not verified. And "game-agnostic" leaks — the 25 m lake inset above is an Arma-toolchain workaround living in the core, and the README concedes "Current version supports only Arma 3 as generation target."

---

## Our own soft spots

Named here so this note is not a sales sheet.

- **The display pipeline is a stub.** [ADR-0013](../adr/0013-display-pipeline.md) is Accepted, but no `.pmtiles` or `visual.json` exists, and none of its stages (`tiles-build`, `visual-spec`, `skin-bake`, `display-certify`, `manifest`) appear in `build-pipeline.mjs`'s `STAGES`. The shipped renderer is still the 1,879-line SVG `ParkMap.jsx`.
- **`lib/tiles-export.mjs` appears broken.** `wayToLine()` reads `way.p` as `[{lng,lat}]`, but shipped bundles store rings as `way.r` = `[[lng,lat]]`, so it would return `null` for every feature in a real `map.json`. Untested. Filed as an agent-handoff issue.
- **One-way flags ship but are never enforced.** Kings Island carries 114 `f:8`, 22 `f:10` and 5 `f:16` ways, yet `index()` in `routing.js` pushes edges both directions unconditionally and no routing profile reads those bits. Filed as an agent-handoff issue.
- **No golden bundle fixtures**, per the GRM comparison above.
- **Four shipped venues** against a 100-park catalog, and against GRM's region-scale coverage.
- **Much of our most competitive work is unmerged** — the display factory and the first polygon-evidence path (`footprint-fusion.mjs`) are both open PRs, one failing its coverage gate and one conflicted.

---

## What to steal from GRM

1. **Pin the OSM input.** Commit the Overpass response per venue as a compressed extract and record its hash in `manifest.json`, exactly as `tests/Datasets/*.pbf.zst` does for GRM's tests. This converts `drift-watch` from "re-run and see what changes" into "diff against a known snapshot," and makes a rebuild reproducible rather than merely repeatable. GRM proves the technique works and proves the cost of not shipping it.
2. **Golden bundle fixtures** on disk, so a determinism regression is caught against a committed artifact and not against a sibling run.
3. **A condition DSL** for POI and land classification, replacing the hardcoded rule arrays in `osm-tags.mjs`, following `Conditions/TagFilterLanguage.cs`.
4. **Constraint solving as a pattern** for reconciling conflicting geometry, instead of fixed precedence — the closest analogue to what `footprint-fusion.mjs` is reaching for.

---

## Sources

| Source | What it establishes |
|---|---|
| `jetelain/ArmaRealMap` @ `2aef204`, local clone | All GRM claims in this note |
| `GameRealisticMap/BuildContext.cs`, `BuildersCatalog.cs` | Lazy per-type task cache; 49 builders; implicit dependency DAG |
| `GameRealisticMap/Osm/OsmDataOverPassLoader.cs`, `OsmDataSource.cs` | Live Overpass, 1-day bbox cache, no snapshot recorded |
| `GameRealisticMap/Reporting/*` | Progress only; `Failed(Exception)` is the sole failure concept |
| `GameRealisticMap/ManMade/Buildings/{BuildingsBuilder,Building}.cs` | Node synthesis; no origin flag; 6.5/2/100, 0.15, 1.05 |
| `GameRealisticMap/Nature/{Ocean,Lakes,Forests}/*.cs` | Land-only fallback; 25 m Mikero inset; 200 m² forest floor |
| `GameRealisticMap/ElevationModel/{ElevationBuilder.cs,Constrained/}` | Simultaneous constraint solve; bridge pinning; ¼-cell sampling |
| `GameRealisticMap/Conditions/TagFilterLanguage.cs` | LINQ-compiled placement DSL |
| `GameRealisticMap.Arma3/Edit/WrpEditBatch.cs` | Revision-keyed patches on the generated artifact |
| `tests/Datasets/`, `tests/DatasetsLoader/Datasets.cs` | Pinned OSM extracts, tests only |
| Park Bound: `packages/venue-builder/lib/{evidence,venue-ids,venue-certify,consolidate,ship-gaps,georef}.mjs` | Our evidence, identity, certification, consolidation, gaps, georeferencing |
| Park Bound: `apps/party-tracker/lib/routing.js`, `test/builder/unit.mjs` | Graph repair, A*, connectivity floor, route byte-equality |
