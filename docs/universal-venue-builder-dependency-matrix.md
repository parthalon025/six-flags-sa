# Universal Venue Builder — dependency matrix

Open-source projects evaluated for the Universal Venue Builder. The goal is to **wrap
adapters** around mature tools instead of rebuilding capabilities or forking everything
into one monorepo.

**Living registry:** `scripts/lib/adapters/registry.mjs`  
**CLI:** `npm run venues:adapters`  
**Architecture:** [universal-venue-builder-architecture.md](./universal-venue-builder-architecture.md)

## Evaluation criteria

| Criterion | Question |
| --- | --- |
| Capability | What builder gap does it close? |
| Maturity | prototype / beta / production |
| License | SPDX + commercial viability (AGPL flagged) |
| Maintenance | subjective 0–5 activity score |
| API quality | CLI, HTTP, library stability |
| Docker | containerized deploy path |
| Languages | Python / TypeScript / etc. |
| GPU | required for default workflow |
| Offline | air-gapped or regional tile builds |
| Integration | low / medium / high vs current Node builder |
| Overlap | what this repo already ships |
| Adopt mode | adopt / wrap / fork / replace / evaluate / defer / reject |

## Adopt modes

| Mode | Meaning |
| --- | --- |
| **adopt** | Primary implementation (already true for OSM + evidence engine) |
| **wrap** | Preferred — external CLI/service behind adapter, no fork |
| **evaluate** | Head-to-head bake-off before commitment |
| **defer** | Phase 2+; evidence weights reserved |
| **reject** | Conflicts with offline-first phone runtime |

## Stack assembly (recommended first wave)

```
                  UNIVERSAL VENUE BUILDER
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
       RESEARCH           GEO              VISION
          │                │                 │
     Playwright           OSM              YOLO*
     LangChain           Osmium            SAM 2
     LangGraph           Overpass          OpenSfM
          │                │                 │
          └────────────────┼─────────────────┘
                           │
                           ▼
                    EVIDENCE ENGINE
                  (evidence-graph.mjs)
                           │
                           ▼
                   VENUE DATA MODEL
                           │
             ┌─────────────┼──────────────┐
             ▼             ▼              ▼
          Routing*       Tiles*          API
        Valhalla/       Tippecanoe      Core App
        GraphHopper*       │
             │             ▼
             └────────── MapLibre* (optional)

* evaluate or defer — see matrix rows
```

## Full matrix

Run `npm run venues:adapters -- matrix` for an up-to-date table. Snapshot:

| Capability | Repo / technology | Role | Adopt | License | Notes |
| --- | --- | --- | --- | --- | --- |
| AI orchestration | langchain-ai/langgraph | BUILD_ORCHESTRATOR | wrap | MIT | Off hot build path |
| Web research | microsoft/playwright | WEB_RESEARCH_AGENT | wrap | Apache-2.0 | Extend venue-official-site |
| LLM tools | langchain-ai/langchain | LLM_TOOL_LAYER | wrap | MIT | Under LangGraph |
| OSM data | OpenStreetMap | GEO_FOUNDATION | adopt | ODbL | Core today |
| OSM queries | drolbr/Overpass-API | OSM_QUERY | wrap | AGPL-3.0 | Mirrors in build-venue |
| OSM toolkit | osmcode/libosmium | OSM_TOOLKIT | wrap | BSD-2-Clause | Regional PBF extracts |
| Place lookup | osm-search/Nominatim | GEO_PLACE_LOOKUP | wrap | GPL-2.0 | Self-hosted --place |
| Routing | graphhopper/graphhopper | ROUTING_CANDIDATE | evaluate | Apache-2.0 | Pedestrian graph extension |
| Routing | valhalla/valhalla | ROUTING_CANDIDATE | evaluate | MIT | Builder QA only |
| Map renderer | maplibre/maplibre-gl-js | MAP_RENDERER_OPTION | evaluate | BSD-2-Clause | vs SVG ParkMap |
| Vector tiles | felt/tippecanoe | TILE_PIPELINE | wrap | BSD-2-Clause | GeoJSON → tiles |
| Street imagery | mapillary/mapillary_tools | GROUND_IMAGERY | wrap | BSD-2-Clause | Entrance candidates |
| Street viewer | mapillary/mapillary-js | VALIDATION_UI | defer | MIT | Human validation UI |
| 3D reconstruction | mapillary/OpenSfM | ADVANCED_GEOMETRY | defer | BSD-2-Clause | Phase 3 |
| Detection | ultralytics/ultralytics | VISION_DETECTOR | evaluate | AGPL-3.0 | **Commercial review** |
| Segmentation | facebookresearch/sam2 | VISION_SEGMENTER | defer | Apache-2.0 | Polygon geometry |
| Park ops data | cubehouse/ParksAPI | VENUE_DATA_ADAPTER | wrap | MIT | Metadata, not live phone feed |
| Legacy parks API | cubehouse/themeparks | LEGACY_REFERENCE | evaluate | MIT | Study successor model |
| Evidence fusion | scripts/lib/evidence.mjs | EVIDENCE_ENGINE | adopt | project | Ahead of proposals |
| Phone routing | lib/routing.js | PHONE_ROUTING | adopt | project | 1.8 ms; no Valhalla on phone |

