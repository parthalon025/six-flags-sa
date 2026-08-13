# Park Bound

Community-powered, exploration-first digital twin of theme parks and other venues: live party coordination, park-native navigation, and a living map that improves through **Side Quests**.

## Language

**Park Bound**:
The product. User-facing and domain name for this system.
_Avoid_: Party Tracker (legacy engineering / package label only)

**Venue**:
One shippable place with its own map and POI contract (theme park, water park, campground, etc.).
_Avoid_: Park (as a second entity type — OK as colloquial UI copy when the Venue is a theme park)

**Party**:
A live group coordinating at a **Venue** — shared roster, presence, meet point, and in-party ride reports. Not a chat room or a saved trip plan.
_Avoid_: Session, room, lobby

**Host**:
The phone that holds the authoritative **Party** state (mesh authority). Should be the best phone to run it (battery, signal, network, performance). Rechecked when a **Member** is added, and on failover.
_Avoid_: Owner, Adult (family labels — not how Host is chosen)

**Member**:
Anyone on the live **Party** roster (including the **Host**). Roster presence, not account identity. May carry only a display name until a **Profile** is attached. May be device-less (e.g. a child without a phone, created by a parent). May carry **height** for eligibility. Unset height means they are not height-constrained — they can do any **Attraction** as far as height goes.
_Avoid_: User (for roster presence); submember (use device-less **Member**); Child / Guest (as party roles)

**Profile**:
A durable signed-in Park Bound identity (prefs, progress, attribution). A **Member** may bind to a **Profile** at join or later. May save family people (names, heights) so they need not be re-entered each visit.
_Avoid_: User (prefer **Profile** for the product-facing person; `user_id` stays an implementation id)

**Managed Guest**:
A saved person under a **Profile** (typically a child) — name, height, and when height was last confirmed — used to seed device-less **Members** and eligibility without a login. Saving requires a **Profile** (no anonymous durable guest store).
_Avoid_: Member (until they are on a live **Party** roster); Subgroup

**Contribution**:
The durable result of completing a **Side Quest** — a Profile-attributed update that improves shared park truth. Feeds **Overlay** and can graduate into builder inputs for the persistent **Venue** map. Enjoyment and map improvement are the same loop, not two products.
_Avoid_: Adventure (legacy spec name); Ride report (ephemeral ops)

**Side Quest**:
An on-the-ground mission to settle a fact only a visitor can confirm — Pokémon GO-style go-to-the-spot play plus Waze-style live reports, as one loop. Seeded from **Gaps** and from always-on live asks. Gap quests require being near the **Place**; live quests require being nearby enough to have seen it. Completing a gap quest produces a **Contribution**; completing a live quest produces a **Ride report** (and maybe a park-wide **Observation** after evidence).
_Avoid_: Adventure; quest (generic); Contribution (the durable payload, not the mission)

**Gap**:
A missing or unconfirmed fact on a **Venue** that open sources / the builder cannot settle (no height, no queue entrance, …). **Gaps** seed **Side Quests**.
_Avoid_: Bug, missing POI (too vague); Contribution (the answer, not the hole)

**Ride report**:
An ephemeral, **Party**-scoped signal about a ride’s live ops (e.g. open/down). Visible to **Members** immediately, expires with the party day, never consolidates into shipped venue JSON. Park-wide fan-out is an **Observation**, not automatic.
_Avoid_: Contribution, chat message (it is ops presence for the party, not a messenger thread)

**Observation**:
A Profile-attributed, append-only live signal (wait, status, freshness) that may outlive a **Party** but never rebuilds venue JSON. Optional fan-out from a **Ride report**. Park-wide “down” needs a second independent **Party** or a nearby confirm; one report never hides an **Attraction** from strangers. Short TTL; easy contradict; repeat false reports cost reputation.
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
A soft partition tag on a **Member** within one **Party** (not a nested party or separate roster). Device-holding **Members** choose their own tag; they may also tag device-less **Members** onto a clump. Split the family by tag, then rejoin at the one **Meet**.
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
The phone’s pending/accepted **Contribution** layer drawn on the shipped **Venue** map. True immediately to the submitting **Party**; other visitors see it only after evidence (peer confirm / trust). Not party roster state and not persistent map until consolidate graduates it into builder inputs.
_Avoid_: Ride report (ops chatter); Observation (live series, not map structure)

**Plan**:
The **Party**’s shared, ordered list of **Places** they intend to visit today. Star/pin before the gates; drag-and-drop to set order. Shared with all **Members**. Not multi-stop navigation — walking a stop is ordinary single-destination nav. Not a **Side Quest** and not a saved vacation file.
_Avoid_: Scenario (engineering name for a local draft); itinerary (travel-agent language); favorite (personal Member stars in code — not the shared Plan)

**Invite**:
How a person becomes a **Member** of a **Party** — a shareable join link or code. Not an account, not a **Profile**, not a ticket. Name-only is enough; a **Profile** may attach later. Joining triggers a **Host** fitness recheck. Accepting an **Invite** on a device means **Location** is shared with the **Party** while inside the **Venue**.
_Avoid_: Login, calendar invite, ticket

