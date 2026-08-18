# Proposal: Overture-style footprint conflation for venue-builder polygon evidence

**Date:** 2026-08-18
**Status:** Proposal — not yet accepted, not yet an ADR
**Product:** Universal Venue Builder (`packages/venue-builder`)
**Depends on / builds on:** [`packages/venue-builder/lib/evidence.mjs`](../../packages/venue-builder/lib/evidence.mjs), [`docs/adr/0002-dual-layer-park-truth.md`](../adr/0002-dual-layer-park-truth.md), [`docs/adr/0013-display-pipeline.md`](../adr/0013-display-pipeline.md), [`docs/research/2026-08-18-visual-ground-truth-tools.md`](./2026-08-18-visual-ground-truth-tools.md)

## Why this note exists

The visual-ground-truth research (companion doc, linked above) recommends adopting the
**Overture Maps `buildings` theme** as a `cv_segmentation` evidence source — a merged,
deduplicated set of building footprints from OSM, Microsoft's ML footprints, and Google Open
Buildings, published ODbL. Once that lands, `packages/venue-builder` will for the first time
have **two independent sources of polygon geometry** for the same structures: OSM's own ways,
and Overture's merged footprints.

`lib/evidence.mjs` already solves this problem for *points* — ride entrances, queue exits — and
solves it well, with a deliberate, hard-won design documented in its own comments. This note asks
whether that design ports to polygons, where it does, and where a genuinely different rule is
needed, **before** anyone writes `lib/footprint-fusion.mjs`. Nothing here is implemented; this is
the decision to make first.

## What Overture actually does

Per Overture's own documentation (see the companion research doc's §2 for full citations):

- A **fixed source-priority order** — OSM, then Esri Community Maps, then high-precision Google
  Open Buildings, then Microsoft ML Building Footprints, then lower-precision Google Open
  Buildings.
- **No spatial overlap → both footprints survive** as separate features.
- **Overlap with IoU > 0.5 → merge**, with height and other attributes combined across the
  matched pair, and the higher-priority source's geometry generally winning the boundary.
- Google's ML data carries a **per-S2-cell confidence threshold** (90% precision) that gates
  whether a given cell's footprints count as "high precision" or "lower precision" in the
  priority order at all.

This is a real, working, planet-scale conflation pipeline. It is also built for a different
problem than this repo's: Overture is fusing *institutional* datasets that each claim to be
complete and authoritative over large areas, with no per-claim confidence scoring beyond the
vendor-tier priority order.

## Where `evidence.mjs`'s existing philosophy already disagrees with that

`lib/evidence.mjs`'s doc comments state two rules it treats as load-bearing, both learned from a
real failure in production data (Cedar Point's three best-evidenced coasters coming out
"disputed" under an earlier, wrong version of this code):

1. **Disagreement is not averaged away.** "The spread is reported and the fused score is capped
   at whatever the best single source is worth, because that is all anybody has actually
   established." An average of two sources is "a coordinate no source supports."
2. **A guess disagreeing with a survey is not a dispute.** Being outranked by a stronger source is
   not a conflict; a conflict is specifically two sources *of equal standing* disagreeing.

Overture's attribute-merge-across-both-matched-footprints step is closer to the averaging this
repo's own design notes call out as the wrong move for points. Porting Overture's merge policy
verbatim — blend attributes from both matched polygons — would reintroduce exactly the failure
mode `evidence.mjs`'s comments describe having already fixed once, just at the polygon level
instead of the point level.

What *does* port cleanly:

- **The priority order itself.** This repo already has one: `WEIGHTS` in `evidence.mjs`. It is
  richer than Overture's fixed vendor list — it is a scored table (`osm_entrance: 4`,
  `cv_segmentation: 3`, ...) that already supports "N sources agree, sum their weight" rather than
  a strict tie-break order. Reuse it rather than inventing a second, parallel priority scheme.
- **"No overlap → keep both, don't force a merge."** This is the polygon-level version of "a
  guess disagreeing with a survey is not a dispute" — two non-overlapping footprints most likely
  describe two different structures (a queue canopy standing next to, not on top of, a building),
  and treating proximity as evidence of sameness is the same mistake the old point-fusion code
  made with "nearest footpath."
- **A geometric overlap test replacing the point model's `spreadM` distance test.** Points use "is
  this within 20 m of the anchor"; polygons should use IoU (or a simpler containment/overlap
  fraction) as the equivalent "is this the same claim" test.

What should **not** port as-is:

- **Cross-source attribute averaging on a match.** Instead: the same rule points already use —
  the **highest-weight source's polygon boundary wins outright** when two sources' footprints
  overlap above the IoU threshold; the lower-weight source becomes corroborating evidence (its
  weight adds to the fused score) but does not blend its geometry into the published shape. This
  is `pointOf()`'s "heaviest source wins, not an average" rule, applied to a boundary instead of a
  coordinate.
