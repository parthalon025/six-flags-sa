# Park Bound

Community-powered, exploration-first digital twin of theme parks and other venues: live party coordination, park-native navigation, and a living map that improves through **Side Quests** — go to the spot (Pokémon GO), report what you see (Waze), leave something the next family can use (Death Stranding).

## Language

**Park Bound**:
The product. User-facing and domain name for this system.
_Avoid_: Party Tracker (legacy engineering / package label only)

**Venue**:
One shippable place with its own map and POI contract (theme park, water park, campground, etc.). The phone updates that map when the app starts and a connection is available (cell or Wi-Fi), so a **Party** shares one current **Venue**.
_Avoid_: Park (as a second entity type — OK as colloquial UI copy when the Venue is a theme park)

**Party**:
A live group coordinating at a **Venue** — shared roster, presence, meet point, and in-party ride reports. Not a chat room or a saved trip plan.
_Avoid_: Session, room, lobby

**Host**:
The phone that holds the authoritative **Party** state (mesh authority). Invisible — no badge, vote, or toast. Always the best phone (battery, signal, network, performance). Rechecked on join, on failover, and continuously, with a margin so it does not flap on 1%. Applies **Plan** last-write and **Overlay** last **Contribution** per **Place** + type so **Members** share one Party truth.
_Avoid_: Owner, Adult (family labels — not how Host is chosen); leader (UI)

**Member**:
Anyone on the live **Party** roster (including the **Host**). Roster presence, not account identity. May carry only a display name until a **Profile** is attached. May be device-less (e.g. a child without a phone, created by a parent). Device-holding **Members** may tag, set height / **With adult**, and remove device-less seats. Unset height means not height-constrained.
_Avoid_: User (for roster presence); submember (use device-less **Member**); Child / Guest (as party roles)

**Profile**:
A durable signed-in Park Bound identity (prefs, progress, **Title**, attribution) — the paid unlock for that identity. Download and name-only **Members** stay free. A **Member** may bind to a **Profile** at join or later. May save family people (names, heights) so they need not be re-entered each visit.
_Avoid_: User (prefer **Profile** for the product-facing person; `user_id` stays an implementation id); account (use **Profile**); Member (roster presence, not the paid identity)

**Managed Guest**:
A saved person under a **Profile** (typically a child) — name, height, and when height was last confirmed — used to seed device-less **Members**. Saving requires a **Profile**. Seeding with a stale height prompts that they may have grown; skip keeps last inches. Removing a device-less **Member** does not delete the **Managed Guest**.
_Avoid_: Member (until they are on a live **Party** roster); Subgroup

**Contribution**:
The durable result of completing a **Side Quest** — a Profile-attributed update that improves shared park truth. Feeds **Overlay** and can graduate into builder inputs for the persistent **Venue** map. Enjoyment and map improvement are the same loop, not two products.
_Avoid_: Adventure (legacy spec name); Ride report (ephemeral ops)

**Side Quest**:
An on-the-ground mission to settle a fact only a visitor can confirm — Pokémon GO go-to-the-spot, Waze live reports, and Death Stranding structures left for people you never meet, as one loop. Gap quests require being at the **Place** and produce a **Contribution** (and may leave a **Mark**). Live quests require being nearby enough to have seen it (walking near, not queue-pin GPS) and produce a **Ride report** (park-wide **Observation** only after a second independent **Party**).
_Avoid_: Adventure; quest (generic); Contribution (the durable payload, not the mission)

**Gap**:
A missing or unconfirmed fact the builder ships on a **Venue** (`*.gaps.json`) that open sources cannot settle. Types this ship: height, queue, path, restroom, food, gate, camping. Atomic on the wire (one **Gap** per unique **Place** key `i`, or `null` for a missing **Place** / camping / venue-wide missing walkway). Shared display names do not fork: two **Places** with unique `i` are two **Gaps**; an ambiguous title is skipped. The builder invents **Gaps** once; the phone ranks them by **Location** and must not invent them from POI heuristics. Missing `gaps.json` is an empty list, not a failed **Venue** load. The phone may group cards (e.g. “Find the restrooms” with progress). **Gaps** seed **Side Quests**.
_Avoid_: Bug, missing POI (too vague); Contribution (the answer, not the hole)

**XP**:
A **Profile** progress score earned by completing **Side Quests**. Lives only on the **Profile** — not on a **Member**, **Party**, or anonymous phone. Never spent. Crossing a threshold grants a **Title** now; the same earn path also grants **Skins** and **Kits**. Repeat of the same (`venue`, `type`, `target`) by the same **Profile** awards 0. A name-first **Ride report** can exist without **XP**; **XP** still needs the **Profile**. Not a public leaderboard.
_Avoid_: experience (that **Contribution** kind); points (generic); Member XP; party score

**Title**:
The earned sub-name on a **Profile** granted when **XP** crosses a threshold: Scout (50), Ranger (250), Cartographer (1000), Steward (3000). Shown under the display name — Alice stays Alice, with **Scout** beneath. Visitor (signed in, below 50) has no **Title** yet. Not a roster rename, not a **Member** field, not a party badge.
_Avoid_: nickname; handle; level; badge (use **Title**); Rank (internal ladder key only)

**Rank**:
Internal ladder key on a **Profile** that selects the **Title** (`visitor` · `scout` · `ranger` · `cartographer` · `steward`). Guests see the **Title**, not the key. Cartographer later unlocks full-ontology Create (Wayfarer) — not this Field Research loop.
_Avoid_: showing Rank ids in UI (show **Title**); leaderboard; level

