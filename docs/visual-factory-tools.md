# Visual factory — tool registry

Every tool the **Visual factory** uses or may adopt, by pipeline stage. Sourcing rule (ADR-0017
cost model): free/open software, free-tier services, CC0 assets, subscription-funded AI via the
agent-brief seam — no per-token API fees. Status legend: **in** (in use) · **adopt: <trigger>**
(bring in when the named trigger fires) · **watch** (viable, no trigger yet) · **rejected** (with
the reason — do not relitigate casually).

## Geometry & layout

| Tool | Buys | Status |
|---|---|---|
| earcut (mapbox) | non-convex/holed footprint triangulation, O(n log n) | adopt: first holed footprint or 3D extrusion need |
| polyclip-ts / martinez | robust polygon boolean ops | adopt: clipping edge-cases bite (water/boundary artifacts) |
| @turf/turf | geodesy utilities grab-bag | watch — prefer the repo's own localMetres/venue-io seams |
| simplify-js (RDP) | vertex reduction for stylized/low-poly passes | adopt: style pass needs silhouette simplification |
| bpypolyskel (Blender) | straight-skeleton hipped/gabled roofs | adopt: Blender tier (E.1) — roofs are the anti-color-swap lever |
| straight-skeleton (npm) / cdt2d / poly2tri | skeleton + CDT in pure JS (no Blender) | adopt: procedural painter wants roof lines without the Blender dep |
| polylabel (mapbox) | visual center of a polygon — label/badge placement | adopt: label placement complaints in bakes |
| delaunator / d3-delaunay | fast triangulation for scatter/mesh work | watch |

## Tiles, styles & formats

| Tool | Buys | Status |
|---|---|---|
| tippecanoe | vector tiles → PMTiles | **in** |
| PMTiles (protomaps) | single-file tile archives over HTTP ranges — vector tier today; zoom-band raster pyramids with viewport streaming per ADR-0019 | **in** |
| maplibre-gl (app renderer) | the one map view: banded raster worlds, vector tier, pitch-eases-with-zoom camera, GL overlay layers | adopt: Train H (decided, ADR-0019) |
| raster tiler (sharp-based, in-repo) | banded bake PNG → deterministic raster tile pyramid → PMTiles | adopt: Train H (ADR-0019) — deterministic and seeded like every certified stage |
| @maplibre/maplibre-gl-style-spec | style.json validation in CI (gl-style-validate) | adopt: first style regression that certification misses |
| spreet (rust) | MapLibre sprite atlases from SVGs | watch — display-atlas.mjs already covers this |
| geojson-vt / vt-pbf | runtime tile slicing without tippecanoe | rejected — tippecanoe is installed and deterministic |
| Planetiler / Tilemaker / PostGIS | planet-scale tiling | rejected (ADR-0016) — venues are park-bbox scale; ADR-0019's band pyramids use the in-repo tiler, not planet tooling |

## Bake rendering & imaging

| Tool | Buys | Status |
|---|---|---|
| headless Chromium canvas (Playwright) | the bake compositor's renderer | **in** |
| skia-canvas / node-canvas | canvas without a browser — faster fleet bakes | adopt: bake wall-clock hurts at fleet scale (100 venues) |
| resvg-js | deterministic CPU SVG→PNG | adopt: a painter emits SVG and byte-identity matters |
| headless Chromium canvas (material compile) | downsize/encode CC0 sets to the 512px budget — the swatch harvester's own path | **in** (slice 4, bin/display-materials.mjs) |
| sharp (libvips) | faster resize/composite/encode without a browser | adopt: material compiles outgrow the browser path (fleet-scale or CI-side compiles) |
| oxipng / pngquant | 30–70% smaller PNGs, lossless/near-lossless | adopt: with everything-in-the-pack, world files are per-guest bandwidth — run before commit; cheapest bandwidth lever in the system |
| WebP/AVIF (via sharp) | world images at ~half PNG weight | adopt: Train H (trigger fired, ADR-0019) — banded pyramids ship WebP at equivalent visual quality; check WebView support floor first |
| @maplibre/maplibre-gl-native | headless render of the real style.json — bake = exactly what phones render | watch — trigger armed per ADR-0019: adopt (with odiff) on the first visual regression that only manifests in engine rendering |
| GDAL / gdaldem | reference-grade hillshade/contours | watch — current solver suffices until quality complaints |
| maplibre-contour | contour lines from DEM at runtime | watch (pairs with the deferred PBR tier) |
| rio-rgbify / terrain-RGB | encode DEM as tiles for 3D runtime terrain | watch (PBR tier only) |

## NPR & style-pass algorithms

| Tool | Buys | Status |
|---|---|---|
| hash-lattice value noise (in-painter, cellHash-seeded) | deterministic two-octave displacement — hand-tremor, clumping | **in** (slice 3 painters; simplex-noise npm stays adopt: a kit needs gradient-noise quality the hash lattice cannot give) |
| rough.js | seeded hand-drawn stroke/fill primitives (hachure!) | adopt: layered-atlas hatching or any sketch-style kit — cheaper than hand-writing hachures |
| perfect-freehand | pressure-simulated ink strokes | adopt: an ink/brush kit wants variable-width strokes |
| image-q | palette quantization (pixel-art pass) | adopt: pixel-tycoon's world conversion |
| Sobel/edge pass (sharp convolve) | 1px outlines for pixel-art | adopt: with image-q |
| distance-field fills (custom, per research) | watercolor pigment pooling | **in** (slice 3) |
| dual-grid autotiling (display-autotile.mjs) | clean terrain transitions | **in** |

## Assets, materials & authoring

