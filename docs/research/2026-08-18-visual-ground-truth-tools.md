# Research: Visual ground truth for the Universal Venue Builder

**Date researched:** 2026-08-18
**Product:** Universal Venue Builder (`packages/venue-builder`)
**Status:** Research complete — primary sources preferred; secondary sources labeled.
**Companion:** [`packages/venue-builder/lib/adapters/registry.mjs`](../../packages/venue-builder/lib/adapters/registry.mjs), [`../guide/venue-builder.md`](../guide/venue-builder.md), [`../adr/0013-display-pipeline.md`](../adr/0013-display-pipeline.md)

This note investigates open-source projects and data sources for two separate gaps:

1. **Truth-layer evidence.** `scripts/lib/evidence.mjs` (registry row `venue-evidence-engine`) already reserves fusion weights for `aerial`, `cv_detection`, `cv_segmentation`, `video`, and `traced` evidence, but nothing in the registry populates them today. `docs/guide/venue-builder.md` says outright that the builder "does not look at aerial imagery, run computer vision over it, watch a ride walkthrough or fetch a park's PDF" — this is the "door for the rest" that document leaves open.
2. **Display-layer material ground truth.** PR #471 (branch `claude/custom-maps-builder-venue-6y1fte`) adds a PBR material pipeline per ADR-0013's Display split (`display/base.pmtiles`, `visual.json`, skin assets). That pipeline needs real-world-derived land cover and material references — a different problem from Truth-layer geometry evidence, and this note keeps the two apart throughout.

Every claim below traces to a license file, terms page, or first-party repo/docs — not a blog summary. Where a claim could only be sourced from a summary or forum thread, it is labeled **secondary**.

---

## Executive summary

Five things are worth prototyping in the next PR, roughly in this order:

1. **Poly Haven + ambientCG** (Display, not Truth) — CC0 PBR texture libraries with `asphalt`, `roofing`, `water`, `foliage`/`grass` categories already curated. Zero license risk, zero API key, and the fastest way to unblock PR #471's material pipeline without touching the evidence engine at all.
2. **ESA WorldCover** (`aerial` / land-cover input to both Truth and Display) — CC BY 4.0, S3 `--no-sign-request`, 10 m global land cover in 11 classes. Populates `aerial` evidence *and* gives the Display pipeline a land-tone base layer (water/built-up/tree-cover/grassland) for free, offline, no attribution friction beyond a citation line.
3. **Microsoft GlobalMLBuildingFootprints + Google Open Buildings** via **Overture Maps `buildings` theme** (`cv_segmentation`) — dedup'd, ODbL, already joined against OSM conventions. Cheaper to adopt than either vendor's raw output because Overture already resolved the overlap between the two.
4. **segment-geospatial (samgeo)** (`cv_detection` / `cv_segmentation`) — MIT-licensed Python wrapping SAM/SAM2 (both Apache-2.0) for imagery-to-polygon segmentation. Same deferral class as the existing `sam2` row: real capability, GPU-heavy, Phase 2+.
5. **Mapillary Tools' `video_process`** extended to ride-walkthrough footage (`video`) — already an `adopt: wrap` row in the registry for street-level imagery; the video-import path it already ships is the lowest-integration-cost way to turn a POV video into geotagged frames, ahead of building a bespoke video pipeline.

Everything AGPL or non-commercially licensed is flagged as a likely `reject` or `defer` below, matching the existing `ultralytics-yolo` precedent. Nothing in this note recommends touching `registry.mjs` directly — see Conclusion for the shape of a follow-up PR.

---

## 1. Aerial / satellite imagery — populates `aerial`

### NAIP (National Agriculture Imagery Program)

