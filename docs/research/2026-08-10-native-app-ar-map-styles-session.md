# Session brief: Native app, AR, gamified geocaching, and unique map styles

**Date:** 2026-08-10
**Status:** Idea capture from a product conversation. Store-distribution decision
is canonical in [`../adr/0005-store-capacitor-shell.md`](../adr/0005-store-capacitor-shell.md)
(Capacitor shells, PWA remains). Remaining AR / widget / map-style items should be
broken out into
[`../superpowers/specs/park-bound-implementation-backlog.md`](../superpowers/specs/park-bound-implementation-backlog.md)
epics when scheduled.
**Related docs:**
- Master spec: [`../superpowers/specs/2026-08-10-park-bound-master-spec.md`](../superpowers/specs/2026-08-10-park-bound-master-spec.md)
- Gamified contributions research: [`2026-08-10-gamified-map-contributions.md`](2026-08-10-gamified-map-contributions.md)
- Living-map design: [`../superpowers/specs/2026-08-10-gamified-map-contributions-design.md`](../superpowers/specs/2026-08-10-gamified-map-contributions-design.md)
- ADR: [`../superpowers/specs/adr-dual-layer-park-truth.md`](../superpowers/specs/adr-dual-layer-park-truth.md)

**Prompt that started it:** "If this is turned into an official app for Google and
Apple, what benefits would it afford the user, and what additional features could I
include?" Follow-ups covered augmented reality, then gamification with geocaching to
improve map data, then 3D / pixelated / unique map styles.

---

## 1. Why go native (App Store / Google Play)

Parkbound's two killer features — live party tracking and turn-by-turn walking
directions — are exactly what a browser tab does worst. Native is a reliability upgrade
first and a marketing upgrade second.

### Benefits to the user

- **It survives the pocket.** Today, screen-lock or a switch to the camera risks the
  GPS fix, the peer connections, and the in-progress navigation. A native app with
  background-location permission keeps the party mesh alive, keeps positions updating
  while phones are in pockets, keeps spoken directions running screen-off, and lets
  NEED HELP reach locked phones.
- **Real push notifications.** Web push is unreliable on iOS and nonexistent without
  install. Native push means the host phone no longer has to be *open* for a party to
  work.
- **Discoverability and trust.** "Search Parkbound on the App Store" replaces the
  whole `INSTALL.md` / QR / tunnel dance — the biggest adoption barrier today. Store
  listing, ratings, and reviews give first-time users confidence before a park day.
- **Offline-first by default.** Park cellular is notoriously bad. A native bundle can
  ship every venue's geometry, places, and height rules inside the app and update them
  as delta downloads on Wi-Fi — no download moment on a saturated park network.
- **Hardware the browser can't give:** full-precision compass with native
  calibration (bearing tape), haptics (turn coming up, NEED HELP buzz), background
  audio for spoken directions, better Bluetooth for a denser lower-power party mesh.
- **OS surface area:** iOS Live Activities / Dynamic Island and Android ongoing
  notification ("Sarah: 4 min away" on the lock screen); home/lock-screen widgets
  ("Car: 12 min walk"); Apple Watch / Wear OS companions (glanceable party bearings,
  haptic turn cues, one-tap NEED HELP).
- **Frictionless party joins.** Universal Links / App Links turn the invite link into
  "tap → app opens → you're in the party." QR codes still work and now deep-link too.

### Costs and constraints

