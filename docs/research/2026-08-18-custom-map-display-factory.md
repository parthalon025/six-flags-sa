# Custom map display factory — ontologized display generation on Databricks

**Status:** Proposal (research)
**Date:** 2026-08-18
**Depends on:** [ADR-0013 display pipeline](../adr/0013-display-pipeline.md) · [ADR-0008 Databricks back-office](../adr/0008-databricks-back-office.md) · [ADR-0010 Databricks ops & free tier](../adr/0010-databricks-ops-free-tier.md) · [park intelligence review](../park-intelligence-review.md) · [universal venue builder architecture](../universal-venue-builder-architecture.md)

This is the solution design for generating **many custom-looking maps** — full PBR-textured, per-Skin display packs for every World the universal venue builder ships — using **Palantir AIP and ontology patterns as design discipline** implemented on the stack this repo has already locked: the Node venue builder, GitHub Actions CI, and Databricks as batch back-office. **Palantir Foundry the platform is explicitly not used** (consistent with the park intelligence review's verdict and ADR-0008's "do not relitigate").

---

## 0. Frame — the decision this improves

```
Once upon a time, a Profile explored a World using the default SVG map,
earning Skins through Side Quests. Due to hand-tuned CSS paint packs and
no automated visual production, only ~20 flat Skins exist, none carries
texture or depth, and none of it scales to hundreds of Worlds or to
quest-prize custom visuals. However, if the builder generated certified
display packs — vector tiles, PBR material sets, baked skin variants —
for every Venue × Skin from one template system, guests could explore
beautiful custom-looking Worlds offline, which matters because Skins are
the XP reward loop and the map is the product's face.
```

| Field | Value |
|---|---|
| Named primary user | A Profile on a phone, in a park, offline, with an earned Skin equipped |
| Decision improved | "Does this World look worth exploring — and does my Skin feel like a prize?" |
| Trigger | New venue built · new Skin authored · quest-prize art commissioned · truth geometry drifts |
| Success metric | Venues with certified display packs 0 → 100 · Skins rendering with materials 0 → 20 · zero coordinate deltas across every (venue × skin) · pack size within budget per venue |
| Out of scope | Live tile servers · Mapbox/Google APIs at runtime · per-venue React forks · anything that moves a Place |

**The one inviolable rule (inherited from ADR-0013 and the blueprint):** *skins restyle, never reposition.* Truth (`map.json`, `pois.json`, `gaps.json`) is builder-owned OSM-derived geometry; display is generated presentation conditioned on truth. No generated artifact may move a coordinate, hide a published pin, or make a closed ride look open.

---

## 1. Two-layer model: truth vs generated display

This is the same separation world-model research converged on (§6): free generation drifts; grounded generation conditions on structure it is not allowed to change.

| Layer | Artifacts | Producer | Mutability |
|---|---|---|---|
| **Truth** | `map.json` · `pois.json` · `gaps.json` · sidecars | `build-venue.mjs` + evidence fusion | Only via evidence → publish floor → rebuild |
| **Display** | `display/base.pmtiles` · `visual.json` · PBR material sets · baked skin tile pyramids · `manifest.json` | New display stages after `certify` | Regenerated freely; **certified against truth before ship** |
| **Overlay (live)** | markers, route, puck, Meet, Overlay pins | Phone runtime | Every frame; never generated |

Display generation is *deterministic given its inputs* (template + materials + truth geometry + seed), so a no-change rebuild produces a no-change pack — the same byte-identical-rebuild property the truth pipeline protects.

---

## 2. The ontology (FDE discipline, Databricks implementation)

Objects are pulled by the workflow, not by the enterprise. The workflow is: *author a skin → bind materials → generate packs per venue → certify → a human approves → phones download.* That pulls exactly these object types into existence.

Backing storage: committed JSON sidecars in the repo (system of record, same as `ids.json`/`heights.json` today) mirrored to Delta tables in Unity Catalog `parkbound.gold` for fleet-scale queries, telemetry, and LLM batch jobs. The repo is the writeback target; Databricks is the analytical mirror — decisions land as sidecars and feed the next rebuild, exactly the existing pattern.

