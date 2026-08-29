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
   row 5 has a real parent to upscale from.

   `px/cell` is retired as the specifying unit, and this is a real change of kind rather than a
   restatement. A cell **is** defined — `display-bake.mjs`'s projector sets
   `tileMetres = max(2, span / maxCols)` with `maxCols` 240 — but it is defined *per venue*, so
   px/cell holds the bake's **pixel dimensions** constant and lets ground resolution float with
   park size. Absolute GSD inverts that: ground resolution is constant and pixel dimensions float.
   Measured across the four shipped venues:

   | venue | cell | close band today | close band at 0.15 m/px |
   |---|---|---|---|
   | big-kahunas | 2.76 m | 0.057 m/px · 11,520 px | 0.15 m/px · 4,408 px |
   | kings-island | 6.46 m | 0.135 m/px · 11,520 px | 0.15 m/px · 10,331 px |
   | six-flags-fiesta-texas | 7.04 m | 0.147 m/px · 11,520 px | 0.15 m/px · 11,256 px |
   | cedar-point | 7.97 m | 0.166 m/px · 11,520 px | 0.15 m/px · 12,753 px |

   ADR-0019's "48 px/cell ≈ 15 cm/px" was true for a mid-size park and only for one. The trade
   accepted here: **a metre means the same thing at every park** — authored close-band detail and
   the clause 3 alignment budget are fixed ground distances rather than venue-dependent ones — at
   the cost of Big Kahuna's dropping 2.6× of the close-band resolution it has today (small parks
   were getting fine detail as an accident of the formula's 2 m floor), and of large venues
   growing: a hypothetical 4 km park needs a 26,667 px side, ~29× kings-island's close-band area.
   The per-band size budget rows are what hold that in check, and they now have to be expressed
   per venue rather than once for the catalogue.
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

Closed 2026-08-22 so Trains H and I can finish. The answers:

- **Train H's build order.** pixel-tycoon authors now against the per-band knobs. Slice h5
  already landed, so holding the kit until that schema existed is obsolete.
- **The perf gate rows.** Regression-only CI throttle (4× CPU, 30 fps floor). Zero-blank-tiles
  is the parent-placeholder functional check (playbook row 5 / slice h9), not a correctness
  gate — clause 1 already removed that rationale. A pinned real device is a later addition,
  not a ship blocker.