**Location**:
A device-holding **Member**’s position for the **Party**. Mandatory (no pause). Only live inside **Venue** bounds; last-known and a trail of dots are visible to all **Members**. Device-less **Members** have no **Location**. Party-scoped — not a **Contribution**. Battery (and charging) is visible to the **Party** because **Host** fitness needs it; IMU / raw movement is not shared.
_Avoid_: GPS (implementation); pause/share-off (not in this product)

**Weather**:
**Venue**-day context: current conditions plus an hourly forecast for that day, used to predict ride data (holds, likely closures). Not party state and not a **Contribution**. Predictions inform a **Plan**; they do not mark an **Attraction** down — that is a **Ride report**.
_Avoid_: Ride report; Observation (those are on-the-ground signals)

## Relationships

- **Park Bound** ships one or more **Venues**
- A **Party** coordinates at one active **Venue** at a time
- A **Party** has exactly one **Host** at a time
- An **Invite** admits a person as a **Member**; joining rechecks whether the **Host** is still the best phone
- A device-holding **Member** always shares **Location** with the **Party** while inside the **Venue**; there is no pause
- Outside **Venue** bounds, live **Location** stops; last-known and in-bounds trail remain visible to the **Party**
- Device-less **Members** have no **Location**
- Battery (and charging) is visible to the **Party**; IMU is not; radio scores stay **Host** election internals
- A **Party** has one or more **Members**; the **Host** is one of them
- A **Member** optionally binds to one **Profile**; an unbound **Member** is identified by display name until attached
- A **Member** may carry zero or one **Subgroup** tag
- A **Member** may carry a **height**; unset height means not height-constrained. Device-less **Members** are valid roster seats
- A **Member** may carry **With adult** (unset means accompanied for every **Member**)
- Device-holding **Members** are the app’s decision makers — they set **Subgroup** tags (including on device-less **Members**), height, and **With adult**; device-less **Members** do not decide via the app
- A **Profile** may own zero or more **Managed Guests**; a **Managed Guest** can seed a device-less **Member**
- A **Managed Guest** does not constrain map / list / glance Eligibility until seeded as a device-less **Member**
- A **Venue** contains many **Places**; some **Places** are **Attractions**
- A **Party** has zero or one **Meet**
- A **Party** has zero or one **Plan** for the active **Venue**; a **Plan** is shared with all **Members**
- A **Plan** may be built before arriving at the **Venue**
- Any device-holding **Member** may star, unstar, or reorder the **Plan**; the **Host** applies it (last write wins)
- A **Contribution** requires a **Profile** and targets a **Venue** (and usually a **Place** within it)
- A **Venue** has zero or more **Gaps**; **Gaps** seed **Side Quests**
- Completing a gap **Side Quest** produces a **Contribution**
- Completing a live **Side Quest** produces a **Ride report** (and maybe an **Observation**); it is not a **Contribution**
- A gap **Side Quest** requires proximity to the **Place**; a live **Side Quest** requires being nearby enough to have seen it
- A **Contribution** appears on the submitting **Party**’s **Overlay** immediately; park-wide **Overlay** needs evidence
- A **Ride report** belongs to a **Party** and refers to an **Attraction**; it is not a **Contribution**
- A **Ride report** may optionally fan out into an **Observation**; an **Observation** is not a **Contribution**
- Park-wide **Observation** of ride-down requires a **Profile** plus a second independent **Party** or nearby confirm; contradict is first-class
- **Eligibility** is computed per person × **Attraction**; it is not stored as party truth
- Map / list / glance Eligibility is the most restrictive **Member** in this phone’s set: matching **Subgroup** tags (including device-less), or the whole **Party** if this phone is untagged. Untagged device-less **Members** are not in a tagged phone’s set
- Place detail Eligibility lists each **Member** in that same set, with reasons
- Leaving someone at the **Meet** changes **Subgroup** / set membership; it does not clear **With adult**
- **Companion** is an **Eligibility** verdict, not a person or a **Member** flag
- **Weather** is **Venue**-day context (now + hourly forecast for the day, used to predict ride data); it is not a **Ride report**

## Example dialogue

