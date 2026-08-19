# Display pipeline execution plan — SVG to final rendering product

**Status:** Plan (execution roadmap — no new decisions; sequences accepted ADRs and a research proposal)
**Date:** 2026-08-19
**Consolidates:** [ADR-0013 display pipeline](../adr/0013-display-pipeline.md) · [ADR-0014 display reference contract](../adr/0014-display-reference-contract.md) · [custom map display factory](./2026-08-18-custom-map-display-factory.md)

This is not a new decision. ADR-0013 (accepted) sets the target architecture and an unordered
implementation list; ADR-0014 (accepted) sets the certification contract every generated artifact
must pass; the display-factory doc (research proposal) sets a five-slice delivery plan for the
visual-factory half of that architecture. None of the three documents states, in one place, the
order the whole thing ships in end to end. This does.

## End state (final product)

- **Renderer:** MapLibre GL JS in the Capacitor WebView, reading local PMTiles. No SVG base
  geometry, no tile server on the phone, no live Mapbox/Google tile API.
- **Two rendering tiers, same PMTiles contract:**
  - **Baked (default, every device):** 2–4 time-of-day raster pyramids per Skin, cross-faded via
    `raster-opacity`. Zero shader cost.
  - **Real-time PBR (capable devices, additive):** MapLibre custom style layer + three.js
    `MeshStandardMaterial` over KTX2-compressed material sets, extruded from truth geometry. Live
    time-of-day and Skin-swap without re-download. Falls back to baked on a capability check.
- **Overlay stays separate:** markers, route, puck, Meet, Overlay pins — SVG or MapLibre symbol
  layers, redrawn every frame, never generated or baked.
- **Scale:** hundreds of Venues, ~20+ Skins, all produced by one template system — no per-Venue
  React/CSS forks (ADR-0013 non-goal, still holds).
- **Every generated artifact certifies before it ships:** ADR-0014's reference-profile + style
  contract for kits, extended by display-certify's zero-coordinate-delta + budget checks for packs.
  Skins restyle, never reposition — proven by screenshot diff, not promised.

## Phases

Each phase is a gate: the next phase does not start meaningfully until the gate before it is met.
Phases 5 and the download manager can run in parallel with 3–4 once phase 2 ships, since they don't
depend on the PBR tier.

| # | Phase | Source | What ships | Gate |
|---|-------|--------|------------|------|
| 1 | **Plumbing spike** | ADR-0013 items 1–2 + factory Slice 1 | Bundle schema + `manifest.json` locked; `tiles-build` + `display-certify` wired into `runVenuePipeline`; one venue (Big Kahuna's) × one baked skin, end to end, MapLibre spike behind a flag | Renders offline on a phone; screenshot-diffed pin positions show zero coordinate delta vs. the SVG truth render |
| 2 | **Baked renderer + skin compiler** | ADR-0013 item 3 + factory Slice 2 | MapLibre renderer loads local PMTiles + global skin templates (baked-raster tier, default and low-end fallback); 3 existing `world.js` paint packs compiled into `SkinTemplate` rows; `display-certify` wired into CI | All 4 shipped venues × 3 skins certify green from one command |
| 3 | **LLM spec authoring + human gate** | Factory Slice 3 | `display_spec_batch` Databricks job proposes `visual.json` per venue (schema-constrained, cached, evaluated); generation fan-out for top-10 venues; draft-PR-only shipping | A fleet run produces PRs only; every pack in a PR carries its certification |
| 4 | **Real-time PBR tier** | ADR-0013 item 4 + factory Slice 4 | three.js custom style layer with KTX2 materials, live time-of-day sun, one sun + small IBL, no shadow maps (AO baked), DPR capped at 2; first venue-specific quest-prize skin art through the same pipeline | Frame rate holds on the reference device (M0 budget); Skin swap without re-download |
| 5 | **Venue download manager** | ADR-0013 item 5 | Prefetch, cache, delta updates for display packs (~3–15 MB/venue; ~15–25 MB shared material kit per Skin, downloaded once) | Can run in parallel with phases 3–4 once phase 2 ships |
| 6 | **Interaction-layer port** | ADR-0013 item 6 | `ParkMap.jsx`'s gesture handling (pinch/wheel zoom-about-point), Follow-mode/**Go** camera, and Overlay pin rendering ported into the MapLibre renderer — currently unowned; phase 2 only covers *drawing* the map, not this | Gesture, declutter priority (ADR-0012), and **Go** behaviour match the SVG renderer 1:1 |
| 7 | **SVG retirement** | ADR-0013 item 7 | Remove SVG base-geometry rendering from `ParkMap.jsx` | Parity proven on store WebView (Capacitor), not just dev browser |
| 8 | **Generative worlds at fleet scale** | Factory Slice 5 | Grounded texture/mural generation (ControlNet-conditioned on truth rasters, license-checked CC0/procedural/derived/AI-generated ladder) + top-100 venue fan-out + drift-triggered regeneration | A drifted venue loses display certification and regenerates without human intervention *except* the merge |

## What blocks what

- Phase 6 (interaction port) is the real gate on phase 7 (SVG retirement) — ADR-0013 flags this
  explicitly: nothing in items 1–5 names who ports the 1879-line SVG component's interaction layer,
  and it has to happen before cutover regardless of how good the PBR tier looks.
- Phase 4 (PBR) depends on phase 3's material/spec pipeline existing (materials need a
  `MaterialSet` to bind to), but not on phase 3's *LLM* authoring specifically — a human-authored
  `visual.json` for the pilot venue is enough to unblock phase 4 if phase 3 slips.
- Phase 8 is the only phase with an open-ended cost/quality tradeoff (generative texture licensing,
  GPU batch cost) — treat it as separately fundable, not a hard dependency of anything before it.

## Non-goals (inherited, still binding)

Tile server on the phone · Google Maps/MapKit SDK as the product surface · live Mapbox/Google tile
APIs as the primary path · Databricks/Postgres serving tiles to phones · per-Venue React/CSS forks ·
any display change that repositions a Place or rewrites routing truth.

## Open questions this plan doesn't resolve

- No phase has an owner or estimate yet — this orders the work, it doesn't staff it.
- No measured SVG-vs-MapLibre benchmark exists; the case for phases 1–2 stays architectural (DOM
  weight, per-venue CSS forks) until phase 1's gate produces real numbers.
- Phase 8's AI-generated material tier (CHORD, seamless-tile diffusion) needs a license review
  before commercial embed — flagged in the factory doc, not yet done.
