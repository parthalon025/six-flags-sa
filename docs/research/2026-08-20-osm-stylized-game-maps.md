# Algorithmic generation of stylized game maps from OSM data — distilled

Source: research text supplied by the repo owner on 2026-08-20 during the Train E (custom map worlds)
design session. Distilled here for the repo; original citations at the bottom. Formula images in the
original did not survive paste and are re-stated in prose where they matter.

## What it covers

An end-to-end pipeline for turning OSM primitives (nodes/ways/relations + tags) into stylized game
maps, across five art paradigms, plus a "universal map factory" architecture.

### Pipeline stages

1. **Ingestion/parsing** — PBF/XML → filtered vectors; tag heuristics for missing structure
   (building height defaults by class, `building:levels` × per-story metres; optional CNN inference
   from LiDAR/imagery for roof shape/height).
2. **Projection** — WGS84 → Web Mercator with the cos(lat) local scale correction; **origin-shift
   to a local ENU tangent plane in float64 before float32 engine consumption** (avoids mantissa
   jitter); floating-origin rebasing for large worlds.
3. **Geometry** — ring closure/winding normalization, collinear pruning; **earcut / constrained
   Delaunay** for non-convex + holed footprints; wall quad extrusion with length-derived UVs;
   **straight-skeleton roofs** (edge-shrink with edge/split events; e.g. `bpypolyskel`) for
   hipped/gabled over irregular footprints; MOOB ridge alignment for near-rectangular ones;
   DEM raycast skirts for terrain seating.
4. **Style passes** (the part that matters for Skins):
   - **2D tilemap**: rasterize vectors to a cell grid; **dual-grid autotiling** — offset grid samples
     4 corner states → 4-bit mask → 16-tile (or compressed 5-tile) transition set; kills jagged
     land/water edges.
   - **Isometric 2.5D**: iso projection of ENU coords; height along screen-Y; dynamic Y-sort keys or
     orthographic depth buffer; classic 2:1 dimetric tile math with the closed-form inverse for
     screen→tile picking.
   - **Hand-drawn NPR**: sub-segment polylines, displace vertices along normals with **multi-octave
     simplex/Perlin** (frequency + amplitude parameters = "hand tremor"); extrude into textured
     ribbons sampling ink/charcoal alpha brushes; **watercolor via distance-field boundary lookup**
     modulating saturation/opacity near polygon edges (pigment pooling on drying edges).
   - **Pixel art**: render vectors un-antialiased into a low-res offscreen buffer; **palette
     quantization** (nearest color in RGB distance to a fixed swatch set); **Sobel edge pass** on
     depth/normal buffers for 1px dark outlines.
   - **Low-poly 3D**: RDP simplification, un-welded normals for faceting, vertex-color baking from
     tags, node-anchored prop instancing.
5. **Runtime** — tile-grid streaming with an R-tree, async spawn, 3-tier LOD (full roofs <500m,
   simplified 0.5–2km, block aggregates beyond).

### "Universal map factory" architecture

- Zero-database tile synthesis (Planetiler/Tilemaker) over PostGIS pipelines for offline/pre-generated
  use; PMTiles archives as the interchange; tag rule engines (Lua/Java) as the strict typed layer
  between raw tags and rendering.
- **Headless Blender sprite baking** for 2.5D: script extrudes footprints + parametric roofs, assigns
  PBR materials from tags, three-point light rig, orthographic camera at 35.264°/45°, renders
  transparent PNG atlases with baked AO/shadows.
- OSM2World for glTF 3D export; engine integration patterns (Unreal georeferencing/PCG, Unity
  jobs/interior-mapping shaders, Godot node trees/TileMap).

## How this maps onto this repo (review, 2026-08-20)

**Validated — we already do it:** truth JSON is our parsed-OSM layer; `localMetres()` is the ENU
origin shift; PMTiles + MapLibre is ADR-0013; per-venue tippecanoe is the right-sized version of the
tile factory; iso projection + depth keys live in `packages/shared/isoWorld.js`; tag heuristics live
in the venue-builder adapters.

**Adopt for the custom-worlds effort (Train E+):**
- NPR treatments with *concrete algorithms*: seeded multi-octave noise displacement for hand-drawn
  wobble; distance-field pigment pooling for watercolor; palette quantization + Sobel outlines for
  pixel-tycoon; dual-grid autotiling wherever a tile look is wanted.
- Straight-skeleton roofs to give iso/2.5D buildings real silhouettes (flat extrusion is part of why
  skins read as "color swaps").
- The headless-Blender orthographic bake is the strongest **non-AI** path to illustrated-quality
  baked worlds (real AO/shadows/materials), at the cost of a heavyweight factory dep and
  version-pinned, perceptual (not byte) certification.
- LOD tiers if venue art scales past current sizes.

**Skip (oversized or off-target):** planet-scale Planetiler/PostGIS (venues are park-bbox scale),
CNN height inference (heuristics suffice), Unreal/Unity/Godot integration (PWA app), floating-origin
rebasing (venues are km-scale).

## Original citations

1. https://theses.fh-hagenberg.at/index.php/system/files/pdf/Kempter15.pdf
2. https://scholarworks.sjsu.edu/cgi/viewcontent.cgi?article=1446&context=etd_projects
3. https://wiki.openstreetmap.org/wiki/Map_features
4. https://www.tandfonline.com/doi/full/10.1080/13658816.2026.2613347
5. https://github.com/bitsteller/osm2pov
6. https://github.com/jlgabriel/condor-buildings-generator
7. https://github.com/onthegomap/planetiler
8. https://tilemaker.org/
9. https://neis-one.org/2026/03/from-planet-to-vector-tiles-osm/
10. https://wiki.openstreetmap.org/wiki/Planetiler
11. https://wiki.openstreetmap.org/wiki/Rendering_OSM_data_with_OSM2World_and_Blender
12. https://github.com/Frataj/3D-OSM-GODOT
13. https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/