**Ride report**:
An ephemeral ops signal about a ride (e.g. open/down). Name-first — a display name is enough. True on this phone immediately — a **Party** is not required. If you are already a **Member**, the **Party** sees it immediately; if you join later, **Members** see it then. Walking near and seeing it is enough; queue-pin GPS is not required. Expires with the party day, never consolidates into shipped venue JSON. Park-wide fan-out is an **Observation**, not automatic.
_Avoid_: Contribution, chat message (it is ops presence for the party, not a messenger thread)

**Observation**:
A Profile-attributed, append-only live signal (wait, status, freshness) that may outlive a **Party** but never rebuilds venue JSON. Optional fan-out from a **Ride report**. Park-wide “down” needs a **Profile** plus a second independent **Party** that also walked near; same-**Party** taps stay in-party. One report never hides an **Attraction** from strangers. Short TTL; easy contradict; repeat false reports cost **Profile** reputation.
_Avoid_: Contribution (Observations are experience/ops series, not durable map structure)

**Place**:
A named thing on a **Venue** map (ride, show, restroom, food, etc.).
_Avoid_: POI (engineering/file label for `*.pois.json` only)

**Attraction**:
A **Place** you ride or experience that may have multiple location slots (queue entrance, station, exit, …) — not a single pin for navigation.
_Avoid_: Ride (as the umbrella type — “ride” is a category of **Attraction**/Place)

**Meet**:
The shared rendezvous point on the **Venue** map for a **Party** (at most one). A personal pin before joining promotes into the party **Meet**.
_Avoid_: Waypoint, marker, pin (generic map chrome — use **Meet** for this job)

**Subgroup**:
A soft partition tag on a **Member** within one **Party** (not a nested party or separate roster). Device-holding **Members** choose their own tag; they may also tag device-less **Members** onto a clump, or remove those seats from the roster. Split the family by tag, then rejoin at the one **Meet**.
_Avoid_: Nested Party, split-party (as a third entity — split is **Subgroup** + scheduled rejoin at the one **Meet**)

**Eligibility**:
The deterministic verdict of whether a person (by height and **With adult**) can do an **Attraction**. Computed from **Member** / **Managed Guest** facts × **Attraction** rules — not a stored party role and not a **Contribution**. A person with no height is not height-constrained (can ride anything); missing height is not an unknown verdict. Map, list, and glance show the most restrictive person in this phone’s set (not eligible, then **Companion**, then advisory, then eligible); place detail lists each person in that same set. The set is this phone’s **Subgroup** (matching tags only — including device-less), or the whole **Party** if this phone is untagged. Untagged device-less **Members** do not shadow a tagged phone — tag them when you split. Verdicts serve device-holding **Members** (the app’s decision makers); device-less people are limiters on those phones, not app users. Leaving someone at the **Meet** is a **Subgroup** / set change, not a **With adult** change. An unattended device-less rider is out of scope.
_Avoid_: Permission, role, filter (those are other jobs)

**With adult**:
A per-**Member** fact: whether this person is accompanied by a grown-up right now. Unset means accompanied (every **Member**, not only device-less). Explicit false is rare and belongs on a device-holding **Member** (e.g. a teen alone) — not a map-wide “alone” switch for a clump. Not a family role.
_Avoid_: Companion (that word is the Eligibility verdict)

**Companion**:
An **Eligibility** verdict: this **Attraction** is allowed only with an adult.
_Avoid_: With adult (the input fact); Adult (a family/account role, not defined yet)

**Overlay**:
The phone’s pending/accepted **Contribution** layer drawn on the shipped **Venue** map. This phone’s map draws **Overlay** — not the Side Quest upload queue. Field Research kinds all draw: height on the **Attraction**, queue-entrance pin, path segment, new restroom / food / gate **Place**, camping hookups. Live **Ride reports** stay ride status, not **Overlay**. True immediately on this phone — a **Party** is not required. That is the same **Overlay**, not a second layer: joining or hosting unions authored facts with **Members** by **Place** + type. For one **Place** + type, the latest **Contribution** is what is drawn — one fact, not a stack. In a **Party**, the **Host** applies that last write so every **Member** draws the same fact; solo, this phone is the only replica until join. Earlier claims stay as evidence; confirm / deny stay statistical (no public counts, names, or percent). Same-**Party** overwrite is not the second independent **Party**. Leave drops **Overlay** you only saw because you were in that **Party**; **Contributions** you authored stay on this phone. Strangers see it only after the same bar as park-wide **Observation**: a second independent **Party** that walked near. Not party roster state and not persistent map until consolidate graduates it into builder inputs.
_Avoid_: Ride report (ops chatter); Observation (live series, not map structure); draft Overlay (solo is the same Overlay); queue / outbox (upload adapter — the map reads Overlay); Skin (paint, not park truth); Action (generic — the **Party** sees the **Side Quest** completion, not a fourth entity)

**Skin**:
A **Profile**-owned cosmetic restyle of the **Venue** map — how it is painted, not where **Places** sit. Earned as a **Side Quest** prize on that **Profile**; two rungs on the same **Skin** (private unlock, then share). Not a **Contribution**, **Overlay**, or **Ride report**. This is the shipped name for what earlier notes called a Map skin.
_Avoid_: Theme (Trail / Park Midnight are the always-on palettes); map pack; party theme; Map skin (use **Skin**)

