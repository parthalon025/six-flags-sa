# Spec — Kings Island watercolor-quest world rebuild

## Goal

Rebuild the Kings Island `watercolor-quest` baked world skin through the visual factory and publish it to the live app bundle.

## Scope

1. Bake `kings-island` with the `watercolor-quest` kit (`venues:bake`).
2. Fold the bake into the display pack (`venues:display --bake`).
3. Publish `watercolor-quest` world files to `apps/party-tracker/public/venues/`.
4. Refresh `kings-island.bundle.json` hashes and byte totals.

## Out of scope

- New kit authoring or palette-only changes.
- Enabling MapLibre as the default renderer (band preview flag remains separate).
- PostDB truth head publication (file-based factory path only).

## Acceptance

- `display-certification.json` reports `certified: true` for watercolor-quest.
- `watercolor-quest.world.png` serves from `public/venues/kings-island/display/`.
- Bundle manifest sha256 matches the published PNG bytes.
- `/dev/banded-world` renders watercolor-quest when `NEXT_PUBLIC_BANDED_WORLD_PREVIEW=1`.