| Tool | Buys | Status |
|---|---|---|
| Kenney / Poly Haven / ambientCG | CC0 sprites, tilesheets, PBR sets | **in** (ledgered, sha-pinned) |
| Material Maker (free, Godot-based) | authored procedural PBR graphs — original materials with `original` license | adopt: a design request needs a material no CC0 library has (ADR-0016 names the gap) |
| Inkscape / Krita / GIMP | manual/agent-assisted sprite & icon authoring | **in** spirit (any-editor); outputs enter the ledger only via vendor pins |
| OpenGameArt (CC0 filter) | more sprite/tile variety | watch — license filter is mandatory, ledger gate enforces |
| Google Fonts | label faces for baked worlds | adopt: a kit wants typography beyond system faces; subset before commit |
| openmaptiles/fonts (build-glyphs) | MapLibre SDF glyphs | watch (only if the vector tier ever draws labels — currently overlay's job) |

## 3D & beauty lane

| Tool | Buys | Status |
|---|---|---|
| Blender (headless) | orthographic AO/shadow bakes, flagship richness | adopt: E.1 (decided) — pinned version, perceptual certs |
| OSM2World | truth → glTF scenes | watch — feeds Blender/PBR tiers without hand-modeling |
| three.js + KTX2 | runtime real-time PBR tier | deferred (ADR-0013 item 4) |
| Godot/Unity/Unreal | — | rejected for certified/phone paths (ADR-0016); beauty lane only |

## AI (subscription/free-tier only)

| Tool | Buys | Status |
|---|---|---|
| Claude sessions via agent-brief seam | kit authoring, design-request expansion, bake judging | **in** (#471; ADR-0017 cost model) |
| Gemini (AI Studio free tier) | concept/reference art for design briefs | adopt: first design request that wants visual references; outputs are `original`-class, eye-passed |
| Local diffusion (SD/ComfyUI) | — | rejected: no GPU in the build environment; revisit only if hardware appears |

## Imagery & ground truth (ADR-0020)

| Tool | Buys | Status |
|---|---|---|
| NAIP (USDA, AWS open data) | public-domain ~0.6–1 m US aerial — the derivation-legal ground truth source | adopt: Train H grounding harvest (decided) |
| USGS 3DEP | elevation truth | **in** (terrain solver) |
| Sentinel-2 | 10 m multispectral — vegetation/water classes at venue scale | watch — NAIP covers the US catalog finer |
| Mapillary / KartaView | derivation-licensed street-level; signage, materials at eye level | adopt: Train I evidence lane |
| deterministic CV lane (seeded clustering, indices, edge alignment) | certifiable extraction — may write truth above a confidence bar | adopt: Train I; tool picks per the [imagery CV research](./research/2026-08-20-imagery-cv-research.md) |
| pinned open recognition models | tree/object/segment extraction at scale | adopt-on-trigger per the research note's rows (license-gated; AGPL rejected) |
| agent vision (Claude/Gemini, brief seam #471/#421) | semantic reads as evidence claims — never direct truth | adopt: Train I (steward-gated, #274) |
| Google Maps API (owner key, back office) | geocoding/Places corroboration for venue bootstrap — place IDs only, free SKU caps, key in secrets | adopt: Train I evidence lane (ADR-0020 §7) |
| Google / Bing / Esri basemap derivation | — | rejected (ADR-0020) — viewable is not derivable; an API key changes what we may call, not what we may keep |

## Verification & inspection

| Tool | Buys | Status |
|---|---|---|
| Playwright + 20-point matrix | screenshot/DOM assertions per skin | **in** |
| pixelmatch | pixel diffs | adopt: first check that needs an image diff (nothing imports it today — certification samples pixels via getImageData instead) |
| odiff | 10× faster perceptual diffs at fleet scale | adopt: perceptual certification (Blender tier, or the maplibre-gl-native trigger firing per ADR-0019) |
| perf trace rows (Playwright + CPU throttle) | 60fps / time-to-first-map / zero-blank-tile gates as failing CI rows | adopt: Train H (ADR-0019 clause 8; spec in the perf playbook) |
| SSIM.js | structural similarity — the §5 generative gate | adopt: generative tier certification |
| LDtk debug export | inspectable bake models | **in** |
| Maputnik | free visual MapLibre style editor — eye-pass tuning of style.json | adopt: first hands-on style tuning session; zero integration, it just opens the files |
| QGIS | inspect truth/GeoTIFF/DEM when a bake looks wrong | watch (diagnostic only, never in the pipeline) |
| maplibre-gl-inspect | layer-poking in the display spike | watch |

## Registry rules

New tool → new row with a **trigger**, not a silent import: the trigger is the cost-benefit case.
Anything touching shipped bytes obeys the ledger (license + sha pin). Anything in the certified
path must be deterministic (seeded, version-pinned) or certify perceptually with a stated
threshold. Rejected rows carry their reason; overturning one is an ADR amendment, not a PR remark.

**License classes** (2026-08-20): CC0/public-domain preferred; plain **CC-BY** acceptable with
attribution wired per the attribution policy; **AGPL, GPL, NC (non-commercial), and CC-BY-SA
(share-alike)** are rejected for shipped assets — GPL joins AGPL in the same copyleft spirit, and
share-alike is not "CC-BY" (an explicit policy decision would be needed to admit it). Sources
whose terms ban redistribution of raw files (textures.com, CraftPix) are rejected outright.
Hosted API sources with free tiers — quotas, traps, and the per-stage shortlist — live in the
[free-tier API catalog](./research/2026-08-20-free-tier-api-catalog.md), which also records the
generated-credits attribution policy.