**Wear**:
The look this phone is painting: own **Skin**, an accepted **Offer**, or Trail / Park Midnight. Own **Skin** is the default when the **Profile** has one. **Wear** of another **Profile**’s **Skin** is not ownership and is not a copy.
_Avoid_: Applied theme; unlocked (that is the owner’s prize)

**Offer**:
A share-unlocked **Skin** held out to **Members** of the current **Party** so they may choose to **Wear** it. Not a push; each phone picks; several **Offers** may be out at once. **Offer** is only for **Skins**, not **Kits**.
_Avoid_: Location share (mandatory device presence); party theme; push

**Kit**:
A **Profile**-owned appearance pack for GPS chrome — the puck, how this **Member** looks to others, the **Meet** they placed, their trail. Equipped **Kit** is visible to the **Party** like a character skin; there is no **Offer**. Not a **Skin** (that is whole-map paint). Strangers at the **Venue** do not see a **Kit**. This is the shipped name for what earlier notes called a Location icon.
_Avoid_: Skin; avatar (Profile photo); pin (generic map chrome); Mark (left in the world); Location icon (use **Kit**)

**Mark**:
A **Profile**-attributed object left at a **Place** (sticker, lantern, chalk, plaque, sign) for visitors who are not in your **Party**. Same gate as **Overlay**: this phone immediately (a **Party** is not required); **Members** once you join or host; strangers after a second independent **Party** that walked near. Others may **Thank** it. Unused **Marks** fade; the **Contribution** they celebrate does not. Not park truth, not **Location**, not a **Skin**, not a **Kit**, not a live stranger.
_Avoid_: Graffiti; pin; Overlay (that layer is **Contribution** facts); ghost; chiral / strand (those are Death Stranding product words)

**Thanks**:
Asynchronous gratitude on a **Contribution**, **Observation**, or **Mark** from someone who used it — Waze “thanks” and Death Stranding “likes,” one idea. Adds evidence and impact for the author; not a chat thread and not spendable currency.
_Avoid_: Like (store/IP wording); karma; clap; comment

**Plan**:
The **Party**’s shared, ordered list of **Places** they intend to visit today. A draft on this phone before join is the same **Plan**, not a second list — not multi-stop navigation, not a **Meet**, not a **Side Quest**, and not a saved vacation file.
_Avoid_: Scenario (do not productize the draft); itinerary (travel-agent language); favorite (personal Member stars in code — not the shared Plan)

**Invite**:
How a person becomes a **Member** of a **Party** — a shareable join link or code. Not an account, not a **Profile**, not a ticket. Name-only is enough; a **Profile** may attach later. Joining triggers a **Host** fitness recheck. Join on a device does not finish until **Location** is on.
_Avoid_: Login, calendar invite, ticket

**Location**:
A device-holding **Member**’s position so the **Party** has situational awareness — where each other are. Shown as a live position; when they are at a **Place**, the **Party** also sees that **Place** name — one **Party** truth, not a per-phone guess and not a check-in. That **Place** travels with **Location**. “At” an **Attraction** means at its queue or station, not walking past; other **Places** (restroom, food) use the same idea — at that **Place**, not nearest-neighbor on the path. At most one **Place** name; if two **Places** conflict, use the one a person would name — the most recognizable **Place**. If two **Attractions** are equally nameable, the slot he is standing in (queue or station) wins. Mandatory (no pause). Not a hide, and not deliberately blurred to spare the roster. Join does not finish without it. Live only inside **Venue** bounds. When live updates stop (outside bounds or OS revoke), last-known and the in-bounds trail stay visible to all **Members** and are marked stale — last known location of that **Member** at that **Place** when they were at one. The trail is the path (dots only); the **Place** name is only on the live or last-known pin. OS revoke after join: stay a **Member** and wall on turning it back on — not an eject. Device-less **Members** have no **Location**. Battery (and charging) is visible to the **Party**; IMU is not; radio scores stay **Host** internals.
_Avoid_: GPS (implementation); pause/share-off (not in this product); privacy blur (Location is awareness, not a hide); most likely / probably / near (conflict rules are not roster copy)

**Weather**:
**Venue**-day context: current conditions plus an hourly forecast for that day, used to predict ride data (holds, likely closures). Not party state and not a **Contribution**. Predictions inform a **Plan**; they do not mark an **Attraction** down — that is a **Ride report**.
_Avoid_: Ride report; Observation (those are on-the-ground signals)

## Relationships