USDA's US-only aerial orthoimagery program. Per the USDA Farm Service Agency's own notice, "since the start of NAIP in 2003, all acquired imagery has been placed in public domain allowing unrestricted use and sharing of the data," with an attribution request (not requirement) to credit "USDA Farm Production and Conservation – Business Center, Geospatial Enterprise Operations" ([FSA NAIP information sheet](https://www.fsa.usda.gov/Internet/FSA_File/naip_info_sheet_2013.pdf), [USGS EROS NAIP archive](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip)). Hosted for programmatic access on the [AWS Registry of Open Data](https://registry.opendata.aws/naip/) and Google Earth Engine ([`USDA/NAIP/DOQQ`](https://developers.google.com/earth-engine/datasets/catalog/USDA_NAIP_DOQQ)). Resolution is sub-meter (~0.6–1 m depending on state/year), refreshed on a 2–3 year state cycle — plenty for verifying a park footprint, not for tracing individual queue rails.

- **Fit:** `aerial` evidence source, high confidence, US-only.
- **Proposed row:** `role: AERIAL_IMAGERY_SOURCE`, `stage: 'vision'`, `adopt: 'wrap'`, `license: 'Public Domain (US Government)'`, `docker: false`, `gpu: false`, `offline: true` (once downloaded/cached), `commercial_ok: true`, `evidence_sources: ['aerial']`.
- **Caveat:** Third-party coverage (UC ANR IGIS, and similar writeups citing FSA Aerial Photography Field Office conference presentations) reports that FSA has periodically floated moving NAIP to a commercial/licensed model — no USDA-published announcement, Federal Register notice, or official USDA page confirming this was found in this research pass, so the rumor itself remains **secondary** ([UC ANR IGIS](https://ucanr.edu/blog/igis/article/usda-considers-switching-naip-imagery-license-model)). What *is* primary-sourced: USDA's own current dataset listing still classifies NAIP as Public Domain, with no change reflected as of its most recent metadata update — [USDA NAIP Imagery dataset, Data.gov catalog (publisher: USDA Farm Production and Conservation Business Center; metadata updated 2025-07-09; rights: `https://www.usa.gov/publicdomain/label/1.0/`)](https://catalog.data.gov/dataset/national-agriculture-imagery-program-naip-imagery). Watch for a terms change before hardcoding "public domain, forever" into adapter notes.

### Sentinel-2 (Copernicus)

ESA's global multispectral satellite program, 10 m visible/NIR resolution, ~5-day revisit. The EU's Copernicus data policy grants "free access to Copernicus Sentinel Data for reproduction, distribution, communication to the public, adaptation, modification and combination with other data and information," for scientific *and* commercial use, worldwide ([Copernicus copyright and licences](https://www.copernicus.eu/en/access-data/copyright-and-licences), [Copernicus Data Space Ecosystem terms](https://dataspace.copernicus.eu/terms-and-conditions)). Attribution line required: "Contains modified Copernicus Sentinel data [YEAR]." Access is via a free Copernicus Data Space Ecosystem account (API/STAC) — not the paid **Sentinel Hub** hosting product, which is a separate commercial service layered on top of the same free data and should not be confused with it when writing adapter notes.

- **Fit:** `aerial` evidence source, global coverage (unlike NAIP), lower resolution than NAIP/aerial-photo sources.
- **Proposed row:** `role: SATELLITE_IMAGERY_SOURCE`, `stage: 'vision'`, `adopt: 'wrap'`, `license: 'Copernicus Sentinel Data terms (free, attribution required)'`, `docker: false`, `gpu: false`, `offline: true` (cached), `commercial_ok: true`, `evidence_sources: ['aerial']`.
- Best fit for parks outside the US, or as a coarse cross-check on top of higher-res NAIP inside it.

### ESA WorldCover

Global 10 m land-cover classification (11 classes: tree cover, shrubland, grassland, cropland, built-up, bare/sparse vegetation, snow/ice, permanent water, herbaceous wetland, mangroves, moss/lichen), generated from Sentinel-1 + Sentinel-2 by the WorldCover consortium. License is Creative Commons Attribution 4.0 International, "free of charge, without restriction of use," per the [WorldCover data access page](https://esa-worldcover.org/en/data-access) and the dataset's [AWS Open Data registry entry](https://registry.opendata.aws/esa-worldcover-vito/), which confirms free access via the `esa-worldcover` S3 bucket in `eu-central-1` with `--no-sign-request` — no AWS account, no cost.

- **Fit:** dual-purpose — it is simultaneously an `aerial`-adjacent Truth-layer corroboration (does the classified pixel under a claimed "water ride" actually classify as permanent water?) *and* a Display-layer land-tone input for PR #471 (see §5).
- **Proposed row (Truth side):** `role: LAND_COVER_CLASSIFIER`, `stage: 'vision'`, `adopt: 'wrap'`, `license: 'CC BY 4.0'`, `docker: false`, `gpu: false`, `offline: true`, `commercial_ok: true`, `evidence_sources: ['aerial']`.
- Genuinely closer to "adopt" than most rows in this note: no API key, no rate limit, no GPU, cacheable, and it directly cross-checks the two sources that currently get the highest weight in the entrance-evidence table (park's own map=5, current aerial imagery=4).

### OpenAerialMap

A Humanitarian OpenStreetMap Team (HOT) project hosting crowd-contributed satellite/UAV imagery. Per its own [legal/terms page](https://openaerialmap.org/legal/), imagery in the underlying Open Imagery Network is licensed **CC-BY 4.0**, attributed as "contributors of Open Imagery Network," and "access is free to all," with a request to contact the project for anything "beyond reasonable use" (no published bulk-download cap). Coverage is patchy and contributor-driven — good for disaster-response areas HOT has flown, unreliable as a *primary* source for arbitrary theme parks since coverage cannot be guaranteed at any given venue.

- **Fit:** `aerial`, opportunistic — check-if-present rather than depend-on.
- **Proposed row:** `role: AERIAL_IMAGERY_SOURCE_OPTIONAL`, `stage: 'vision'`, `adopt: 'evaluate'` (coverage is the open question, not the license), `license: 'CC-BY 4.0'`, `docker: false`, `gpu: false`, `offline: false` (API-dependent), `commercial_ok: true`, `evidence_sources: ['aerial']`.

### Microsoft Bing Maps aerial imagery — flag as `reject`/`defer`

Bing's imagery/tile APIs are the most commonly reached-for "free" aerial source, but Microsoft's own [Bing Maps Platform APIs Terms of Use](https://www.microsoft.com/en-us/maps/product/terms-april-2013) restrict exactly the two things this project would need: the terms bar you from "reveal[ing] latitude, longitude, altitude or other metadata" from bird's-eye imagery and from "sav[ing], download[ing], print[ing], distribut[ing], transmit[ing] or manipulat[ing]" it through your application. It is a cloud-only, terms-gated, key-required tile service — exactly the profile ADR-0013 rules out ("$0 OPEX and offline-first stay goals," non-goal: "Live Mapbox/Google tile APIs as the primary display path"). The separate **Bing Maps Imagery Editor API** license (used by OSM's own iD editor) is explicitly scoped to "non-commercial online editor application[s] of OpenStreetMap maps" only ([OSM blog, license PDF](https://blog.openstreetmap.org/wp-content/uploads/2010/11/4540180-Bing-Maps-Imagery-Editor-API-License-FINAL.pdf)) — narrower still.

- **Reasoning, matching the `ultralytics-yolo` precedent:** commercial redistribution/storage of the imagery itself is contractually blocked, and the offline requirement is unmeetable by design (it is a live, keyed, per-request tile service). This is a **reject** for anything that persists imagery or derived geometry into `evidence_sources`, the same way YOLO's AGPL clause made it unusable inside the build. It could theoretically be used as a *human, ephemeral, on-screen-only* cross-check during manual QA (never cached, never fed to `addEvidence`), but that is a workflow note, not an adapter row.
- **Proposed row (if added at all):** `adopt: 'reject'`, `commercial_ok: false`, `evidence_sources: []`, notes citing the terms-of-use clause above.

### Planet / commercial constellations

Planet's daily sub-meter imagery is licensed per-seat/per-area commercially; its free **NICFI Tropical program** is scoped to tropical-forest monitoring and excludes the temperate-latitude US/EU theme parks this repo ships. No further evaluation is warranted — it fails the "$0 OPEX" and "offline-first" bars on cost alone before license is even reached.

---

## 2. Building/structure footprint extraction — populates `cv_segmentation` / `cv_detection`

### Microsoft GlobalMLBuildingFootprints

ML-generated building polygons — Microsoft's own repo states 1.4 billion buildings detected worldwide from Bing/Maxar/Airbus/IGN France imagery between 2014–2024. The repository's [`LICENSE`](https://github.com/microsoft/GlobalMLBuildingFootprints/blob/main/LICENSE) is the **Open Data Commons Open Database License (ODbL)** — the same license OSM itself uses, so it composes cleanly with the existing `osm` row (also ODbL) without introducing a new license family.

- **Fit:** `cv_segmentation` — already-extracted footprints, no inference step required on our side.
- **Proposed row:** `role: BUILDING_FOOTPRINT_DATASET`, `stage: 'vision'`, `adopt: 'wrap'`, `license: 'ODbL'`, `docker: false`, `gpu: false`, `offline: true` (bulk-downloadable GeoJSON by quadkey), `commercial_ok: true`, `evidence_sources: ['cv_segmentation']`.

### Google Open Buildings

Google Research's satellite-derived building dataset (V3 polygons, plus a 2.5D temporal variant with height/presence over 2016–2023). Dual-licensed — [Earth Engine catalog entry](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings_v3_polygons) and [Open Buildings project page](https://sites.research.google/gr/open-buildings/) confirm the data ships under **both CC BY 4.0 and ODbL v1.0**, "so that people can pick whichever they prefer" — explicitly designed to be OSM-compatible.

- **Fit:** `cv_segmentation`, strongest outside the US/Europe (Microsoft's coverage skews US/Europe-heavy; Google's skews Africa/South Asia/Latin America).
- **Proposed row:** same shape as the Microsoft row above, `license: 'CC BY 4.0 / ODbL (dual)'`.

### Overture Maps Foundation — `buildings` theme (recommended entry point over the two vendor datasets directly)

The Overture Maps Foundation (Linux Foundation project backed by Microsoft, Meta, Amazon, TomTom) publishes a merged, deduplicated `buildings` theme that ingests both Microsoft's and Google's ML footprints plus OSM buildings. Per Overture's own [attribution and licensing docs](https://docs.overturemaps.org/attribution/), most themes use CDLA Permissive-2.0, but "the buildings theme is published under the ODbL license because it includes OpenStreetMap data" — an explicit design choice to keep the OSM-derived layer ODbL-compatible rather than trying to relicense it. Practically, this means adopting Overture's buildings theme gets you Microsoft + Google + OSM buildings, deduplicated, in one ODbL-licensed pull, instead of resolving three overlapping sources by hand.

- **Fit:** `cv_segmentation`, preferred over either vendor dataset alone.
- **Proposed row:** `role: BUILDING_FOOTPRINT_MERGED`, `stage: 'vision'`, `adopt: 'wrap'`, `license: 'ODbL'`, `docker: false`, `gpu: false`, `offline: true` (Parquet on S3/Azure, downloadable), `commercial_ok: true`, `evidence_sources: ['cv_segmentation']`, notes: "Supersedes separately wrapping Microsoft + Google building datasets — Overture already resolved the overlap."

### segment-geospatial (samgeo)

A Python package (`opengeos/segment-geospatial`) that wraps Meta's Segment Anything Model (SAM / SAM2 / SAM3, all Apache-2.0) for georeferenced raster segmentation, including a documented building-footprint-extraction workflow with polygon regularization ([GitHub](https://github.com/opengeos/segment-geospatial), [docs](https://samgeo.gishub.org/)). The repo's own [`LICENSE`](https://github.com/opengeos/segment-geospatial/blob/main/LICENSE) file is the **MIT License** (Qiusheng Wu, 2023).

- **Fit:** `cv_segmentation`/`cv_detection` — the tool that would let the builder segment *fresh* aerial imagery for a venue that isn't already covered by Microsoft/Google/Overture's precomputed footprints (e.g. structures added after the dataset's last training-imagery snapshot, or theme-park-specific features like queue canopies that generic building-footprint models don't target).
- **Proposed row:** `role: VISION_SEGMENTER_GEOSPATIAL`, `stage: 'vision'`, `adopt: 'defer'` — matching the existing `sam2` row's deferral, for the same reason: real capability, `gpu: true` for practical throughput (CPU inference works but is slow per the project's own docs), Phase 2+. `license: 'MIT'`, `docker: true`, `offline: true`, `commercial_ok: true`, `evidence_sources: ['cv_segmentation', 'cv_detection']`, notes: "Same deferral as sam2 — this is effectively sam2 pointed at raster tiles instead of photos; promote both together."

---

## 3. Ride walkthrough / POV video → geolocated frames or paths — populates `video`

The registry already has a `mapillary-tools` row (`adopt: wrap`, `stage: vision`, `evidence_sources: ['mapillary']`) for "geotagged imagery/video processing, GPX alignment." That tool's own README documents a `video_process` subcommand — the combination of `sample_video` (frame extraction) and `process` (geotagging) — which "extracts the GPS track from the video's telemetry structure and locates video frames along the GPS track," sampling one frame per ~3 m by default, with experimental support for external GPX/NMEA tracks when a camera has no built-in GPS ([mapillary_tools README](https://github.com/mapillary/mapillary_tools/blob/main/README.md), [forum: external GPX support](https://forum.mapillary.com/t/external-gpx-support-for-videos-in-mapillary-tools-0-11-0b2/7373)).

- **This is the lowest-integration-cost path to `video` evidence**, precisely because it reuses a row already `adopt: wrap` in the registry rather than introducing a new dependency. A ride walkthrough shot on a phone or action camera with location services on (or paired with a separately logged GPX trace, the same shape as `guest-traces`) becomes geotagged frames through a tool the pipeline already knows how to invoke.
- **Proposed change:** extend the existing `mapillary-tools` row's `evidence_sources` to include `'video'` alongside `'mapillary'`, and note in the row that `video_process` is the specific subcommand in scope, rather than adding a brand-new row.

### Narrower single-purpose GPS-telemetry extractors (secondary path, GPS-tagged footage only)

For footage where the *only* need is pulling embedded GPS out of the camera's metadata track (no frame sampling, no photogrammetry) — several single-purpose OSS tools exist:

- **`gopro2gpx`** (`juanmcasillas/gopro2gpx`) — parses the GPMD stream in GoPro MP4 files, emits GPX/KML/CSV. License: **GPL-3.0** ([repo](https://github.com/juanmcasillas/gopro2gpx)).
- **`pygpmf`** (`alexis-mignon/pygpmf`) — Python module for the same GPMF extraction. Correction from initial research: the upstream repo does carry a `LICENSE` file — **MIT License**, copyright (c) 2020 Alexis Mignon, confirmed by direct fetch ([`alexis-mignon/pygpmf` — LICENSE](https://github.com/alexis-mignon/pygpmf/blob/master/LICENSE)). Primary-sourced; no need to fall back to the `pygpmf-oz` fork for licensing clarity.
- **`gopro-telemetry`** (JuanIrache, npm/Node) — same GPMF parsing, JS-native, multiple output formats (GPX/KML/GeoJSON/CSV) ([GitHub](https://github.com/JuanIrache/gopro-telemetry)) — worth a license check since it is the only Node-native option in this list and would integrate with zero Python/Docker overhead.

These only help when the walkthrough footage already carries embedded GPS (action cameras) — they do nothing for a phone-shot or downloaded/YouTube-sourced POV video with no telemetry track, which is the more common case for a park walkthrough. For that case:

### OpenSfM / COLMAP — vision-only path reconstruction (no embedded GPS required)

`OpenSfM` is already a registry row (`adopt: defer`, `gpu: true`, `evidence_sources: ['aerial', 'cv_segmentation']`) for structure-from-motion from photo sequences. The same technique applies to video frames once sampled (e.g. via `ffmpeg` or the mapillary_tools frame extractor above): relative camera trajectory can be recovered from visual features alone, then anchored to absolute coordinates with even a few weak GPS priors (a known entrance point, a park-map-traced landmark). **COLMAP** (`colmap/colmap`) is the more actively maintained general-purpose alternative, BSD-licensed ("new BSD license" per [COLMAP's own license page](https://colmap.github.io/license.html), which also notes third-party dependencies carry separate licenses that "may affect the resulting COLMAP license" depending on build configuration).

- **Fit:** `video` → path/geometry, the "watch a ride walkthrough" gap `venue-builder.md` names directly.
- **Proposed row:** `role: VIDEO_PATH_RECONSTRUCTION`, `stage: 'vision'`, `adopt: 'defer'` (same Phase-2+ class as `opensfm`/`sam2`), `license: 'BSD-3-Clause'`, `docker: true`, `gpu: true` (CPU-only build exists but is materially slower per project docs), `offline: true`, `commercial_ok: true`, `evidence_sources: ['video', 'traced']`, notes: "Extends opensfm's existing deferral to video frame sequences; check third-party build deps (CUDA/CGAL) for license drift before adopting."
- **OpenDroneMap (ODM/WebODM)** was also evaluated as a possible video→georeferenced-map pipeline: it handles video by pulling still frames from `.mp4`/`.mov`/`.lrv`/`.ts` and optionally pairing `.srt` GPS subtitle files, then runs the normal drone-photo pipeline — confirmed directly from ODM's own README under its "Video Support" heading: "Starting from version 3.0.4, ODM can automatically extract images from video files (.mp4, .mov, .lrv, .ts)... Subtitles files (.srt) with GPS information are also supported" ([`OpenDroneMap/ODM` — README, "Video Support"](https://github.com/OpenDroneMap/ODM/blob/master/README.md#video-support)), primary-sourced. Both ODM and WebODM are **AGPLv3**. Following this repo's own precedent — `overpass-api` (AGPL-3.0) is `adopt: wrap` because it is queried as an arm's-length, self-hosted service rather than linked into product code, while `ultralytics-yolo` (AGPL-3.0) is `reject` because it would be imported directly — ODM fits the `overpass-api` shape (Docker container invoked via CLI/API, its output consumed as data) rather than the `yolo` shape, so it is a defensible `wrap`, not an automatic `reject`. Flag it in the row notes regardless: it is drone-photogrammetry-first and camera-agnostic-video-second, so it's a heavier dependency than the mapillary_tools path above for the same job.

---

## 4. Park map / PDF digitization — populates `official_map`

`docs/guide/venue-builder.md` documents that `trace-venue.mjs` already does the georeferencing half of this job — taking a park map image and a thin-plate-spline (or other) transform to tie traced points to ground coordinates (`npm run venues:trace -- --model tps`). What's missing upstream of that is turning a *raw PDF or scanned map* into machine-readable labels and vector geometry in the first place — OCR and vectorization, not warping.

### Tesseract OCR

The standard open-source OCR engine. [Repository `LICENSE`](https://github.com/tesseract-ocr/tesseract/blob/main/LICENSE) confirms **Apache License, Version 2.0** — "personal, academic, and commercial production projects without paying any licensing or API fees," per the project's own site copy.

- **Fit:** `official_map` — reading ride names and labels off a scanned/PDF park map so they can be matched to the attraction inventory already assembled from OSM/official-site sources.
- **Proposed row:** `role: MAP_TEXT_OCR`, `stage: 'vision'`, `adopt: 'wrap'`, `license: 'Apache-2.0'`, `docker: true`, `gpu: false`, `offline: true`, `commercial_ok: true`, `evidence_sources: ['official_map']`.

### mapKurator — flag license restriction

The University of Minnesota Knowledge Computing Lab's `mapkurator-system` is the closest existing OSS project to "ML-based map digitization": a full pipeline that takes scanned historical maps and outputs recognized text labels, bounding polygons, post-OCR-corrected labels, and OSM geo-entity links ([repo README](https://github.com/knowledge-computing/mapkurator-system), [paper](https://arxiv.org/html/2306.17059v2)). Its text-spotter component (`mapkurator-spotter`) is built on Deformable-DETR/TESTR. However, the system README's own "Licensing Information" section states the license as **CC BY-NC 2.0** — NonCommercial.

- **Reasoning, matching the `ultralytics-yolo` precedent:** a NonCommercial license is directly incompatible with `commercial_ok: true`, the same disqualifying category as YOLO's AGPL clause (different clause, same effect — it blocks the exact use this project needs). This is a **reject** for direct adoption, or at best a `defer`-with-asterisk to study the *architecture* (text-spotting + geocoordinate conversion) while reimplementing on permissively-licensed components (Tesseract + a permissively-licensed detector) rather than importing the code.
- **Proposed row:** `adopt: 'reject'`, `commercial_ok: false`, `evidence_sources: []`, notes: "CC BY-NC 2.0 per repo README — architecture worth studying (text-spotting → geocoordinate conversion), code not adoptable under commercial_ok:true constraint."

### PDF vector extraction (GDAL / poppler-based tooling)

For park maps distributed as vector PDFs (not scans), the geometry is often already machine-readable without OCR at all. GDAL's PDF driver (GDAL itself: **MIT/X-style license**, well-precedented OSS GIS toolkit — same license family already implicitly trusted via `osmium`/BSD, `nominatim` stack) can extract vector layers directly from a PDF's content stream, and `pdftoppm`/`pdftocairo` (part of `poppler`, GPL-licensed) rasterize a PDF page for the OCR path above when the source is scan-only. Neither is currently a registry row; both are standard Linux GIS/PDF toolchain components, low-risk to wrap.

- **Fit:** `official_map`, upstream of both the OCR path and `trace-venue.mjs`'s image-warping path — routes a PDF into whichever of "already vector" or "needs OCR" applies.
- **Proposed row:** `role: MAP_PDF_EXTRACTOR`, `stage: 'vision'`, `adopt: 'wrap'`, `license: 'MIT-style (GDAL) / GPL-2.0+ (poppler, CLI-only use)'`, `docker: true`, `gpu: false`, `offline: true`, `commercial_ok: true`, `evidence_sources: ['official_map']`.

---

## 5. Material/texture recognition for the PBR display pipeline (PR #471) — Display layer, not Truth layer

**This section is explicitly Display, not Truth.** Nothing here should populate `evidence_sources`, feed `scripts/lib/evidence.mjs`, or influence `pois.json`/`map.json`/`gaps.json`. Per ADR-0013, PR #471's PBR pipeline feeds `visual.json` and the `display/` asset pack only — geometry stays exactly what the Truth layer already published, and the builder still "never invents geometry." The tools below inform *how the ground looks*, not *where things are*.

### Poly Haven and ambientCG — CC0 PBR texture libraries (recommended first prototype target)

Both are community-run libraries of production-grade, tileable PBR material sets (albedo/normal/roughness/displacement/AO maps) released under **CC0** (public domain dedication) — no attribution required, no commercial restriction. [Poly Haven's texture catalog](https://polyhaven.com/textures) has dedicated categories including [`asphalt`](https://polyhaven.com/textures/asphalt), [`asphalt-bitumen`](https://polyhaven.com/textures/asphalt-bitumen), and [`roofing`](https://polyhaven.com/textures/roofing/outdoor); [ambientCG](https://ambientcg.com/) hosts a comparably broad set including water and foliage/ground-cover materials — confirmed by browsing the live site's category listing, which includes dedicated `Water`, `Foliage`, `Grass`, `Ground`, and `Asphalt` categories among 60+ material categories ([ambientCG — asset/category list](https://ambientcg.com/list)); the CC0 license is stated directly on ambientCG's own homepage: "All assets are released under the Creative Commons CC0 license, making them free to use without attribution - even in commercial circumstances" ([ambientCG homepage](https://ambientcg.com/)). Primary-sourced.

- **Fit:** direct material source assets for `visual.json`'s land tones and skin-bake stage — asphalt for midways, water for lagoons/log-flume splashdown, foliage for landscaping, generic roofing for building shells.
- **Proposed row:** `role: PBR_MATERIAL_LIBRARY`, `stage: 'display'` (a new stage value, distinct from `vision` — this is display-pipeline input, not evidence), `adopt: 'adopt'`, `license: 'CC0'`, `docker: false`, `gpu: false`, `offline: true` (download once, vendor into `display/` build assets), `commercial_ok: true`, `evidence_sources: []` (deliberately empty — Display, not Truth), notes: "Feeds PR #471's material pipeline / visual.json land tones directly. Not an evidence source — do not wire into evidence.mjs."

### Materialize (BoundingBoxSoftware) — flag GPL, likely unnecessary

A Unity-adjacent open-source tool that converts photographic source images into height/metallic/smoothness maps (then derives normal/edge/occlusion). Repo license, confirmed by direct fetch of the repo's [`LICENSE`](https://github.com/BoundingBoxSoftware/Materialize/blob/master/LICENSE) file, is **GPL-3.0** (GNU General Public License, Version 3, 29 June 2007) — primary-sourced. Given Poly Haven/ambientCG already ship finished CC0 PBR sets for exactly the material categories this project needs (asphalt, roofing, water, foliage), there is no clear reason to stand up a photo-to-PBR *generation* tool at all — the categories needed are generic outdoor surfaces already well-covered by existing CC0 libraries, not park-specific textures requiring bespoke capture.

- **Proposed row:** `adopt: 'defer'` (not `reject` — GPL-3.0 as a standalone CLI/desktop tool used to *pre-bake* offline assets, never linked into the shipped app, is a materially different risk than AGPL-in-the-service-loop; but there is no evident need to reach for it while CC0 libraries cover the same ground), notes: "Deferred on lack of need, not license — Poly Haven/ambientCG already supply the material categories PR #471 needs. Revisit only if a park-specific texture (branded pavement, signature roofing) can't be approximated from stock CC0 sets."

### OpenSurfaces / MINC — material *classification* datasets (research reference, not a build dependency)

Cornell's OpenSurfaces and the follow-on Materials in Context Database (MINC) are the standard academic datasets for material recognition (asphalt vs. concrete vs. foliage vs. water, from photographs) — MINC "encompasses over 430,000 images... includes 72,000 segments refined and expanded from OpenSurfaces" ([project page](http://opensurfaces.cs.cornell.edu/publications/minc/)). OpenSurfaces' own annotations are released under **CC BY 4.0**, though the underlying *photos* "have their own licenses" ([OpenSurfaces project page](http://opensurfaces.cs.cornell.edu/publications/opensurfaces/)) — meaning the dataset is usable for training/evaluating a material classifier, but not as a direct source of clean, redistributable texture assets the way Poly Haven/ambientCG are.

- **Fit:** only relevant if the Display pipeline needs to *classify* materials from a venue's own aerial/ground photography (e.g., "is this patch of the venue asphalt or concrete, to pick the right stock texture") rather than simply applying stock textures by land-cover class. ESA WorldCover (§1) already supplies a coarser but zero-training-required land-cover signal (built-up / tree-cover / water / grassland) that may be sufficient for `visual.json` land tones without needing a trained material classifier at all.
- **Proposed row:** `adopt: 'defer'`, `stage: 'display'`, `license: 'CC BY 4.0 (annotations only; photos vary)'`, `commercial_ok: true` (with the photo-provenance caveat noted above), `evidence_sources: []`, notes: "Only needed if WorldCover-class land-cover signal proves too coarse for material selection; a training dataset, not a ready asset source."

### ESA WorldCover, again — the practical land-tone base layer

Already covered in full in §1 for its Truth-layer role. For Display, the same CC BY 4.0, 10 m, 11-class raster is the cheapest way to decide *which* Poly Haven/ambientCG material set applies to which patch of a venue's `visual.json` — built-up pixels get pavement/roofing tones, tree-cover gets foliage, permanent-water gets the water material, grassland gets turf. No separate row needed; the existing WorldCover row (§1) should carry both `evidence_sources: ['aerial']` for Truth-side corroboration *and* a documented Display-side consumer in its `notes` field, without adding `visual.json` fields to `evidence_sources` (which stays Truth-only per the evidence engine's own contract).

---

## Conclusion — prioritized shortlist for a follow-up PR

In order of "prototype this first":

1. **Poly Haven + ambientCG (CC0 PBR libraries).** Zero license risk, zero infrastructure, unblocks PR #471 immediately without touching `evidence.mjs` at all. Start here because it is the only item in this note with no open question left to resolve — license is CC0, categories already match the material list (asphalt/roofing/water/foliage), and it is purely additive to the Display pipeline.
2. **ESA WorldCover.** Populates `aerial` in the evidence engine *and* becomes the land-tone base layer for Display, so it pays for itself twice from one adapter. CC BY 4.0, no API key, `--no-sign-request` S3 access, cacheable offline. The one item here that is simultaneously a Truth-layer and Display-layer win.
3. **Overture Maps `buildings` theme** (superseding a direct Microsoft-or-Google choice). Populates `cv_segmentation` with pre-extracted, deduplicated, ODbL polygons — no inference step, no GPU, no Docker required for the base case. Second priority because it is the highest-value `cv_segmentation` unlock with the least integration cost.
4. **Extend the existing `mapillary-tools` row's `evidence_sources` to include `'video'`.** The tool is already `adopt: wrap`; the `video_process` subcommand already exists upstream. This is a one-line registry change plus a build-pipeline wiring task, not a new dependency — the cheapest way to close the `video` gap `venue-builder.md` names explicitly.
5. **segment-geospatial (samgeo), deferred alongside the existing `sam2` row.** Only pursue once GPU infrastructure is available for the pipeline generally (the same gate that already applies to `sam2`/`opensfm`) — this is the item that turns *fresh* imagery into venue-specific `cv_detection`/`cv_segmentation` evidence for venues Overture/MS/Google building datasets don't already cover (theme-park-specific structures like queue canopies, standalone kiosks).

**Explicitly not worth prototyping yet:** Bing Maps aerial (contractually blocked from the offline/storage pattern this project needs — `reject`), mapKurator (`CC BY-NC 2.0`, commercially unusable — `reject`, though its text-spotting-then-geocode *architecture* is worth studying for a from-scratch Tesseract-based reimplementation), OpenDroneMap/WebODM (AGPLv3 — defensible as a `wrap` under this repo's own `overpass-api` precedent, but heavier than the mapillary_tools video path for the same `video`-evidence job, so it's a second-choice fallback rather than a first prototype), Materialize (no clear need while CC0 libraries already cover the material list), OpenSurfaces/MINC (a training dataset for a classifier this project may not need if WorldCover's land-cover classes prove sufficient).

**Shape of the follow-up PR:** new rows for Poly Haven/ambientCG (`stage: 'display'`, a new stage value distinct from `vision`, `evidence_sources: []` on principle), ESA WorldCover (`stage: 'vision'`, `evidence_sources: ['aerial']`), and Overture Maps buildings (`stage: 'vision'`, `evidence_sources: ['cv_segmentation']`); a one-line `evidence_sources` extension on the existing `mapillary-tools` row; and a `defer` row for segment-geospatial matching `sam2`'s shape. New adapter files under `packages/venue-builder/lib/adapters/` should mirror the existing `mapillary-tools` wrap pattern (CLI/Docker invocation, cached output under `data/venues/<id>/`, never auto-writing to `public/venues/`) for anything Truth-side, and a separate, clearly-labeled Display-side asset-vendoring path (no `evidence.mjs` involvement) for the CC0 texture libraries.

---

## Sources

### Aerial / satellite imagery
- [FSA NAIP information sheet (public domain statement)](https://www.fsa.usda.gov/Internet/FSA_File/naip_info_sheet_2013.pdf)
- [USGS EROS NAIP archive](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip)
- [NAIP — AWS Registry of Open Data](https://registry.opendata.aws/naip/)
- [NAIP — Google Earth Engine catalog](https://developers.google.com/earth-engine/datasets/catalog/USDA_NAIP_DOQQ)
- [UC ANR IGIS — USDA considers NAIP licensing change](https://ucanr.edu/blog/igis/article/usda-considers-switching-naip-imagery-license-model) (secondary)
- [USDA NAIP Imagery — Data.gov catalog entry (current public-domain status, publisher: USDA FPAC-BC)](https://catalog.data.gov/dataset/national-agriculture-imagery-program-naip-imagery)
- [Copernicus — copyright and licences](https://www.copernicus.eu/en/access-data/copyright-and-licences)
- [Copernicus Data Space Ecosystem — terms and conditions](https://dataspace.copernicus.eu/terms-and-conditions)
- [ESA WorldCover — data access](https://esa-worldcover.org/en/data-access)
- [ESA WorldCover — AWS Registry of Open Data](https://registry.opendata.aws/esa-worldcover-vito/)
- [ESA-WorldCover/esa-worldcover-datasets (GitHub)](https://github.com/ESA-WorldCover/esa-worldcover-datasets)
- [OpenAerialMap — legal/terms](https://openaerialmap.org/legal/)
- [OpenAerialMap — about](https://openaerialmap.org/about/)
- [Microsoft Bing Maps Platform APIs — Terms of Use](https://www.microsoft.com/en-us/maps/product/terms-april-2013)
- [Bing Maps Imagery Editor API license (PDF, via OSM blog)](https://blog.openstreetmap.org/wp-content/uploads/2010/11/4540180-Bing-Maps-Imagery-Editor-API-License-FINAL.pdf)

### Building/structure footprint extraction
- [microsoft/GlobalMLBuildingFootprints — LICENSE](https://github.com/microsoft/GlobalMLBuildingFootprints/blob/main/LICENSE)
- [microsoft/GlobalMLBuildingFootprints — repo](https://github.com/microsoft/GlobalMLBuildingFootprints)
- [Google Open Buildings V3 Polygons — Earth Engine catalog](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings_v3_polygons)
- [Open Buildings — project page](https://sites.research.google/gr/open-buildings/)
- [Overture Maps — attribution and licensing](https://docs.overturemaps.org/attribution/)
- [Overture Maps — buildings guide](https://docs.overturemaps.org/guides/buildings/)
- [Overture Maps — FAQ](https://overturemaps.org/about/faq/)
- [opengeos/segment-geospatial — repo](https://github.com/opengeos/segment-geospatial)
- [opengeos/segment-geospatial — LICENSE](https://github.com/opengeos/segment-geospatial/blob/main/LICENSE)
- [samgeo docs](https://samgeo.gishub.org/)

### Ride walkthrough / POV video
- [mapillary/mapillary_tools — README (`video_process`)](https://github.com/mapillary/mapillary_tools/blob/main/README.md)
- [Mapillary forum — external GPX support for video](https://forum.mapillary.com/t/external-gpx-support-for-videos-in-mapillary-tools-0-11-0b2/7373) (secondary)
- [juanmcasillas/gopro2gpx — repo](https://github.com/juanmcasillas/gopro2gpx)
- [alexis-mignon/pygpmf — repo](https://github.com/alexis-mignon/pygpmf)
- [alexis-mignon/pygpmf — LICENSE (MIT)](https://github.com/alexis-mignon/pygpmf/blob/master/LICENSE)
- [JuanIrache/gopro-telemetry — repo](https://github.com/JuanIrache/gopro-telemetry)
- [colmap/colmap — license page](https://colmap.github.io/license.html)
- [colmap/colmap — repo](https://github.com/colmap/colmap)
- [OpenDroneMap/ODM — README, "Video Support"](https://github.com/OpenDroneMap/ODM/blob/master/README.md#video-support)
- [OpenDroneMap vs WebODM comparison](https://www.skyebrowse.com/news/posts/webodm-vs-opendronemap) (secondary; superseded as citation by ODM's own README above)
- [WebODM — official site](https://webodm.org/)

### Park map / PDF digitization
- [tesseract-ocr/tesseract — LICENSE](https://github.com/tesseract-ocr/tesseract/blob/main/LICENSE)
- [tesseract-ocr/tesseract — repo](https://github.com/tesseract-ocr/tesseract)
- [knowledge-computing/mapkurator-system — README (license section)](https://github.com/knowledge-computing/mapkurator-system/blob/main/README.md)
- [mapKurator paper (arXiv)](https://arxiv.org/html/2306.17059v2)

### Material/texture (Display layer)
- [Poly Haven — textures](https://polyhaven.com/textures)
- [Poly Haven — asphalt](https://polyhaven.com/textures/asphalt)
- [Poly Haven — roofing](https://polyhaven.com/textures/roofing/outdoor)
- [ambientCG](https://ambientcg.com/)
- [ambientCG — asset/category list](https://ambientcg.com/list)
- [BoundingBoxSoftware/Materialize — repo](https://github.com/BoundingBoxSoftware/Materialize)
- [BoundingBoxSoftware/Materialize — LICENSE (GPL-3.0)](https://github.com/BoundingBoxSoftware/Materialize/blob/master/LICENSE)
- [OpenSurfaces — project page](http://opensurfaces.cs.cornell.edu/publications/opensurfaces/)
- [MINC (Materials in Context Database) — project page](http://opensurfaces.cs.cornell.edu/publications/minc/)

### In-repo context
- [`packages/venue-builder/lib/adapters/registry.mjs`](../../packages/venue-builder/lib/adapters/registry.mjs)
- [`docs/guide/venue-builder.md`](../guide/venue-builder.md)
- [`docs/adr/0013-display-pipeline.md`](../adr/0013-display-pipeline.md)
