# Research: Terrain/elevation ground truth for the PBR display pipeline

**Date researched:** 2026-08-18
**Product:** Universal Venue Builder (`packages/venue-builder`)
**Status:** Research complete — primary sources preferred; secondary sources labeled.
**Companion:** [`2026-08-18-visual-ground-truth-tools.md`](./2026-08-18-visual-ground-truth-tools.md) (doc 1 — same evaluation shape, covers aerial/CV/video/map-digitization/materials), [`packages/venue-builder/lib/adapters/registry.mjs`](../../packages/venue-builder/lib/adapters/registry.mjs), [`../adr/0013-display-pipeline.md`](../adr/0013-display-pipeline.md), [issue #493](https://github.com/parthalon025/six-flags-sa/issues/493), [PR #471](https://github.com/parthalon025/six-flags-sa/pull/471) (`claude/custom-maps-builder-venue-6y1fte` — PBR material pipeline + "grounded world-model generation")

This is a sixth area doc 1 didn't cover: **terrain/elevation**. PR #471 adds a PBR material pipeline and "grounded world-model generation" to the Display layer (`display/base.pmtiles`, `visual.json`, skin assets, per ADR-0013's truth/display split) — but as of this research, that pipeline has no ground-truth height or slope input at all. It would bake flat-terrain assumptions into every venue's `visual.json`, which is wrong for a hilly park (a mountain-coaster park, a park built into a ravine, a water park with an elevated log-flume lift) in the same way flat land-cover tinting was wrong before doc 1's ESA WorldCover recommendation.

Every claim below traces to a license file, terms page, or first-party program page — not a blog summary. Where a claim could only be sourced from a summary (search-result synthesis of a document this note could download but not machine-parse) rather than a direct read, it is labeled **secondary**.

---

## Executive summary

**This is a Display-layer question, not a Truth-layer one — confirmed, not assumed.** `packages/venue-builder/lib/evidence.mjs`'s `WEIGHTS` table (`official_map`, `osm_entrance`, `aerial`, `cv_detection`, `guest_trace`, `geometry`, …) is exhaustively a table of *where things are* — every source in it is evidence for a 2D lat/lon claim about an entrance, queue, or POI. None of it is elevation-shaped, and elevation doesn't corroborate or contradict a footprint claim: a ride's entrance is in the same XY place whether the ground under it is flat or on a 40° slope. Terrain height only matters once that XY geometry is already settled — it feeds the Z-axis of the render mesh, slope-aware material selection (steep terrain gets rock/scree instead of turf), and hillshading in `visual.json`, exactly the same shape as doc 1 §5's PBR material sources. See "Truth vs. Display" below for the full reasoning.

Four things worth prototyping in the next PR, roughly in this order:

1. **Copernicus DEM (GLO-30)** — free, worldwide, no-cost-to-registered-user license per ESA/Airbus's own Copernicus DEM licence, and a materially better global product than SRTM (full ±90° latitude coverage, no radar voids, produced 2010–2015 vs. SRTM's 2000 single-pass mission). The obvious global default for the "grounded world-model" height input.
2. **USGS 3DEP** — US public domain, "free of charge and without use restrictions" per USGS's own words, and the only one of the eight that offers a genuine bare-earth **DTM** (not just a DEM/DSM) plus raw lidar point clouds, at 1 m resolution where flown. The right upgrade path for US parks once Copernicus DEM's 30 m baseline is in place.
3. **OpenTopography** as the *access layer* over both, not a separate data source — one REST API surfaces SRTM, Copernicus DEM (COP30/COP90), and USGS 3DEP rasters/point-clouds under one key, but its free-tier API Agreement explicitly disallows "commercial, for-profit... integration of ... API keys into a product or service" without an Enterprise key. That clause needs a builder-time-only read (bake heights into venue assets at build, never call the API from the shipped app) before this is a clean `wrap`.
4. **SRTM (as a fallback, not a first choice)** — same "no restrictions on use" USGS EROS status as everything else USGS distributes, but it is a strictly worse product than Copernicus DEM for this use case: it is itself a surface model with radar-shadow voids, and it has no coverage above 60°N or below 56°S. Worth keeping only as the long-tail fallback OpenTopography already wires up for free.

