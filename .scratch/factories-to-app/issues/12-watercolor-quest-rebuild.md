# 12: Rebuild Kings Island watercolor-quest world skin

**What to build:** Bake kings-island with watercolor-quest kit, compile display pack, publish to live app public bundle.
**Blocked by:** None
**Status:** resolved

- [x] Bake kings-island --kit watercolor-quest
- [x] venues:display --bake
- [x] venues:publish-worlds kings-island watercolor-quest
- [x] Verify /dev/banded-world preview

## Comments

Verified complete 2026-08-27. `display-certification.json` for kings-island reports
`bakes.watercolor-quest.certified: true` (signature `9c820ad4`, 16px) and all 20
`bake:watercolor-quest:style_*` checks pass, including `style_no_baked_text` and
`style_bake_deterministic`. `watercolor-quest.world.png` + `.world.json` are published under
`apps/party-tracker/public/venues/kings-island/display/`. Five skins certify on KI
(trail, park-midnight, layered-atlas, watercolor-quest, pixel-tycoon).

The ticket had every acceptance box ticked but was never flipped, which is why
`npm run workflow:next` kept naming it the frontier.