- **Park Bound** ships one or more **Venues**
- The phone updates the active **Venue** when the app starts and a connection is available (cell or Wi-Fi)
- A **Party** coordinates at one active **Venue** at a time
- A **Party** has exactly one **Host** at a time; **Host** is not user-facing
- The **Host** applies **Plan** last-write and **Overlay** last **Contribution** per **Place** + type; every **Member** draws the same **Overlay** fact
- An **Invite** admits a person as a **Member**; joining rechecks whether the **Host** is still the best phone
- **Host** fitness also rechecks on failover and continuously, with a margin so it does not flap
- Join on a device does not finish until **Location** is on
- A device-holding **Member** always shares **Location** with the **Party** while inside the **Venue** so the **Party** can see where they are; there is no pause and no deliberate blur to hide them
- A live **Location** is a position on the **Venue**; the **Party** also sees a **Place** name only when that **Member** is at the **Place** (an **Attraction**’s queue or station, or at that restroom / food **Place**) — not merely walking past
- The **Party** never sees two **Place** names for one **Member**; on conflict, the most recognizable **Place** to a person wins; two equally nameable **Attractions** fall back to the slot that **Member** is standing in
- The **Party** never sees hedging copy for **Location** (most likely, probably, near) — one **Place** name, or last known location of that **Member** at that **Place**
- Every **Member** sees the same **Place** name (or the same last known location of that **Member** at that **Place**) for a given **Location**; **Location** plus **Venue** slots decide it and that **Place** travels with **Location** — not a check-in, not each phone guessing
- If **Location** is revoked after join, they stay a **Member**; live updates stop, last-known and the in-bounds trail stay visible and marked stale (last known location of that **Member** at that **Place** when they were at one), and the app walls on turning it back on
- Outside **Venue** bounds, live **Location** stops; last-known and the in-bounds trail stay visible to the **Party** and are marked stale (last known location of that **Member** at that **Place** when they were at one)
- The in-bounds trail is the path (dots only); the **Place** name is only on the live or last-known pin, not on each crumb
- Device-less **Members** have no **Location**
- Battery (and charging) is visible to the **Party**; IMU is not; radio scores stay **Host** election internals
- A **Party** has one or more **Members**; the **Host** is one of them
- A **Member** optionally binds to one **Profile**; an unbound **Member** is identified by display name until attached
- Sign-in on a device auto-binds that device’s unbound **Member** to the new **Profile** (one bind per **Member**)
- A **Member** may carry zero or one **Subgroup** tag
- A **Member** may carry a **height**; unset height means not height-constrained. Device-less **Members** are valid roster seats
- A **Member** may carry **With adult** (unset means accompanied for every **Member**)
- Device-holding **Members** are the app’s decision makers — they set **Subgroup** tags (including on device-less **Members**), height, and **With adult**, and may remove a device-less **Member** from the roster; device-less **Members** do not decide via the app
- A **Profile** may own zero or more **Managed Guests**; a **Managed Guest** can seed a device-less **Member**
- Seeding a **Managed Guest** with stale height prompts that they may have grown; skip keeps last inches
- Removing a device-less **Member** does not delete the **Managed Guest**
- A **Managed Guest** does not constrain map / list / glance Eligibility until seeded as a device-less **Member**
- A **Venue** contains many **Places**; some **Places** are **Attractions**
- A **Party** has zero or one **Meet**
- A **Party** has zero or one **Plan** for the active **Venue**; a **Plan** is shared with all **Members**
- A **Plan** may be built before arriving at the **Venue**; that draft is the same **Plan**, held on this phone until join, host, or resume
- Create, join, or resume promotes the draft only when the shared **Plan** is empty, then clears it; a shared **Plan** that already has stops is not overwritten; leave does not resurrect the draft
- Any device-holding **Member** may star, unstar, or reorder the **Plan**; the **Host** applies it (last write wins)
- Per-**Member** favorites in code are personal stars, not the **Plan**
- A **Contribution** requires a **Profile** and targets a **Venue** (and usually a **Place** within it)
- A **Venue** has zero or more **Gaps**; the builder ships them; **Gaps** seed **Side Quests**
- Completing a gap **Side Quest** produces a **Contribution** and, when the **Profile** walked near (or is inside **Venue** bounds for camping / add-**Place**, or inside bounds and off the mapped walkable layer for **path**), awards **XP** onto that **Profile**
- Completing a live **Side Quest** produces a **Ride report** (name-first); it is not a **Contribution**; **XP** for a live report needs a **Profile** and lands on that **Profile**
- Completing a **Side Quest** may also award a **Skin** rung on the **Profile** (unlock, then share on that same **Skin**) and may leave a **Mark** at the **Place**
- A **Profile** may own zero or more **Skins**; **Unlock** / share / **Offer** require a **Profile**
- A **Profile** may own zero or more **Kits**; equipping a **Kit** is what other **Members** see on that person
- **Host** does not gate **Skins** or **Kits** — the **Profile** that earned a **Skin** is the only one who can **Offer** it
- A **Party** may have zero or more **Offers** at once; a device-holding **Member** **Wears** one look at a time
- **Wear** of an offered **Skin** lasts only while that owning **Profile** is a **Member**; withdrawing the **Offer** ends that **Wear** the same way
- A stranger may finish a **Gap** another **Profile** started; that is still a **Side Quest**, not a meeting
- A **Profile** may send **Thanks** on a **Contribution**, **Observation**, or **Mark** they used; **Thanks** is evidence and impact, not chat
- **Marks** are world objects, not live people — strangers never see another **Party**’s **Location** or **Kit**
- Device-less **Members** have no map and no **Wear**
- A gap **Side Quest** requires proximity to the **Place**; a live **Side Quest** requires walking near enough to have seen it (not queue-pin GPS); a **path** **Side Quest** requires walking where the map has no walkway yet
- A **Contribution** appears on this phone’s **Overlay** immediately; this phone’s map draws **Overlay**, not the upload queue; a **Party** is not required
- **Overlay** draws every Field Research kind (height, queue, path, restroom, food, gate, camping); live **Ride reports** are not **Overlay**
- Joining or hosting unions authored **Overlay** with **Members** by **Place** + type; it does not replace the Party’s whole **Overlay** the way a non-empty **Plan** refuses a draft
- For one **Place** + type, the latest **Contribution** is what is drawn; earlier claims stay as evidence, not a second pin
- The **Party** sees **Side Quest** completions (who, which **Place**, what they marked) even when that completion is not the drawn **Overlay** fact and even when it is not a **Contribution** (live **Ride report**; last-write overwrite). That visibility is **Party**-scoped, not park-wide, and not a fourth entity named Action
- Place detail is where **Members** see those completions for that **Place**; the **Side Quests** tab shows this phone’s own completions; the **Overlay** pin stays one fact — not a chat feed, not a second pin, not 2-vs-1 on the map
- In a **Party**, the **Host** applies that last write so every **Member** draws the same **Overlay**; solo, this phone is the only replica until join
- Same-**Party** overwrite is not the second independent **Party**
- Leave drops **Overlay** you only saw because you were in that **Party**; **Contributions** you authored stay on this phone
- Park-wide **Overlay** needs a second independent **Party** that walked near
- Confirm / deny of an **Overlay** claim are statistical (no public counts, names, or percent) and are park-wide — not this ticket. Place detail lists completions; in-party disagreement is last-write, not a vote
- **XP** and **Title** are **Profile** fields; **XP** is never spent; the **Title** is the visible sub-name when a threshold is crossed
- **Skin** and **Kit** are earned the same way as **Titles** — never bought with **XP**. A **Skin** restyles this phone’s **Venue** map. A **Kit** draws on that **Member**’s **Location** pin for the **Party**
- Repeat of the same (`venue`, `type`, `target`) by the same **Profile** awards 0 **XP**
- A **Ride report** appears on this phone immediately; a **Party** is not required; if you are already a **Member**, the **Party** sees it immediately; if you join later, **Members** see it then; it is not a **Contribution**
- A **Ride report** may optionally fan out into an **Observation**; an **Observation** is not a **Contribution**
- Park-wide **Observation** requires a **Profile** plus a second independent **Party** that walked near; same-**Party** taps stay in-party; contradict is first-class
- **Eligibility** is computed per person × **Attraction**; it is not stored as party truth
- Map / list / glance Eligibility is the most restrictive **Member** in this phone’s set: matching **Subgroup** tags (including device-less), or the whole **Party** if this phone is untagged. Untagged device-less **Members** are not in a tagged phone’s set
- Place detail Eligibility lists each **Member** in that same set, with reasons
- Leaving someone at the **Meet** changes **Subgroup** / set membership; it does not clear **With adult**
- **Companion** is an **Eligibility** verdict, not a person or a **Member** flag
- **Weather** is **Venue**-day context (now + hourly forecast for the day, used to predict ride data); it is not a **Ride report**