A cross-cutting correction worth flagging up front: **SRTM and Copernicus DEM are not bare-earth models.** Radar interferometry reflects off whatever it hits first — tree canopy, a roofline — so both are technically DSM-like products (Copernicus's own producer literally calls the source "edited DSM," see §4). Only USGS 3DEP's lidar-derived products offer a true bare-earth DTM. For a venue with tree cover or tall structures, this means the cheap global default (Copernicus DEM) will show canopy/roof height where the builder wants ground height — worth a note in adapter docs, not a blocker.

---

## Truth vs. Display — the determination the issue asks to confirm

`evidence.mjs`'s weight table exists to fuse claims about **where a POI is**: `official_map` (5), `osm_entrance` (4), `aerial` (4), `cv_detection` (2), `guest_trace` (2), and — importantly — the repo's own lowest-weight `geometry` source, defined in the file's own comment as "this repo's own inference from the shape of the path network." Every one of those fourteen weighted sources is a statement of the form "the entrance is here" or "this claim about a location is corroborated." None encodes a height, slope, or surface-material fact, and none of the terrain sources below produce that kind of claim either — a DEM pixel says "the ground at 40.7°N is 212 m above a reference ellipsoid," which has no bearing on whether a queue entrance OSM tagged at that point is real.

ADR-0013's own Display/Truth split says it plainly: the Display pipeline "feeds `visual.json` and the `display/` asset pack only — geometry stays exactly what the Truth layer already published, and the builder still 'never invents geometry.'" A DEM raster clipped to a venue's bounding box and baked into a heightfield for the render mesh doesn't reposition a single POI or path node published by the Truth layer; it only changes how the ground under those already-fixed XY coordinates is rendered — extrusion height, hillshading, and (combined with doc 1 §5's material work) which stock texture a sloped patch gets versus a flat one.

**Conclusion: all eight sources in this note are Display-layer inputs.** `evidence_sources: []` on every proposed row below, matching doc 1 §5's Poly Haven/ambientCG/WorldCover-for-Display precedent exactly.

---

## 1. DEM, DTM, DSM — terminology, not standalone sources

These three acronyms name *product types*, not adoptable projects — there is no single "DEM" to license the way there is a single OSM to license. USGS's own FAQ defines the baseline term plainly: a Digital Elevation Model is "a representation of the bare ground (bare earth) topographic surface of the Earth excluding trees, buildings, and any other surface objects" ([USGS — What is a digital elevation model (DEM)?](https://www.usgs.gov/faqs/what-digital-elevation-model-dem)). In practice, as USGS's own 3DEP product pages show, the terms split further:

- **DEM** — the umbrella USGS itself uses for its seamless national elevation rasters (1 m, 1/3 arc-second, 1 arc-second, 2 arc-second), described as bare-earth by definition.
- **DTM** — explicitly bare-earth, breakline-aware — 3DEP's Alaska IfSAR product line names a Digital Terrain Model (DTM) as a distinct GeoTIFF output alongside the Digital Surface Model, described on the same USGS page ([USGS — About 3DEP Products & Services](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)).
- **DSM** — the surface *including* everything on it (canopy, rooflines). The same 3DEP IfSAR page names a 5 m Digital Surface Model (DSM) product explicitly as "vegetation/structures" included. Radar- and photogrammetry-derived global products (SRTM, Copernicus DEM — §§3–4 below) are DSM-shaped by physics, whether or not their own branding says "DEM": the sensor measures whatever surface reflects the signal first.

This distinction is not academic for a "grounded world-model" pipeline: a DTM gives a clean terrain mesh to drape materials over; a DSM already has tree/roof height baked in, which would double-count against the Overture Maps building-massing work doc 1 §2 already recommends for `cv_segmentation`, and would make flat plazas under tree canopy read as bumpy terrain. USGS 3DEP is the only source in this note that offers a real DTM as a first-class, separately-named product.