### Object types

| Object type | `id` (string, from own properties) | Title | Key properties | Editable? | Maturity |
|---|---|---|---|---|---|
| `Venue` | slug (exists: manifest) | name | bounds, kind, counts, coverage | via builder only | Active |
| `Place` | `i` (exists: ids ledger) | `n` | c, a, h, e, out | via evidence only | Active |
| `SurfaceClass` | e.g. `walkway`, `water`, `grass`, `wood`, `building-roof`, `building-wall`, `coaster-track`, `midway`, `lot` | label | source layers, default material slot, rendering hints | yes (manifest) | New |
| `MaterialSet` | `<family>--<variant>` e.g. `paving-herringbone--worn` | label | albedo/normal/orm/height/emissive refs, resolution, seamless flag, **source + license**, generator + seed | yes | New |
| `SkinTemplate` | Skin id (exists in `world.js`) | label | style tokens, per-SurfaceClass material bindings, iso template id, bake recipe, unlock ladder | yes | New |
| `DisplayPack` | `<venueId>--<skinId>` | derived | artifact paths, hashes, sizes, versions, built_at_timestamp | no (generated) | New |
| `DisplayCertification` | `<packId>--<n>` | derived | per-check claim/evidence/pass, coordinate-delta result, size + node budgets | no (generated) | New |
| `ReviewDecision` | PR number / commit | — | approved_by_user, approved_at_timestamp, why | append-only | New |

Ontology rules applied (from the workflow doctrine): every `id` is a string built from the object's own properties, never row order or build time; keys are issued once and retired, never reused (the `ids.json` ledger pattern extends to `MaterialSet` and `SkinTemplate`); no property is inferred by parsing an id; every object type has a point of contact and maturity; the title (what a guest reads) is separate from the key (what edits are filed under).

### Link types

| Link | From → To | Cardinality | Traversal it enables |
|---|---|---|---|
| binds | `SkinTemplate` → `MaterialSet` (per `SurfaceClass`) | M:M | "which skins break if this material is retired" |
| renders | `DisplayPack` → `Venue`, `DisplayPack` → `SkinTemplate` | M:1, M:1 | "which packs must regenerate when this venue drifts" |
| certifies | `DisplayCertification` → `DisplayPack` | 1:1 per version | ship / hold |
| approves | `ReviewDecision` → `DisplayPack` | 1:M | the recorded human decision |
| rewards | Side Quest / earn ladder → `SkinTemplate` | existing (`world.js` unlock) | quest-prize custom visuals |

### Action types (the verbs, with submission criteria)

| Action | Edits | Submission criteria | Who | Side effect |
|---|---|---|---|---|
| Propose skin spec | drafts `SkinTemplate` + `visual.json` | schema-valid; references only registered MaterialSets and SurfaceClasses | LLM job or human | lands as a *claim* in a cache sidecar — never ships directly |
| Approve material | `MaterialSet.status = approved` | license ∈ {CC0, original, licensed-with-proof}; seamless check passed | human | material enters the library |
| Generate pack | creates `DisplayPack` | template approved; venue certified (truth) | CI batch | display-certify queued |
| Certify pack | creates `DisplayCertification` | all checks pass incl. zero coordinate delta | CI | pack eligible for PR |
| Publish pack | manifest entry | certification green | **human merges the draft PR** | phones see the new pack version |
| Retire skin/material | tombstone in ledger | nothing links to it, or successor named | human | never re-issued |

The draft PR **is** the Workshop review app for now — the recorded, permissioned, auditable human action (blueprint Wave 4: "merging is the recorded approval"). A Databricks App steward UI stays deferred per ADR-0010 until multiple stewards need it.

---

## 3. Pipeline — AIP concepts mapped onto the locked stack

