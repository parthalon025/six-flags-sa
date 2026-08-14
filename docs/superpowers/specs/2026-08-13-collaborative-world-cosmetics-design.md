# Design: Collaborative world, Skins, Kits, and Marks

**Date:** 2026-08-13  
**Status:** Draft for review — not approved for implementation  
**Glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md) (canonical terms)  
**Depends on:** [`./2026-08-10-gamified-map-contributions-design.md`](./2026-08-10-gamified-map-contributions-design.md) (E9–E11), [`../../adr/0002-dual-layer-park-truth.md`](../../adr/0002-dual-layer-park-truth.md), [`../../research/2026-08-10-native-app-ar-map-styles-session.md`](../../research/2026-08-10-native-app-ar-map-styles-session.md)  
**Backlog:** E9 (Side Quests), E10 (XP / fog / passport), E11 (explorer packs / map skins)

---

## Problem

The map is something a family stares at for hours, but the only paint today is Trail / Park Midnight. Side Quests already improve park truth; they do not yet leave a world other visitors can feel, or prizes a Profile would grind for. We want one loop: go to the Place, report what you see, leave something the next family can use, and earn cosmetics that never fake the map.

## Goals

1. **Side Quests** remain the work: Pokémon GO (walk up), Waze (live report), Death Stranding (leave a structure). Same tab.
2. Cosmetics split cleanly: **Skin** (how this phone paints the Venue), **Kit** (how this Member looks to the Party), **Mark** (object left at a Place for people you never meet).
3. Strangers never get live GPS or Kits. **Location** stays Party-only.
4. **Thanks** is the gratitude / evidence pulse (Waze thanks + Death Stranding likes). Unused Marks fade; Contributions do not.
5. Party join, Host, and navigation stay free. Nobody pays to coordinate.

## Non-goals (v1)

- Live stranger ghosts, named trainers on the map, or a chiral-network metaphor in the UI.
- Freeform graffiti, chat on Marks, or cargo / inventory as a second roster.
- Minecraft / RCT / Pokémon / Death Stranding IP in store listing or asset names — original homage names only.
- 2.5D tilt or 3D coaster tracks (later renderer; not a Skin).
- Loot-box gambling or paywalling Party / Side Quests.
- Hand-editing generated venue JSON. Marks and Overlays never become builder output until consolidate.

## Constraints

- Skins restyle, never reposition. Shape + colour + glyph stay redundant (accessibility).
- Builder still owns `public/venues/*.json`. Overlay / Mark / Observation sit on top (ADR-0002).
- **Profile** required to submit Side Quests, leave Marks, send Thanks, unlock Skins / Kits / Offer. Name-only Members may Wear an offered Skin. Device-less Members have no map and no Wear.
- **Host** does not gate cosmetics.
- Day/night palettes (Trail / Park Midnight) stay always-on, not Skins.

---

## Three engines, one loop

| Engine | Job in Park Bound | Product object |
|--------|-------------------|----------------|
| Pokémon GO | Walk to the Place; do the mission | Gap **Side Quest** |
| Waze | Tap what you see; others confirm | **Ride report** → **Observation**; **Thanks** |
| Death Stranding | Leave a structure; others use it and Thank; unused dressing fades | **Mark**; finishing someone else’s **Gap** |

**Scene.** Mia walks to Diamondback (PoGO), logs the height (**Contribution**), and a plaque **Mark** appears for her Party. A stranger family sees the plaque after Overlay-style evidence (DS structure, not her GPS). They use the height and tap **Thanks**. A week with no Thanks and the plaque dims; the height fact stays. If the ride goes down, that is a **Ride report**, not a Mark.

---

## Cosmetic layers

### Skin (map paint)

Profile-owned restyle of the Venue map. Two rungs on the **same** Skin: private **unlock**, then **share** (may **Offer**). RCT share does not unlock another Skin. Own Skin is the default on that phone. Offer is opt-in, not a push. Several Offers may be out; each phone Wears one look. Wear of someone else’s Skin lasts only while that Profile is a Member (withdrawing the Offer is the same). New Party does not remember Saturday’s yes. Host is irrelevant.

Trail / Park Midnight are not Skins.

### Kit (GPS chrome)

Profile-owned appearance: puck, how Members see you, Meet you placed, your trail. Equipped Kit is visible to the Party like a character skin. No Offer. Strangers do not see Kits.

