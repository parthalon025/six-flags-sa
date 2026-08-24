# Generative texture tier — license review (Wayfinder #630)

**Status:** Resolved (research, 2026-08-24)  
**Map:** [Wayfinder: factories → app end-state gap](https://github.com/parthalon025/six-flags-sa/issues/625)  
**Ticket:** [#630](https://github.com/parthalon025/six-flags-sa/issues/630)

Phase 8 of the display pipeline execution plan (`docs/research/2026-08-19-display-pipeline-execution-plan.md`) flags generative texture tooling for license review before fleet-scale embed.

## Verdict

| Candidate | License | Commercial embed | Notes |
|---|---|---|---|
| **Ubisoft CHORD** | Ubisoft ML License (Research-Only) | **Reject** | Academic/research permitted purpose only; commercial use prohibited. Separate commercial terms via Ubisoft if ever needed. |
| **Seamless-tile SDXL diffusion** | SDXL 1.0 (CreativeML Open RAIL++-M) | **Ok** | Pin SDXL 1.0; outputs ship as `original`-class with model + seed provenance. Avoid SD 3/3.5 (revenue threshold) and Flux dev (NC). |
| **ControlNet (SDXL stack)** | CreativeML Open RAIL-M / ++-M on SDXL ControlNets | **Ok** | Pin SDXL-based ControlNet weights; inference is build-time only. |
| **Flux ControlNets / SD 3.5** | NC / revenue-cap | **Reject or legal review** | Do not use for shipped assets. |

Repo gate: `ALLOWED_LICENSES` in `display-pack.mjs`; AGPL/GPL on ledger rows rejected per `docs/visual-factory-tools.md`.

## Phase 8 status

**Not ruled out.** Remains separately fundable Slice 5. The CHORD leg of the AI-generated sourcing ladder (`docs/research/2026-08-18-custom-map-display-factory.md` §4) is blocked unless Ubisoft grants commercial terms.

**Proceed without CHORD:** CC0/procedural/DeepBump (build-time) for PBR completion, or SDXL-generated albedos with pinned weights.

**Remaining gate:** perceptual certification infrastructure (ADR-0017), not licensing.

## Suggested close comment for #630

> License review complete. CHORD rejected; SDXL seamless-tile + SDXL ControlNet approved with pinned weights and provenance. Phase 8 stays on the roadmap as separately fundable — full fleet gate still depends on perceptual certification (ADR-0017).