| Palantir concept | Implementation here |
|---|---|
| Datasets + transactions, branching | Committed sidecars + git; Delta tables in `parkbound.{bronze,silver,gold}` for the mirror |
| Pipeline Builder / code repos | `runVenuePipeline` display stages (Node) + Databricks serverless Jobs (Python) |
| Incremental builds | drift-watch diffing + hash-keyed regeneration (only packs whose inputs changed rebuild) |
| "Use LLM" node with typed Struct outputs | Foundation Model serving with constrained JSON (`databricks/src/llm/research_batch.py` pattern) — new `display_spec_batch` job |
| Compute Modules (arbitrary containers) | CI containers running the Node builder + Blender/toktx/Tippecanoe toolchain |
| Ontology writeback | Sidecars under `data/` — the next rebuild consumes the last decision |
| Automate (object-set conditions → effects) | GitHub Actions triggers + scheduled drift-watch; "status became approved" → generation batch |
| AIP Evals | display-certify matrix + gold-park fixtures in CI; LLM spec outputs regression-tested against schema fixtures |
| Workshop | evidence/review HTML + draft PR gate (steward App later) |
| OSDK / REST for consumers | `manifest.json` + static display packs on `public/venues/` / CDN — the phone contract, unchanged in kind |

**LLM guardrails carry over verbatim from the truth pipeline:** the LLM authors *style* — palette proposals, material bindings, label styling, bake parameters, quest-prize art briefs — as schema-constrained JSON claims into a cache sidecar. It never emits coordinates, never touches truth files, and nothing it proposes ships without certify + the human gate. Deterministic work (tiling, compression, baking, diffing) stays deterministic code.

### Builder stages (extends ADR-0013's list, per venue × skin)

```
certify (truth, exists)
  └─► tiles-export (exists) ─► tiles-build (Tippecanoe → display/base.pmtiles)
  └─► material-source   fetch/generate PBR sets → data/display/materials/
  └─► material-compile  normalize to glTF metal-rough, atlas, mipmap,
                        compress (ETC1S color / UASTC normals) → KTX2
  └─► visual-spec       merge visual.json (tokens, land tones, per-SurfaceClass
                        material bindings; LLM-proposed, human-approved)
  └─► skin-bake         headless Blender ortho renders with materials + sun
                        keyframes → raster pyramid → PMTiles per (skin × time)
  └─► display-certify   fixed-camera matrix, zero-coordinate-delta proof,
                        size + node budgets, contrast floors
  └─► manifest          hashes, sizes, versions for the download manager
```

---

## 4. Full PBR materials — the concrete texture pipeline

**Material model:** glTF 2.0 metallic-roughness. Per `MaterialSet`: baseColor (sRGB) · normal (linear, OpenGL Y+) · **ORM-packed** occlusion/roughness/metallic (linear, one texture) · height (build-time only: baked to normals/displacement) · emissive (sRGB, for Park Midnight / marquee skins). Stylized look = `metallic 0`, painterly albedo, broad roughness, baked AO — no exotic KHR extensions on mobile.

**Compression (non-negotiable for phones):** KTX2/Basis via glTF-Transform/toktx — ETC1S for baseColor/ORM/emissive (~100–300 KB per 1K map), UASTC only for normals (~0.7–1.5 MB per 1K); always mipmapped; stays compressed in VRAM (4–8× less GPU memory than PNG/WebP). Budget: 512–1024² per material, ≈1.5–2.5 MB per full set; a Skin's global material kit ≈ 8–12 SurfaceClass sets ≈ **15–25 MB downloaded once, shared across every venue** — venue packs stay in ADR-0013's 3–15 MB envelope because materials are global, not per-venue.

**Sourcing ladder (license before embed, in order of preference):**
1. **CC0 libraries** — ambientCG + Poly Haven, both with public APIs for automated pull; CC0 permits commercial redistribution, no attribution required (we attribute anyway in credits).
2. **Procedural** — Material Maker (MIT) graphs committed to the repo for park-specific families (midway asphalt, queue rails, wooden coaster lumber); deterministic, CI-friendly.
3. **Derived** — DeepBump CLI (ONNX, CPU) fills normal/height from albedo where a set is incomplete.
4. **AI-generated** — seamless-tile diffusion (circular-padding SD/SDXL) + Ubisoft CHORD (SIGGRAPH Asia 2025, open weights) to decompose RGB → full PBR set; runs as a **GPU batch job** (Databricks GPU job or one-time offline run), outputs land in a cache sidecar like `llm-research-cache.json` does — reviewed, then committed. License-check CHORD's repo before commercial embed; AGPL stays rejected.

