# Comparable park-map rendering — physical relationships in a pixel tycoon map

**Date researched:** 2026-08-15
**Question:** How should a Pixel tycoon / RollerCoaster Tycoon-style map represent pedestrian paths, coaster track, buildings, and location markers without losing the real park’s useful relationships?

**Scope:** OpenRCT2’s isometric paint pipeline, official comparable-park maps, and OpenStreetMap (OSM) tagging/rendering conventions. The recommendation below distinguishes source geometry from deliberate tycoon-map styling.

## Executive recommendation

Treat the map as two coordinated products:

1. **A literal spatial skeleton:** OSM pedestrian geometry remains the walkable network; building footprints remain buildings; coaster track remains a non-walkable ride line; markers stay anchored to the real POI or entrance.
2. **A stylized painter:** apply a fixed isometric projection, controlled pseudo-height, pixel palette, stable depth sorting, line deduplication, and label decluttering. None of those visual choices should be mistaken for surveyed building heights, coaster elevations, or a route.

For this app, keep `path` / `service`, `building`, and `coaster` as separate source-derived layers. Draw ground and walkways first, then interleave building faces and raised coaster pieces by local depth/bounding envelope, then draw markers and labels in a separate top annotation pass. A coaster area or ride POI is useful when OSM lacks rails; it is not permission to invent a detailed track. A station building is still a building even when the ride’s track touches or passes through its footprint.

## What the primary sources say

### 1. OpenRCT2: isometric depth is geometry, not a flat layer list

OpenRCT2’s current paint source represents each drawable as a `PaintStruct` with a 3D bounding box, screen position, parent/child links, and a quadrant index. The paint session:

- rotates the bounding-box position for the current view;
- assigns the item to a quadrant using its projected X/Y position;
- links quadrant lists from back to front;
- compares bounding boxes to reorder intersecting items; and
- draws the final ordered list, recursively drawing children or attached sub-sprites with their parent.

