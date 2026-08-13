# Research: No Man’s Sky missions vs Park Bound Side Quests

**Date:** 2026-08-13  
**Status:** Research complete. Review only — no design approved, no implementation.  
**Companion research:** [`2026-08-10-gamified-map-contributions.md`](./2026-08-10-gamified-map-contributions.md) (Waze / StreetComplete / Wayfarer)  
**Shipped system:** [`../adr/0009-ship-gaps.md`](../adr/0009-ship-gaps.md), language in root [`CONTEXT.md`](../../CONTEXT.md)  
**Draft (not this ship):** [`../superpowers/specs/2026-08-10-gamified-map-contributions-design.md`](../superpowers/specs/2026-08-10-gamified-map-contributions-design.md)

This note is a Marco-style product review of **Side Quests** as shipped, read against Hello Games’ mission systems from Atlas Rises (2017) through Omega / Orbital / Beacon (2024–2025). It answers: what is worth stealing, what already beats No Man’s Sky, and which NMS patterns would make a park day worse.

---

## Executive summary

Hello Games spent a decade discovering that **procedural fetch boards** do not make a huge world feel alive, and that **shared, optional-order, on-site goals** do. Park Bound already chose the better half of that lesson.

Side Quests are **place-specific facts the builder shipped** (height on *this* ride, queue pin at *this* entrance, a walkway OSM missed). They are not “scan / trade / combat” templates restamped onto every land. That is the original Sean Murray instinct — do not send people to fetch space chickens — and it is the part of NMS that later updates had to *unlearn* after Atlas Rises added a traditional mission board.

What is worth taking from NMS is **not** the Mission Board. It is the later recovery:

1. **One current / pinned mission** that the UI must not steal (Omega spent a patch just undoing auto-switch).
2. **Go to the area, then look** (Target Sweep, Expeditions 3.3) instead of a dumb GPS pin to the exact pixel.
3. **Complete on site.** When return-to-giver failed at planetary scale, they added reset-if-too-far (Atlas Rises 1.37). A park is the same geometry at walking speed.
4. **A same-day community pulse** to one real place, with a **catch-up stack of three** so Saturday-only guests are not punished (Nexus Quicksilver + weekend events).
5. **Optional-order seasonal milestones** (Expeditions), with catch-up later because hard clocks were the part Hello Games themselves had to walk back (Expeditions Revisited).
6. **Titles as cosmetics**, not content gates for the field loop.
7. **Later edition rewards are Map skins and Location icons** — the Quicksilver-shop analog without a spendable currency. Skins restyle this Profile’s map; icons sit on the Location pin the Party watches. Not HUD quest markers.

Do **not** import: standing-gated empty boards, encrypted hidden objectives, real-time wait gates, a spendable shop, HUD clutter, abandon penalties, combat, or a Nexus that warps you to the job. Those solve a solitary galaxy. They fight a family Saturday at Kings Island.

This note is not permission to add a mission board, a Quicksilver shop, standing grind, or a HUD quest pin. Any of those needs a new grill and ADR. Later **Map skins** / **Location icons** are locked as the cosmetic surface; they still need their own grill before build.

---

## Scope and locks (do not reopen)

The review assumes the shipped Side Quest contract and does not reopen it:

- The builder invents **Gaps** once into `*.gaps.json`. The phone ranks by **Location**. No POI heuristics on the phone.
- Wire is atomic `{ type, target }`. `target` is unique Place key `i`, or `null`.
- Inventory this ship: height, queue, path, restroom, food, gate, camping. Not aliases, credits, locality, live ops.
- **XP** lives only on the **Profile**. Never spent. Repeat of the same `(venue, type, target)` by the same Profile is 0.
- **Titles** are Profile sub-names (Scout → Steward). Visitor has no Title yet. Not a roster rename.
- Cards stay meaning-first. No “+12 XP” on the card.
- Field Research now; Cartographer Create (Wayfarer) later.
- Park-wide Overlay still needs a second independent **Party**.
- Later editions grant **Map skins** and **Location icons** on the Profile (earned, never bought with XP). Not this ship.

Cross-links: Waze / StreetComplete / Wayfarer already cover *validation and score*. This note covers *mission shape, attention, and togetherness*.

---

## How Side Quests work today