## Example dialogue

> **Dev:** "Does joining with an **Invite** require a **Profile**?"
> **Domain expert:** "No — name is enough. Opening the **Invite** does not finish until **Location** is on, and we recheck whether a better phone should be **Host**. You never see a **Host** — the best phone just has it."
>
> **Dev:** "Can I pause sharing so the party doesn't see me?"
> **Domain expert:** "No — **Location** is how the **Party** knows where you are, not a hide. You see the live position; 'Dad · Orion' only when he's in that queue or at the station, not when he walks the midway past it. Never two **Places** — if the restroom sits on the queue, say Orion, the name a person would use. Two rides of equal fame: the queue or station his body is in. Mom and Grandma see the same name — he does not check in, and phones do not each guess. Leave the bounds or lose the sensor and live updates stop; the **Party** still sees last known location of Dad at Orion, marked stale. If iOS kills Location later, you're still in the **Party**, we wall on turning it back on, and they still see that."
>
> **Dev:** "If someone marks Diamondback down, is that a **Contribution**?"
> **Domain expert:** "No — that's a **Ride report**, trusted on this phone immediately, name-first. Walk near, see it, mark it — you don't have to stand in the queue, and you don't need a **Party**. Other families only see it as an **Observation** after a second **Party** walks by. Your own clump tapping again does not count. A **Contribution** is something we'd keep and feed back into the builder."
>
> **Dev:** "Mia has no phone — how does the party know she's 40 inches?"
> **Domain expert:** "Add Mia as a device-less **Member** with height. Prefer saving her as a **Managed Guest** on a parent's **Profile** so next visit she can be re-added. If her height is old, prompt that she may have grown — skip keeps last inches. If Grandma takes her home, remove her from the roster; that does not delete the **Managed Guest**."
>
> **Dev:** "Is 'can ride Orion' a **Contribution** or party state?"
> **Domain expert:** "Neither — that's **Eligibility**, computed from Mia's height and **With adult**. If the ride needs a grown-up, the verdict is **Companion**."
>
> **Dev:** "Whose Eligibility does the map show — mine or the whole family?"
> **Domain expert:** "The toughest person with you on this phone. Untagged phone → whole **Party**. Tagged phone → matching tags only — tag Mia onto your clump when you split, or she won't constrain your map. Unset height means they're not worried. Phones decide; phoneless kids are limiters, not app users."
>
> **Dev:** "I left Mia at the **Meet** — do I flip **With adult** off?"
> **Domain expert:** "No — take her out of your **Subgroup**. If she's riding unattended she doesn't need the app. **With adult** stays the dumb default (accompanied) unless a phone person is truly alone."
>
> **Dev:** "If we mark a restroom closed, do other families see it right away?"
> **Domain expert:** "Our **Party** does — it's on our **Overlay**. Other visitors wait for a second independent **Party** that walked near — same bar as a park-wide **Observation**. A ride going down is time-sensitive, but that's a **Ride report**, not an **Overlay** fact."
>
> **Dev:** "I confirmed the height sign before anyone joined. Does **Overlay** wait for a **Party**?"
> **Domain expert:** "No — it's on this phone's map now. A **Party** is not required. When you join, the family sees those facts immediately (union by **Place** + type, not a **Plan**-style replace-the-list). If you leave, you keep what you authored; you lose **Overlay** you only saw because you were in their **Party**."
>
> **Dev:** "Sam marked Diamondback down before anyone joined — name only, no **Profile**. Who sees it?"
> **Domain expert:** "Sam does, on his map. A **Party** is not required. When he joins, **Members** see the **Ride report**. Other families never see it until a **Profile** plus a second independent **Party** walk near — that's an **Observation**."
>
> **Dev:** "Sam is already in our **Party**, name only. He marks Diamondback down. Do I see it?"
> **Domain expert:** "Yes — Dad's map goes down, Grandma's too. Same-**Party** taps are not a second **Party**. Other families still wait for a **Profile** plus that second **Party**."
>
> **Dev:** "Is the pending Side Quest queue what the map draws?"
> **Domain expert:** "No. This phone's map draws **Overlay**. Completing a gap quest writes **Overlay** and may also enqueue upload. The queue is the adapter, not the layer."
>
> **Dev:** "Dad pinned Orion at 48 inches, then Mom pinned 42. Two heights?"
> **Domain expert:** "One pin. The map draws the latest **Contribution** — 42. The **Host** applies it, so Dad and Grandma see 42 together. Open Orion: place detail still lists Dad confirmed 48 and Mom confirmed 42. The **Side Quests** tab shows your own completions. Not a chat feed, not a second pin, not 2 vs 1 on the map. Their clump tapping again is not the second **Party**."
>
> **Dev:** "If I only pin a restroom, does Overlay wait for a height sign?"
> **Domain expert:** "No. Every Field Research kind draws. Height on the ride, queue pin, path you walked, restroom / food / gate you named, camping hookups. Ride up or down is still a **Ride report**, not Overlay."
>
> **Dev:** "Is 'Ride up or down?' a **Contribution**?"
> **Domain expert:** "It's a live **Side Quest**. Completing it is a **Ride report** — no **Profile** needed, and a **Party** is not required; it is on this phone now. A height-sign **Side Quest** is the other kind — that one _is_ a **Contribution**, it stays Profile-gated, and it may leave a **Mark** at the ride. Think Pokémon GO for the walk-up missions, Waze for the live reports, Death Stranding for the thing you leave for the next family — same tab."
>
> **Dev:** "Can the phone invent a height **Side Quest** from rides that lack `h`?"
> **Domain expert:** "No. The builder ships **Gaps**. If `gaps.json` is missing, the durable list is empty. Live **Side Quests** while you walk still exist."
>
> **Dev:** "Do I see +25 XP on the restroom card?"
> **Domain expert:** "No. The card says help other guests. **XP** lands on your **Profile**; **Scout** is the **Title** you see under your name. Same (`venue`, type, **Place**) again is 0 — no farming."
>
> **Dev:** "Can Mia on the roster earn Scout without signing in?"
> **Domain expert:** "No. **XP** is tied to the **Profile**, not the **Member**. A name on the roster is not a ledger. A **Ride report** can still go out by display name; that report earns **XP** only after a **Profile** is attached."
>
> **Dev:** "When I hit 50 XP, do I level up to level 2?"
> **Domain expert:** "You earn a **Title** — a sub-name on the **Profile**. Alice stays Alice; now **Scout** sits under the name. Not a roster rename, not a **Member** field."
>
> **Dev:** "Do we spend XP on a Quicksilver shop?"
> **Domain expert:** "Never. **Skins** and **Kits** land the same way **Titles** do — earned on the **Profile**. The **Skin** is your map; the **Kit** is your pin on the **Location** map the **Party** watches. Not a HUD quest marker."
>
> **Dev:** "Can I pick Coaster when I'm finding restrooms?"
> **Domain expert:** "Not on that card. Restroom, food, and gate only. Creating any ontology type is a later **Cartographer** loop, not this Field Research card."
>
> **Dev:** "If we star Diamondback at breakfast, is that a **Meet**?"
> **Domain expert:** "No — that's the **Plan**. Star the **Places**, drag them into the day's order. A **Meet** is where we regroup. Tapping a stop walks _there_, not a chained multi-stop route."
>
> **Dev:** "Is the breakfast list on this phone a Scenario, or a second Plan?"
> **Domain expert:** "It's the **Plan** — a draft until you join or resume. If the **Party** already has stops, don't overwrite them. Leave does not bring the draft back. Favorites on a **Member** are personal stars, not today's order."
>
> **Dev:** "It's supposed to storm at 3 — is Diamondback down?"
> **Domain expert:** "That's **Weather** — hourly forecast feeding a prediction. We don't mark the ride down until someone files a **Ride report**."
>
> **Dev:** "Mia finishes a height-sign **Side Quest** and the map goes RCT — is that a **Contribution**?"
> **Domain expert:** "The height is the **Contribution**. RCT is her **Skin** — paint, not park truth. Until she earns share on that **Skin**, only her phone **Wears** it. Then she can **Offer** it; Sam's map does not change unless he accepts, and he loses it when she leaves the **Party**."

