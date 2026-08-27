# ADR-0023 — Visual factory: open-source assets follow the look

**Status:** Accepted (owner-confirmed, 2026-08-24) · Amended 2026-08-25 (attribution-required OSS allowed with credits distro)
**Depends on:** [ADR-0014](./0014-display-reference-contract.md) · [ADR-0016](./0016-custom-map-worlds.md) · [ADR-0017](./0017-visual-factory-request-contract.md) · [display factory design](../research/2026-08-18-custom-map-display-factory.md) · [visual factory tools](../visual-factory-tools.md)

## Context

The **Visual factory** must produce a highly detailed three-dimensional **World** in whatever design visual is requested (CONTEXT.md, ADR-0016/0017). That look is not invented at bake time from palette tokens alone — it is assembled from licensed art and materials whose *selection* is driven by the design request. CC0 libraries (Kenney, ambientCG, Poly Haven), procedural graphs, and (when necessary) generative outputs already enter through three ledgers and two fetch scripts; what was undecided is the contract: **who picks which OSS row, when bytes are pulled, and what is rejected.**

## Decision

1. **The design request selects assets; the factory fetches them.** A valid design-request document (ADR-0017) compiles into ledger bindings before any bake runs:
   - **SkinTemplate** `surfaces` → **MaterialSet** ids (PBR families per `SurfaceClass`)
   - **Kit spec** → asset-ledger ids (sprites, tilesheets, icons) and piece draw styles
   - **Reference profile** (ADR-0014) → exemplar pixels the cert gates sample against
   The prompt chooses *from* the license-gated catalogs; it does not invent URLs or runtime downloads.

2. **Three ledgers, one discipline.** Every shipped byte is named by a ledger row with `source`, `license`, and sha256 pin:
   | Ledger | Path | Fetch | Role |
   |---|---|---|---|
   | MaterialSet | `data/display/materials.json` | `venues:materials --fetch` | Tiled PBR albedo/normal/roughness on surfaces |
   | Asset | `data/display/assets.json` | `venues:vendor-assets --fetch` | Sprites, tilesheets, icons |
   | Reference images | `data/display/references/images.json` | hand-placed or vendored | Output contract pins (ADR-0014) |
   CI verifies pins; it never fetches. A row that cannot be fetched records a `compiled.gap` (materials) or blocks certification until vendored — the missing-tippecanoe pattern, never a silent fallback.

3. **Sourcing ladder (license before embed, in order).** When the requested look needs art the ledgers do not yet contain, new rows enter in this order — never skip a rung without recording why:
   1. **CC0 libraries** — ambientCG, Poly Haven, Kenney, OpenGameArt (license-filtered); automated API or pinned mirror pull where available.
   2. **Attribution-required OSS** — CC-BY and similar, **allowed** when `scripts/lib/credits-registry.json` records the required distro (`on-map` | `credits-screen` | `placed-link:<where>`). Policy module: `scripts/lib/credits.mjs`. Do not reject a source only because it needs a credit line.
   3. **Procedural** — Material Maker graphs committed to the repo (`original` license); deterministic, CI-friendly.
   4. **Derived** — DeepBump (normals/height from albedo) where a CC0 set is incomplete.
   5. **Generative** — seamless-tile SDXL / truth-conditioned ControlNet; outputs are `original`-class, owner eye-passed, provenance recorded (#630). Ubisoft CHORD and NC/revenue-cap weights stay rejected.
   Every row records source, license, generator, and seed — provenance on assets matches provenance on coordinates. Ledger `license` values stay `CC0-1.0` | `original` | `licensed` (`packages/venue-builder/lib/display-pack.mjs` `ALLOWED_LICENSES`); attribution-required rows use `licensed` plus a registry source.

4. **Kit briefs are menu-bound.** `display-kit-brief.mjs` exposes only ledger ids for the flat/top-down tier. An agent answer referencing art outside the menu, an unknown piece, or a palette-only change fails `resolveKit` before render — the hard gate that keeps OSS selection honest.

5. **Rendering tiers stay separate from sourcing.** OSS pulls feed all tiers; delivery differs:
   | Tier | OSS role today | Ships as |
   |---|---|---|
   | **Baked (default)** | CC0 materials tiled + parametric/CC0 sprites in the compositor | Zoom-banded PNG/WebP pyramids in the **display pack** (ADR-0019/0021) |
   | **Real-time PBR (deferred)** | Same MaterialSet rows compiled to KTX2 on extruded truth geometry | MapLibre custom layer + three.js (ADR-0013 item 4) |
   | **Props at POI (deferred)** | TRELLIS / OSM2World glTF placed at truth coordinates | Additive hero content; geometry from **Map factory**, style from OSS or retexture |
   Sourcing policy is shared; the phone never pulls OSS at runtime.

6. **PostDB carries compiled outputs, not live catalog queries.** Factories resolve ledger bindings at build time; **Delivery** exports pinned bytes and manifests. Git holds ledgers and vendored `assets/vendor/` bytes until PostDB Slice 1 lands; the contract (look → ledger row → fetch → bake → cert) is unchanged when the bus moves.

## Rejected / deferred

- Runtime OSS fetch on the phone (battery, license audit, non-deterministic).
- Palette-only looks (invalid per ADR-0017; structural/signature distinctness required).
- AGPL, GPL, **NC**, **CC-BY-SA** (share-alike on shipped art), and no-redistribution sources (textures.com, CraftPix) for shipped bytes. **CC-BY and other attribution-only licenses are allowed** with the credits distro (owner, 2026-08-25). ODbL map data already ships with `on-map`.
- Automated “search the internet for a coaster model matching this mood” without steward review — new ledger rows are PR releases, not silent imports.
- Per-object 3D sprites with full runtime PBR as the *default* path — baked dimensional worlds remain the fleet bar (Q13=A); runtime PBR and glTF props are additive tiers.

## Consequences

- New looks ship as PRs that add or bind ledger rows, run fetch scripts, and pass `material_textures_resolve` plus ADR-0014 style-contract rows.
- `docs/visual-factory-tools.md` remains the tool registry; this ADR is the *selection and pull* contract those tools serve.
- A future `oss-resolver` module (design axes → catalog search → proposed ledger row → steward merge) formalizes automation without changing the ladder or pin discipline.
- CONTEXT.md gains **Material set** and **Asset ledger** as product vocabulary for the two primary OSS catalogs.
