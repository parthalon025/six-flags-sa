# 04: Reward wiring and minimum prop vocabulary

**Type:** grilling
**Blocked by:** None
**Status:** open

## Question

ADR-0017 requires reward wiring in the design request. G1 B6/C1 name dense prop clutter and landmark sprites (barrels, fences, bridges, INN signage, statue pair, market tent, garden rows). Kit schema today has no C1 landmark field — props are scatter + building sprites only.

1. **Reward** — Earnable Skin (unlock/share rungs), venue-bound art, rank prize, or seasonal?
2. **Prop minimum** — Ship with Kenney tiles + procedural buildings/trees only, or block ship until bridge/prop/ signage sprite families exist in the ledger?
3. **Signage** — In-world signage sprites (INN, shop icons) per G1 C3 negation, or overlay carries all names?

Facts: G1 matrix lists bridge/prop families as “missing for goal quality”; `rpg-overworld` uses `kenney-roguelike-sheet` without bespoke prop clutter.