> **Dev:** "Does joining with an **Invite** require a **Profile**?"
> **Domain expert:** "No — name is enough. Opening the **Invite** makes you a **Member**, and we recheck whether a better phone should be **Host**."
>
> **Dev:** "Can I pause sharing so the party doesn't see me?"
> **Domain expert:** "No — a device **Member** always shares **Location** in the **Venue**. Leave the bounds and live updates stop; last-known and the trail stay for the **Party**."
>
> **Dev:** "If someone marks Diamondback down, is that a **Contribution**?"
> **Domain expert:** "No — that's a **Ride report** for the **Party**, trusted immediately. Other families only see it as an **Observation** after a second party or a nearby confirm. A **Contribution** is something we'd keep and feed back into the builder."
>
> **Dev:** "Mia has no phone — how does the party know she's 40 inches?"
> **Domain expert:** "Add Mia as a device-less **Member** with height. Prefer saving her as a **Managed Guest** on a parent's **Profile** so next visit she can be re-added. If her height is old, prompt that she may have grown."
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
> **Domain expert:** "Our **Party** does — it's on our **Overlay**. Other visitors wait for evidence. A ride going down is time-sensitive, but that's a **Ride report**, not an **Overlay** fact."
>
> **Dev:** "Is 'Ride up or down?' a **Contribution**?"
> **Domain expert:** "It's a live **Side Quest**. Completing it is a **Ride report** for the **Party**. A height-sign **Side Quest** is the other kind — that one _is_ a **Contribution**. Think Pokémon GO for the walk-up missions, Waze for the live reports — same tab."
>
> **Dev:** "If we star Diamondback at breakfast, is that a **Meet**?"
> **Domain expert:** "No — that's the **Plan**. Star the **Places**, drag them into the day's order. A **Meet** is where we regroup. Tapping a stop walks _there_, not a chained multi-stop route."
>
> **Dev:** "It's supposed to storm at 3 — is Diamondback down?"
> **Domain expert:** "That's **Weather** — hourly forecast feeding a prediction. We don't mark the ride down until someone files a **Ride report**."

## Soft gate

- Browse map / pick **Venue**: no **Profile** required
- Join or host a **Party**: display name enough; **Profile** optional (attach later)
- Save **Managed Guests** (name/height for next visit): **Profile** required
- **Contributions** / **Side Quest** submit: **Profile** required
- **Plan** personalization / sync across days: **Profile** required; building a **Plan** inside a **Party** does not

## Flagged ambiguities

- "Party Tracker" appears in package names (`@party-tracker/*`) and some docs titles — resolved: engineering label only; domain talk uses **Park Bound**.
- "park" vs "venue" — resolved: domain term is **Venue**; "park" is colloquial UI only.
- Host vs Owner/Adult/Child/Guest — resolved: **Host** is mesh authority only; “best phone” is automatic fitness (battery, signal, network, performance), rechecked on **Invite**/join and on failover. Do **not** add Owner/Adult/Child/Guest as party roles — device-less **Member**, **Managed Guest**, and **With adult** cover the family.
- Code role `member` (non-host) vs domain **Member** — resolved: domain **Member** always means roster person; includes Host.
- ADR-0001 soft-gates party behind **Profile** — resolved: party is name-first; ADR-0001 and EP.3/EP.5 revised 2026-08-12. **Side Quests** remain Profile-gated.
- "submember" / kids without phones / height on Member or Subgroup — **resolved**: kids without phones are device-less **Members** with height on the roster (family product; shared party visibility OK). Durable save lives as **Managed Guest** under a **Profile** only (no anonymous guest DB), with a growth/reconfirm prompt when height is stale. Height is not a **Subgroup** property. Contradicts park-intelligence “heights not on the wire” — accepted trade-off for family use.
- Code `eligibility()` returns `unknown` when inches is null — **resolved**: unset height means not height-constrained (can ride anything), not an unknown verdict. Adults who never set height do not fade the map. A child added with no height also does not constrain the group until someone enters one.
- Code `withAdult` global toggle vs per-person accompaniment — **resolved**: domain fact is per-**Member** **With adult**; unset means accompanied for every **Member**; explicit false is rare on a device-holding **Member**. No map-wide “alone” clump switch — leave the **Meet** via **Subgroup**. **Companion** is only the Eligibility verdict.
- Map Eligibility vs one global height — **resolved**: map / list / glance show the most restrictive **Member** in this phone’s set (matching **Subgroup** tags including device-less, or whole **Party** if this phone is untagged). Untagged device-less do not shadow a tagged phone. Place detail lists each **Member** in that set. Device-holding **Members** are the decision makers; device-less are limiters only. Not an “active rider” picker. Height / **With adult** edits are phone-driven; the local guest-chip store is not a second roster. **Managed Guests** do not constrain the map until seeded as device-less **Members**.
- Party-local vs park-wide map edits — resolved: **Overlay** is immediately true to the submitting **Party**; park-wide needs evidence. Ride-down: **Party** trusts the **Ride report** immediately; park-wide **Observation** needs a second independent **Party** or nearby confirm, short TTL, easy contradict, reputation for spam.
- Adventure vs Contribution — resolved: product name is **Side Quest**; enjoyment and map improvement are one loop (Pokémon GO + Waze). **Gaps** seed gap quests → **Contribution**; live quests → **Ride report** / **Observation**. Gap quests are at-the-**Place**; live quests are nearby-enough. `_Avoid_: Adventure`.
- Plan vs next-best card vs personal favorites — resolved: **Plan** is a party-shared, drag-ordered list of starred **Places** (pre-arrival OK). Not multi-stop nav. Any device-holding **Member** may edit; **Host** applies last write. Per-**Member** favorites in code are not the **Plan**. **Member** target remains “heading there now.”
- Location pause / history — resolved: no pause for device-holding **Members**. Live **Location** only inside **Venue** bounds; last-known + trail visible to the **Party**. Battery visible; IMU not shared; signal/network are **Host** election only. Contradicts park-intelligence “never keep location history” — accepted for family trail dots.