- **Fit:** none of the three is directly adoptable; each is realized by the concrete sources in §§3–6 below. `role` classification only, no standalone `id`.
- **Proposed shape (documentation only, not a new registry row):**
  ```
  // DEM / DTM / DSM are role labels, realized by:
  //   bare-earth DTM  -> usgs-3dep (role: TERRAIN_DTM_SOURCE)
  //   surface DSM     -> usgs-3dep (Alaska IfSAR) OR srtm / copernicus-dem (global, DSM-shaped by physics)
  //   generic DEM     -> whichever of the above is in scope for the venue's country
  ```

---

## 2. LPC — Lidar Point Cloud

The raw discrete-return 3D point data lidar sensors produce, before it's rasterized into a DEM/DTM/DSM at all — the highest-fidelity option in this note, and the only one that would let the builder derive its *own* custom-resolution terrain mesh or extract standalone-feature heights (a queue canopy's true roofline, say) rather than trusting someone else's rasterization choices. USGS's 3DEP LPC products are distributed "in LAZ format," described by USGS as "a lossless compressed version of the American Society for Photogrammetry and Remote Sensing (ASPRS) LAS format" ([USGS — About 3DEP Products & Services](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)), and mirrored for bulk access on AWS Open Data: the `usgs-lidar-public` S3 bucket (Entwine Point Tiles, a streamable LAZ-based octree) needs no AWS account (`aws s3 ls --no-sign-request s3://usgs-lidar-public/`), while a companion `usgs-lidar` Requester-Pays bucket carries "Raw LAZ (Compressed LAS) 1.4 3DEP format" with more complete coverage ([USGS 3DEP LiDAR Point Clouds — AWS Registry of Open Data](https://registry.opendata.aws/usgs-lidar/)). License on that same registry entry is stated as **"US Government Public Domain"**, pointing to USGS's own terms FAQ ([What are the terms of use/licensing for map services and data from The National Map?](https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map)).

- **Fit:** Display, highest-effort/highest-fidelity option — raw point cloud → rasterize-to-heightfield yourself, rather than consuming a pre-rasterized DEM. Only worth the extra integration cost for a venue with terrain features (an artificial mountain, a berm-hidden coaster) too fine-grained for a 1 m+ raster to capture cleanly.
- **Proposed row:**
  ```js
  {
    id: 'usgs-3dep-lpc',
    name: 'USGS 3DEP Lidar Point Cloud',
    repo: 'usgs/3dep',
    url: 'https://registry.opendata.aws/usgs-lidar/',
    capability: 'Raw discrete-return lidar point clouds (LAZ) for custom terrain-mesh rasterization at build time',
    role: 'TERRAIN_POINT_CLOUD_SOURCE',
    stage: 'display',
    license: 'Public Domain (US Government)',
    adopt: 'defer',
    maturity: 'production',
    maintenance: 5,
    languages: ['various'],
    docker: false,
    gpu: false,
    offline: true, // once pulled from S3 and cached
    commercial_ok: true,
    evidence_sources: [],
    integration: 'high',
    notes:
      'US-only; nominal pulse spacing/vertical accuracy varies by collection (2014+ generally meets QL2). Defer behind usgs-3dep raster row — only reach for raw LPC when a rasterized DEM/DTM is too coarse for a specific venue feature.',
  }
  ```

---

## 3. SRTM (Shuttle Radar Topography Mission)

NASA/NGA's February 2000 single-pass radar-interferometry mission (Space Shuttle *Endeavour*, STS-99, flown with the German and Italian space agencies) — the first near-global elevation dataset, covering roughly 80% of Earth's landmass between 60°N and 56°S at 1 arc-second (~30 m) posting. USGS EROS distributes it as public data with essentially the same blanket terms as the rest of the archive: **"There are no restrictions on the use of data received from the U.S. Geological Survey's Earth Resources Observation and Science (EROS) Center ... unless expressly identified prior to or at the time of receipt,"** with a requested (not required) citation of "Data Available from the U.S. Geological Survey" ([USGS EROS Archive — Data Use and Citation](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-data-use-and-citation)). Product-specific pages are at [USGS EROS Archive — SRTM 1 Arc-Second Global](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm-1) and the general [USGS EROS Archive — SRTM](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm) overview page; Version 3 ("SRTM Plus"/void-filled) backfilled the radar-shadow gaps in earlier releases with other topographic sources.

Two structural weaknesses matter for this project specifically: (1) it is a **surface** model, not bare earth — radar reflects off canopy and rooftops, the same physics caveat as §1; (2) coverage stops at 60°N/56°S, so it silently fails for any venue north of, say, most of Canada, Scandinavia, or the UK's northern half — a hard gap Copernicus DEM (§4) does not have.

- **Fit:** Display, global fallback — free and zero-friction, but strictly dominated by Copernicus DEM for quality and by USGS 3DEP for US bare-earth fidelity. Keep as the option OpenTopography already serves for venues neither of the better sources covers well (it doesn't cover higher latitudes at all, so this is more "belt" than "primary").
- **Proposed row:**
  ```js
  {
    id: 'srtm',
    name: 'SRTM (Shuttle Radar Topography Mission)',
    repo: 'nasa-usgs/srtm',
    url: 'https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm',
    capability: 'Near-global 30m/90m surface-elevation raster (radar interferometry, 60°N–56°S coverage)',
    role: 'TERRAIN_ELEVATION_SOURCE_FALLBACK',
    stage: 'display',
    license: 'Public Domain (US Government) — "no restrictions on use" per USGS EROS',
    adopt: 'wrap',
    maturity: 'production',
    maintenance: 3, // mission ended 2000; archive is stable, not actively expanding
    languages: ['various'],
    docker: false,
    gpu: false,
    offline: true,
    commercial_ok: true,
    evidence_sources: [],
    integration: 'low',
    notes:
      'DSM-shaped (canopy/roof reflective surface, not bare earth) and no coverage above 60°N/below 56°S. Prefer copernicus-dem for global default; keep this as OpenTopography\'s existing fallback dataset, not a first-choice adapter.',
  }
  ```

---

## 4. Copernicus DEM

ESA's global elevation product, edited from the 2010–2015 TanDEM-X bistatic radar mission (DLR/Airbus WorldDEM™), offered in three instances — EEA-10 (10 m, restricted-access, 39 European countries), GLO-30 (30 m, worldwide), and GLO-90 (90 m, worldwide) — per ESA's own collection page: *"GLO-30 and GLO-90 datasets are available worldwide with a free license"* and *"All registered users can freely access the 30m and 90m resolution instances"* ([Copernicus Data Space Ecosystem — Copernicus DEM collection description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)). ESA's own December 2020 announcement of the GLO-30 opening confirms *"any registered user"* can now access it under a *"free & open licence,"* while flagging that "a small subset of tiles covering specific countries are not yet released to the public" for historical political/export reasons ([Sentinel Online — Copernicus DEM 30 metre dataset now freely available](https://sentinels.copernicus.eu/-/copernicus-dem-30-metre-dataset-now-freely-available)). The governing legal document is the standalone Copernicus DEM instance licence, distributed at [License-COPDEM-30.pdf](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf) — this note downloaded that PDF but could not machine-extract its text in this environment, so the specific clause wording below is **secondary** (search-engine summary of the same document): *"The use rights granted under this licence are free of charge to the User,"* with a required attribution notice — *"© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"* — when the data is distributed or adapted.

**This is explicitly not the same product as Sentinel-2**, which doc 1 already covers as an optical multispectral imagery source under the EU's general Copernicus data policy. Copernicus DEM is a separate elevation product, produced by a different mission (TanDEM-X radar, not Sentinel optical), governed by its own standalone DEM-instance licence rather than the general Copernicus Sentinel Data terms doc 1 cited for Sentinel-2 — two different license documents from the same Copernicus program, easy to conflate in adapter notes if the distinction isn't called out.

Like SRTM, it is producer-labeled a surface product: OpenTopography's own API documentation names it plainly as **"COP30 (Copernicus Global DSM 30m)"** ([OpenTopography for Developers](https://opentopography.org/developers)) — not DEM, not DTM. Unlike SRTM, its TanDEM-X radar source (2011–2015, dual-antenna single-pass interferometry) has full global coverage without SRTM's latitude cutoff or as many radar-shadow voids, and is a materially more modern, more accurately edited product.

- **Fit:** Display, recommended global default. The single best "grounded world-model" height input for any non-US venue, and a reasonable US default too before reaching for 3DEP's higher-resolution but US-only data.
- **Proposed row:**
  ```js
  {
    id: 'copernicus-dem',
    name: 'Copernicus DEM (GLO-30)',
    repo: 'esa/copernicus-dem',
    url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
    capability: 'Global 30m surface-elevation raster (TanDEM-X derived, edited DSM), full-latitude coverage',
    role: 'TERRAIN_ELEVATION_SOURCE',
    stage: 'display',
    license: 'Copernicus DEM instance licence (free for registered users, attribution required)',
    adopt: 'wrap',
    maturity: 'production',
    maintenance: 4,
    languages: ['various'],
    docker: false,
    gpu: false,
    offline: true, // bulk-downloadable GeoTIFF, cacheable
    commercial_ok: true,
    evidence_sources: [],
    integration: 'low',
    notes:
      'DSM-shaped, not bare earth (canopy/roof height included) — same physics caveat as SRTM. Distinct product and distinct license from Sentinel-2 (doc 1) — different mission (TanDEM-X radar vs. Sentinel optical), different governing licence document. Recommended global default height source for visual.json.',
  }
  ```

---

## 5. OpenTopography — the data portal/API

A single REST API (San Diego Supercomputer Center / UC San Diego, NSF-funded) that fronts most of the elevation sources in this note under one key: its own Global Datasets API lists SRTM GL1/GL3, ALOS World 3D, **COP30 ("Copernicus Global DSM 30m")**, COP90, GEDI L3 ("DTM 1000 meter"), a Continental Europe DTM, and more; a separate USGS 3DEP Raster API front-ends 1 m/10 m/30 m 3DEP rasters; and a Point Cloud API serves lidar point-cloud queries — all documented at [OpenTopography for Developers](https://opentopography.org/developers). Its own Terms of Use, fetched directly (last updated October 8, 2025), state plainly under "Data and Content": **"Data obtained from OpenTopography are free of all copyright restrictions and made fully and freely available for both non-commercial and commercial uses. Certain datasets may have open data licenses (e.g., Creative Common CC BY 4.0) associated with them"** ([OpenTopography — Terms of Use](https://opentopography.org/usageterms)).

The catch is in the same Terms, under "API Agreement": **"Commercial, for-profit (i.e., intending to make money), integration of OpenTopography API keys into a product or service is not permitted. For these for-profit use cases we offer Enterprise API keys"** — with the free-tier key additionally rate-limited (200 calls/24h for academics, 50/24h for non-academics) and bbox-area-capped per dataset (450,000 km² for 30 m-resolution datasets, tighter for USGS 3DEP's finer rasters). This is a real distinction from the *data* itself, which the Terms confirm is free for commercial use once obtained — the restriction is specifically on wiring a free-tier *key* into a commercial product's live request path, the same "arm's-length service vs. linked-in dependency" line doc 1 drew for `overpass-api` (AGPL, `wrap`, self-hosted/queried at arm's length) versus `ultralytics-yolo` (AGPL, `reject`, would be imported directly).

- **Fit:** Display, convenience access layer — one integration surface instead of three (SRTM archive, Copernicus DEM portal, USGS National Map downloader), at the cost of a licensing nuance worth resolving before treating it as a clean `wrap`.
- **Proposed row:**
  ```js
  {
    id: 'opentopography',
    name: 'OpenTopography',
    repo: 'opentopography/opentopography',
    url: 'https://opentopography.org',
    capability: 'Unified REST API over SRTM, Copernicus DEM, ALOS World 3D, USGS 3DEP rasters, and lidar point-cloud queries',
    role: 'TERRAIN_DATA_AGGREGATOR',
    stage: 'display',
    license: 'Data: free for commercial + non-commercial use (per dataset terms). Free-tier API key: non-commercial integration only.',
    adopt: 'evaluate',
    maturity: 'production',
    maintenance: 4,
    languages: ['various'],
    docker: false,
    gpu: false,
    offline: false, // portal/API access; fetched rasters are cacheable once pulled
    commercial_ok: true, // data itself; API-key clause is the open question — see notes
    evidence_sources: [],
    integration: 'low',
    notes:
      'Open question, not license risk: free API key\'s "no commercial product/service integration" clause is written for live pass-through use, not obviously for a builder-time batch job that bakes heights into static venue assets and never calls the API from the shipped app — confirm that reading (or get an Enterprise key) before promoting past evaluate. If resolved, this supersedes separately wrapping srtm/copernicus-dem/usgs-3dep individually the same way doc 1\'s Overture row superseded wrapping Microsoft+Google buildings separately.',
  }
  ```

---

## 6. USGS 3DEP (3D Elevation Program)

USGS's national elevation-data program, distributed through The National Map — the source underlying §§1–2 above. Its own product page states plainly: **"All 3DEP products are available, free of charge and without use restrictions"** ([USGS — About 3DEP Products & Services](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)), consistent with the "Public Domain" / "US Government Public Domain" labeling on its AWS Open Data mirror and the general USGS EROS "no restrictions on use" statement cited in §3. Product lines include seamless DEMs at four resolutions (1 m, 1/3 arc-second ≈10 m, 1 arc-second ≈30 m, 2 arc-second Alaska-only ≈60 m), project-based collections at up to 1 m/1-9 arc-second, Alaska IfSAR-derived DSM/DTM pairs (§1), and raw lidar point clouds (§2).

This is the only source of the eight that offers **genuine bare-earth terrain** as a first-class, separately-labeled product (not a DSM masquerading as elevation data), and the highest resolution of anything in this note — 1 m where lidar has flown, which as of this research covers an expanding but not yet complete fraction of the conterminous US. It is US-only, which is why Copernicus DEM (§4) is the recommended default and 3DEP the recommended US upgrade.

- **Fit:** Display, best-in-class for US venues. Pairs naturally with doc 1's NAIP recommendation (both USDA/USGS-sourced, both US-only, both public domain) as the "US high-fidelity" branch of the Display pipeline, mirroring Copernicus DEM/Sentinel-2 as the "global" branch.
- **Proposed row:**
  ```js
  {
    id: 'usgs-3dep',
    name: 'USGS 3D Elevation Program (3DEP)',
    repo: 'usgs/3dep',
    url: 'https://www.usgs.gov/3d-elevation-program',
    capability: 'US bare-earth DEM/DTM (up to 1m), Alaska IfSAR DSM, and lidar-derived seamless elevation rasters',
    role: 'TERRAIN_ELEVATION_SOURCE_US',
    stage: 'display',
    license: 'Public Domain (US Government) — "free of charge and without use restrictions" per USGS',
    adopt: 'wrap',
    maturity: 'production',
    maintenance: 5,
    languages: ['various'],
    docker: false,
    gpu: false,
    offline: true, // bulk GeoTIFF/COG downloads via The National Map or AWS Open Data, cacheable
    commercial_ok: true,
    evidence_sources: [],
    integration: 'low',
    notes:
      'US-only; resolution varies by state/collection cycle (1m coverage still expanding). Genuine bare-earth DTM, unlike SRTM/Copernicus DEM — preferred source for US venues once Copernicus DEM\'s global 30m baseline is in place. Pairs with doc 1\'s NAIP row as the US-high-fidelity Display branch.',
  }
  ```

---

## Conclusion — prioritized shortlist for a follow-up PR

In order of "prototype this first":

1. **Copernicus DEM (GLO-30).** Free, worldwide, full-latitude coverage, no API key required for direct bulk access, and the best available global default — start here because it unblocks every venue regardless of country, the same "no open question left" bar doc 1 used for Poly Haven/ambientCG.
2. **USGS 3DEP.** US public domain, genuine bare-earth DTM (not a DSM proxy), up to 1 m resolution. Second priority as the US-specific upgrade once the global Copernicus DEM baseline exists — pairs with doc 1's NAIP recommendation as the "US high-fidelity" branch of both Display inputs (imagery and now terrain).
3. **OpenTopography, gated on resolving the Enterprise-key question.** The single-integration convenience layer over both of the above plus SRTM and lidar point clouds — worth prototyping third specifically to settle whether builder-time-only batch fetching (bake to static assets, never call from the shipped app) satisfies the free-tier API Agreement's "no commercial product/service integration" clause, or whether an Enterprise key is required before this project can rely on it at all.
4. **SRTM**, kept as OpenTopography's (or a direct USGS EROS) fallback dataset for venues Copernicus DEM's country-restricted tiles don't yet cover — not a first-choice adopt, but zero additional integration cost once OpenTopography or direct USGS EROS access exists for the other two.
5. **USGS 3DEP LPC (raw lidar point clouds)**, deferred — only reach for raw point-cloud rasterization when a venue's terrain features are too fine-grained for a pre-rasterized DEM/DTM to capture (an artificial mountain, a berm-hidden queue), the same "real capability, not yet needed" deferral class doc 1 used for segment-geospatial.

**Explicitly not worth prototyping as a distinct effort:** DEM/DTM/DSM as such — they are product-type labels realized by the four concrete sources above, not separate adoptable projects; giving them their own registry rows would just duplicate the USGS 3DEP / Copernicus DEM / SRTM entries under a different id.

**Shape of the follow-up PR:** new `stage: 'display'`, `evidence_sources: []` rows for `copernicus-dem` and `usgs-3dep` (both `adopt: 'wrap'`), an `evaluate` row for `opentopography` pending the Enterprise-key determination, a `wrap` row for `srtm` explicitly documented as fallback-only, and a `defer` row for `usgs-3dep-lpc` matching the `sam2`/segment-geospatial deferral class. All five carry `evidence_sources: []` on principle, the same as doc 1's material rows — nothing here should touch `evidence.mjs`, `pois.json`, `map.json`, or `gaps.json`.

---

## Sources

### Terminology (DEM / DTM / DSM)
- [USGS — What is a digital elevation model (DEM)?](https://www.usgs.gov/faqs/what-digital-elevation-model-dem)
- [USGS — About 3DEP Products & Services](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)

### LPC (Lidar Point Cloud)
- [USGS 3DEP LiDAR Point Clouds — AWS Registry of Open Data](https://registry.opendata.aws/usgs-lidar/)
- [USGS — What are the terms of use/licensing for map services and data from The National Map?](https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map)
- [USGS — About 3DEP Products & Services](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)

### SRTM
- [USGS EROS Archive — Data Use and Citation](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-data-use-and-citation)
- [USGS EROS Archive — SRTM 1 Arc-Second Global](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm-1)
- [USGS EROS Archive — SRTM (overview)](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm)

### Copernicus DEM
- [Copernicus Data Space Ecosystem — Copernicus DEM collection description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
- [Sentinel Online — Copernicus DEM 30 metre dataset now freely available](https://sentinels.copernicus.eu/-/copernicus-dem-30-metre-dataset-now-freely-available)
- [License for Copernicus DEM instance COP-DEM-GLO-30 (PDF)](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf) (downloaded directly; specific clause wording quoted in this note is **secondary** — sourced from a search-engine summary of the PDF, not a locally machine-extracted read, since this environment could not parse the PDF's text stream)
- [OpenTopography for Developers](https://opentopography.org/developers) (corroborates "COP30 (Copernicus Global DSM 30m)" naming)

### OpenTopography
- [OpenTopography — Terms of Use](https://opentopography.org/usageterms)
- [OpenTopography for Developers](https://opentopography.org/developers)

### USGS 3DEP
- [USGS — 3D Elevation Program (home)](https://www.usgs.gov/3d-elevation-program)
- [USGS — About 3DEP Products & Services](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)
- [USGS 3DEP LiDAR Point Clouds — AWS Registry of Open Data](https://registry.opendata.aws/usgs-lidar/)

### In-repo context
- [`2026-08-18-visual-ground-truth-tools.md`](./2026-08-18-visual-ground-truth-tools.md) (doc 1)
- [`packages/venue-builder/lib/adapters/registry.mjs`](../../packages/venue-builder/lib/adapters/registry.mjs)
- [`packages/venue-builder/lib/evidence.mjs`](../../packages/venue-builder/lib/evidence.mjs) (`WEIGHTS` table — basis for the Truth vs. Display determination above)
- [`../adr/0013-display-pipeline.md`](../adr/0013-display-pipeline.md)
- [GitHub issue #493](https://github.com/parthalon025/six-flags-sa/issues/493)
- [PR #471](https://github.com/parthalon025/six-flags-sa/pull/471) (`claude/custom-maps-builder-venue-6y1fte`)