Private HUD (heading tape, quest sensor toward a Place) may match the Kit on *this* phone only.

### Mark (world object)

Profile-attributed object at a Place. Same gate as Overlay: this phone immediately (a Party is not required); Members once you join or host; other visitors after a second independent Party that walked near. Others may Thank it. Unused Marks fade; the Contribution they celebrate does not. Not Location, not Skin, not Kit, not a live person.

A later Profile may complete a Gap someone else started. That is still a Side Quest, not a meeting.

### Thanks

One tap on a Contribution, Observation, or Mark the sender used. Evidence + author impact. Not chat, not spendable. Profile required. At most one Thanks per Profile per target per day.

---

## Mark catalog

Closed types. No freeform drawing. Signs are a fixed phrase list so Marks cannot replace Ride reports.

| Mark | Looks like | Drops from | Strangers see when |
|------|------------|------------|--------------------|
| **Plaque** | Measured plate on an Attraction | Confirmed height / entrance / companion-rule **Contribution** | Evidence (second independent Party that walked near) |
| **Sign** | DS-style board; preset copy only | Optional extra on a gap quest, or a “point the way” quest | Evidence |
| **Lantern** | Soft light on a settled Place | First confirmed **Contribution** at that Place (one lantern per Place per author) | Evidence |
| **Sticker** | Collectible on the Place | Fog / visit: being there + a Side Quest | Evidence |
| **Cairn** | Stacked stones on a path | Path / stairs / stroller **Gap** settled | Evidence |
| **Beacon** | Dim “unfinished” glow on a Gap | A Profile started evidence but left; another can finish | Party of the starter; park-wide as a Gap, not as their GPS |
| **Cone** | Caution on an Attraction | Does **not** drop from a Ride report — down stays Observation. Cone is not v1. | — |

**Preset signs (v1):** “Queue this way”, “Rest here”, “Height checked”, “Nice view”, “This way to restrooms”. Not: “Ride down”, “Wait 90 min” (those are Ride report / Observation).

**Fade (v1):** No Thanks and no walk-by for 7 days → Mark dims for strangers. 28 days unused → gone from stranger view. Author and their Party may still see their own Marks on that visit. Re-Thanks or a walk-by resets the clock. Contributions and Overlay facts are unchanged.

**Stacking:** One plaque per Contribution. Lanterns do not stack forever — later Thanks brighten the existing lantern. Stickers may stack as a small count on the Place (cap 99 visible).

---

## Kit catalog (Party-visible)

Homage names, not IP.

| Kit | Video-game read | What the Party sees |
|-----|-----------------|---------------------|
| **Porter cuff** | Death Stranding strand cuff | Puck ring while the Member is on a Side Quest |
| **Buddy** | Pokémon GO buddy | Small companion beside the puck |
| **Street arrow** | Classic GPS / Waze | Heading triangle |
| **Meet flag** | DS sign / BotW medallion | The Meet they placed |
| **Cairn trail** | DS cairns / PoGO incense | Trail dots as stones (Party-only; dies with the Party) |
| **Quest sensor** | BotW shrine / PoGO nearby | Private HUD toward the Side Quest Place; optional glyph on *their* pin for Members |

Unlock with the same Side Quest meters as Skins (below). Equip one Kit at a time (puck + trail + Meet may be one pack).

---

## Skin catalog (this phone’s paint)

Per-Skin ladder: unlock (private Wear) then share (Offer). Meter rhymes with the look. Global Skins travel with the Profile; venue-kind Skins (Water slick, Camp lantern) only Wear at matching Venues. Haunt / Frost live in the closet year-round and only Wear in-season.

