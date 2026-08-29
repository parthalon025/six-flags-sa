# ADR-0020 — Open imagery: ground truth evidence and visual grounding

**Status:** Accepted (owner-confirmed through a structured design review, 2026-08-20) ·
Amended by [ADR-0021](./0021-zoomable-worlds-revised.md) (clauses 2, 6)
**Depends on:** [ADR-0014](./0014-display-reference-contract.md) ·
[ADR-0017](./0017-visual-factory-request-contract.md) ·
[ADR-0019](./0019-zoomable-worlds.md) · evidence graph (#274) · vision-agent seam (#421)

## Context

Both factories currently understand the real world only through vectors and rasters that others
authored: OSM geometry, ESA WorldCover classes, 3DEP elevation. Open imagery of the venues
themselves — what the park actually looks like from above and from the path — is untapped. The
owner's ask: use open-source imagery to *understand real ground truth* and build off real forms
and textures. The two factories may not consume it the same way, because their truth rules
differ: the Map factory never invents what it cannot evidence; the Visual factory restyles but
never repositions.

## Decision

1. **Imagery feeds both factories, split by contract.** For the **Map factory**, imagery is a new
   **evidence class**: tree positions, surface classes, water and path edges, extracted with full
   provenance (source tile, capture date, sha256, license class — the vendor-pin discipline).
   For the **Visual factory**, imagery is **grounding**: each venue's real material and color
   relationships harvested into its reference profile (extending ADR-0014's harvest), so every
   Skin of Kings Island is recognizably *Kings Island's*.
2. **Sources are derivation-licensed only.** NAIP (public domain aerial, ~0.6–1 m, covers the US
   catalog), USGS 3DEP (already in), Sentinel-2 (classes at 10 m), and Mapillary/KartaView
   street-level (derivation-licensed). Google, Bing, and Esri basemaps are **rejected for
   derivation** — viewable is not derivable. Every ingested tile is ledger-pinned.
   *Corrected 2026-08-20 by [ADR-0021](./0021-zoomable-worlds-revised.md):* NAIP is fetched from
   Microsoft Planetary Computer (STAC, anonymous short-lived SAS). The AWS Open Data NAIP
   buckets are Requester-Pays with no anonymous path — this clause previously implied they
   were freely reachable.
3. **Extraction runs in three lanes by certainty** (tooling detail in the
   [imagery CV research note](../research/2026-08-20-imagery-cv-research.md)):
   - **Deterministic CV** — seeded, replayable passes (indices, contours, texture descriptors);
     may write truth directly above a stated confidence bar **only when that exact invocation is
     CI-proven byte-identical across consecutive runs** — the research found classical CV hides
     nondeterminism (GrabCut's unseedable k-means init, RANSAC ignoring the seed), so
     determinism is proven per pass, never assumed.
   - **Pinned open models** (object/tree/segment recognition) — adopt-on-trigger per the
     research note's registry rows; outputs enter the evidence graph, never write truth directly.
   - **Agent vision** — subscription Claude/Gemini reads via the agent-brief seam (#421) for
     semantic claims ("that cluster is a carousel"); always claims, resolved by corroboration or
     steward review (#274). No API fees anywhere, per ADR-0017's cost model.
4. **Grounding rule: design owns treatment, venue owns relationships.** A Skin's palette contract
   (axis A1 — saturation budget, temperature, quantization) always wins on *treatment*; the
   venue harvest wins on *relationships* — which roofs are the blue ones, which paths are asphalt
   versus gravel, where lawn meets plaza — re-expressed inside each Skin's own palette. Skins
   stay distinct (the beyond-palette gate holds) while every Skin stays unmistakably that park.
5. **Truth-conflict rule: OSM stays canonical; imagery adds and flags.** Imagery adds what OSM
   lacks and, where it contradicts OSM geometry, raises an evidence claim and a dispute
   ("path position disputed") for steward review — never a silent geometry move
   (the OSM import-guidelines norm). Confirmed corrections may flow back upstream to OSM.
   *Clarified 2026-08-29 by [ADR-0021](./0021-zoomable-worlds-revised.md)'s closed Open
   section:* "**Gap**" here meant the steward's review queue, not the guest-facing **Gap** type
   in [ADR-0009](./0009-ship-gaps.md), and the two were conflated while Train I was built. The
   owner's answer of 2026-08-22 is that a dispute is builder-side only — recorded in
   `imagery-disputes.json` beside the venue's other maintainer sidecars, and never a Side
   Quest, a shipped Gap, or anything else a guest is asked to settle.
6. **Sequencing: the grounding harvest rides Train H** (kings-island's banded worlds ship already
   grounded in that park's real relationships); the **evidence lane is Train I** after H —
   extraction passes, evidence-graph wiring, the steward gate, and the OSM feedback loop.
   *Amended 2026-08-20 by [ADR-0021](./0021-zoomable-worlds-revised.md):* the harvest grounds the
   overview and mid bands only — NAIP's ~1 m GSD is ample for the relationships that make a
   park recognizable and roughly 7× too coarse to texture a 0.15 m/px band. Close-band
   specificity comes from kit vocabulary positioned by Places truth.
7. **Google Maps API: back-office corroboration only** (owner holds a key). Geocoding/Places
   cross-checks inside the Map factory's build pipeline as a second opinion against
   Nominatim/OSM — an evidence-graph corroboration source, ToS-bounded: place IDs may be stored,
   Google content never becomes truth or grounding (clause 2's derivation wall stands), usage
   stays inside the free per-SKU caps, and the key lives in secrets (never the repo — it is
   public). No guest-path or runtime use; live Places enrichment would be its own design
   request with a cost cap.

## Rejected

- Deriving from Google/Bing/Esri basemap imagery (license).
- Imagery overwriting OSM geometry above a confidence bar (a misregistered tile silently bends
  routing; no community check catches it).
- Venue colors overriding Skin palettes (the color-swap failure mode returning through the
  imagery door), and design ignoring venue relationships (the park stops being *your* park).
- Auto-promotion of model/agent extractions to truth (evidence review is the gate, as with every
  other evidence class).

## Consequences

- The ledger gains imagery source rows; certification gains provenance checks for
  imagery-derived evidence; the venue reference profile gains a grounding section.
- The vision-agent (#421) and evidence-graph steward (#274) seams get their first real payload.
- Campground-class venues — where OSM is thinnest — gain the most from Train I's evidence lane.