## Evidence source weights (adapter outputs)

Defined in `scripts/lib/evidence.mjs`. New adapter-facing keys:

| Source | Weight | Typical adapter |
| --- | ---: | --- |
| official_map, official_site | 5 | Playwright, trace |
| osm_entrance, osm_named_queue, aerial, mapillary | 4 | OSM, orthophoto, Mapillary |
| parks_api, traced, guest_photo, video, cv_segmentation | 3 | ParksAPI, trace, media |
| cv_detection | 2 | YOLO (candidate only) |
| geometry | 1 | Path inference — never publishes alone |

## Venue Evidence Graph

Every feature is a **node**; every observation is a **claim** with source, date, and URI.
Fusion answers: *how many independent sources converge, and what band is publishable?*

Implementation: `scripts/lib/evidence-graph.mjs`  
Principle from architecture review: the app consumes **validated results**, not raw AI guesses.

```
ORION QUEUE ─────────┼── Official Website
                     ├── Official Map
                     ├── OSM
                     ├── Aerial
                     ├── Mapillary
                     └── Guest Video
                              │
                              ▼
                     fuse() → band → pois.json
```

## What stays rejected for the phone runtime

From `docs/park-intelligence-review.md` — unchanged by this matrix:

- PostGIS as primary store (JSON + service worker precache)
- Valhalla/OSRM/GraphHopper **on the phone** (client A* remains)
- Twelve-service docker-compose for MVP
- Live wait-time feed without append-only observation log

Builder-side services may use Valhalla or Tippecanoe; output still lands in `public/venues/*.json`.

## Integration phases

### Phase 1 — wrap without new runtime deps (current + next)

- [x] Dependency registry and evidence graph module
- [x] Extended evidence source keys (mapillary, parks_api, cv_*)
- [ ] Playwright adapter for `venues:research --browser`
- [ ] ParksAPI wrapper for sidecar metadata
- [ ] Human validation UI shell (Mapillary JS optional)

### Phase 2 — geospatial services (builder only)

- [ ] Tippecanoe tile pipeline for large venues
- [ ] Valhalla vs GraphHopper bake-off on pedestrian subgraph
- [ ] Local Overpass/Nominatim for reproducible CI

### Phase 3 — vision (GPU builder workers)

- [ ] Mapillary ingest → entrance candidates
- [ ] SAM 2 segmentation → georeferenced polygons
- [ ] OpenSfM for station/queue geometry
- [ ] YOLO only after AGPL commercial decision

## Adding a new repository

1. Add a row to `scripts/lib/adapters/registry.mjs`
2. If it emits evidence, add a `WEIGHTS` key in `evidence.mjs`
3. Wire `park-capabilities.mjs` if audits should recommend it
4. Run `npm run venues:adapters -- matrix` and commit doc sync if needed

Do **not** add npm dependencies to the phone bundle for builder-only tools.
