# ADR-0021 — Zoomable worlds revised: truth-recoverable paint, power-of-two bands, one park first

**Status:** Accepted (owner-confirmed question by question in a structured design review, 2026-08-20)
**Amends:** [ADR-0019](./0019-zoomable-worlds.md) (clauses 1, 2, 5, 10) ·
[ADR-0020](./0020-imagery-ground-truth.md) (clauses 2, 6) ·
[ADR-0013](./0013-display-pipeline.md) (visual-spec step 3) ·
[ADR-0016](./0016-custom-map-worlds.md) (clause 8 band units) ·
[ADR-0018](./0018-factory-interaction-and-delivery.md) (clause 5 on-wear sync)
**Depends on:** [ADR-0013](./0013-display-pipeline.md) ·
[ADR-0014](./0014-display-reference-contract.md) ·
[performance playbook](../research/2026-08-20-perf-playbook.md) ·
[imagery CV research](../research/2026-08-20-imagery-cv-research.md)

## Context

ADR-0019 and ADR-0020 were accepted the same day and stress-tested before Train H (#563) started
building. The review did not reopen the settled shape — MapLibre as the one renderer, banded LOD,
the derivation-licence wall, OSM-canonical truth all stand. It found three other things: two
contracts that disagreed with each other, several numbers that were load-bearing but undefined,
and one feature whose entire supporting apparatus was still TBD.

The throughline is a question ADR-0019 never asked directly: **what is the painted band actually
for?** The bundle already ships `map.json`, `pois.json`, `gaps.json` and `display/base.pmtiles`
offline, so routing, Places and Gaps work with no network and no paint. That makes the painted
world helpful rather than load-bearing — but only if it never becomes the sole home of a fact.
Clause 1 below turns that from an observation into an invariant, and most of what follows falls
out of it.

## Decision

1. **The painted band carries no information that is not recoverable from Truth.** No band bakes
   legible text: ADR-0019 clause 1's "signage" means sign *objects* — frames, marquees,
   silhouettes, the colour and shape of a sign — never readable words. Every string on the map
   comes from `pois.json`. `visual.json` may style a label (face, halo, the zoom it appears at,
   per-Skin suppression) but never supplies the string, and Skins never rename Places: two
   Members on different Skins must never read different names for the same Place while trying to
   Rally. Certification rows: no text glyphs in any baked band; no label strings in `visual.json`.
2. **Bands are specified in ground sample distance, on power-of-two steps.** Overview **2.4 m/px**
   · mid **0.6 m/px** (unchanged — Train E's existing bake) · close **0.15 m/px**. Each band sits
   exactly 4× (two zoom levels) from its neighbour, so the parent-band placeholder of playbook
   row 5 has a real parent to upscale from. `px/cell` is retired as the specifying unit: nothing
   in the repo states a cell's size directly, and it is only pinnable by working backwards from
   ADR-0019's own "48 px/cell ≈ 15 cm/px" — which puts the old overview band at 1.8 m/px. So this
   is not a pure restatement: mid and close land exactly where they were, and **overview coarsens
   from 1.8 to 2.4 m/px** to buy the clean 4× chain. That band's job is bold generalized shapes,
   which is why it is the one that can afford to move.
3. **Generalization removes, never moves.** A band may drop a feature entirely; any feature it
   does draw sits where Truth says it sits. Per-band alignment budget, asserted against Truth
   centrelines by the `style_world_geo` row: close ≤ 1 px (0.15 m), mid ≤ 1 px (0.6 m), overview
   unconstrained because departing from Truth is that band's job. The live overlay always draws
   from Truth and is never snapped to art — at 0.15 m/px a metre of drift is seven pixels of blue
   line crossing painted lawn, and guests trust their eyes over the route.
4. **Band handoffs are staged, not simultaneous.** The pitch ease occupies a zoom range that does
   not overlap a band boundary, and content a closer band adds ramps in across the crossfade
   window rather than switching on at its edge. One pinch should read as detail emerging, not as
   the world reorganising itself.
5. **No automatic pyramid prefetch.** ADR-0019 clause 5's skin-wear background sync is withdrawn.
   Bands stream by viewport — cellular included, which is what every map app does and is fine —
   and cache normally; the mid band in the venue pack stays the offline floor, and per clause 1 a
   band that has not arrived costs prettiness, not function. Offline close-band coverage becomes
   an explicit guest action: a *make this park available offline* download that states its size
   before it runs. No custom network-priority machinery; the OS is the priority manager.
6. **First ship is one venue × three contrasting Skins.** ADR-0019 clause 10's venue × full
   catalogue becomes the *second* milestone. One Skin cannot fail the beyond-palette distinctness
   gate, so it cannot tell you the kit is wrong; three Skins chosen far apart on the design axes
   can. **pixel-tycoon goes first** — clause 6 of ADR-0019 retires the projection that carried its
   distinctness, making it the hardest case for the gate and the cheapest place to discover a kit
   problem. Guests who unlocked pixel-tycoon get a note that it changed and why.
7. **The close band is machine-produced.** "Good for one park before hundreds" means the pipeline
   clears a bar, not that hands made one park pretty — hand-authoring proves the art direction and
   proves nothing about the factory. A hand-painted target frame is throwaway and stays out of the
   repo (#563's camera spike); the shipped close band comes entirely from kit vocabulary driven by
   Places truth. A certification row fails the build if any per-venue close-band asset exists.
8. **Grounding covers the overview and mid bands only.** Recognition is an arm's-length
   phenomenon — the landmark standing where it stands, the shape of the midway, which cluster of
   roofs is the blue one — and NAIP at ~1 m GSD is ample for all of it and roughly 7× too coarse
   to texture 0.15 m/px. ADR-0020 clause 4's treatment-versus-relationships split stands at those
   two bands. Close-band specificity comes from kit vocabulary positioned by Places truth.
   Street-level grounding (Mapillary, self-capture per #498) is the eventual close-band path and
   stays out of scope while per-venue capture cost is a human walking the park. This scopes it
   only — its licence terms are un-reviewed (see Open).
9. **NAIP is fetched from Microsoft Planetary Computer** (STAC, anonymous short-lived SAS), not
   the AWS Open Data buckets — those are Requester-Pays with no anonymous path, so they need real
   credentials and cost money. Corrects ADR-0020 clause 2 and issue #562; #563 already said this.

## Rejected

- **Baking legible text into any band** — a painted word does not degrade, it smears; it cannot
  dodge a party dot, be read aloud, change language, or survive a ride being renamed without
  re-baking the pyramid for every Skin in the catalogue.
- **Skin-scoped renaming of Places** — display aliases alongside the true name are a possible
  later feature; instead-of is a Party failure.
- **Snapping the route to painted art** so the two always agree on screen — art bending Truth, in
  the one tier routing depends on.
- **Wi-Fi-only sync, cellular caps, and yielding sync to Party traffic** — over-built. Viewport
  streaming on cellular is the ordinary pattern and the OS already arbitrates.
- **Automatic on-wear prefetch** — takes bandwidth and battery the guest did not ask for, to
  prevent a degradation clause 1 established is cosmetic.
- **Packing the close band for the walkable core, and prefetching a pyramid on venue entry** —
  both were weighed against the in-park dead-signal case and both lose to clause 1: Truth is
  already offline, so the zoom-in that congestion degrades still answers the question.
- **One venue × one Skin as the first ship** — cannot fail the gate that matters.
- **One venue × two contrasting Skins** — the near-miss, and the reviewer's recommendation. Two
  can fail the distinctness gate, but a pair that passes may be passing on a single axis;
  three is the smallest set where that cannot hide.
- **A true-iso path kept for pixel-tycoon** — reaffirms ADR-0019's rejection; if painted-iso plus
  a camera preset cannot carry the feeling, the answers are a kit redesign or retiring the Skin
  with compensation, not two renderers forever.
- **Per-venue hand-authored close-band art** — cost is venues × Skins of human attention, the
  flagship stays beautiful, and every other park teaches guests which ones are the real ones.

## Consequences

- Playbook rows 2 (bank-swap diff sync) and 14 (storage ceiling), and the idle-gated-sync half of
  row 12, lapse with the feature they existed to protect — the cluster the playbook itself flagged
  as least covered. Row 8's cache budget still applies to viewport streaming; row 12's
  render-on-demand half stands.
- Clause 1 removes the *correctness* rationale for ADR-0019 clause 8's zero-blank-tiles row —
  with Truth offline and paint carrying no facts, a blank tile is ugly rather than wrong. What
  becomes of the row is part of the open gate-row question below; clause 8 is left as written.
- The grounding harvest stops being a nice-to-have riding along in Train H and becomes the thing
  that keeps a machine-produced park from looking generic (clauses 7–8 together).
- `docs/adr/0013-display-pipeline.md`, `docs/adr/0016-custom-map-worlds.md`,
  `docs/adr/0018-factory-interaction-and-delivery.md`, the perf playbook, and `CONTEXT.md`'s
  **Zoom band** and **Display pack** entries all carried the old band units or the withdrawn
  on-wear sync. Each is amended in place alongside this ADR.

## Open

Recorded so the next session does not mistake silence for agreement:

- **Train H's build order.** #563 puts the two riskiest unknowns — does flat art read well
  pitched, does a mobile WebView hold up — in the last slices, while clause 6 above puts
  pixel-tycoon first among the *Skins*. Slice order is not settled here, and clause 6 does not
  settle it: which slice lands when is still open.
- **The perf gate rows.** The review established that background drain is the real concern (the
  screen is off for most of a park day) and that cellular streaming is fine. It did *not* settle
  how the rows are structured — CI throttle as regression-only versus absolute, whether a pinned
  real device joins the gate, or what a drain budget would be. The fate of the zero-blank-tiles
  row (see Consequences) belongs to this same question.
- **Train I.** Only clauses 8 and 9 above touch it. The evidence lane, the steward review budget,
  the `GOOGLE_MAPS_API` key's exposure through public workflow triggers, Mapillary's share-alike
  reach into derived venue data, and the OSM write-back path are all un-reviewed.
