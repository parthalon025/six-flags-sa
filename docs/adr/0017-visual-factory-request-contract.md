# ADR-0017 — Visual factory: the request contract

**Status:** Accepted (owner-confirmed point by point, 2026-08-20) — amended 2026-08-21 (clause 2: per-Zone treatment is declarable; an expansion missing its skins.json row is incomplete) · Amended by [ADR-0019](./0019-zoomable-worlds.md) (distribution clause 4)
**Depends on:** [ADR-0013](./0013-display-pipeline.md) · [ADR-0014](./0014-display-reference-contract.md) · [ADR-0016](./0016-custom-map-worlds.md) · [display factory design](../research/2026-08-18-custom-map-display-factory.md) · [OSM stylized-map research](../research/2026-08-20-osm-stylized-game-maps.md)

## Context

The **Visual factory** is request-driven and output-agnostic (ADR-0016): any venue's truth from
the **Map factory**, any prompted design visual from the Visual factory. What was undecided is the
request contract itself — who may ask, what a valid ask contains, what quality bar the answer
clears, and how the answer reaches guests. The first two style-pass kits (watercolor-quest,
layered-atlas) were built by hand-carrying a prompt into three ledger artifacts; that shape is now
fixed as the contract.

## Decision

1. **Requesters are the owner and agent sessions.** New looks ship as releases through PRs, never
   as runtime events. Operator- and guest-initiated requests are deferred, deliberately.
2. **One design-request document per look.** A design prompt compiles into a single request doc
   that the factory expands into all three ledger artifacts — the **Skin template** (skins.json
   row), the kit JSON, and an ADR-0014-harvested reference profile — with the request doc
   committed beside the ledgers as provenance. A request declares a reference anchor (pillar line,
   touchpoints, exemplar) and states a target on every design-language axis
   ([docs/goals/design-language-axes.md](../goals/design-language-axes.md); declared negation
   counts, silence scores zero). A request that changes only palette/tokens is **invalid**: the
   factory must not produce color-only looks, and certification gains a beyond-palette
   distinctness gate — structural/signature distinctness at the anchor points, not hue distance
   (extending `style_cross_kit_distinct`).

   *Amended 2026-08-21:* a request also states **how this look treats a Zone** — the Skin
   template's `tokens.landTones` rule, which turns a World's relationships (land cover, grounding
   harvest) into that Zone's wash inside this Skin's own palette. It is a design-language
   statement, so silence still scores zero and the declared rule is what certification measures.
   Two consequences of the shape this clause already requires, made explicit because the code had
   drifted from both: (a) a look that cannot restyle a Zone *is* the colour-only look this clause
   declares invalid, and (b) an expansion that produces a kit and a reference profile but no
   skins.json row is **incomplete**, because the missing row is what leaves the look unreachable —
   `buildWorldTier` places a kit only through an active Skin bound to it. `midnight-carnival` and
   `blueprint-survey` were in exactly that state and now carry rows.
3. **Quality gate.** A look's first ship requires full mechanical certification **plus** an owner
   eye pass (Tier-0 gates then the axis score, anchored to the request's exemplar). Refreshes of
   an approved look re-certify mechanically without re-approval.
4. **Distribution.** Every certified look ships in the venue's pack — no lazy per-look download.
   Consequence: the per-look size budget becomes a hard certification row, because every look
   costs every guest's download.
   *Amended 2026-08-20 by [ADR-0019](./0019-zoomable-worlds.md):* with zoom-banded worlds, "in
   the pack" means the **mid band** — the map works offline day one in every owned look — while
   overview/close pyramids stream by viewport and sync on wear through the download manager. The
   size budget becomes per-band rows (pack budget for mid, pyramid budget for streamed bands);
   guests pay bandwidth only for looks they wear.
5. **Reward wiring is part of the request.** The design-request document must declare the look's
   role — earnable **Skin** (with unlock/share rungs), **Rank prize**, seasonal, or venue-bound
   art — or it is incomplete.

### Cost model

The owner's AI capacity is subscription-funded (Claude, Gemini) — zero marginal dollar cost; there
are no API fees anywhere in this architecture. All model work in both factories routes through the
existing agent-brief seam (`VENUE_LLM_PROVIDER=agent`, PR #471): briefs on disk, answered by the
invoking subscription-funded agent session, consumed on rerun. Paid per-token API services are
rejected. Tooling and data source free and open by default — OSM/ESA/3DEP data,
tippecanoe/MapLibre/PMTiles/Playwright/Blender/ffmpeg, CC0 asset libraries (Kenney, Poly Haven,
ambientCG; see [docs/visual-factory-tools.md](../visual-factory-tools.md)). Gemini image
generation via AI Studio's free tier is admissible for reference/concept-art briefs; generated
assets enter the ledger as `original`-class rows and still pass the owner eye pass before first
ship. Consequence: the design doc's §5 generative tier is deferred only on its certification build
(perceptual gates), not on economics; the hybrid decision's authored flagship overrides may be
produced through subscription-funded briefs.

*Correction (2026-08-20, free-tier survey):* Gemini's free tier no longer includes image-generation
models (billing required) and its free text tier trains on submitted content with an EEA/UK
geofence — admissible for non-sensitive prompt/caption work only. The confirmed recurring free
image-generation path is **Cloudflare Workers AI** (daily neuron quota, outputs owned, per-model
license check before ledger entry). Quotas, terms, and the per-stage source shortlist:
[free-tier API catalog](../research/2026-08-20-free-tier-api-catalog.md).

## Rejected / deferred

- Runtime look delivery (feature-flag or server-pushed looks) — looks are releases.
- Guest/operator design requests — deferred until the request doc + gates have shipped looks.
- Palette-only "new looks" — invalid by definition; the palette tier retires per Skin (ADR-0016).
- Per-token API spend for any factory stage.

## Consequences

- The beyond-palette distinctness row and the hard per-look size budget row land with Train F
  (noted here as consequences; slice-3 kits already certify signature-distinctness per
  invocation).
- The request doc becomes the provenance record the eye pass and future refreshes read.
- ADR-0018 records how the factories couple and how certified packs reach phones.
