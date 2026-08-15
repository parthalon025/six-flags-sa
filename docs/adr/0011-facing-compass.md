# Facing Compass on phone and Watch

Park Bound’s orientation HUD is a facing-relative **Compass** (game-style radar), not a north-first magnetic rose. It ships on the phone as the bearing strip and on Apple Watch as a dial with distance and next-maneuver navigation. The map-edge compass rose is removed so there is one instrument language.

**Mark rules (both surfaces):** show **Members** with a **Location** pin (stale allowed); always show **Meet** when set; one primary **Place** — Go destination while navigating, otherwise selection or next **Plan** **Place** (selection replaces Plan-next); coalesce the same **Place** as Go > Meet > selection/Plan-next; quiet N tick; people marks are bodies only (not Member targets); range on the primary only. No facing → do not fake a relative dial. Solo/pre-Party still gets Plan-next or selection. Phone tape is optional and independent of Watch visibility; it sits under top map chrome, silhouette-first, one home when the sheet rises.

**Map:** north-up always except during Go (course-up).

**Watch:** same marks; works in browse and Go (Go adds next-turn cue + distances). Guests get a full settings panel — density, Always On style, show party, show Meet, units, turn haptics, raise-to-nav — not a single locked chrome. Shipping default is glance-first density and calm Always On. Not a “which Plan pin” picker; Plan-next stays the product rule.

Canonical language: root `CONTEXT.md`.
