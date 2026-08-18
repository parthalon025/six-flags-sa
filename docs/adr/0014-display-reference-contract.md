# ADR-0014: Display reference contract

Date: 2026-08-18
Status: accepted

## Context

The venue builder's game-tier bakes must look like real game worlds — the
target set by three reference images (an RPG-Maker tiled overworld, Big
Kahuna's hand-illustrated operator map, an aerial photo as layout ground
truth), not by adjectives. Palette rows in a kit cannot prove that; PR
#447 proved the working pattern (a reference-derived visual profile,
checked at fixed visual points) and PR #480 surveyed the licensed tool
ecosystem for ground truth and materials.

## Decision

1. **Reference profiles are the output contract.** Every committed kit
   ships a profile under `data/display/references/<kit>.json`: per-terrain
   color families (anchor + Lab ΔE tolerance, **measured from real bakes**
   via `venues:bake --harvest-profile`, never guessed hex), road-hierarchy
   rules (`vsGround` polarity, or `centerlineVsPaper` for linework
   styles), structure treatment, ADR-0012's layer invariants, and
   agent-review prompts for what pixels cannot judge. A kit without a
   profile does not certify.

2. **Reference images pin by sha256 whether or not git carries them.**
   `references/images.json` uses the asset-ledger grammar. Rows with
   `committed: true` point at bytes in the repo (the Big Kahuna's operator
   map rides with its venue). Third-party works of unknown provenance
   (the user-supplied RPG overworld and aerial references) are **not
   redistributable**: bytes live gitignored under `assets/reference/`,
   placed by hand, while the committed pins guarantee every reviewer
   compares against the same image. `vendor-assets` verifies both ledgers.

3. **The style contract samples real pixels at truth-derived points.**
   `lib/display-style-contract.mjs` computes sample points from the bake
   model (per-terrain interior cells, building interiors and edges, track
   fills and casing rings, badge disc moats), the compositor page samples
   its own canvas, and `certifyStyleContract()` emits the standard
   `check()` rows. Mechanical rows gate (palette, hierarchy, legibility,
   presence, annotation-on-top, in-run double-render determinism,
   cross-kit distinctness); agent-review items ride a separate `review`
   array — `certified` stays a machine statement. The review surface is
   `venues:bake-review` (bake beside its pinned references, cert rows,
   review checkboxes).

4. **PR #480 tools enter as data first.** Registry rows only:
   `polyhaven-ambientcg` (CC0 materials, `stage: display`,
   `evidence_sources: []` — the firewall is a test), `esa-worldcover`
   (CC BY 4.0 land cover, truth-side adapter to be built; display
   consumption documented in notes only), `segment-geospatial`
   (deferred to the GPU harness phase). Explicitly deferred with no row:
   COLMAP/OpenSfM, NAIP, Materialize, OpenSurfaces/MINC; Bing aerial and
   mapKurator stay rejected.

## Consequences

- "Looks like the reference" is now falsifiable: 4 venues × 3 kits
  certify 12/12, and the contract caught two real model defects on its
  first runs (off-boundary buildings surviving the crop; badge pins
  stacking unreadably in dense parks — now decluttered, gates first).
- Profiles are per-design-language, not per-venue: one profile certifies
  its kit on every World.
- The illustrated tier (plan Phase D) inherits this contract unchanged —
  a generated image must pass the same rows plus its own IoU gates.