Sources: [`Paint.h`](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/paint/Paint.h), [`Paint.cpp` quadrant assignment](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/paint/Paint.cpp#L66-L105), [`Paint.cpp` bounding-box sorting](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/paint/Paint.cpp#L337-L373), [`Paint.cpp` quadrant arrangement](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/paint/Paint.cpp#L454-L676), and [`Paint.cpp` final drawing](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/paint/Paint.cpp#L697-L745).

This is the important convention to borrow: a path, a wall face, a roof, a support, and a rail that overlap on screen need a deterministic spatial order. A global order such as “all buildings, then all coasters” cannot correctly express a track passing behind one wall and in front of another. Parent/child or attached drawing is also a useful model for keeping a ride’s station sign, supports, and track visually together.

OpenRCT2’s own issue tracker documents the failure mode: items can share a quadrant, and bounding-box edge cases can produce incorrect or flickering results. The report specifically describes quadrant assignment from bounding-box X/Y, linked-list insertion order, and the need for sorting; it also notes that old parks may depend on historical quirks. This is evidence to use stable tie-breakers and to split geometry at crossings, not evidence that a hand-authored global layer order is sufficient. Source: [OpenRCT2 issue #2239](https://github.com/OpenRCT2/OpenRCT2/issues/2239).

**Implication:** use a depth envelope for every stylized mesh (ground shadow, track, support, wall face, roof), sort back-to-front with a stable secondary key, and keep labels out of the physical depth sort. Do not try to encode every overlap with a single integer layer.

### 2. Official park maps: show the visitor mental model, not every survey detail

Official park maps consistently prioritize a small set of relationships:

- **Named lands or districts** organize the map into memorable areas.
- **Attractions** are named and numbered or symbolized.
- **Dining, shopping, restrooms, first aid, information, entrances, and accessibility facilities** are separately marked.
- **Walkways and building/landmark shapes** provide orientation, but the map is not a building-by-building engineering plan.

Examples:

- [Six Flags New England official park map page](https://www.sixflags.com/newengland/park-map) directs guests to the official interactive map/app. The official [park-map-and-guide PDF](https://static.sixflags.com/website/files/sfne_park-map-and-guide.pdf) groups the park into areas and lists attractions, shopping, dining, and guest services rather than labeling every geometry vertex.
- [Universal Orlando official interactive map](https://www.universalorlando.com/web/en/us/plan-your-visit/resort-maps/interactive-map.html) explicitly frames the map around rides, shopping, dining, events, and other visit-planning destinations. Its [Islands of Adventure official map PDF](https://www.universalorlando.com/contentdata/uor/en/us/files/Documents/islands-of-adventure-park-map-english.pdf) uses themed-land headings and numbered attraction/dining markers over a simplified park diagram.
- Disneyland’s official [Accessibility Planning Guide & Recommendations](https://cdn1.parksmedia.wdprapps.disney.com/vision-dam/digital/parks-platform/parks-global-assets/disneyland/guest-services/guide-map/Accessibility_Planning_Guide_Recommendations_1-9-26.pdf) says the portable tactile maps represent **building boundaries, walkways, and landmarks**, and separately discusses choosing a meeting location. The official [guide map PDF](https://cdn1.parksmedia.wdprapps.disney.com/vision-dam/digital/parks-platform/parks-standard-assets/disneyland/guide-maps/Guide_Map-DLP-GWD-053123.pdf) labels attractions and services instead of turning every physical object into a label.

**Implication:** preserve the path/building relationship for orientation and routing, but put the user-facing emphasis on districts, attractions, and a restrained set of destination markers. A “truthful” map does not need every OSM way name or every coaster segment visible at once.

### 3. OSM: pedestrian ways, coaster areas, coaster rails, and buildings are different objects

OSM’s conventions deliberately separate the physical concepts:

- [`highway=footway`](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dfootway) means a minor way mainly or exclusively for pedestrians. Wider pedestrianized streets can use `highway=pedestrian`; areas can use `area:highway=footway` or `highway=pedestrian` + `area=yes` where non-linear routing matters. Footways should join other ways for routing.
- [`attraction=roller_coaster`](https://wiki.openstreetmap.org/wiki/Tag:attraction%3Droller_coaster) describes the area encompassing a permanent coaster installation. The page explicitly says not to put that tag on the actual track.
- [`roller_coaster=track`](https://wiki.openstreetmap.org/wiki/Key:roller_coaster) describes the track line; the same key also documents `roller_coaster=station`, `support`, and `track` uses. The attraction area and track line therefore answer different questions.
- [`building=yes`](https://wiki.openstreetmap.org/wiki/Tag:building%3Dyes) records the presence of a building when a more specific building type is not known. A building footprint is not automatically a coaster track, even if a station or queue is associated with the ride.
- [`layer=*`](https://wiki.openstreetmap.org/wiki/Key:layer) is local vertical-order information for crossing or overlapping features. It is not a general height or “draw this whole object above everything” field. OSM recommends using it with a bridge, tunnel, covered way, or related structural tag; [bridge](https://wiki.openstreetmap.org/wiki/Key:bridge) and [tunnel](https://wiki.openstreetmap.org/wiki/Key:tunnel) describe the physical crossing context.

OSM Carto reflects the same separation:

- Its [building style](https://github.com/gravitystorm/openstreetmap-carto/blob/v5.8.0/style/buildings.mss) uses fills and outlines for building polygons and renders entrance symbols as a separate high-zoom annotation.
- Its [roller-coaster style](https://github.com/gravitystorm/openstreetmap-carto/blob/v5.8.0/style/tourism.mss) uses a casing/fill treatment, a gap-fill layer, and explicit bridge/tunnel handling for `roller_coaster=track`; it does not turn the ride area into a line.
- The [v5.8.0 style change](https://github.com/gravitystorm/openstreetmap-carto/compare/v5.7.0...v5.8.0) records the addition of roller-coaster rendering and its zoom-sensitive treatment.

**Implication:** build the walkable graph from pedestrian/service ways only. Render coaster track as a visual, non-routable feature. Render the coaster installation area or ride POI as context/selection data, not as a substitute for rails. Render buildings as polygons, with stations identified by their ride relationship or OSM station tag rather than by converting every ride-associated polygon into track.

## Literal map truth versus tycoon-map convention

| Concern | Literal real-world truth | Deliberate Pixel tycoon / RCT-style convention |
|---|---|---|
| Position | Preserve the source coordinates and relative placement. | Use a fixed isometric projection and snap/pixel-align at the display scale. |
| Pedestrian paths | A path is a route-bearing way with joins, access, steps, bridges, and tunnels. | Give walkways a readable ribbon/casing and simplify duplicate parallel ways; never make the simplification change routing. |
| Buildings | The footprint is the mapped ground outline; its height may be unknown. | Extrude a modest heuristic height and use a roof/wall palette. The extrusion is visual, not a claim about surveyed height. |
| Coaster rails | Track is a non-walkable line; bridges/tunnels/layers describe local crossings where known. | Lift the line into a stylized rail ribbon with sparse supports and optional ground shadow. A repeating lift profile is an iconographic effect, not elevation truth. |
| Coaster installation | `attraction=roller_coaster` marks the installation area, which may contain queues, fencing, station, and track. | Use the area/POI as a ride envelope or selection target; do not render its outer boundary as if it were the rail. |
| Markers | A marker should point to a real POI, entrance, or meeting location. | Use a high-contrast icon, halo, short leader, or small offset to remain legible. Marker placement may move on screen while its geographic anchor remains fixed. |
| Labels | Names belong to the relevant feature and must not imply nonexistent geometry. | Show one label per user-facing destination, with collision priority and clustering/occlusion rules. |

## Overlap and incomplete OSM geometry

### Building and track overlap

Use the source semantics before using screen-space collision:

1. If the geometry is `building=*` and the track is `roller_coaster=track`, retain both as separate objects.
2. If the station is tagged or otherwise identified, keep the station as a building and let the track terminate/enter it. The overlap is meaningful: it represents a ride station, queue, or enclosed segment.
3. If a track crosses a building but OSM supplies `tunnel=building_passage`, `covered=*`, `bridge=*`, or a local `layer=*`, use that information for the local depth decision. Do not apply the layer to unrelated nearby geometry.
4. If the overlap is ambiguous, do not delete the building just to make the line visible. Prefer a deterministic mask/occlusion rule or a short split of the track so the rail can pass behind/in front of the appropriate wall. Keep the source features selectable.
5. If the building is merely near the coaster installation area, retain it. The OSM attraction area is not a reason to suppress unrelated shops, restrooms, or station-adjacent structures.

This is stricter than a purely decorative “remove whichever shape collides” rule. It preserves the useful physical relationship while allowing the painter to choose a legible stylization.

### Missing or partial track

When OSM has a coaster POI or installation area but no reliable track line:

- show the ride marker and, if useful, a low-detail installation footprint or named ride envelope;
- do not fabricate loops, lifts, supports, or a complete rail path from the attraction polygon;
- let the UI say or imply “ride location” rather than “this is the exact track”;
- make a later, reviewed geometry correction additive: once a track line is present, it can be rendered as a separate visual layer without changing the path graph.

When OSM supplies several fragments for one named ride, merge only connected/near-duplicate fragments under a stable ride identity. Preserve distinct parallel or crossing rails when they represent real track; deduplication should remove duplicate imports, not erase the ride.

## Avoiding line spaghetti around location markers

Use a dedicated annotation pass rather than allowing every geometry layer to compete with markers:

- **Deduplicate by destination:** one marker/label for a ride or place ID, not one for every OSM way, rail fragment, entrance node, or associated polygon.
- **Anchor in world space:** choose the actual POI or a reviewed entrance/meeting point; offset only the screen presentation.
- **Keep physical lines underneath:** paths, service ways, track, shadows, supports, building faces, and roofs render before markers and labels.
- **Use a marker halo/backplate:** a small opaque or semi-opaque pixel halo preserves readability without erasing a large piece of the map.
- **Use short leaders only when needed:** route a leader from the offset marker to its anchor with a short elbow/radial segment; avoid crossing dense path junctions and do not draw a leader when the anchor is already clear.
- **Resolve collisions by priority:** selected destination / meeting point first, then ride, entrance, food, restroom, and lower-priority context. Cluster or hide lower-priority labels at low zoom.
- **Avoid label-on-line repetition:** a long coaster or path should have one readable name near its chosen anchor, not repeated labels along every segment.
- **Preserve an inspection mode:** a user can still inspect all source geometry or select a hidden/occluded object without making the default view a tangle of leaders and duplicate rails.

## Concrete implications for this app

The venue pipeline already has the right conceptual seam in `packages/venue-builder/lib/osm-tags.mjs`: it classifies `path`, `service`, `building`, and `coaster` separately, and only the walkable layers belong in routing. Keep that data contract.

For the Pixel tycoon renderer in `apps/party-tracker/lib/isoTycoon.js`:

1. Keep projection and pseudo-height visibly labeled as style. `isoLocal`, building extrusion, and coaster lifting should never be treated as navigation or surveyed elevation.
2. Keep path/service geometry ground-bound and route-bearing. Carry `steps`, `bridge`, `tunnel`, access restrictions, and local layer metadata where they affect routing or local occlusion.
3. Keep buildings as extruded footprints even when they overlap a ride. Prefer explicit station/covered/bridge/tunnel semantics and depth masks over dropping a building wholesale.
4. Keep coaster rails non-routable and separate from the attraction area and building footprint. Merge only same-ride fragments that are actually connected or duplicate.
5. Sort interleaved building faces, roofs, track, shadows, and supports by a stable depth envelope. Use a deterministic tie-breaker for equal-depth geometry; do not rely on insertion order.
6. Put location markers and labels in a final, collision-aware annotation layer. Anchor them to POIs/entrances, not to arbitrary line midpoints, and use one marker per destination.
7. When coverage is incomplete, render uncertainty as less detail or a ride-area marker rather than invented track. This keeps the app’s map useful without claiming more physical truth than the source provides.

## Sources

Primary sources consulted on 2026-08-15:

1. [OpenRCT2 `Paint.h`](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/paint/Paint.h)
2. [OpenRCT2 `Paint.cpp`](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/paint/Paint.cpp)
3. [OpenRCT2 issue #2239: Walls behind slopes get drawn on top of them](https://github.com/OpenRCT2/OpenRCT2/issues/2239)
4. [Six Flags New England official Park Map page](https://www.sixflags.com/newengland/park-map)
5. [Six Flags New England official park-map-and-guide PDF](https://static.sixflags.com/website/files/sfne_park-map-and-guide.pdf)
6. [Universal Orlando official interactive map](https://www.universalorlando.com/web/en/us/plan-your-visit/resort-maps/interactive-map.html)
7. [Universal Islands of Adventure official map PDF](https://www.universalorlando.com/contentdata/uor/en/us/files/Documents/islands-of-adventure-park-map-english.pdf)
8. [Disneyland official Accessibility Planning Guide & Recommendations](https://cdn1.parksmedia.wdprapps.disney.com/vision-dam/digital/parks-platform/parks-global-assets/disneyland/guest-services/guide-map/Accessibility_Planning_Guide_Recommendations_1-9-26.pdf)
9. [Disneyland official guide map PDF](https://cdn1.parksmedia.wdprapps.disney.com/vision-dam/digital/parks-platform/parks-standard-assets/disneyland/guide-maps/Guide_Map-DLP-GWD-053123.pdf)
10. [OpenStreetMap `highway=footway`](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dfootway)
11. [OpenStreetMap `attraction=roller_coaster`](https://wiki.openstreetmap.org/wiki/Tag:attraction%3Droller_coaster)
12. [OpenStreetMap `roller_coaster=*`](https://wiki.openstreetmap.org/wiki/Key:roller_coaster)
13. [OpenStreetMap `building=yes`](https://wiki.openstreetmap.org/wiki/Tag:building%3Dyes)
14. [OpenStreetMap `layer=*`](https://wiki.openstreetmap.org/wiki/Key:layer)
15. [OpenStreetMap `bridge=*`](https://wiki.openstreetmap.org/wiki/Key:bridge)
16. [OpenStreetMap `tunnel=*`](https://wiki.openstreetmap.org/wiki/Key:tunnel)
17. [OpenStreetMap Carto building style](https://github.com/gravitystorm/openstreetmap-carto/blob/v5.8.0/style/buildings.mss)
18. [OpenStreetMap Carto roller-coaster style](https://github.com/gravitystorm/openstreetmap-carto/blob/v5.8.0/style/tourism.mss)
19. [OpenStreetMap Carto v5.7.0 → v5.8.0 change history](https://github.com/gravitystorm/openstreetmap-carto/compare/v5.7.0...v5.8.0)