- **A single fixed vendor-tier order.** Use the scored `WEIGHTS` table so a well-evidenced
  OSM way (e.g. one already corroborated by a named-queue-way heuristic) can outrank a
  lower-confidence Overture cell, and vice versa — Overture's own per-cell confidence gating on
  Google's data is itself an argument for scored rather than fixed-tier trust.

## Proposed shape (design only — not code yet)

A new module, `lib/footprint-fusion.mjs`, sitting next to `evidence.mjs` and reusing its
`WEIGHTS`/`BANDS` exports rather than duplicating them:

```
fuseFootprints(polygons: [{ source, geometry, date? }], { iouThreshold = 0.5 } = {})
  → { geometry, score, band, sources, dissent, conflict }
```

Mirroring `fuse()`/`pointOf()`'s split:

- **Same-source dedup first.** One source producing multiple overlapping polygons for a single
  structure (a building drawn as separate wall/roof ways, the same "one ride, four mapped lanes"
  problem `evidence.mjs` already solved for entrances) gets reconciled *within* that source before
  cross-source conflation runs, not treated as two claims.
- **Anchor selection.** The highest-weight source among overlapping candidates picks the
  published boundary — same as `pointOf()`.
- **Agreement scoring.** Every other source whose polygon overlaps the anchor above
  `iouThreshold` adds its weight to the fused score, same accumulation rule `fuse()` already uses
  for points (`score = agrees.reduce(sum weights)`), capped at the anchor's weight only in a true
  conflict (two equal-weight sources with non-overlapping, materially different polygons).
- **No overlap → separate features, not a conflict.** A non-overlapping polygon from a second
  source is not "dissent" the way a distant point claim is — it is most likely a different
  structure and should be evaluated as its own candidate footprint, not folded into the anchor's
  dissent list.
- **Publish threshold.** Reuse `BANDS`/`PUBLISH_AT` from `evidence.mjs` unchanged — a fused
  footprint reaching `moderate` (7+) publishes, same bar entrances already clear.

## Explicitly out of scope for this proposal

- **No code changes.** This is the decision to review before `lib/footprint-fusion.mjs` gets
  written.
- **Entrance/point fusion is untouched.** `evidence.mjs`'s existing `fuse()`/`pointOf()` stay
  exactly as they are; this proposal adds a sibling for polygons, not a replacement.
- **Display-layer materials are a separate track.** The companion research doc's §5 (PBR
  materials, Poly Haven/ambientCG) is Display, not Truth, and explicitly must never touch
  `evidence_sources` — this proposal is entirely about Truth-layer footprint geometry and doesn't
  change that boundary.
- **Which registry rows to add** (Overture buildings, ESA WorldCover, etc.) is already covered by
  the companion research doc's shortlist; this note is only about the fusion *rule*, not which
  adapters feed it.

## Open questions for review

1. **IoU threshold value.** Overture uses 0.5 for attribute merging. Is 0.5 right for this
   product, where a ride's footprint (queue canopy, station building, footprint of the track
   itself) is smaller and more irregularly shaped than typical urban buildings, or does a smaller
   venue-scale footprint need a lower threshold to avoid false non-matches?
2. **Should OSM ways keep a weight advantage over Overture's merged footprints even where
   Overture's own confidence is high?** OSM ways at these parks are often hand-traced by mappers
   who have walked the ride (per `docs/guide/venue-builder.md`'s existing observation about
   named-queue ways being "as good as automatic evidence gets"); Overture's ML-derived footprints
   are automatic by construction. The existing `WEIGHTS` table would need a `cv_segmentation`
   entry considered alongside `osm_entrance`/`osm_named_queue` rather than assumed equal.
3. **Ride-specific structures Overture won't cover.** Queue canopies, standalone ticket kiosks,
   and similar small theme-park-specific structures are unlikely to appear in a general building-
   footprint dataset trained on typical urban/suburban structures. The companion doc's
   `segment-geospatial` (samgeo) recommendation — deferred, GPU-gated — is the eventual answer for
   venue-specific footprints Overture/Microsoft/Google don't have; this proposal's fusion rule
   should be written so a third source slots in without a redesign, not just two.

## If accepted

Promote this note to an ADR (following the `docs/research/2026-08-15-comparable-park-map-
rendering.md` → ADR-0012 and the PR #471 design doc → ADR-0013 precedent already in this repo),
then implement `lib/footprint-fusion.mjs` plus the `WEIGHTS` table additions in a follow-up PR,
gated on the Overture Maps `buildings` theme adapter (companion doc's shortlist item 3) actually
landing as a `cv_segmentation` source first — there is no second polygon source to conflate
against until that adapter exists.
