# Research: Official Disney theme-park apps vs Park Bound

**Date researched:** 2026-08-15  
**Product:** Park Bound (Park Bound: Explore)  
**Status:** Research complete — primary sources preferred; secondary sources labeled.  
**Companion:** root [`CONTEXT.md`](../../CONTEXT.md), [`../guide/features.md`](../guide/features.md), [`../adr/0009-ship-gaps.md`](../adr/0009-ship-gaps.md)

This note audits **every official Disney guest app whose job is a theme-park day**, then compares that surface to Park Bound. It answers three product questions:

1. What do Disney’s apps actually do (and require)?
2. What should Park Bound **add** so a Disney-going family is not missing the useful half?
3. What does Park Bound already have that Disney does **not**, and why a family should open Park Bound instead of (or beside) those apps?

This is not permission to become a ticket wallet, Lightning Lane booker, PhotoPass store, or hotel key. Those are operator-owned. Copying them is how a companion app dies.

---

## Executive summary

Disney does not ship one park app. It ships **one official wallet per resort**, plus one US **play** app. Every resort app is the same product wearing a different name: **tickets, paid skip-the-line, dining, official waits, a GPS map of *you*, hotel, photos.** None of them is a live family radio. None of them draws a park as geometry. None of them works at Cedar Point on Saturday and Magic Kingdom on spring break.

**Use Disney’s app for the gate. Use Park Bound for the family.**

| Job | Disney official apps | Park Bound today |
|-----|----------------------|------------------|
| Buy / show tickets, Lightning Lane / Premier Access, dining, PhotoPass, hotel key | **Wins. Do not compete.** | Out of scope |
| Official wait times, showtimes, character locations | **Wins when the signal is up** | Party **Ride reports** + weather outlook; no official feed (by design) |
| See *yourself* on a GPS map | Yes (approximate; needs data) | Yes, plus offline drawn map |
| See *the Party* on the map, named by **Place** | **No official live family GPS** | **Yes — this is the product** |
| Height for *this* kid / this clump | Not a listed store feature; planDisney describes a ″ filter | **Eligibility** from roster heights + **With adult** |
| Device-less child on the roster | Family & Friends / managed profiles for *booking* | Device-less **Member** + **Managed Guest** |
| Walk there, named by what you can see | MDE store: step-by-step (needs data). DLR: GPS map, no official “directions” claim | On-device A*, landmark turns, course-up **Go**, works offline |
| Facing-relative “where is Dad?” | No | **Compass** (phone + Watch) |
| Meet / NEED HELP | No | **Meet** + pulsing NEED HELP |
| Improve the map | No (guests cannot edit park truth) | **Side Quests** → **Contribution** / **Overlay** |
| One app for every park this year | **No — six wallets** | **Yes — any OSM venue** |
| Offline park day | Partial cache; waits need internet | **Premise** — map, heights, routing, party mesh |

**Do not add:** tickets, Lightning Lane / Premier Access booking, virtual queues, dining reservations, Mobile Order, PhotoPass, MagicBand / MagicMobile, hotel keys, Cast chat, IP queue games. Disney will always win those, and guests already have the official app for them.

**Do add (operator-agnostic, Disney-shaped):** ship Disney **Venues** through the existing builder; public height rules; showtimes / character greetings as **Places**; accessibility and park hours; “works alongside My Disney Experience” copy. Keep official waits as a later ingest only if the source is licensed — the honest **Ride report** is already the differentiator.

---

## Scope — what counts as a Disney park app

### In scope (official guest park-day apps, 2026-08-15)

