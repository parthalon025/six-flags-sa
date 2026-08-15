# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

**Single-context.** One product (**Park Bound**) despite npm workspaces (`apps/*`, `packages/*`). The venue builder and the phone app are two runtimes of the same language: **Venue**, **Place**, **Attraction**, **Gap**, **Contribution**, and **Overlay** mean the same thing on both sides. Enjoyment and map improvement are one loop, not two glossaries.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (created lazily by `/domain-modeling` / `/grill-with-docs` — do not invent an empty stub).
- **`docs/adr/`** — numbered ADRs (`0001-slug.md`, …) that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them when terms or decisions actually get resolved.

## Legacy ADRs

Long-form decision write-ups also live under `docs/superpowers/specs/` (pre–Matt layout). Prefer `docs/adr/` for new decisions. When both exist for the same topic, treat `docs/adr/NNNN-*.md` as canonical and the specs file as expanded history.

## File structure

```text
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   │   ├── 0001-auth-profiles.md
│   │   ├── 0002-dual-layer-park-truth.md
│   │   ├── 0003-family-party-mesh.md
│   │   ├── 0004-eligibility-set.md
│   │   ├── 0005-store-capacitor-shell.md
│   │   ├── 0006-invisible-host.md
│   │   ├── 0007-park-wide-second-party.md
│   │   ├── 0008-plan-one-list.md
│   │   └── 0009-ship-gaps.md
│   ├── agents/          ← skill config (this folder)
│   │   ├── matt-standards.md
│   │   ├── ci.md
│   └── superpowers/     ← human specs / expanded history (not the ADR root)
├── apps/
│   └── party-tracker/   ← phone PWA
├── packages/
│   ├── shared/          ← contracts both runtimes import
│   └── venue-builder/   ← OSM → venue bundle
└── scripts/             ← repo automation (not the venue builder)
```

Package seams: [packages/README.md](../../packages/README.md). Visual tour: [architecture-map.md](../architecture-map.md).

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (auth profiles) — but worth reopening because…_
