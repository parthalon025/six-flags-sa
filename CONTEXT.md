# Park Bound

Community-powered, exploration-first digital twin of theme parks and other venues: live **Party** coordination, park-native navigation, and a living map that improves through **Side Quests** — go to the spot (Pokémon GO), report what you see (Waze), leave something the next family can use (Death Stranding).

Vocabulary for agents and product talk. Trade-offs live in [`docs/adr/`](docs/adr/). Builder files still say `venue`; UI and this glossary say **World**.

## Language

### Product

**Parkbound**:
The in-product name. **Park Bound: Explore** is the store title.
_Avoid_: Party Tracker (package label only)

**World**:
One park-scale map a visitor explores (theme park, water park, campground). A **Party** shares one current World, updated when a connection is available.
_Avoid_: Venue in product talk (builder/file term only); Park is a colloquial World

**Zone**:
A named area inside a **World**, shown only where an OSM land polygon exists. A **Place** may sit in a Zone; otherwise it stays in the World.
_Avoid_: inventing fallback Zones; treating Zone as a required hierarchy

**Place**:
A named thing on a **World** map (ride, show, restroom, food, …). May sit in a mapped **Zone**.
_Avoid_: POI (file label for `*.pois.json` only)

**Attraction**:
A **Place** you ride or experience, with slots (queue, station, exit) — not a single pin.
_Avoid_: Ride as the umbrella type (ride is a category of Attraction)

### Party

**Party**:
A live group in one **World** — roster, **Location**, **Rally Point**, **Plan**, and in-Party **Ride reports**. Not a chat room or a saved trip.
_Avoid_: Session, room, lobby

**Host**:
The phone that holds authoritative **Party** state. Invisible; always the best phone (battery, signal, network, performance), rechecked on join, failover, and continuously with a flap margin. Applies **Plan** last-write and **Overlay** last **Contribution** per **Place** + type.
_Avoid_: Owner, Adult (family labels); leader (UI)

**Member**:
Anyone on the live **Party** roster, including the **Host**. Roster presence, not a **Profile**. May be name-only or device-less (a child without a phone). Device-holding Members tag, set height / **With adult**, and remove device-less seats.
_Avoid_: User (roster); submember (say device-less Member); Child / Guest as party roles

**Invite**:
How a person becomes a **Member** — a shareable link or code. Name is enough; a **Profile** may attach later. Join on a device does not finish until **Location** is on; joining rechecks **Host** fitness.
_Avoid_: Login, calendar invite, ticket

**Rally Point**:
The **Party**’s one shared rendezvous on the **World** map. A personal pin before join promotes into it. **Rally** is the action.
_Avoid_: Meet, Meet-up, Waypoint, marker, pin

**Subgroup**:
A soft tag on a **Member** inside one **Party** — not a nested party. Split by tag, rejoin at the **Rally Point**.
_Avoid_: Nested Party; split-party as a third entity

**Location**:
A device-holding **Member**’s position so the **Party** knows where they are — mandatory, no pause, no blur, live only inside **World** bounds. At most one **Place** name, only when they are at that Place (Attraction queue/station, or that restroom/food Place); on conflict, the name a person would use, else the slot they stand in. Live stop (bounds or OS revoke) keeps last-known + in-bounds trail, marked stale; revoke walls, does not eject. Device-less Members have no Location. Battery is visible; IMU is not; radio scores stay Host internals.
_Avoid_: GPS; pause/share-off; privacy blur; hedging copy (most likely / probably / near)

**Plan**:
The **Party**’s shared, ordered list of **Places** for today. A pre-join draft on this phone is the same Plan — promote on create/join/resume only when the shared Plan is empty; leave does not resurrect it. Any device-holding **Member** may edit; the **Host** applies last write. Cross-day personalization needs a **Profile**.
_Avoid_: Scenario; itinerary; favorite (personal stars in code, not the Plan)

**Compass**:
Facing-relative radar on phone (bearing strip) and Apple Watch (dial) for **Members**, the **Rally Point**, and one primary **Place** (Go destination, else selection, else next **Plan** Place). The map stays north-up except during **Go**; the map-edge rose is not this instrument.
_Avoid_: compass rose; bearing tape; magnetic compass; quest sensor

### Identity