| App | Resort | Store / official page |
|-----|--------|------------------------|
| **My Disney Experience** | Walt Disney World (4 parks, 2 water parks, Disney Springs, hotels, ESPN Wide World of Sports) | [App Store](https://apps.apple.com/us/app/my-disney-experience/id547436543), [WDW mobile apps](https://disneyworld.disney.go.com/guest-services/my-disney-experience/mobile-apps/) |
| **Disneyland** | Disneyland Resort California (Disneyland + Disney California Adventure) | [App Store](https://apps.apple.com/us/app/disneyland/id1022164656), [DLR app page](https://disneyland.disney.go.com/guest-services/download-disneyland-mobile-app/) |
| **Play Disney Parks** | WDW + DLR only — games / AR / Galaxy’s Edge datapad | [App Store](https://apps.apple.com/us/app/play-disney-parks/id1325935439), [DLR Play page](https://disneyland.disney.go.com/guest-services/play-app/) |
| **Disneyland Paris** | Disneyland Park + **Disney Adventure World** (Studios Park renamed 2026-03-29) | [App Store](https://apps.apple.com/us/app/disneyland-paris/id396908589), [DLP mobile app](https://www.disneylandparis.com/en-usd/mobile-app), [rename](https://news.disneylandparis.com/en/walt-disney-studio-park-discovery/) |
| **Tokyo Disney Resort App** | Tokyo Disneyland + Tokyo DisneySea | [Official app page](https://www.tokyodisneyresort.jp/en/tdr/app.html), [App Store](https://apps.apple.com/us/app/tokyo-disney-resort-app/id1313147771) |
| **Hong Kong Disneyland** | Hong Kong Disneyland | [App Store](https://apps.apple.com/us/app/hong-kong-disneyland/id1077550649) |
| **Shanghai Disney Resort** | Shanghai Disneyland + Disneytown + hotels | [App Store](https://apps.apple.com/us/app/shanghai-disney-resort/id1073826118) |

### Features, not separate apps

- **Disney MagicMobile** — wallet pass *inside* My Disney Experience only. Official DLR copy does **not** publish MagicMobile (entry is MagicBand+ / tickets in the Disneyland app). [WDW](https://disneyworld.disney.go.com/guest-services/magic-mobile).
- **Disney Genie** (complimentary itinerary) — *inside* MDE / Disneyland. [Official](https://disneyworld.disney.go.com/genie/).
- **Lightning Lane Multi / Single / Premier Pass** — purchased and redeemed in MDE / Disneyland. [WDW](https://disneyworld.disney.go.com/lightning-lane-passes/), [DLR](https://disneyland.disney.go.com/lightning-lane-passes/).
- **Disney PhotoPass / Memory Maker / PhotoPass+** — in-app IAP in MDE / Disneyland.
- **Virtual queues** — in MDE / Disneyland. Fetch 2026-08-15: WDW listed **none available**; DLR listed **World of Color – ONE**. [WDW](https://disneyworld.disney.go.com/guest-services/virtual-queue/), [DLR](https://disneyland.disney.go.com/guest-services/virtual-queue/).
- **Merchandise Mobile Checkout** — in MDE and Disneyland (not a Shop Disney Parks app). [WDW](https://disneyworld.disney.go.com/guest-services/merchandise-mobile-checkout/), [DLR](https://disneyland.disney.go.com/guest-services/merchandise-mobile-checkout/).

### Out of scope (not a theme-park day)

- **shopDisney** — ecommerce. The old **Shop Disney Parks** app was **retired 31 May 2019** ([TouringPlans contemporaneous note](https://touringplans.com/blog/shop-disney-parks-app-retired/); planDisney pointed guests at shopDisney / MDE).
- Disney+, DisneyNOW, Disney Cruise Line, Aulani-only, Disney Vacation Club — not a park-day job.
- Cast / internal tools.

### Secondary (labeled)

Fan blogs (Undercover Tourist, Disney Food Blog, Doing Disney Daily) describe UI paths. Used only when they match official copy. **Not used as fact:** a Screenwise parenting guide that claims MDE shows live GPS of every linked Family & Friends member. Official MDE legal text describes Family & Friends as **ticket / itinerary sharing**, not a live roster map ([MDE legal terms](https://disneyworld.disney.go.com/park-experience-terms-conditions/)). Life360’s own park-day marketing assumes you need a *second* app to see the family ([Life360](https://www.life360.com/en-gb/blog/how-to-track-everything-at-disney-world)).

---

## App-by-app audit

### 1. My Disney Experience (Walt Disney World)

**Role:** The WDW vacation OS. 549 MB, iOS 17+, English/Spanish, 4.7★ / 3.1M ratings, v8.23.2 (fetched 2026-08-15). [App Store](https://apps.apple.com/us/app/my-disney-experience/id547436543)

Official listing + help claim:

- Complimentary **Disney Genie** itinerary / tips / “what’s next” ([Genie](https://disneyworld.disney.go.com/genie/) — requires valid admission + park reservation linked to a Disney account).
- Real-time waits, park hours, Character Greetings, showtimes.
- GPS-enabled interactive map; **step-by-step directions** (store copy).
- Dining: menus, reservations, Mobile Order.
- **My Day / My Plans** — hotel, dining, activities in one list.
- Hotel mobile check-in; MagicBand+ linking; **MagicMobile** (park entry, virtual queue / Lightning Lane redeem, PhotoPass link, folio charge) ([MagicMobile](https://disneyworld.disney.go.com/guest-services/magic-mobile)).
- PhotoPass / Memory Maker IAP: One Day **$84.99**, 30 Day **$209.99**, Mural of Memories **$9.99** ([App Store](https://apps.apple.com/us/app/my-disney-experience/id547436543)).
- Car locator at select lots (store copy).
- **Family & Friends** — assign tickets, book dining / Lightning Lane for people you manage; share itinerary. Not live location ([legal](https://disneyworld.disney.go.com/park-experience-terms-conditions/)).
- Height: **not listed** as an app feature in official MDE store/help copy. planDisney panelists describe a map filter by requirement (e.g. 42″) — not a family roster ([planDisney](https://plandisney.disney.go.com/question/list-rides-walt-disney-world-height-requirements-plan-609134/)).
- Beacons + location for wait-time quality; waits “may not update accurately” without a strong signal ([App Store](https://apps.apple.com/us/app/my-disney-experience/id547436543)).
- Optional offline cache of *some* data; purchases and live ops need a connection.
- **US-only, English-only** ([WDW mobile apps](https://disneyworld.disney.go.com/guest-services/my-disney-experience/mobile-apps/)).
- In-app Cast Member chat; merchandise mobile checkout; **bus arrival times** with Direct-to-Room ([WDW mobile apps](https://disneyworld.disney.go.com/guest-services/my-disney-experience/mobile-apps/)).
- Store versions 2026-08-15: iOS **8.23.2** (2026-08-12), Android **8.23.2** (2026-08-14).

**Lightning Lane (2026):** Multi Pass (up to 3 pre-picks, then one-at-a-time), Single Pass, Premier Pass — all in the app. Photo perks bundled with Multi Pass. [Official](https://disneyworld.disney.go.com/lightning-lane-passes/). Prices vary by date/park; displayed in-app (typically ~21 days of pricing). This is a **paid skip-the-line product**, not a family map.

### 2. Disneyland (California)

**Role:** Same OS for DLR. 532 MB, iOS 17+, 4.7★ / 1.9M, v8.23.3. [App Store](https://apps.apple.com/us/app/disneyland/id1022164656)

Official DLR page adds, beyond the WDW twin ([DLR app](https://disneyland.disney.go.com/guest-services/download-disneyland-mobile-app/)):

- Contactless tickets / park reservations; Magic Key discounts.
- Lightning Lane Multi / Single / Premier. Official Multi Pass **starts at $34 USD per ticket per day** ([DLR Lightning Lane](https://disneyland.disney.go.com/lightning-lane-passes/)).
- Virtual queues: **World of Color – ONE** as of 2026-08-15 ([DLR Virtual Queues](https://disneyland.disney.go.com/guest-services/virtual-queue/)).
- Mobile Order, dining reservations, walk-up list, mobile check-in.
- Merchandise **mobile checkout**.
- **In-app Cast Member chat** (intake 24h; Cast replies 7:00 a.m.–9:00 p.m. PT per [DLR press](https://disneyexperiences.com/disneyland-press/fact/maximize-a-disneyland-resort-visit-with-the-disneyland-app-and-digital-technology/)).
- Park reservation **required** with admission, same park, same date, ages 3+ ([experience updates](https://disneyland.disney.go.com/experience-updates/)).
- **MagicMobile is not published** for DLR — entry is MagicBand+ / tickets in the app. MagicBand / MagicBand 2 are **not supported** at DLR.
- Character locations; PhotoPass+ IAP (**$24.99** / 1 day, **$14.99** digital download).
- Hotel check-in / digital key.
- GPS maps, waits, showtimes, park hours, accessibility copy.

Genie complimentary itinerary is in the store listing. Lightning Lane at DLR is **same-day, one-at-a-time** after park entry (2-hour / redeem rule) — different cadence than WDW’s advance Multi Pass ([DLR Lightning Lane](https://disneyland.disney.go.com/lightning-lane-passes/)).

### 3. Play Disney Parks

**Role:** Separate **play** app. Not a planner. WDW + DLR only. [Official](https://disneyland.disney.go.com/guest-services/play-app/), [App Store](https://apps.apple.com/us/app/play-disney-parks/id1325935439)

- Queue mini-games that talk to attraction hardware (beacons).
- Star Wars: Galaxy’s Edge **Datapad** (hack / scan / tune / translate).
- **Batuu Bounty Hunters** with MagicBand+.
- Disney Fab 50 AR quest; trivia; achievements; playlists.
- Some features require park admission. Advertising in the listing.

This is IP entertainment. It is **not** a living map and **not** a Party. Park Bound **Side Quests** must stay fact-missions (height sign, queue pin, restroom), not Disney trivia or Aurebesh translators.

### 4. Disneyland Paris

**Role:** European wallet. 298 MB, iOS 15.1+, 8 languages, 4.3★ / 3.3K, v7.16. [App Store](https://apps.apple.com/us/app/disneyland-paris/id396908589), [Official](https://www.disneylandparis.com/en-usd/mobile-app)

- Buy/store park tickets; hotel booking + check-in; Digital MagicPass + digital key at two hotels ([official news](https://news.disneylandparis.com/en/mobile-check-in-digital-magic-pass-and-digital-key-new-services-offered-in-the-disneyland-paris-mobile-application-for-disney-hotel-residents/)).
- **Disney Premier Access One** (per-ride slot, same-day) and **Ultimate** (one use per available attraction, no slots; Orbitron excluded). [Official](https://www.disneylandparis.com/en-gb/attractions/disney-premier-access)
- Site still promotes a free **Standby Pass**; current App Store / Play copy **omits** it.
- Meet-and-greet **virtual queues** via the app after ticket scan (Fans Corner, 2025-04-18). Hero Training Center enlistment in store copy.
- Disney Picks + Wishlist; accessibility conditions per attraction.
- Waits, showtimes, interactive map + filters.
- Dining: book 2 months ahead (12 months for hotel guests); Click & Collect; menus; Meal Plan filter.
- PhotoPass is **not** in current store copy (hotel PhotoPass+ at Reception).
- No Genie, MagicBand+, or MagicMobile on official listings.

No official live family GPS. No community map edits.

### 5. Tokyo Disney Resort App

**Role:** Oriental Land Co. ops app. Bookings need **MyDisney (13+)** + GPS; **maps and wait times do not require login** ([FAQ](https://faq-en.tokyodisneyresort.jp/answer/680ba04871b483fd12254fb5/)). [Official](https://www.tokyodisneyresort.jp/en/tdr/app.html), [App Store](https://apps.apple.com/us/app/tokyo-disney-resort-app/id1313147771)

- Tickets; guide map; waits; restaurant + hotel booking; **Disney Mobile Order**.
- **Disney Premier Access** (paid, timed), **Entry Request** (free show virtual entry), **40th Anniversary Priority Pass** (free; **ends 2026-08-31**), **Standby Pass** (free — official FAQ: **shops**, not the US standby-line meaning). In-park only.
- **Disney Photo** in-app (scan Photo Key; JPEG/MP4 IAP).
- JP listing: in-app shopping shipped to the guest; hotel digital key **Japan residents only**.
- **Create Group** — share **tickets and plan details**. Not live location. Members without a phone can ride one smartphone for tickets/passes ([FAQ](https://faq-en.tokyodisneyresort.jp/answer/680ba04501fdf7431bafb3a0/)). [Official](https://www.tokyodisneyresort.jp/en/tdr/app/group.html)

Closest Disney analog to a **Party** — and it is still a **booking share**, not a mesh. No Genie / MagicBand+ / MagicMobile.

### 6. Hong Kong Disneyland

**Role:** Compact park OS. 542 MB, iOS 17+, 5 languages, 4.6★ / 6.2K, v8.22.0. [App Store](https://apps.apple.com/us/app/hong-kong-disneyland/id1077550649)

- Approximate waits; GPS map of **your** position; park hours; Character Greetings; showtimes; accessibility.
- Store listing does **not** say “buy tickets”; official press: reserve the park visit in-app. Premier Access and Standby Pass are official on the site/press but **omitted** from current store copy.
- 1-tap **call** for restaurant/hotel reservations (not DLP-style in-app table booking).
- Mobile food order; Magic Access member blockouts/discounts.
- **Magic AR** in World of Frozen (Elsa’s Ice Magic).
- Premier Access from HK$199 (advance website multi-pass); 1-Attraction same-day in the app ([terms](https://www.hongkongdisneyland.com/offers-discounts/disney-premier-access-1-attraction/details/)).
- Sibling **Hong Kong Disney PhotoPass** app (Pictureworks Pte Ltd — official-vendor, not Disney Electronic Content). [App Store](https://apps.apple.com/us/app/hong-kong-disney-photopass/id1130667769)
- Baidu map SDK (privacy note in listing).

### 7. Shanghai Disney Resort

**Role:** China wallet. 488 MB, iOS 16+, EN/ZH, 3.5★ / 156 US ratings, v13.9. [App Store](https://apps.apple.com/us/app/shanghai-disney-resort/id1073826118)

- Tickets + Annual Passes; waits; parade/show schedules.
- **Disney Standby Pass** + **Disney Premier Access** (single or set; party must have entered).
- GPS map (Baidu); Alipay; SMS PIN; government ID; facial recognition for some features.
- Hotels + Disneytown info. Dining mobile order is documented on a **WeChat Mini Program**, not the App Store feature list.
- Location only while the app is open (listing).

**Shanghai Disney Resort WeChat Mini Program** is an official guest surface — tickets, hotels, Premier Access ([official Premier Access](https://prod.origin-character-story.shanghaidisneyresort.com/tours/vip-premier-access/)). A store-listed **Disney PhotoPass** app (DIGI STUDIO) exists; SHDR HTML did not name it.

---

## Capability matrix

Legend: **Y** = official listing/help claims it · **P** = partial / filter / booking-only · **—** = not claimed · **n/a** = operator-only, Park Bound should not copy

| Capability | MDE | DLR | Play | DLP | TDR | HKDL | SHDL | **Park Bound** |
|------------|-----|-----|------|-----|-----|------|------|----------------|
| Tickets / reservations | Y | Y | — | Y | Y | P | Y | **n/a — do not add** |
| Paid skip-the-line | Y | Y | — | Y | Y | Y | Y | **n/a** |
| Virtual / standby queue | Y | Y | — | P | Y | P | Y | **n/a** |
| Dining reserve / Mobile Order | Y | Y | — | Y | Y | P | Mini Program | Places only (OSM) |
| Official waits / showtimes | Y | Y | — | Y | Y | Y | Y | **Ride report** + weather; no official feed |
| Character locations | Y | Y | — | Y | Y | Y | P | Not shipped |
| GPS map of **you** | Y | Y | beacons | Y | Y | Y | Y | Y + drawn OSM |
| Live map of **Party** | — | — | — | — | — | — | — | **Y** |
| Group = tickets/plans | Family & Friends | Family & Friends | — | — | **Create Group** | — | — | **Party** is live coordination |
| Height for *this family* | planDisney ″ filter | Advisories | — | Access copy | Website FAQ | Access copy | — | **Eligibility** from roster |
| Device-less child | Managed F&F profile | Same | — | — | One phone for tickets | — | — | Device-less **Member** |
| Meet / NEED HELP | — | — | — | — | — | — | — | **Y** |
| Landmark walking + offline | Directions (online) | Nav (online) | — | Map | Map | Map | Map | **Y (on-device)** |
| Facing **Compass** / Watch | — | — | — | — | — | — | — | **Y** |
| Guest-editable park truth | — | — | — | — | — | — | — | **Side Quests / Overlay** |
| Works at non-Disney parks | — | — | — | — | — | — | — | **Y (4 venues + any OSM)** |
| Offline-first day | Cache | Cache | Cache | — | Map/waits no login | — | Open-only GPS | **Premise** |
| Name-first, no operator account | Disney account | Disney account | Optional | Disney account | Browse free; buy = MyDisney 13+ | Browse free | ID/SMS | **Name is enough** |
| IP queue games / AR | Lenses | — | **Y** | Hero Training | Photo | Frozen AR | — | **No — stay fact quests** |
| Hotel key / folio | Y | Y | — | Y | JP only | Call | Y | **n/a** |
| Photo commerce | Y | Y | — | Hotel desk | Y | Sibling app | Sibling app | **n/a** |
| Cast chat | Y | Y | — | — | — | — | — | **n/a** |
| Car pin | Select lots | — | — | — | — | — | — | **Y (private to this phone)** |
| Campground / pitches | — | — | — | — | — | — | — | **Y (Cedar Point)** |
| Weather → ride outlook | — | Forecast waits | — | — | — | — | — | **Y (never claimed as ops)** |

---

## What Disney wins (do not copy)

These are **operator privileges**. Guests will keep the official app for them. Competing is a trap.

1. **Admission media** — tickets, MagicBand+ / MagicMobile (US only; **not found** on DLP/TDR/HK/SH store listings), park reservations. International skip-the-line is **Premier Access**, not Lightning Lane; no official **Genie** brand on those listings.
2. **Paid queue products** — Lightning Lane, Premier Access, Standby Pass, Entry Request. DLR Multi Pass **starts at $34/ticket/day** (official); WDW prices vary by park/date and are shown in-app (typically ~21 days). Not a map feature.
3. **Dining inventory** — reservations, Mobile Order, walk-up lists, Meal Plan.
4. **PhotoPass commerce** — Memory Maker $85–$210; DLR PhotoPass+ $25/day.
5. **Hotel** — check-in, digital key, folio.
6. **Official character / show schedule** — Disney’s own entertainment system.
7. **Cast chat / merchandise checkout** — both US resort apps.
8. **IP play** — Play Disney Parks, Frozen AR, Galaxy’s Edge datapad.

Park Bound’s data-sources guide already states the correct posture: *“Operating status — nobody’s but your own party’s. There is no ride-status feed here and the app never claims one.”* ([`../guide/data-sources.md`](../guide/data-sources.md))

---

## What Park Bound has that Disney does not

These are the reasons a family should open **Park Bound instead of** (or **open first, then**) the official app. Language matches [`CONTEXT.md`](../../CONTEXT.md).

### 1. A live **Party**, not a booking list

Disney **Family & Friends** (WDW/DLR) and Tokyo **Create Group** share *tickets and plans*. They do not put Dad on the map as “Dad · Orion” when he is in that queue. Park Bound **Location** is mandatory, Party-only, Place-named, last-known when stale, with battery visible. Join is name-first; a Disney account is not required.

Life360 sells this gap at WDW because the official app does not fill it.

### 2. **Eligibility** for the clump, not a height filter

Official MDE/DLR store copy does **not** list a height layer. planDisney describes filtering attractions by a requirement (e.g. 42″). Park Bound computes **Eligibility** from every **Member** on this phone’s **Subgroup** (including device-less kids) × attraction rules, paints the map alarm-red for the most restrictive person, and lists **Companion** when a grown-up is required. Unset height means not constrained — adults do not fade the map.

### 3. Device-less kids as first-class **Members**

Disney’s managed Family & Friends profiles exist so *you* can book Lightning Lane for a child. Park Bound’s device-less **Member** exists so the *map* knows Mia is 40″ and in your clump. **Managed Guest** saves her for next visit. Removing her from the roster does not delete the saved person.

### 4. **Meet** + NEED HELP

Disney has no shared rendezvous pin and no panic pulse. Park Bound has one **Meet**, walking time, facing arrow, and NEED HELP that vibrates every phone.

### 5. A drawn park, not a tile with pins

Disney maps are GPS overlays on illustrated / vendor tiles (Baidu in HK/Shanghai). Park Bound paints OSM geometry: midways, water, **actual coaster centrelines**. Tap Diamondback and *its* track lights. Nothing in the renderer names a park — a water park and a campground already shipped through the same pipeline.

### 6. Park-native walking that works in a dead zone

MDE advertises step-by-step directions; they need a connection and they do not name “bear right at Juke Box Diner.” Park Bound routes on-device, speaks landmark turns, goes course-up on **Go**, greys the path behind you, and still works with the network cut ([`../park-intelligence-review.md`](../park-intelligence-review.md) — tests enforce this).

### 7. Facing **Compass** (phone + Apple Watch)

Disney has no facing-relative radar for people. Park Bound’s **Compass** answers “which way is Grandma / the Meet / the next **Plan** stop?” over a crowd. Watch guests get the same marks plus density / Always On / turn haptics ([ADR-0011](../adr/0011-facing-compass.md)).

### 8. The map improves because you walked there

Disney guests cannot fix a wrong queue pin or a missing restroom. Park Bound **Gaps** → **Side Quests** → **Contribution** / **Overlay** (Pokémon GO go-to-the-spot + Waze report + Death Stranding leave-a-**Mark**). **XP** / **Title** live on the **Profile**. Play Disney Parks is the opposite loop: consume IP, do not improve park truth.

### 9. Honest ops when the official feed is wrong or unreachable

Disney waits need cell/Wi-Fi; the store listing admits they go stale. Park Bound trusts a **Ride report** you walked near and saw, fans it to the **Party** immediately, and only goes park-wide after a second independent **Party**. Weather predicts; it never marks a ride down.

### 10. One app for the family’s whole park year

A US family that does WDW, Cedar Point, and a water-park weekend today needs **My Disney Experience + Disneyland + Play Disney Parks** — and still has nothing at Cedar Point. Park Bound ships Kings Island, Cedar Point, Six Flags Fiesta Texas, and Big Kahuna’s, and `venues:build --place "…"` builds anywhere OSM covers. That is the category break: **venue-agnostic family radio**, not a seventh Disney wallet.

### 11. Offline-first, name-first, not a 500 MB sales channel

MDE/DLR/HKDL are ~530–550 MB, iOS 17, Disney account, in-app purchases, background location. Tokyo **requires** login. Park Bound is a PWA / store shell: browse and **Party** are free; paid unlock is a **Profile** at **$10/year** ([pricing research](./2026-08-14-parkbound-account-pricing.md)). No Lightning Lane, no PhotoPass upsell.

### 12. Campground + private car

Cedar Point’s Lighthouse Point pitches, hookups, and a car pin that **never** goes to the Party. Disney’s car locator is “select lots” and tied to the resort OS.

---

## What to add (priority)

Split: **steal the job, not the privilege.**

### P0 — Make Disney-going families able to *open* Park Bound there

| Add | Why | How (Park Bound language) |
|-----|-----|---------------------------|
| **Ship Disney Venues** | Without a Magic Kingdom / Disneyland / DLP / TDR / HKDL / SHDL map, the comparison is theoretical. The builder already has a Disney listing parser (`packages/venue-builder/lib/operators/disney.mjs`) and is venue-agnostic. | Builder → `*.map.json` / `*.pois.json` / `*.gaps.json`. Do **not** hand-edit generated JSON. Prove in the app. |
| **Height rules from public attraction pages** | Disney publishes minima; the app only *filters* by a number. Park Bound’s map paint is the better UI — but only if `overrides.json` has the inches. | Same override path as Cedar Point / KI. Cite park pages; “operator measures at the gate.” |
| **“Works alongside My Disney Experience”** | Guests will not delete MDE. Position: *tickets in Disney, family in Park Bound.* | Store / Me copy. Do not imply Park Bound replaces Lightning Lane. |

### P1 — Disney-shaped **Places**, still operator-agnostic

These are the useful half of MDE that are just **Places** + hours, not a wallet.

| Add | Disney analog | Park Bound fit |
|-----|---------------|----------------|
| Showtimes / parades / fireworks as **Places** (or timed events on a **Place**) | Showtimes, Character Greetings | Park-intelligence review already flagged `opening_hours` unused. Do not invent a second “itinerary” — fold into **Plan** + glance. |
| Character greeting **Places** (public locations only) | “Locate Favorite Characters” | Pins + walk time. No claim of live official feed unless licensed. |
| Accessibility flags on **Places** | DLP/HKDL/MDE accessibility copy | Wheelchair / transfer / DAS-adjacent *facts*, not a Disney DAS booker. |
| Park hours / calendar | Park hours | Venue-day context next to **Weather**. |
| Rider Switch / **Companion** copy | Disney Rider Switch | Eligibility already has **Companion**; surface the park’s published rider-swap rule as a note, not a booking. |

### P2 — Intelligence Disney advertises and Park Bound already half-has

| Add | Notes |
|-----|--------|
| Personal Tip Board | Disney Genie Tip Board = favorite waits. Park Bound **Plan** is the shared list; a personal star already exists in code and must stay **not** the **Plan**. A “watch these waits” chip is fine if it reads **Ride reports** + weather, not a fake official feed. |
| Forecasted waits | DLR store copy claims forecasted waits. Park Bound should keep **Weather → outlook** and never present it as an operations feed. |
| Stairs / stroller / shade on the walk graph | Park-intelligence: `highway=steps` still routes as flat midway. This is a live correctness problem at WDW *and* Cedar Point. |
| Food as **Places** with cuisine / hours | OSM `cuisine` / `diet:*` unread today. Useful; not Mobile Order. |

### P3 — Official wait ingest (only if licensed)

Do **not** scrape MDE. If a licensed or park-published wait source appears, it is an adapter behind the existing status layer: **Ride report** still beats a stale official number, same as today. Until then, the honesty gap *is* the brand.

### Explicitly reject

| Tempting Disney feature | Why reject |
|-------------------------|------------|
| Lightning Lane / Premier Access booking | Operator inventory. Becomes a sales channel. |
| Virtual queues | Same. |
| Dining reservations / Mobile Order | Same. |
| PhotoPass / Memory Maker | Commerce. |
| MagicMobile / hotel key | Hardware + folio. |
| Play Disney Parks clone | IP; fights **Side Quests**. |
| Family & Friends as a second roster | We already have **Party** + **Managed Guest**. |
| Background beacon wait-harvest | Disney uses beacons to improve *their* waits and to sell. We do not become a tracker. |
| 500 MB native rewrite | Offline JSON + PWA is the constraint that lets the app work in a queue. |

---

## Positioning — why open Park Bound

**At a Disney resort:** keep My Disney Experience / Disneyland / the local official app for the gate, Lightning Lane, dining, and photos. Open Park Bound so the family can see each other, know who can ride, walk without cell, drop a **Meet**, and mark a ride down when the official wait is a lie.

**Everywhere else:** there *is* no My Disney Experience. Park Bound is the app.

**One-line:** Disney’s apps sell the day. Park Bound runs the day — at every park, including theirs.

**Do not say:** “replacement for My Disney Experience.” That invites a feature-for-feature loss on tickets.

**Do say:** “The family radio Disney never shipped — and it works at Cedar Point too.”

---

## Shipped vs designed (honesty bar)

Do not sell Disney-going families a glossary term that is not on the phone.

**On the phone today** (see [`../guide/features.md`](../guide/features.md) and app modules): drawn OSM map, four venues, height **Eligibility**, live **Party** + **Meet** + NEED HELP, glance rail, on-device walking + **Compass**, weather outlook, party **Ride reports**, car pin, campground, **Side Quests** from shipped **Gaps**, **Plan**.

**In language / ADRs, still consolidating:** park-wide **Observation** / **Overlay** second-**Party** bar, **Marks** / **Thanks**, **Skin** / **Kit**, **Profile** XP **Titles**, Watch settings polish. Those strengthen the Disney contrast when they ship; they are not required to win the “family radio” argument.

**Not shipped:** any Disney **Venue**. Until a Magic Kingdom (or DLR) bundle exists, the P0 row above is the only gap that makes this research actionable.

---

## Sources

### Official

- [My Disney Experience — App Store](https://apps.apple.com/us/app/my-disney-experience/id547436543)
- [WDW mobile apps](https://disneyworld.disney.go.com/guest-services/my-disney-experience/mobile-apps/)
- [WDW MagicMobile](https://disneyworld.disney.go.com/guest-services/magic-mobile)
- [WDW merchandise checkout](https://disneyworld.disney.go.com/guest-services/merchandise-mobile-checkout/)
- [WDW virtual queues](https://disneyworld.disney.go.com/guest-services/virtual-queue/)
- [WDW access the magic](https://disneyworld.disney.go.com/guest-services/access-the-magic/)
- [WDW Lightning Lane](https://disneyworld.disney.go.com/lightning-lane-passes/)
- [WDW Disney Genie](https://disneyworld.disney.go.com/genie/)
- [MDE legal / Family & Friends](https://disneyworld.disney.go.com/park-experience-terms-conditions/)
- [Disneyland — App Store](https://apps.apple.com/us/app/disneyland/id1022164656)
- [DLR official app](https://disneyland.disney.go.com/guest-services/download-disneyland-mobile-app/)
- [DLR Lightning Lane](https://disneyland.disney.go.com/lightning-lane-passes/)
- [DLR virtual queues](https://disneyland.disney.go.com/guest-services/virtual-queue/)
- [DLR merchandise checkout](https://disneyland.disney.go.com/guest-services/merchandise-mobile-checkout/)
- [DLR experience updates](https://disneyland.disney.go.com/experience-updates/)
- [DLR press — app / digital](https://disneyexperiences.com/disneyland-press/fact/maximize-a-disneyland-resort-visit-with-the-disneyland-app-and-digital-technology/)
- [DLR Mobile Order](https://disneyland.disney.go.com/guest-services/mobile-food-orders/)
- [Play Disney Parks — DLR](https://disneyland.disney.go.com/guest-services/play-app/)
- [Play Disney Parks — App Store](https://apps.apple.com/us/app/play-disney-parks/id1325935439)
- [Galaxy’s Edge Play app — WDW](https://disneyworld.disney.go.com/attractions/hollywood-studios/star-wars-galaxys-edge-play-app/)
- [Disneyland Paris — App Store](https://apps.apple.com/us/app/disneyland-paris/id396908589)
- [Disneyland Paris mobile app](https://www.disneylandparis.com/en-usd/mobile-app)
- [Tokyo Disney Resort App](https://www.tokyodisneyresort.jp/en/tdr/app.html)
- [TDR App Store](https://apps.apple.com/us/app/tokyo-disney-resort-app/id1313147771)
- [TDR Create Group](https://www.tokyodisneyresort.jp/en/tdr/app/group.html)
- [TDR Standby Pass](https://www.tokyodisneyresort.jp/en/tdr/guide/app_service/standbypass.html)
- [TDR Premier Access / Standby FAQ](https://faq-en.tokyodisneyresort.jp/answer/680ba05101fdf7431bafb6b0/)
- [Hong Kong Disneyland — App Store](https://apps.apple.com/us/app/hong-kong-disneyland/id1077550649)
- [HKDL Premier Access terms](https://www.hongkongdisneyland.com/offers-discounts/disney-premier-access-1-attraction/details/)
- [Shanghai Disney Resort — App Store](https://apps.apple.com/us/app/shanghai-disney-resort/id1073826118)

### Official-adjacent (planDisney = Disney Destinations panelists)

- [Height filter in MDE](https://plandisney.disney.go.com/question/list-rides-walt-disney-world-height-requirements-plan-609134/)
- [Get Directions in MDE](https://plandisney.disney.go.com/question/directions-feature-disney-app-378596/)

### Secondary (labeled)

- [Shop Disney Parks retired](https://touringplans.com/blog/shop-disney-parks-app-retired/)
- [Life360 — track family at WDW](https://www.life360.com/en-gb/blog/how-to-track-everything-at-disney-world)
- Undercover Tourist / Disney Food Blog UI walkthroughs — not used as capability claims unless they repeat store copy.

---

## Decision this note does **not** make

Shipping a Disney **Venue** is a builder + height-override + store-copy task, not a new product. It does not reopen **Party**, **Eligibility**, or **Side Quests**. It does not authorize a Lightning Lane feature. If someone wants official waits, that is a new grill: licensed source vs scrape (reject scrape) vs keep **Ride reports** only.
