# Ship Gaps across the builder–phone seam

The builder invents **Gaps** once and writes `apps/party-tracker/public/venues/<id>.gaps.json`. The phone fetches that file, ranks by **Location**, and must not invent durable **Gaps** from POI fields (`!h`, `!e`, missing restrooms). A missing Gaps file is an empty list — it must not fail **Venue** load.

Atomic on the wire: `{ type, target }` with `type` one of height · queue · restroom · food · gate · camping. `target` is the **Place** key `i` when the **Place** exists, or `null` for a missing **Place** / camping. The phone may group cards (progress `2/3`). Credits, aliases, locality, and live ops stay out of the file.

**XP** on the **Profile** is how guests earn rewards. Completing a walked-near (or in-bounds for camping / add-**Place**) Side Quest awards **XP**; **Rank** is the visible reward. **XP** is never spent. Repeat of the same (`venue`, `type`, `target`) by the same **Profile** is 0. Cards stay meaning-first (“Help other guests. Earn trust.”). No all-time global leaderboard this ship. Cartographer later unlocks full-ontology Create (Wayfarer); this ship is Field Research only.

Canonical language: root `CONTEXT.md`.
