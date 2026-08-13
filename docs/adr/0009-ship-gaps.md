# Ship Gaps across the builder–phone seam

The builder invents **Gaps** once and writes `apps/party-tracker/public/venues/<id>.gaps.json`. The phone fetches that file, ranks by **Location**, and must not invent durable **Gaps** from POI fields (`!h`, `!e`, missing restrooms). A missing Gaps file is an empty list — it must not fail **Venue** load.

Atomic on the wire: `{ type, target }` with `type` one of height · queue · path · restroom · food · gate · camping. `target` is the unique **Place** key `i` when the **Place** exists, or `null` for a missing **Place** / camping / a venue-wide missing walkway. Shared titles do not fork: invent one **Gap** per `i`; an ambiguous name is skipped. The phone may group cards (progress `2/3`). Credits, aliases, locality, and live ops stay out of the file.

**Path** Gaps fill walking routes OSM missed (stranded rides farther than 35 m from walkable geometry, plus one venue-wide cut-through). Guests submit by standing off the mapped walkway and marking “I’m on a walkway.” Contribution lat/lng is the geometry — not freeform GIS.

**XP** is tied to the **Profile**. Completing a walked-near (or in-bounds for camping / add-**Place**, or in-bounds and off-walkway for **path**) Side Quest awards **XP** onto that **Profile**; **Rank** is the visible reward. **XP** is never spent and never lives on a **Member**, **Party**, or anonymous phone. A name-first **Ride report** can exist without **XP**. Repeat of the same (`venue`, `type`, `target`) by the same **Profile** is 0. Cards stay meaning-first (“Help other guests. Earn trust.”). No all-time global leaderboard this ship. Cartographer later unlocks full-ontology Create (Wayfarer); this ship is Field Research only.

Canonical language: root `CONTEXT.md`.