Every `MaterialSet` records source, license, generator, and seed — provenance on assets, exactly like provenance on coordinates.

### Rendering tiers (hybrid bake, per the mobile evidence)

| Tier | What ships | What runs |
|---|---|---|
| **Baked (default + low-end fallback)** | 2–4 time-of-day raster pyramids per skin (dawn/day/dusk/night), PMTiles | MapLibre raster layers, cross-faded via `raster-opacity` — zero shader cost, best battery, the Attractions.io-proven pattern for exactly this product category |
| **Real-time PBR (capable devices)** | KTX2 material sets + glTF meshes | MapLibre custom style layer + three.js `MeshStandardMaterial`: one sun + small IBL, **no shadow maps** (AO baked), DPR capped at 2 — live time-of-day and Skin-swap without re-downloading pyramids |
| **Overlay** | unchanged | SVG/symbol layers for pins, route, puck — always crisp, never baked |

MapLibre's `fill-extrusion-pattern` is *not* the PBR path (no material support, unreliable UVs) — the custom-layer + three.js integration is, and it's officially exemplified. PMTiles serves both vector and raster from static files, so baked and vector variants ship through the same offline download manager.

---

## 5. World-model grounding — how Sora/Genie-class generation stays honest

The world-model field (August 2026) divides into two camps, and only one is usable here.

**Camp A — "the model is the world"** (Sora 2, Genie 3 / Project Genie, Decart Oasis/Odyssey-2, Microsoft WHAM/Muse): geometry exists only implicitly in weights; every frame is re-hallucinated; consistency is emergent, not guaranteed. Sora 2's API accepts a prompt, a duration, and one reference image — **no depth/segmentation/camera-path conditioning and no seed control**, so no reproducibility. Genie 3 holds visual memory for roughly a minute and Project Genie caps sessions at ~60 seconds with no export and no way to hand it a layout. None of these can accept our OSM geometry as a constraint. They are inspiration (and marketing-footage tools), not pipeline components.

**Camp B — "the model decorates a world that already exists"**: explicit geometry goes in, pixels/textures come out, and drift is either structurally bounded or structurally impossible. This is where the entire usable toolchain lives, in four escalating tiers of guarantee:

1. **ControlNet-style conditioning over semantic rasters (2D, v1).** Render truth vectors to a semantic raster (walkway = class 1, water = class 2, coaster footprint = class 3…) and condition tile/illustration generation on it. Mature, open-weight (SDXL/Flux ControlNets), seed-exact reproducible, ~$0.002–$0.02 per image — a full park tileset costs well under $100. The direct research lineage is **OSMGen** (NeurIPS 2025 workshop: generation conditioned on raw OSM JSON, "strictly follows prescribed geometries"), CityDreamer (OSM-layout-conditioned 3D cities), and Google's Streetscapes (map + heightmap + camera-path conditioned video). NVIDIA's **Cosmos Transfer** proves the pattern at industrial scale — AV companies re-skin HD vector maps precisely because the map is the truth layer and generation is only a renderer.
2. **Retexturing existing geometry (the hard guarantee, v2).** Generate **textures for meshes we extrude from truth geometry** (Text2Tex, Paint3D, TEXGen, SceneTex — all open source, single-GPU): geometry drift becomes impossible *by construction*, not by validation. This is where §4's PBR pipeline and generative AI meet: the mesh comes from `map.json`, the material comes from the generator.
3. **Generated props at truth coordinates (v3).** TRELLIS / TRELLIS.2 (MIT license, PBR output) and TripoSR create stylized 3D assets — a coaster station, a food stand — that *our code* places at POI coordinates. Placement is ours, so it cannot drift.
4. **Hero scenes (optional).** World Labs **Marble** with its **Chisel** mode is the productized version of this exact pattern — "the coarse 3D scene determines the world's structure, the prompt controls its style," accepting imported 3D layouts (our extruded OSM footprints) as guidance. Exports persistent Gaussian splats (Niantic's SPZ format: ~10× smaller than PLY, phone-renderable) and meshes; commercial rights from the $35/mo tier. Conditioning is soft, so outputs still pass display-certify. Treat splats as per-district hero content, never the base map.

**Certification closes the loop** (no turnkey validator exists; we assemble it): render every generated output from fixed canonical cameras; re-infer segmentation and compute per-class IoU against the truth raster (path centerlines within N px); check landmark Places land in the right cells; SSIM/LPIPS against the previous accepted version to catch style regressions; reject-and-regenerate on failure. For retextured meshes, certification reduces to seam/quality checks since geometry cannot move. Cache key = hash(truth tile + control raster + prompt + seed + model version) — only tiles whose truth changed regenerate, preserving the no-op-rebuild property and making drift-watch the regeneration trigger.

This section is why the design prefers **open weights over hosted APIs** for every generative step: seeds, reproducibility, and caching are load-bearing, and Sora-class APIs expose none of them.

---

## 6. What the open draft PRs contribute

| PR | Verdict for this design |
|---|---|
| #196 ADR-0012 visual design grill | **Merge first** — the layer-first model and declutter rules are prerequisites this design cites |
| #446 template-driven iso maps | **Harvest the seam** — `ISO_MAP_TEMPLATES` / `resolveIsoMapTemplate()` becomes the `SkinTemplate` object's iso half; rebase onto main |
| #447 analytical + watercolor Skins | **Harvest the test** — the 20-point fixed-location visual matrix is the seed of `display-certify`; the two skins become the first template-driven `SkinTemplate` rows |
| #199 map-polish prototypes | **Decide, then close** — pick one direction (Atlas/Board/Quest) as the default skin's design language; the prototype stays throwaway as intended |

---

## 7. Slices (plumbing first, each a gate)

1. **Slice 1 — one venue, one skin, end to end.** Big Kahuna's (smallest) × one baked skin: `tiles-build` + one CC0 material set + Blender bake + PMTiles + a MapLibre spike behind a flag. **Gate:** renders offline on a phone; screenshot-diffed pin positions show zero coordinate delta vs the SVG truth render.
2. **Slice 2 — skin template compiler + certify.** Compile 3 existing `world.js` paint packs into `SkinTemplate` rows; `display-certify` (visual matrix + budgets) wired into CI; harvest #446/#447. **Gate:** all 4 shipped venues × 3 skins certify green from one command.
3. **Slice 3 — LLM spec authoring + human gate.** `display_spec_batch` Databricks job proposes `visual.json` per venue (constrained JSON, cached, evaluated); generation fan-out for top-10 venues; draft-PR-only shipping. **Gate:** a fleet run produces PRs only; every pack in a PR carries its certification.
4. **Slice 4 — real-time PBR tier + quest prizes.** three.js custom layer with KTX2 materials, time-of-day sun; first venue-specific quest-prize skin art through the same pipeline. **Gate:** frame rate holds on the reference device (M0 budget), Skin swap without re-download.
5. **Slice 5 — generative worlds at fleet scale.** Grounded texture/mural generation (§5) + top-100 fan-out + drift-triggered regeneration. **Gate:** a drifted venue loses display certification and regenerates without human intervention *except* the merge.

---

## 8. Standing rules (inherited, restated for display)

- **Style is data.** Every color, stroke, material binding lives in template + spec files; zero style literals in the renderer.
- **Skins restyle, never reposition.** Certified by screenshot diff, not by promise.
- **Evidence, not guesses.** LLM and generative output are claims in sidecars until a human action ships them.
- **Deterministic work stays deterministic.** Given template + materials + truth + seed, the pack is byte-reproducible.
- **License before embed.** CC0/original/licensed-with-proof only; AGPL rejected; ODbL attribution ships in every pack.
- **The phone stays lean.** Static files + service worker/Capacitor cache; no tile server, no runtime generation, Databricks never serves phones.
- **Every consequential change is a PR.** The merge is the recorded approval.