| Skin | Unlock | Share rung |
|------|--------|------------|
| **Handbill** | 8 confirmed gap Contributions at one Venue | 20 at that Venue or midway passport |
| **Postcard** | First confirmed Contribution | Contributions at 3 Venues |
| **Ticket stub** | 5 Plan stops walked + 3 nearby Side Quests | Finish a day’s Plan + 10 quests |
| **Drafting** | 5 path/entrance Gaps | 25 geometry Contributions |
| **Operator** | 10 Ride reports | 10 agrees or one Observation |
| **Down-line** | 3 agreed Ride reports | 10, or one park-wide Observation |
| **Marquee** | 5 Side Quests after sunset | 20 night quests |
| **Haunt** / **Frost** | Event-window Side Quests | Repeat next season or N event Contributions |
| **Rain day** | Quests during Weather-predicted holds | N live reports on storm hours |
| **Junior** | Device-less Member with height + 1 height quest | 5 height Contributions |
| **Sticker book** | 25% fog at a Venue | 100% of one category |
| **Star chart** | Night / last-hour quests | Night passport at one Venue |
| **Water slick** | Water-park Gaps | That Venue’s passport |
| **Camp lantern** | Camp Place Gaps | Campground passport |
| **Chalk lot** | First Side Quest with a kid on the roster | Junior share or 10 family quests |
| **Sunrise** | Opening-hour Side Quests | Rope-drop on 3 days |
| **Woodblock** | 12 Contributions | Impact: helped 25 visitors |
| **Pixel tycoon** | 25% fog | 100% midways or 10 peer confirms |
| **Block park** | 10 Places walked + 5 quests | Full Venue fog lift |
| **Redline** | High rank / review N peers | Offer once review power exists |

**v1 ship:** Postcard, Handbill, Pixel tycoon, Junior, plus Trail / Park Midnight. The rest are catalog, not blockers.

**Thanks → share:** Thanks received on this Profile’s Marks / Contributions count toward the share rung of the Skin whose meter matches (e.g. plaques feed Handbill / Junior; Ride-report Thanks feed Operator / Down-line).

---

## Party flow (Skins)

1. Unlock Skin → only this phone Wears it; no Offer control.
2. Share rung → Offer. Others get “Wear Mia’s Handbill?” Maps do not change until accept.
3. Own Skin wins until they pick an Offer.
4. Multiple Offers may be out; one Wear per phone.
5. Owner leaves or withdraws Offer → Wearers fall back to own Skin or Trail / Park Midnight.
6. Mid-day join: see outstanding Offers; default remains own Skin.
7. Name-only Member may accept an Offer; cannot unlock or Offer.

---

## Privacy and evidence

- **Party** sees: roster Location, Kits, Offers, and Marks you already had on this phone (union on join).
- **Strangers** see: park-wide Overlay facts and Marks after a second independent Party that walked near. Never Location, trail, Kit, or Skin of another Party.
- Park-wide Observation of ride-down still needs a **Profile** plus a second independent Party that walked near (ADR-0007). Same-Party taps stay in-party.
- Marks use that same evidence bar. Thanks helps but does not skip a second Party for hiding an Attraction.

---

## Accessibility and IP

- Every Skin keeps category colour + glyph + shape. Hue-only Skins are rejected.
- Contrast floor stays at least the current day/night packs.
- Store and UI use homage names (Pixel tycoon, Block park, Porter cuff). Not “Minecraft”, “RCT”, “Pokémon”, “Death Stranding” as product features.

---

## Phasing (not one PR)

This spec is several backlog slices. Do not implement as a single branch.

| Slice | What ships | Blocked on |
|-------|------------|------------|
| **S0** | Glossary in CONTEXT.md (done in this session) | — |
| **S1** | Extra Skin packs in the SVG renderer (paint only, no earn) | Map M2 tokens wired through layers |
| **S2** | Kit puck / trail / Meet cosmetics, Party-visible | Party mesh already carries Member identity |
| **S3** | Marks + Thanks + fade, Overlay-gated | E9 submit + contribution store |
| **S4** | Earn ladders, fog/passport meters, Offer | E10 + S1 |
| **S5** | Seasonal Wear, venue-kind Skins, Redline | S4 |

Party tracking, Side Quests, and the two default palettes remain free at every slice.

---

## Example dialogue

> **Dev:** "The stranger sees Mia’s RCT map because they Thanked her plaque?"  
> **Domain expert:** "No. Thanks is evidence and impact. RCT is a Skin. They see the plaque Mark, not her paint, and never her puck."

> **Dev:** "Can she leave a sign that Diamondback is down?"  
> **Domain expert:** "No. That’s a Ride report. Signs are wayfinding phrases. Down becomes an Observation after evidence."

> **Dev:** "Does the height vanish when the lantern fades?"  
> **Domain expert:** "No. The Contribution stays. Only the Mark dims."