- **Train I.** A disputed path position **never reaches a guest**. It stays builder-side: a
  maintainer record (`packages/venue-builder/data/venues/<id>/imagery-disputes.json`, written by
  `imagery-disputes.mjs`) plus a dissenting claim in the evidence graph, for steward review. A
  **ride evidence conflict is not covered by that** and **does** reach a guest: it ships on the
  existing `verify` type, targeted at the ride (owner ruling, 2026-08-23). The shipped Gap
  vocabulary stays ADR-0009's frozen seven plus `verify` and `inventory` either way; no dispute
  kind may be spelled as a shipped Gap type, and `ship-gaps.mjs` asserts that at module load.
  OSM write-back is steward-gated proposal files, never an automatic upload. Google Places is
  back-office metadata corroboration only (clause 7 already). Mapillary share-alike stays
  attribution-gated and does not write truth.

  *Corrected 2026-08-29:* this bullet previously recorded the opposite answer — "ships as Gap
  type `path_disputed` (extends the frozen seven)". That was written from ADR-0020 clause 5's
  word "Gap" before the owner had answered, and `path_disputed` was already in
  `SHIPPED_GAP_TYPES` and on the phone's keep-list by the time the answer came back. The owner
  chose the third option on 2026-08-22 — *keep it internal, never show guests* — so the eighth
  type this bullet added to the frozen seven is unshipped. No published bundle under
  `apps/party-tracker/public/venues/` ever carried a `path_disputed` row, so nothing reached a
  guest's cache; the phone's keep-list drops the type anyway, which is what covers a bundle
  cached from a preview build.

  *Corrected again 2026-08-23 (recorded 2026-08-29):* unshipping `path_disputed` also unshipped
  `evidence_conflict`, because the conflict seed had been routed onto `path_disputed`'s channel
  and inherited its fate — a ride whose sources disagreed reached no guest at all. The owner's
  decision was about **a disputed path position**, not about ride evidence, and the owner has
  since ruled: **keep ride evidence conflicts visible**, on `verify`. So `evidence_conflict` is
  no longer classified as a dispute kind (`DISPUTE_KINDS` holds `path_disputed` alone, and every
  member of it is stamped `shipped: false`); it is named in `shippedTypeForSeed` in full and
  mapped to `verify` rather than riding another kind's route, which is how it shipped
  unexamined the first time. Its builder-side record is where it always was — the certification
  brief's durable seeds. The frozen seven are untouched by all of this. No published gaps
  document changed: none of the four venues under `apps/party-tracker/public/venues/` currently
  produces an evidence conflict, and all four still regenerate byte-identical.

  *Shipped state, 2026-08-29:* the re-route reaches the wire and stops there. The phone keeps
  `verify` through `venue/store.js`'s network filter and then discards it at the renderer:
  `sideQuests.js` `groupShippedGaps` skips any type absent from `GAP_CARD`, which holds
  ADR-0009's seven only. `inventory` (added on main, #781) is dropped by the same line. So both
  types that sit outside the frozen seven are emitted, transported, and never drawn — the
  correction above moved evidence conflicts off a channel that was filtered out onto one that
  is not rendered, which is visible progress on the builder side and none on the guest side.
  Making `verify` guest-facing is a real slice, not a card entry: the type carries two seeds
  with incompatible semantics (`adapter_stale` names an adapter id, with no Place to stand at,
  while `evidence_conflict` names a ride), and `overlay.js` has neither a `FIELD_TYPES` member
  nor an `HTTP_KIND` mapping for it, so a completed quest would record no Overlay fact.
  Tracked as #795, with a tripwire in `test/builder/gaps-quests.mjs` that goes red when the
  drift changes shape.

Plus the crop question that building h1 surfaced. Answered **don't trim, use the large
tiles**: a band plan describes the World, and so does the picture — the bake emits the
projector's whole grid and `cert.bounds` is that grid's own four corners. `bandBakePlan` is
still independent of any cropping, because there is none: `cropModel` and its `margin`
option are deleted rather than taught about plans. The pyramid keeps georeferencing against
`cert.bounds` (a plan says what a bake was asked for; only the artifact says what it
emitted), which now names the same World the plan does.

  *First answered 2026-08-21* as "the plan describes the World; the pyramid georeferences
  against the cropped PNG" — which left the mismatch in place rather than closing it, and
  the owner reversed it on 2026-08-22. The mismatch it left: the bake trimmed itself to the
  boundary ring's box plus a 6-cell margin, so big-kahunas planned 244x276 and emitted
  157x191, while kings-island matched its plan only because its boundary happens to fill its
  bbox. Two consequences of not trimming, both deliberate: the map bbox is the World, so
  neighbouring geometry inside it (big-kahunas keeps 74 building footprints where the crop
  left 32) is drawn rather than dropped; and every mark sits at the projector's own cell,
  because there is no window origin left to subtract.

  *Corrected 2026-08-21:* this list originally named "the `GOOGLE_MAPS_API` key's exposure through
  public workflow triggers" as an open risk. Checked, and it was overstated on both counts. The key
  is not referenced by any workflow or any code in the repo — it exists only as a stored secret. And
  no workflow uses `pull_request_target`, the one trigger that hands secrets to a fork's pull
  request; `build-venue.yml` is `workflow_dispatch`, which requires write access, so it is not
  public-triggerable. When Train I does wire the key, the guard to keep is that rule: no
  `pull_request_target`, and the corroboration step reachable only from triggers that already
  require write access. The call-budget guard in ADR-0020 clause 7 remains worthwhile as defence in
  depth, not as the only defence.