- **Background location is heavily scrutinised.** Apple needs a justification string
  and a visible user benefit ("keeps your party's positions live while your screen is
  off"); Google Play needs a declaration form and sometimes a demo video for
  `ACCESS_BACKGROUND_LOCATION`. Parkbound's use case is legitimate; budget for one
  round of review friction.
- **No rewrite needed.** A Capacitor (or similar WebView) shell around the existing
  Next.js front end gets store presence, push, and background location first; go
  fully native on the map renderer later only if frame rate demands it. (The master
  spec §"Phone app" already says: keep the PWA, native shell optional later — this
  session agrees.)
- **Money is trivial:** $99/yr Apple, $25 one-time Google.
- The phone-hosted party model improves: "best-placed phone takes over the roster"
  failover becomes far more reliable when host phones can run in the background.

### Sequencing for the native work

1. Store shell + push + background location (fixes the real-world failure modes).
2. Live Activity / widget.
3. Crowdsourced wait times as the first backend feature — the thing that turns
   Parkbound from "great for my group" into "the app everyone at the park should have."

---

## 2. Augmented reality

Parkbound already has the two ingredients AR wayfinding needs that most apps lack:
accurate geometry (every path, building, and coaster centreline from OSM) and live
party positions.

### Candidate features

- **Raise-to-navigate (flagship).** Point the phone down the midway and the route
  floats on the camera view — arrows on the ground, a banner over the correct fork,
  "bear right at Juke Box Diner" anchored to the diner itself. Critical design call:
  **AR is a lens you raise, not the default view.** A 10-hour park day in July sun
  cannot run camera + GPS + screen continuously. Turn-by-turn stays on the drawn map;
  AR appears when the user lifts the phone at a confusing junction (Google Maps Live
  View's pattern).
- **Party finding through crowds.** The bearing tape's AR evolution: hold the phone
  up and party members appear as floating name labels at their true bearing and
  distance — "Sarah · 180 ft →" hovering above the crowd she's behind. Same for the
  meet-up pin (a beacon over the midway) and the car at 11 PM in a 10,000-space lot.
  Solves the single most common park problem — "where are you?" — and nobody does it
  well.
- **Point-at-a-ride info.** Aim at a coaster: name, height rule vs. *your* riders,
  live status ("reported down 10 min ago"), walk time to the entrance. Aim at a
  restaurant: menu, open/closed. All of this data already exists in the venue files;
  AR is just a new viewport onto it.
- **AR height check.** Use the camera (LiDAR on Pro iPhones, ARCore depth on Android)
  to measure a kid's height in seconds and instantly recolour the ride list and map
  to what they can ride. Turns the existing height slider into a moment of delight at
  the park entrance instead of a guess.
- **Queue entertainment.** Scavenger hunts and photo AR in 60-minute lines: virtual
  mascots to spot, park trivia anchored to what's visible, ride-through previews for
  nervous kids ("see how big the drop really is"). Retention gold; parks would love
  it too.

### Honest constraints

- **No VPS coverage.** Google's Visual Positioning System and Apple's location
  anchors are spotty outside major cities. Early versions use GPS + compass AR (like
  early Live View): accurate to a few metres, plenty for "which fork do I take."
- **GPS interference.** Coaster structures are giant steel Faraday cages; expect
  drift near big rides and degrade gracefully ("roughly this way," never a confident
  wrong arrow).
- **Battery.** Strict duty cycle — AR session only while the phone is raised, with a
  first-run "AR costs battery" hint.
- **Device support.** ARCore excludes many budget Androids; the drawn-map experience
  must always remain the complete fallback.

---

## 3. Other features native would unlock

### Intelligence / planning

- **AI day planner:** party ages, heights, must-dos, arrival time → an optimised
  route (rope-drop strategy, minimal backtracking, meal timing around parades).
  Re-plans live when a ride goes down or the party dawdles. (Master spec's "Dynamic
  Planner" pillar.)
- **Smart alerts:** "Storm cell 20 minutes out — nearest indoor rides," "Lightning
  queue just dropped to 15 minutes," "9:40 — last chance for a night ride on
  Diamondback."
- **Predicted wait times:** once crowdsourced reports flow park-wide, historical
  curves per ride ("dips at parade time every day").

### Accessibility as a feature, not a checkbox

- **Sensory-friendly mode:** quiet zones marked, low-stimulation routing,
  crowd-density avoidance.
- **Step-free routing:** wheelchair paths, companion restrooms, ride transfer
  requirements. (OSM stairs/wheelchair data is thin — noted in the master spec audit;
  geocaching quests in §4 are how it gets filled.)
- **Haptic "hot/cold" guidance** for low-vision users: the phone buzzes faster as you
  face the right direction.

### Enthusiast community (the free marketing engine)

- **Coaster credit counting** — the enthusiast community already tracks every coaster
  ridden in apps like Coaster-Count; building it in makes Parkbound the app *they*
  recommend.
- Check-ins, badges, park passports, year-in-review stats ("you rode 4,200 ft of
  coaster track").
- **UGC correction flow:** one-tap "this path is closed" / "entrance moved" reports
  feed straight back into the venue-builder pipeline (`venues:research` /
  `venues:audit`), so the app crowdsources its own map maintenance — and per the
  builder contract, confirmed fixes land in `data/venues/<id>.*.json` and regenerate,
  never hand-patch shipped JSON.

### Practical day-of utilities

- Locker locations/prices and per-ride bag policy ("this one has free bins").
- Show/parade schedule with "leave now to make it" walk-time alerts.
- Water refill stations and shade-maximised routing (OSM tags much of this).
- Dining allergy filters and mobile-order deeplinks.
- End-of-night mode: fireworks end → everyone's "walk to your car" routes light up at
  once, per person, to their own saved spots.
- Geofenced arrival: entering the parking lot → "Save your parking spot?" and
  "Switch to Kings Island?" prompts.
- Wallet passes (season pass, parking barcode) next to the map that routes you there;
  Siri/Assistant shortcuts ("where's my car?"); day recap (distance walked, rides
  done, shareable timeline); battery-saver mode (reduced GPS cadence + dark map, mesh
  kept alive at lower fidelity).

---

## 4. Gamification with geocaching to improve map data

**The deep research and design for this already exist** — see the gamified-map-
contributions research and design docs, and backlog epics E10/E11. This session
reinforced and extended them with a specific framing: **hide gameplay at exactly the
places where the map data is weakest.**

### Core loop — "Scout" quests

- The venue builder knows what's uncertain: an untagged path, an inferred ride
  entrance, a fountain with no `amenity` tag, a "restroom yes/no" gap. Turn each gap
  into a quest: *"There's supposed to be a water fountain near The Beast's exit —
  find it."*
- User walks there, confirms yes/no or a quick photo, earns points and a stamp.
  Confirmations feed the pipeline — not directly into the map, but into review (one
  report = a lead, three independent reports = truth). Durable fixes graduate to
  `data/venues/<id>.*.json` overrides or upstream to OSM, per the design doc's
  hybrid contribution pipeline.
- **GPS trace contribution (opt-in):** the highest-value data costs the user nothing
  — just walking. Midway traces validate path geometry the way Strava's heatmap
  does; reward "metres mapped." First to walk a new/changed path: "Trailblazer"
  badge.
- **Photo quests:** "Snap the entrance sign" confirms entrance position and ride name
  — and those photos double as point-at-a-ride AR imagery later (§2).

### Engagement layer

- **Fog-of-war map reveal:** your personal copy of the park starts shrouded and
  un-fogs where you walk. The oldest exploration mechanic there is, and it quietly
  spreads users across *all* paths — including the unglamorous ones the data needs.
- **Consensus gameplay:** players validate pending reports ("Is this photo actually
  Diamondback's entrance?") — Waze-style. Validators earn points; moderation becomes
  gameplay instead of labour. (Matches the design doc's confirm-loop and
  score-the-outcome findings.)
- **Park badges and leaderboards:** "Mapped 100% of Cedar Point's midways," seasonal
  Fright Fest/HalloWeekends events, "Mapper of the Month." Use per-venue/weekly
  leagues, not one hopeless global board (per the research doc's demotivation risk).
- **Party quests:** whole-party challenges ("everyone check in at a different coaster
  at the same time") that double as distributed data collection — plugs into the
  party mesh's relatedness, per the research doc's SDT finding.

### Constraints (from this session and the research doc)

- **Never let a single report mutate the map; never bypass the builder.** A report is
  a `venues:research` input, not an edit.
- **Privacy:** GPS traces need clear opt-in, on-device trimming to park bounds, and
  anonymisation before leaving the phone — users include kids.
- **Gaming resistance:** rate limits, agreement metrics, proximity checks, delayed
  full credit (already in the design doc).
- **Park partnership upside:** guest-confirmed maps reduce the parks' guest-services
  burden. A data partnership (official geometry, early new-ride plans) is a plausible
  endpoint and makes the app "official" in a way store listings can't.

---

## 5. Unique and 3D map styles

The renderer's architecture is the enabler: the builder outputs geometry and the app
paints it — **the same venue JSON can feed more than one renderer.** Light/dark
already proves the palette-swap path.

### Tier 1 — Style skins (same SVG renderer, new palettes/treatments)

- **8-bit / RollerCoaster Tycoon pixel style** — the nostalgia nuke. Dithered grass,
  blocky coasters, tiny pixel guests on the midways. A dither/pixelation pass over
  the existing SVG gets most of it.
- **Vintage souvenir map** — the painted aerial-view style of paper park maps:
  parchment tones, hand-lettered district names, coaster illustrations. Screenshot
  bait.
- **Blueprint/schematic** — white lines on drafting blue, technical labels;
  enthusiasts will adore it.
- **Neon midway** — an evolution of dark mode: glowing paths, lit marquee markers,
  "the park after the lights come on."
- **Seasonal overlays** — fog and pumpkins for Halloween events, lights and snow for
  winter. Time-limited skins create annual return visits.
- **Kids' mode** — simplified geometry, big cartoon landmarks, only the categories a
  kid cares about.

**Accessibility rule for every skin:** keep the shape + colour + glyph redundancy. A
skin that only differs by hue breaks the ~8% of red-green-deficient users the current
design deliberately protects. (Backlog E11.2 already has "Map skins / markers —
unlockable themes, offline assets cached"; this session fleshes out the catalogue.)

### Tier 2 — 2.5D tilt

Rotate/tilt into a perspective view, course-up for navigation. Doable with
CSS/WebGL transforms on existing geometry; buildings extrude as flat-roof blocks.
Makes "which way am I facing" disappear.

### Tier 3 — True 3D (new WebGL/Three.js renderer)

- **3D coaster tracks are the showpiece.** OSM provides the centreline; RCDB (Roller
  Coaster DataBase) has heights, drops, lengths, and inversions for essentially every
  coaster at the shipped parks. Centreline + height profile = a recognisable 3D
  Diamondback or Steel Vengeance in the app. Nobody's park app does this.
- Extruded buildings, terrain, water — the Apple Maps look, from our own data.
- The rider-height filter is great in 3D: coasters your kid can't ride loom grey
  while the ones they can glow.

---

## 6. The flywheel: skins as quest rewards

Make cosmetic skins the **geocaching reward currency**: reveal 25% of a park's fog →
unlock the pixel skin; validate 10 reports → the vintage souvenir map; complete every
coaster credit at Cedar Point → a spinnable 3D Steel Vengeance.

Players get prizes they actually want (they stare at this map for 10 hours — cosmetics
matter); the map data improves with every step; the better map makes the game richer:

```text
GAMEPLAY → DATA → BETTER MAP → BETTER GAMEPLAY ↺
```

Monetisation-friendly version: skins earnable *or* purchasable, while quests and
party features stay free — nobody pays to make your data better, but plenty will pay
two dollars to skip the grind for the RCT map. Party tracking stays free forever:
it's the network-effect feature, and paywalling it kills group adoption.

---

## 7. Suggested priority (from the session)

| Order | Item | Why first |
|-------|------|-----------|
| 1 | Native shell + push + background location | Fixes the app's real-world failure modes |
| 2 | Live Activity / widget | Highest-visibility native surface |
| 3 | Crowdsourced wait times (first backend feature) | Turns "great for my group" into "everyone should have it" |
| 4 | AR party finding + point-at-a-ride | Reuses existing data; demos incredibly in App Store screenshots |
| 5 | AI day planner | Gets strangers, not just your group, to install |
| 6 | Scout quests + fog-of-war (per the existing design doc) | The data flywheel |
| 7 | Style skins, then 2.5D, then 3D coaster models | Rewards for the flywheel, cheapest first |

## 8. Open questions to resolve before building

- Notion copy: the earlier gamification research noted Notion OAuth was blocked in
  cloud runs — same applies here; sync manually if a Notion record is wanted.
- RCDB licensing/terms for coaster stats (height, inversions) before shipping 3D
  models or height-rule enrichment from it.
- Whether account profiles ship with the contribution system (the research doc flags
  this as a product decision; offline profile cache after sign-in is the mitigation).
- Park partnership outreach: which park first, and what data-sharing agreement makes
  "official" status mutual.