## Soft gate

- Browse map / pick **Venue**: no **Profile** required (free without a **Profile**)
- Join or host a **Party**: display name enough; **Profile** optional (attach later); **Location** required to finish join
- Save **Managed Guests** (name/height for next visit): **Profile** required
- Gap **Side Quest** / **Contribution** submit: **Profile** required; this phone’s **Overlay** does not need a **Party**; without a **Profile**, stash locally until sign-in (do not discard on dismissed OAuth)
- **Ride report**: display name enough; this phone’s map does not need a **Party**
- Park-wide **Observation** / **Overlay**: **Profile** required, plus a second independent **Party**
- **Thanks** / leaving a **Mark**: **Profile** required
- **Skin** unlock / share / **Offer**: **Profile** required; **Wear** of an **Offer** does not
- **Plan** personalization / sync across days: **Profile** required; building a **Plan** inside a **Party** does not
- Paid unlock: **Profile** only — not **Member**, not “user”, not a second product name for the same identity

## Flagged ambiguities

- "Party Tracker" appears in package names (`@party-tracker/*`) and some docs titles — resolved: engineering label only; domain talk uses **Park Bound**.
- "park" vs "venue" — resolved: domain term is **Venue**; "park" is colloquial UI only.
- Host vs Owner/Adult/Child/Guest — resolved: **Host** is invisible mesh authority only; “best phone” is automatic fitness (battery, signal, network, performance), rechecked on **Invite**/join, on failover, and continuously with a margin so it does not flap. Do **not** add Owner/Adult/Child/Guest as party roles — device-less **Member**, **Managed Guest**, and **With adult** cover the family.
- Code role `member` (non-host) vs domain **Member** — resolved: domain **Member** always means roster person; includes Host.
- ADR-0001 soft-gates party behind **Profile** — resolved: party is name-first; ADR-0001 and EP.3/EP.5 revised 2026-08-12. Gap **Side Quests** / **Contributions** remain Profile-gated with local stash until sign-in. **Ride reports** are name-first and do not need a **Party**; park-wide **Observation** / **Overlay** need a **Profile** plus a second independent **Party**.
- Auth provider — resolved 2026-08-14: **Clerk** (Google + Apple only) per ADR-0010; supersedes Auth.js ADR-0001. Native OAuth in Capacitor store shell; Postgres **Profile** row minted on sign-in callback, not webhook-only.
- Paid identity — resolved 2026-08-14: download is free; the paid unlock is a **Profile** (not **Member**, not “user”, not a second product name for the same identity). Name-only **Members** / browse / Party stay free. Price and store SKUs live outside this glossary.
- "submember" / kids without phones / height on Member or Subgroup — **resolved**: kids without phones are device-less **Members** with height on the roster (family product; shared party visibility OK). Device-holding **Members** may tag them, set height / **With adult**, and remove them from the roster (does not delete the **Managed Guest**). Durable save lives as **Managed Guest** under a **Profile** only (no anonymous guest DB). Stale height prompts at seed; skip keeps last inches. Height is not a **Subgroup** property. Contradicts park-intelligence “heights not on the wire” — accepted trade-off for family use.
- Code `eligibility()` returns `unknown` when inches is null — **resolved**: unset height means not height-constrained (can ride anything), not an unknown verdict. Adults who never set height do not fade the map. A child added with no height also does not constrain the group until someone enters one.
- Code `withAdult` global toggle vs per-person accompaniment — **resolved**: domain fact is per-**Member** **With adult**; unset means accompanied for every **Member**; explicit false is rare on a device-holding **Member**. No map-wide “alone” clump switch — leave the **Meet** via **Subgroup**. **Companion** is only the Eligibility verdict.
- Map Eligibility vs one global height — **resolved**: map / list / glance show the most restrictive **Member** in this phone’s set (matching **Subgroup** tags including device-less, or whole **Party** if this phone is untagged). Untagged device-less do not shadow a tagged phone. Place detail lists each **Member** in that set. Device-holding **Members** are the decision makers; device-less are limiters only. Not an “active rider” picker. Height / **With adult** / tag / remove are phone-driven; the local guest-chip store is not a second roster. **Managed Guests** do not constrain the map until seeded as device-less **Members**.
- Overlay vs Side Quest queue — resolved: this phone’s map draws **Overlay**, not the upload queue. Completing a gap **Side Quest** writes **Overlay** immediately and may also enqueue upload (local adapter today; HTTP is the second). Strangers still wait for park-wide **Overlay**.
- Overlay kinds this ticket — resolved: every Field Research kind draws (height, queue, path, restroom, food, gate, camping). Live **Ride reports** stay ride status, not **Overlay**.
- Confirm / deny this ticket — resolved: no. Place detail lists who marked what. In-party disagreement is last-write. Confirm / deny stay park-wide **Overlay** evidence (statistical, no public counts) for a later ticket.
- Party sees completions vs **Contribution** — resolved: the **Party** sees **Side Quest** completions (who / which **Place** / what they marked) independent of which **Contribution** is drawn and independent of whether the completion is a **Contribution** at all (live **Ride report**). No **Action** term. Surface is place detail for that **Place**; **Side Quests** tab for this phone’s own. Overlay pin stays one fact — not a chat feed, not a second pin, not public confirm counts. This ticket’s audience is the **Party** (and this phone); park-wide strangers still wait.
- Party-local vs park-wide map edits — resolved: **Overlay** is immediately true on this phone (a **Party** is not required) and to **Members** once you join or host (union by **Place** + type). For one **Place** + type, the latest **Contribution** is drawn; the **Host** applies that last write so every **Member** draws the same fact (solo, this phone is the replica). Earlier claims stay as evidence; same-**Party** overwrite is not the second independent **Party**. Leave drops **Overlay** you only saw via that **Party**; authored **Contributions** stay. Park-wide **Overlay** uses the same bar as **Observation** — a second independent **Party** that walked near. Same-**Party** taps stay in-party. Ride-down: this phone trusts the **Ride report** immediately (walk near, see it, mark it — not queue-pin GPS; a **Party** is not required); if you are already a **Member**, the **Party** sees it immediately; if you join later, **Members** see it then; park-wide needs a **Profile** plus that second **Party**, short TTL, easy contradict, reputation for spam on the **Profile**.
- Adventure vs Contribution — resolved: product name is **Side Quest**; enjoyment and map improvement are one loop (Pokémon GO + Waze + Death Stranding). **Gaps** seed gap quests → **Contribution** (+ optional **Mark**; Profile-gated, at-the-**Place**); live quests → **Ride report** (name-first, nearby enough to have seen it) / **Observation** (park-wide). `_Avoid_: Adventure`.
- Who invents **Gaps** — resolved: the builder, once, into `*.gaps.json`. The phone ranks by **Location** and does not invent durable **Gaps** from POI heuristics. Missing/empty file → empty durable list, not a failed **Venue** load.
- **XP** vs leaderboard — resolved: **XP** grants **Title** rewards (sub-names on the **Profile**: Scout, Ranger, Cartographer, Steward). Visitor has no **Title** yet. **XP** and **Title** live on the **Profile** only (not **Member**, **Party**, or anonymous phone). No all-time global leaderboard this ship. Cards stay meaning-first; earning a **Title** may toast.
- Cosmetic rewards — resolved: **Skin** (this **Profile**’s map paint) and **Kit** (cosmetic on the **Location** pin the **Party** watches) earn the same way as **Titles**: **XP** is never spent. Not a Quicksilver shop, not a HUD quest pin, not phone-invented geometry. Accessibility still needs shape + colour + glyph redundancy.
- Death Stranding in this product — resolved: keep structures (**Mark**), gratitude (**Thanks**), finishing someone else’s **Gap**, and unused **Marks** fading. **Contributions** stay until contradicted. Do not import live stranger ghosts, chiral network naming, or cargo as a second roster. **Location** stays **Party**-only.
- Map cosmetics vs park truth — resolved: **Skin** is **Profile**-owned paint (Side Quest prize; private unlock then share). **Wear** / **Offer** are Party-live and not a copy. Trail / Park Midnight stay the always-on palettes, not **Skins**. **Host** does not gate cosmetics.
- GPS cosmetics vs map paint — resolved: **Kit** is how this **Member** appears (puck, trail, **Meet** they placed). The **Party** sees the equipped **Kit** with no **Offer**. **Offer** is **Skin**-only. Strangers do not see **Kits**.
- Collaborative world — resolved: the **Venue** keeps **Marks** at **Places** (stickers, lanterns, chalk). Same gate as **Overlay**: this phone immediately, **Members** on join, park-wide after a second independent **Party**. Not a dumped **Skin**. Not live GPS of other families.
- Field Research vs Create (Q13) — resolved: this ship is Field Research chips (height / queue / path / restroom / food / gate / camping). Full-ontology Create is a later **Cartographer** / Wayfarer loop, not an “Other…” on Find-the-restrooms.
- Plan vs next-best card vs personal favorites — resolved: **Plan** is a party-shared, drag-ordered list of starred **Places** (pre-arrival OK). The pre-party list is a draft of that same **Plan**, not a Scenario and not a second term. Promote on create, join, or resume only when the shared **Plan** is empty; then clear the draft. Leave does not resurrect it. Not multi-stop nav. Any device-holding **Member** may edit; **Host** applies last write. Per-**Member** favorites in code are not the **Plan**. **Member** target remains “heading there now.”
- Location pause / history — resolved: **Location** is **Party** situational awareness, not a hide. No pause; no deliberate blur to spare the roster. Live position plus **Place** name only when they are at that **Place** (**Attraction** queue or station; restroom / food at the **Place**) — not nearest while walking past. Never two **Place** names; on conflict, the most recognizable **Place** to a person; two equal **Attractions** use the slot he is standing in. Not “most likely,” “probably,” or “near” on the roster. One **Party** truth: **Location** plus **Venue** slots, and the **Place** travels with **Location** — not a check-in, not each phone guessing. The phone updates the **Venue** at app start when a connection is available. Join does not finish without **Location**. Live **Location** only inside **Venue** bounds. When live stops (outside bounds or OS revoke), last-known + trail stay visible to the **Party** and are marked stale — last known location of that **Member** at that **Place** when they were at one; not wiped. Trail is path dots only; **Place** name only on the live or last-known pin. OS revoke after join: stay a **Member**, wall to turn it back on — not an eject. Battery visible; IMU not shared; signal/network are **Host** election only. Contradicts park-intelligence “never keep location history” — accepted for family trail dots.
- Databricks vs Vercel Postgres vs App vs offline-first — resolved 2026-08-14: phones stay offline-first on precached venue JSON; **Vercel + Neon Postgres** is E0 OLTP; **Databricks serverless jobs + Delta** is batch back-office only (ingest, traces, sidecar export); **Node consolidate + venue builder** still graduates shipped map truth. **No Databricks App deploy** and **paused job schedules** pre-launch ($0). Lakebase deferred until App/steward UI or explicit Postgres-host move. Do not relitigate — see `docs/adr/0010-databricks-ops-free-tier.md`.