Shipped in `feat: ship Gaps across the builder-phone seam` ([#139](https://github.com/parthalon025/six-flags-sa/pull/139)). Canonical language: `CONTEXT.md`. Contract: ADR-0009.

### Two tempos, one tab

| Loop | Seed | Where | Output | Identity |
|------|------|-------|--------|----------|
| Durable Gap | Builder `*.gaps.json` | At the Place (or in-bounds + off-walkway for path) | **Contribution** | Profile required |
| Live ambient | Hard-coded: ride up/down, queue band, amenity outage | Nearby enough to have seen it | **Ride report** / later **Observation** | Name-first; XP still needs Profile |

The phone groups Gaps by type into cards with progress (`2/3`), ranked by Location. Copy is the fact (“Confirm height on the sign”), not the reward. Completing the same Gap twice on one Profile awards 0 XP. Path uses a ~40 m score cell so one walk does not farm-block the park.

There is **no current/pinned mission**. Opening a card is local UI state. Live ambient cards sit beside durable cards. Nothing prevents a Ride-up ping from competing with a height Gap the guest was walking toward.

There is **no return-to-giver**. Submit is at the spot, queued offline, scored when walked-near.

There is **no community pulse**. The list is the builder’s backlog for this Venue, not “today everyone photograph Rivertown queues.”

There is **no seasonal page**. Titles accrue across visits on the Profile. Cartographer later unlocks Create; Field Research is not standing-gated.

There is **no Map skin or Location icon** this ship. Trail / Park Midnight are unearned map packs. Future editions grant skins (this Profile’s map) and icons (this Member’s Location pin) the same way Titles land.

That is already closer to StreetComplete + Waze than to an MMO board. The NMS question is whether later Hello Games systems can tighten *attention* and *sameness of day* without turning Gaps into fetch templates.

---

## Research sources

### Primary (Hello Games, interviews)

| Source | What it owns |
|--------|----------------|
| [PC Gamer — “10 burning questions”](https://www.pcgamer.com/no-mans-sky-10-burning-questions-answered/) quoting Murray (Mar 2016) | Pre-launch rejection of traditional quests / “space chickens.” |
| [Atlas Rises 1.3](https://www.nomanssky.com/atlas-rises-update/) | Story + Mission Agent + guilds + mission log. |
| [Atlas Rises patch 1.37](https://www.nomanssky.com/2017/09/atlas-rises-patch-1-37/) | Reset mission if thousands of light years away; stop failed timed missions hanging on the board. |
| [NEXT](https://www.nomanssky.com/next-update/) | Photography, feeding, archaeology, hunting; guild envoys; real-time / scheduled / multiplayer missions. |
| [Development Update 8](https://www.nomanssky.com/2018/11/development-update-8/) | Community Research: everyone photograph underwater fauna on a named planet. |
| [Beyond](https://www.nomanssky.com/beyond-update/) | Nexus as social hub; multiplayer missions warp you to the location. |
| [Beyond Development Update 2](https://www.nomanssky.com/2019/09/beyond-development-update-2/) | Daily Quicksilver (stack to 3); encrypted hidden-objective missions; community-wide unlock of shop items. |
| [Ars Technica interview with Sean Murray](https://arstechnica.com/gaming/2019/08/sean-murray-tells-us-nearly-everything-to-expect-in-no-mans-sky-beyond/) | Nexus as Destiny-like “pinch point” / Tower; “this week, you need to go to this planet and take pictures of creatures.” |
| [GamesRadar — Murray on the Nexus](https://www.gamesradar.com/no-mans-sky-beyond-introduces-a-destiny-2-like-social-space-and-fireteams/) | Fireteams; “a bit like The Tower in Destiny.” |
| [Expeditions 3.3](https://www.nomanssky.com/expeditions-update/) / [Sean’s post](https://www.nomanssky.com/2021/03/no-mans-sky-expeditions-update/) | Shared start planet; optional-order milestones; Target Sweep; weekend missions re-enabled. |
| [Expeditions Revisited](https://www.nomanssky.com/2021/11/expeditions-revisited/) | Surprise popularity; hard clocks made participation hard; they reran seasons. |
| [Omega](https://www.nomanssky.com/omega-update/) / [Sean’s post](https://www.nomanssky.com/2024/02/no-mans-sky-omega-update/) | “Expeditions have become one of the most popular ways to play”; mission-log theft fixes; cycle hints; current mission always available. |
| [Waypoint](https://www.nomanssky.com/waypoint-update/) | Base Computer Archives: **timers removed**. |
| [Frontiers](https://www.nomanssky.com/frontiers-update/) / [3.63](https://www.nomanssky.com/2021/09/frontiers-patch-3-63/) | Settlement Overseer: decisions every few hours (later 15 min–2 h). |
| [Orbital](https://www.nomanssky.com/orbital-update/) | Guild standing more rewarding; envoys; donations — standing as a shop, not the mission loop. |

### Secondary (player-facing tables; label as such)

| Source | Use with care |
|--------|----------------|
| [Miraheze — The Nexus](https://nomanssky.miraheze.org/wiki/The_Nexus) | Daily 400 Quicksilver, weekend 1800, stack of 3, group size 4, instance caps. Hello Games confirmed stack-of-3 and weekend-on-one-planet; exact QS amounts are wiki. |
| [Miraheze — Mission Board](https://nomanssky.miraheze.org/wiki/Mission_Board) | Five board slots, turn in at any station. Pattern-level, not a Hello Games number. |

### In-repo

| Source | Relevance |
|--------|-----------|
| `apps/party-tracker/lib/sideQuests.js` | Grouped Gap cards + live ambient; no pin. |
| `apps/party-tracker/components/SideQuestsPanel.jsx` | One open card; Location ranking; meaning-first submit. |
| `packages/shared/questScore.js` | Profile XP, Titles, path score cell, repeat = 0. |
| `apps/party-tracker/lib/mapThemeTokens.js` | Unearned Trail / Park Midnight packs. Skins restyle, never reposition. |
| `packages/shared/mapSymbols.js` | Shape + colour + glyph. Later Location icons must keep this. |
| ADR-0009 / `CONTEXT.md` | Locks above, including later Map skin / Location icon. |

---

## The Hello Games arc (why the inventory exists)

NMS did not ship one mission system. It shipped a **sequence of corrections**.

### 1. Rejection, then the traditional board

Before launch, Murray told PC Gamer there would not be traditional quests. Fetch quests in a game that wants you to keep moving “just didn’t seem to fit.” Aliens would trade and give technology rather than send you on errands to fetch “space chickens.” He said it would be easy to add fetch quests, but it felt like a wasted opportunity and something other games already did better.

A year later, [Atlas Rises](https://www.nomanssky.com/atlas-rises-update/) added exactly that shape: a Mission Agent, “constantly generated” tasks for scanning, trading, combat, and exploration, guild standing that unlocks “more difficult, more rewarding missions,” plus a mission log to pick what to track. It also added ~30 hours of authored story (Atlas / Artemis). Two products, one update: a **campaign**, and a **board**.

The board is the part later criticized as copy-paste across the galaxy — the same scan/kill/haul verbs on every station. That criticism matches Polygon’s launch-era “wide but shallow” complaint about NPC requests, which predates the board and explains why adding more templates did not fix sameness.

**Park Bound implication:** Gaps must stay *this Place’s missing fact*, not “a height quest archetype instanced onto every ride in every park.” The builder already invents one Gap per unique `i`. Keep that. A Mission Agent that emits “scan three flora” equivalents (“confirm any three heights”) would be the Atlas Rises mistake.

### 2. Return-to-giver dies at scale

[Patch 1.37](https://www.nomanssky.com/2017/09/atlas-rises-patch-1-37/) added: if the destination is several thousand light years away, highlight it in red and let the player reset to the most recent safe stage. They also stopped failed timed missions hanging on the board forever, and reduced multiple missions sending you to the same pin.

That is an admission: **hand-in at the original giver fails** when the world is larger than a zone. A theme park is small on a map and large on foot with a stroller. Completing at the Place (already shipped) is the 1.37 lesson applied early. The remaining steal is **relocate the active check-in** if the guest walks to another land — not reset the Gap itself.

### 3. Verbs get park-native (NEXT)

[NEXT](https://www.nomanssky.com/next-update/) expanded mission types to photography, feeding, freighter attack/defence, archaeology, specialised hunting. Guild envoys started offering tributes. Multiplayer, real-time, and scheduled missions appeared.

The useful slice is **photography and identify**, not combat. A height Gap is already “read the sign.” A photo of that sign is a park-native confirm, in the same family as Waze photos (see the August 10 research). Hunting and raids are not.

### 4. The pinch point: Nexus + community pulse

[Beyond](https://www.nomanssky.com/beyond-update/) turned the Space Anomaly into a communal hub. Murray told Ars the Nexus is the game’s “pinch point,” “a bit like Destiny’s Tower”: you summon it from anywhere, shard with other players, see their bases, take missions together. GamesRadar quotes the same Tower comparison and fireteams.

Two mission layers landed on that hub:

- **Daily Quicksilver**, stacking to **3**, so you “won’t miss out even if you don’t have the opportunity to play every day.” Community-wide completions unlock shop cosmetics for everyone. ([Beyond Dev Update 2](https://www.nomanssky.com/2019/09/beyond-development-update-2/).)
- **Encrypted missions**: objectives hidden until the mission starts; “especially interesting and lucrative.” Same post.
- **Weekend / community events** on one specified planet. Murray to Ars, before launch: “This week, you need to go to this planet and take pictures of creatures there.” Hello Games then actually ran that shape — e.g. [Dev Update 8](https://www.nomanssky.com/2018/11/development-update-8/): travel to a colourless planet and photograph underwater fauna. Expeditions later re-enabled weekend missions as “specifically-located” for all Travellers.

Murray also told Ars that crowded community planets make the lonely ones feel better by contrast. A park already *is* the crowded planet. The steal is **one shared pulse per day**, not a second social space. Park Bound’s Party is the fireteam. A Nexus that warps you to the job ([Beyond patch notes](https://www.nomanssky.com/beyond-update/): “Multiplayer missions now warp players directly to the mission location”) is the opposite of walking the park.

Encrypted hidden objectives are a poor fit for a physical park with children: you cannot hide “what you are about to do” when the action is standing at a ride sign in public.

Wiki numbers (secondary): daily ~400 QS, weekend ~1800, groups of four. Treat amounts as community documentation; the **stack-of-3 catch-up** and **one shared destination** are first-party.

### 5. Expeditions: the system they say people actually play

[Expeditions 3.3](https://www.nomanssky.com/expeditions-update/) is the structural win:

- Everyone starts on the **same planet**.
- **Milestones in any order**, grouped into phases. Pin a milestone to the log.
- Phase completion unlocks exclusive cosmetics; finish the expedition for an extra reward.
- **Target Sweep**: “Instead of just following a marker, the Analysis Visor’s new Target Sweep mode requires players to use their tracking skills to precisely locate their target.”
- Time-limited season; save converts to Normal after.

Sean’s [March 2021 post](https://www.nomanssky.com/2021/03/no-mans-sky-expeditions-update/) frames it as a way for returning players, veterans, and newcomers to share one journey.

[Expeditions Revisited](https://www.nomanssky.com/2021/11/expeditions-revisited/) is the correction: “One of our biggest surprises in 2021 has been the popularity of Expeditions” — and the limited-time nature made it hard for some people to participate, so they reran the seasons on shorter windows.

[Omega](https://www.nomanssky.com/2024/02/no-mans-sky-omega-update/) states the verdict in Hello Games’ own words: “Expeditions in No Man’s Sky have become one of the most popular ways to play the game. They bring all players together to the same planet for an interstellar, shared experience.” They then let people join from an existing save (no forced fresh start) and opened Omega as a free intro.

**Park Bound implication:** a seasonal “mapping weekend” with optional-order milestones (confirm 5 height signs, walk 2 missing paths, pin 3 queues) is the Expeditions pattern. A hard clock that expires Saturday at 6 pm is the part they had to revisit. Catch-up or a later redux matters more than FOMO.

Target Sweep is the other keep: **rank by Location, then ask the guest to look**, rather than snapping a pin onto the exact queue entrance before they have seen it. Path Gaps already do this (“I’m on a walkway”). Height still wants the sign in front of you — that is fine. Restroom / food / gate “find one” cards are already sweep-shaped. Do not add a visor HUD; add copy and ranking.

### 6. Mission log as a first-class bug surface (Omega)

Omega’s patch notes are a catalogue of attention failure:

- Manually cycle notifications so mission directives, hints, and guidance do not hide each other.
- “Your currently selected mission will now always be available.”
- Fixed selected mission changing after warp or reload.
- Fixed active mission changing after a secondary activity that used the mission system.
- Expedition milestones prioritised in the secondary pool so the current one is easier to find.

If Hello Games needed a major update to stop the game **stealing the current mission**, Park Bound should not add a second channel (live Ride reports, Plan, Meet, Gap cards) that silently replaces the Gap the guest opened. One pinned Side Quest, explicit, is the transfer. Auto-promoting “Ride up or down?” over an in-progress height card is the Omega bug.

### 7. Timers: they added them, then removed them

[Frontiers](https://www.nomanssky.com/frontiers-update/) made the player Overseer of a settlement. “Every few hours, the Overseer may be requested to make a decision.” Patch [3.63](https://www.nomanssky.com/2021/09/frontiers-patch-3-63/) tightened that to “intervals of 15 minutes to 2 hours” after settlements failed to generate decisions.

[Waypoint](https://www.nomanssky.com/waypoint-update/) then reworked the Base Computer Archives chain **to remove timers**. Archives unlock by learning language, not by waiting.

**Park Bound implication:** do not gate “confirm this height” behind a real-time wait. Park days are already scheduled by the park. A pulse can be *calendar* (today’s community goal) without being a *cooldown* (come back in 47 minutes). Settlement-style “your town needs you in 15 minutes” fights lunch, height checks, and a child’s stamina.

### 8. Standing and titles

Atlas Rises gated harder board missions on guild standing and added medals for merchant / mercenary / explorer guilds. [Orbital](https://www.nomanssky.com/orbital-update/) made standing a **shop and discount** (free supplies, donations), not the reason you are allowed to play.

Expedition rewards include titles and patches (PlayStation Blog, Sean Murray, 31 Mar 2021: milestones unlock “a host of new content… as well as a title”). Those titles are cosmetics on the traveller, not a rename of the fireteam.

Park Bound already matches the good end-state: **XP never spent**, **Title under the display name**, Field Research not standing-gated, Cartographer later for Create. Do not copy Atlas Rises “empty board until you grind standing.” A Saturday visitor who just signed in must see height Gaps.

### 9. Cosmetics, not a currency shop

NMS’s Nexus shop spends Quicksilver on appearance: suits, banners, jetpacks. Murray told Ars there would be no microtransactions; the shop is earned. The thing players actually stare at for hours is the avatar and the ship.

Park Bound’s ten-hour stare is the **Venue map** and the **Location** pins the Party uses to find each other. Later editions therefore grant:

- **Map skin** — this Profile’s map treatment (palette + optional marker glyphs). Restyles; never moves geometry. Trail / Park Midnight stay the unearned defaults (`mapThemeTokens.js`). Catalogue sketches live in [`2026-08-10-native-app-ar-map-styles-session.md`](./2026-08-10-native-app-ar-map-styles-session.md) §5–6 and backlog E11.2.
- **Location icon** — cosmetic on this Member’s Location pin so the Party can spot them. That is the Nexus “see their spacesuit” beat, without a Tower. Not a Side Quest HUD marker (Omega / Target Sweep warn against that).

Same earn path as Titles: XP is never spent. The August 10 session’s “pay two dollars to skip the grind” is **not** locked — Party stays free; cosmetics are earned. Accessibility: every skin and icon keeps shape + colour + glyph redundancy (`mapSymbols.js`).

---

## Comparison matrix

| Concern | No Man’s Sky | Park Bound now | Transfer? |
|---------|--------------|----------------|-----------|
| What is a mission? | Mix: authored story, procedural board templates, Nexus dailies, Expedition milestones, settlement timers | Builder-shipped Gap or live ambient | Keep Gaps. Do not add a template board. |
| Who invents the task? | Mission Agent / Nexus RNG / Hello Games season designers | Builder, once per Venue | Keep. Phone must not invent. |
| Sameness | Board verbs repeat in every system | Each Gap is a unique `i` (or one null-target path/camping) | Keep uniqueness. Pulse can *highlight* a type for a day without cloning templates. |
| Attention | One current mission + secondary log; years of auto-steal bugs | Any card can open; live and durable compete | **Steal pin.** |
| Wayfinding | Marker → later Target Sweep (search locally) | Location rank + 150 m “right here”; path is off-walkway | **Steal sweep copy** for find-a-Place types; keep at-the-sign for height/queue. |
| Hand-in | Originally return to giver / station; 1.37 reset-if-too-far; Nexus warps you there | Submit on site, offline queue | Keep on-site. **Steal relocate** if they walk away mid-form. |
| Togetherness | Nexus pinch point; weekend one planet; Expeditions same start | Party mesh; park-wide needs 2nd Party | Party = fireteam. **Steal a day-pulse**, not a hub. |
| Catch-up | QS dailies stack to 3; Expeditions Revisited reruns | Repeat = 0 forever on that Gap (good); no “today’s extra” | **Steal stack-of-3 for pulses only**, not for unique Gaps. |
| Time gates | Settlement hours; Archive timers later removed; season clocks painful | None on Gaps | Do not add wait gates. Calendar pulses only. |
| Rewards | Units, nanites, Quicksilver shop, patches, titles | Profile XP → Title now; later **Map skin** + **Location icon** | Steal cosmetics, not the shop. |
| Gating | Standing unlocked harder board missions | Visitor sees Gaps; submit needs Profile | Keep. |
| Hidden objectives | Encrypted Nexus missions | Meaning-first, chips are the fact | Do not hide the ask. |
| Failure | Abandon / fail timed board missions | Overturned Contribution claws XP / reputation | Keep quality clawback; no abandon penalty for walking away. |

---

## Ranked recommendations

These are **grill candidates**, not a backlog to implement from this note.

### Steal (highest leverage first)

**1. One pinned current Side Quest.**  
Omega’s patch notes exist because the log kept replacing what the player chose. Pin the Gap card the guest opened (or the nearest unfinished Gap of that type). Live Ride reports stay available but must not steal the pin. Plan and Meet stay other tabs. This is attention design, not a new Gap type.

**2. Target Sweep copy for find-missions; keep “at the sign” for facts on a Place.**  
Hello Games replaced follow-the-dot with local search because the dot made every planet feel the same. For restroom / food / gate / null-target path: “You’re in the park — look, then mark.” For height / queue: the Place exists; ranking gets you close; the chip still requires the sign or the line. Do not add AR visor chrome.

**3. Same-day community pulse + catch-up of three.**  
Nexus dailies stack to 3 so missing Tuesday is not death; weekends send everyone to one planet. A park analog: “Today’s pulse: queue pins in Rivertown” (or height signs, or missing paths). Personal credit still lands on the Profile. A community meter can help unlock a **Map skin** or **Location icon** — it must not replace the second-Party bar for park-wide live ops. Catch-up: last three pulses remain completable. Unique Gaps stay unique (repeat still 0).

**4. Optional-order seasonal milestone page, with redux.**  
Expeditions: any-order milestones, phase cosmetics, pin to log. Hello Games called this the most popular way to play *and* had to rerun seasons because clocks locked people out. A “Kings Island mapping weekend” that you can finish the next visit is the transfer. Do not expire Field Research. Phase rewards are **Map skins** and **Location icons**, not a shop.

**5. Park-native extra verbs, still meaning-first.**  
NEXT’s photography / identify, plus Hello Games’ actual community research (photograph fauna on this planet). Candidate: optional photo of the height sign as evidence, not as XP bait. Confirm/deny of someone else’s Contribution is already in `questScore` (+2) — surface it. Do not add kill, raid, or fetch-from-A-to-B.

**6. Relocate the active check-in, never the Gap.**  
1.37 reset the *stage* when the player was impossibly far. If Mia opens a height card at The Beast, then the family walks to Action Zone, the form should follow Location (nearest unfinished height) rather than submit The Beast from the wrong land. The Gap inventory stays builder-owned.

**7. Cycle competing hints.**  
Omega: when several systems want the HUD, let the player cycle; always keep the selected mission. If Side Quests, Plan, and navigation ever share a toast, cycle; do not stack, do not auto-replace.

### Do not steal

| NMS pattern | Why it fails in a park |
|-------------|------------------------|
| Procedural Mission Board | Makes every land feel like every other land. Gaps are the anti-board. |
| Standing-gated empty boards | Saturday Visitor must see work. Titles are sub-names, not keys to the list. |
| Encrypted hidden objectives | Families need to know the ask. Meaning-first chips. |
| Return-to-giver / warp-to-mission | The park is walked. Nexus warp is a video-game skip. |
| Real-time wait gates (settlement / archives) | Hello Games removed archive timers. Park days already have queues. |
| Spendable Quicksilver shop | XP is never spent. Later editions grant **Map skins** and **Location icons** instead — cosmetics, not a currency. |
| HUD quest marker as the loop | They added Target Sweep to undo it. Location rank is enough. |
| Auto-switch current mission | Omega’s bug list. |
| Combat / hunting / pirate raids | Wrong verb family. |
| Abandon penalties on casual tasks | Walking to lunch is not failure. Overturned false reports already cost reputation. |
| Authored 30-hour story as default Side Quests | Atlas Path is a campaign. Side Quests are Field Research. A light seasonal narrative is optional later, not the loop. |
| Position-not-saved / instance shuffle | Party mesh is the session. Do not drop check-in state because the “shard” changed. |

### Already better than NMS — protect these

- **Unique `i`, not templates.** Two Poltergeists with two ids are two Gaps. The board would have emitted “scan a coaster” twice.
- **Complete on site.** 1.37 exists because they got this wrong.
- **Meaning-first cards.** Encrypted missions and “+400 QS” are the opposite.
- **Profile-tied XP, never spent, no global leaderboard.**
- **Titles under the name.** Alice stays Alice.
- **Later: Map skins + Location icons**, not a spendable shop. The skin is your map; the icon is your pin.
- **Party as the fireteam** without a Destiny Tower to walk to.
- **Second independent Party** for park-wide truth — stricter than Nexus “anyone in the shard counts.”

---

## Risks if we copy the wrong layer

**Overjustification.** The August 10 research already warns: extrinsic boards kill the intrinsic “I saw the sign.” NMS’s shop and standing grind are that failure mode. Pulses must still read as helping other guests. Map skins and Location icons are the reward *after* the fact, not copy on the card.

**Template gravity.** Once you have a pulse generator, it is tempting to emit “any three heights” forever. That is the Mission Board. Pulses should *point at existing Gaps*, not invent parallel tasks.

**Attention theft.** Live Ride reports are valuable and name-first. If they auto-pin, Omega repeats. Pin is guest-owned.

**FOMO clocks.** Expeditions Revisited is the primary source that hard season windows blocked the exact community they wanted. A park weekend pulse can highlight; it must not delete the Gap at 6 pm.

**Hidden objectives in public space.** Encrypted Nexus missions are a streamer beat. A parent at a queue entrance needs the chip to say the fact.

**Wait gates vs child stamina.** Settlement “come back in 15–120 minutes” is incompatible with a day that is already a sequence of waits.

---

## Suggested next grill (not this PR)

If product wants a follow-up, grill in this order:

1. **Pin** — one current Side Quest; live reports cannot steal it.
2. **Pulse** — calendar highlight of existing Gaps + stack-of-3 catch-up; community meter does not replace second-Party Overlay.
3. **Sweep copy** — find-a-Place types; no visor.
4. **Seasonal optional-order page** — redux allowed; no hard lockout.
5. **Map skin + Location icon** — earn rules, Party-visible pin vs personal map, accessibility (shape + colour + glyph). Not a HUD quest pin.
6. Only then: photo-as-evidence, never photo-as-XP.

Out of scope until a separate grill: Create/Wayfarer (Cartographer), spendable rewards, HUD pins, any phone-side Gap invention.

---

## Verdict

Murray was right in 2016 that fetch boards waste a world whose point is *being there*. Atlas Rises added the board anyway; Beyond and Expeditions then spent years building the thing people actually liked: **everyone here, optional order, look around, finish on site, cosmetics for showing up, catch-up if you miss a day.**

Park Bound Side Quests already are “being there” for a real map. The useful NMS imports are **pin, local search, day-pulse with catch-up, and seasonal optional-order** — all aimed at Gaps the builder already shipped. The shop analog is **Map skins** and **Location icons**, earned like Titles, never bought with XP. The Mission Board, the spendable currency, the standing gate, the hidden objective, and the timer are how a galaxy got boring. A park cannot afford that.