**Profile**:
A durable signed-in Parkbound identity — prefs, progress, **Title**, attribution — and the paid unlock. Browse, name-only **Members**, and **Party** stay free. Required for **Contribution**, **Mark**, **Thanks**, **Skin** unlock/share/**Offer**, **Managed Guests**, and park-wide **Observation** / **Overlay**.
_Avoid_: User (product person); account; Member (roster, not the paid identity)

**Managed Guest**:
A saved person under a **Profile** (typically a child) used to seed a device-less **Member**. Stale height prompts at seed; skip keeps last inches. Removing a device-less Member does not delete the Managed Guest.
_Avoid_: Member (until on a live roster); Subgroup

**Operator**:
A Clerk-backed allowlist on one **Profile** (`private_metadata.admin`). Invisible. That Profile has every shipped **Skin** and **Kit**, Steward **Title**, and operator routes. An **Offer** from this Profile may be Worn regardless of season or **World** kind. Not a **Title**, **Rank**, or **Host**.
_Avoid_: godmode in UI; Admin as a Title; Steward as admin

### Eligibility

**Eligibility**:
Whether a person (height × **With adult**) can do an **Attraction** — computed, not stored. Unset height means not height-constrained. Map / list / glance show the most restrictive person in this phone’s set (matching **Subgroup** tags, or the whole **Party** if untagged); place detail lists each. Device-holding **Members** decide; device-less people are limiters. Leaving someone at the **Rally Point** is a Subgroup change, not a With adult change.
_Avoid_: Permission, role, filter

**With adult**:
Per-**Member** fact: accompanied by a grown-up right now. Unset means accompanied. Explicit false is rare and belongs on a device-holding Member.
_Avoid_: Companion (that is the Eligibility verdict)

**Companion**:
An **Eligibility** verdict: this **Attraction** is allowed only with an adult.
_Avoid_: With adult; Adult (not a party role)

### Field research

**Side Quest**:
An on-the-ground mission. Gap quests require being at the **Place** and produce a **Contribution** (and may leave a **Mark**). Live quests require being nearby enough to have seen it and produce a **Ride report** (park-wide **Observation** only after a second independent **Party**).
_Avoid_: Adventure; generic quest; Contribution (the payload, not the mission)

**Gap**:
A missing fact the Map factory ships honestly with a **World** — height, queue, path, restroom, food, gate, camping — that open sources cannot settle. The builder invents each **Gap** once; the phone ranks them by **Location** and does not invent them. The **Visual factory** reads the same **Gaps** to paint incompleteness beautifully: legible, artistic treatment where truth is thin, never fabricating coordinates or facts underneath. Missing gap data is an empty list, not a failed World. **Gaps** seed **Side Quests**.
_Avoid_: Bug; missing POI; Contribution (the answer, not the hole); fake-it fill (beauty without truth); toolchain gap (factory log label, not this term)

**Contribution**:
The durable, Profile-attributed result of a gap **Side Quest**. Feeds **Overlay** and can graduate into the persistent **World** map. Enjoyment and map improvement are one loop.
_Avoid_: Adventure; Ride report (ephemeral ops)

**Overlay**:
This phone’s **Contribution** layer on the shipped **World** map — every Field Research kind, not **Ride reports**, not the upload queue. True immediately without a **Party**; join unions by **Place** + type; latest Contribution wins; the **Host** makes every **Member** draw that fact. Leave drops Overlay you only saw in that Party; authored Contributions stay. Park-wide Overlay needs a second independent Party that walked near. Confirm / deny are statistical and park-wide, not in-party votes.
_Avoid_: Ride report; Observation; draft Overlay; queue/outbox; Skin; Action

**Ride report**:
Ephemeral ops about a ride (open/down). Name-first; true on this phone immediately; **Members** see it on join. Nearby enough to have seen it — not queue-pin GPS. Expires with the party day; never rebuilds shipped map JSON. Park-wide fan-out is an **Observation**.
_Avoid_: Contribution; chat message

**Observation**:
A Profile-attributed live signal (wait, status, freshness) that may outlive a **Party** but never rebuilds map JSON. Park-wide “down” needs a **Profile** plus a second independent **Party**; same-Party taps stay in-party. Short TTL; easy contradict; spam costs Profile reputation.
_Avoid_: Contribution

**Mark**:
A Profile-attributed object left at a **Place** for visitors not in your **Party**. Same gate as **Overlay**. Others may **Thank** it. Unused Marks fade; the **Contribution** they celebrate does not.
_Avoid_: Graffiti; pin; Overlay; ghost; chiral / strand

**Thanks**:
Asynchronous gratitude on a **Contribution**, **Observation**, or **Mark** from someone who used it. Evidence and impact for the author — not chat and not currency.
_Avoid_: Like; karma; clap; comment

**XP**:
A **Profile** progress score from **Side Quests**. Never spent; never on a **Member**, **Party**, or anonymous phone. Repeat of the same (World, type, target) by the same Profile awards 0. A name-first **Ride report** can exist without XP.
_Avoid_: experience (Contribution kind); points; Member XP; party score; leaderboard

**Title**:
The sub-name on a **Profile** when **XP** crosses a threshold: Scout (50), Ranger (250), Cartographer (1000), Steward (3000). Alice stays Alice, with Scout beneath. Visitor (signed in, below 50) has no Title yet.
_Avoid_: nickname; handle; level; badge; Rank in UI

**Rank**:
Internal ladder key on a **Profile** (`visitor` · `scout` · `ranger` · `cartographer` · `steward`) that selects the **Title**. Cartographer later unlocks full-ontology Create — not this Field Research loop.
_Avoid_: showing Rank ids in UI; leaderboard; level

**Rank prize**:
A **Skin** or **Kit** granted when **XP** crosses that **Rank** — never bought, never spent. The **Title** is separate.
_Avoid_: loot box; store purchase; Member reward

### Factories

**Map factory**:
The engine that derives a **World**'s truth from real-world data — geometry, **Places**, **Gaps** — for any venue on request. Output-agnostic: point it at a park and it produces that park's truth; it never invents what it cannot evidence. Implementation name: the universal venue builder.
_Avoid_: builder (ambiguous in product talk); map generator

**Visual factory**:
The engine that produces everything a guest sees and earns on the map — **Display packs**, baked **Skin** worlds, materials, prize art — conditioned on the **Map factory**'s truth and its **Gaps**. Request-driven and output-agnostic: any venue × any design visual can be requested; a design prompt becomes a **Skin template** or kit, compiled and certified. Restyles honest unknowns as art; never repositions and never writes truth.
_Avoid_: display factory (legacy header name); art pipeline; inventing geometry to hide a **Gap**

**Grounding harvest**:
A **World**'s real material and color relationships — which roofs are the blue ones, asphalt vs gravel, lawn vs plaza — read from openly licensed imagery into that World's reference profile. Every **Skin** re-expresses those relationships inside its own declared palette: design owns treatment, the venue owns relationships. Not truth (see **Map factory** — imagery evidence is a separate lane) and never a color override. Detail: ADR-0020.
_Avoid_: satellite skin; real-color mode; texture pack

**PostDB**:
The canonical store for all factory outputs — **Truth revisions**, **Display packs**, certifications, and published artifact registry. Factories write here; **Delivery** exports from here. Not git paths or working-tree JSON as source of truth.
_Avoid_: postgres (implementation); file store; repo-as-bus

**Truth revision**:
An immutable Map factory snapshot for one **World** — geometry, **Places**, and **Gaps** as of one build. Append-only; promotion picks which revision guests receive.
_Avoid_: map.json (file label); draft; live edit in place

**World head**:
Which **Truth revision** and certified **Display packs** a **World** currently publishes to guests. Staging may differ until promote.
_Avoid_: latest; main branch; generated stamp alone

**basedOn**:
The **Truth revision** a **Display pack** was built against. A certified pack whose basedOn lags the **World head** cannot ship.
_Avoid_: generated timestamp alone; implicit freshness

**Delivery**:
Export from **PostDB** to whatever serves the phone — static CDN, API manifest plus object storage, or app seed bundles. The phone contract is fixed: hash-verified manifest, offline cache, truth/display split. The transport is not.
_Avoid_: Vercel deploy; git commit; tile server; runtime factory queries on the phone

### Cosmetics and map look

**Skin**:
A **Profile**-owned cosmetic restyle of the **World** map — how it is painted, not where **Places** sit. Earned as a **Side Quest** prize on that **Profile**; two rungs on the same **Skin** (private unlock, then share). Not a **Contribution**, **Overlay**, or **Ride report**. **Wear** resolves a global **Skin template** plus optional **World** overrides from that **World**’s **display pack**. This is the shipped name for what earlier notes called a Map skin.
_Avoid_: Theme (Trail / Park Midnight are the always-on palettes); map pack; party theme; Map skin (use **Skin**)

**Display pack**:
The **Visual factory**'s output for one **World** (implementation: one `venue` bundle) — offline files the phone paints, separate from map truth. Includes vector tiles (`display/base.pmtiles` from Tippecanoe), per-**Skin** baked worlds (the mid **Zoom band**; deeper bands stream by viewport and cache, or download when a guest asks — ADR-0021), `visual.json` (Zone tones, landmark refs, quest-reward overrides), and `manifest.json` (hashes, sizes, versions for download). The phone reads static files; it does not run a tile server. Routing, **Places**, and **Gaps** stay in truth JSON separate from display tiles (exported from **PostDB** via **Delivery**, consumed offline on the phone). See **Rendering tier** for how a device chooses baked vs real-time PBR.
_Avoid_: tile server (runtime HTTP on the phone); map pack (use **display pack**); baking truth into tiles (truth stays JSON)

**Zoom band**:
One of the generalization levels a baked **Skin** world ships at — overview (bold shapes, landmarks only), mid (the everyday view), close (textures, props, sign *objects* — never baked words). More detail is *authored*, not just magnified, the closer a guest zooms; the camera eases from flat to a gentle tilt on the way in, staged so tilt and band handoff never land together. Bands are 2.4 / 0.6 / 0.15 m/px, each 4× its neighbour. The mid band lives in the **display pack**; overview and close stream by viewport and cache, and go offline only when a guest asks for the download. Detail: ADR-0019, ADR-0021.
_Avoid_: zoom level (a tile coordinate, not a band); LOD (implementation vocabulary); quality setting (bands are content, not fidelity knobs)

**Rendering tier**:
How a **World**’s **display pack** actually draws on a device: baked (default, every device, zero shader cost) or real-time PBR (additive on capable devices — live time-of-day and **Skin** swap with no separate download, falling back to baked on a device-capability check). Not the **Custom map** replace/overlay distinction (that is *what* draws; this is *how* it renders) and not a **Skin template** (a template still resolves to whichever tier the device runs). Detail: ADR-0013 item 4.
_Avoid_: shader tier; graphics mode; **Zoom band** (bands are per-zoom content within the baked tier, not a tier); ADR-0014’s “game-tier” / “illustrated tier” (venue art fidelity — a different axis from this)

**Skin template**:
The global compile recipe for a **Skin** id — MapLibre style JSON, iso template parameters, and optional baked tile variant — not hand-tuned CSS per **World**. A **Profile** still earns the **Skin**; **Wear** selects which template loads atop the active **World** **display pack**. **World**-specific reward art overrides live in that **World**’s `visual.json`, not in forked app code.
_Avoid_: per-park CSS; Theme (Trail / Park Midnight are palettes, not **Skin templates**)

**Custom map**:
Extra drawing a **Skin** may attach on the OSM base — **replace** (hide the base) or **overlay** (draw on it, optionally taking named layers such as buildings). **Places** stay on their lat/lng. Not **Overlay** (that is **Contribution** truth) and not the **Skin** paint itself. At scale, **Custom map** geometry compiles into the **display pack** (ADR-0013); runtime does not fork per **World** in React.
_Avoid_: Overlay (contributions); map pack; tileset

**Wear**:
The look this phone is painting: own **Skin**, an accepted **Offer**, or a **Palette**. Wearing another Profile’s Skin is not ownership.
_Avoid_: Applied theme; unlocked (that is the owner’s prize)

**Offer**:
A share-unlocked **Skin** held out to **Members** so each phone may choose to **Wear** it. Several Offers may be out; Offer is Skin-only, not **Kit**. Wear lasts while that owning Profile is a Member.
_Avoid_: Location share; party theme; push

**Kit**:
A **Profile**-owned appearance pack for GPS chrome — puck, how this **Member** looks to others, the **Rally Point** they placed, their trail. Visible to the **Party** with no **Offer**. Strangers do not see a Kit.
_Avoid_: Skin; avatar; pin; Mark; Location icon

**Palette**:
Base paint when no **Skin** is active — **Trail** or **Park Midnight**.
_Avoid_: Theme; map pack

**Trail**:
Always-on daylight **Palette** — warm paper ground, marketing and first-run look.
_Avoid_: day theme; light mode

**Park Midnight**:
Always-on night **Palette** — dark ground, auto from local time / park hours with a manual override.
_Avoid_: night theme; dark mode

**Shape**:
One of four marker silhouettes on a **Place** — disc, chip, diamond, pin — plus its glyph. Shape, colour, and glyph stay redundant so a category remains readable when any one fails.
_Avoid_: icon; pin (use Rally Point or Kit)

**Go**:
Turn-by-turn walking on the **World** map. Course-up camera, route and puck forward; ends north-up when Go stops.
_Avoid_: navigate (verb); GPS mode

**Field research look**:
Visual treatment on **Overlay** facts — kind-specific geometry plus a subtle provisional cue until consolidate ships the **World**.
_Avoid_: pending layer; draft pin

**Fog**:
Optional **Profile** shroud on unexplored **World** geometry. Default off on the map so **Party** coordination stays readable.
_Avoid_: fog of war in UI copy

**Weather**:
**World**-day conditions plus hourly forecast, used to predict holds and likely closures. Informs a **Plan**; does not mark an **Attraction** down — that is a **Ride report**.
_Avoid_: Ride report; Observation
