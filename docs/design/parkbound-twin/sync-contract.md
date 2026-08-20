repo: parthalon025/six-flags-sa
branch: main
path: apps/party-tracker

## Last sync
date: 2026-08-20T00:15:14Z

### Updated in this project
- Marks is its own sub-menu, split the way lib/world.js actually works: Sign and Beacon are placeable by hand; Plaque, Lantern, Cairn and Sticker are listed as left automatically by recordSideQuest (height → plaque + lantern, geometry/path → cairn, any Place → sticker) and are not selectable.
- Each type carries a one-line explanation, and placing requires an anchored spot from a map tap.
- Kits and Marks use their real Icon.jsx glyphs per KIT_ICONS / MARK_ICONS.
- Map taps: a Place pin opens its detail; bare ground drops a pin and offers Side Quest here or Leave a Mark, carrying the point through.

### Tracking
Tracking `main` at `apps/party-tracker`. On a sync: read this file, pull what changed since the date above, rebuild only the screens the Screen map ties to changed files, then rewrite this section.

## Screen map
| Project screen | Repo files |
| --- | --- |
| Sign in (Profile gate) | components/AuthGate.jsx, components/OAuthButtons.jsx, lib/auth/authCopy.js |
| Intro / onboarding | components/IntroSplash.jsx, lib/brand.js, lib/introGate.js |
| Location gate | components/GpsGate.jsx |
| World pick | components/WorldPicker.jsx, lib/worlds.js |
| Explore (map + capsule) | components/ParkMap.jsx, lib/sheet.js, lib/theme.js, lib/mapThemeTokens.js |
| Map furniture (Key, scale) | components/MapLegend.jsx, components/MapSymbols.jsx |
| Plan (Stops + Heights) | components/PlanPanel.jsx, components/PlanStops.jsx, components/HeightPanel.jsx, lib/park.js, lib/plan.js, lib/eligibility.js |
| Place detail | components/PlaceDetail.jsx |
| Party + roster | components/PartyPanel.jsx, lib/party/client.js |
| Walking directions | components/NavBar.jsx, components/DirectionsPanel.jsx, lib/routing.js |
| Side Quests (tab root) | components/SideQuestsPanel.jsx, lib/sideQuests.js |
| Me / journey | components/ProfileJourney.jsx, components/TitleProgress.jsx, packages/shared/questScore.js |
| Settings (You/Map/Phone/More) | components/SettingsPanel.jsx, components/InstallCard.jsx |
| Collection (Skins/Kits/Marks) | components/WorldCloset.jsx, lib/world.js, lib/worldMarks.js |
| Chrome (tabs, compass) | components/TabBar.jsx, components/CompassTape.jsx, app/page.js, app/globals.css |
| Icons & brand marks | components/Icon.jsx, components/BrandMark.jsx, public/icon.svg |
| Language / copy | CONTEXT.md, lib/brand.js |

## Sync history
- 2026-08-20T00:09Z — real Kit/Mark glyphs, location-aware map taps.
- 2026-08-20T00:05Z — Collection screen (WorldCloset).
- 2026-08-19T15:12Z — polish pass over all screens in both palettes.
- 2026-08-19T15:03Z — sign-in gate, Settings topics, Appearance automatic.
- 2026-08-19T14:58Z — five-tab bar per TAB_ORDER, Side Quests as a tab root.
- 2026-08-19T14:43Z — heights moved onto Party Members per lib/eligibility.js.
- 2026-08-19T14:22Z — map Key and scale, Plan Stops section.
- 2026-08-19T14:14Z — real Icon.jsx / BrandMark.jsx glyphs.
- 2026-08-19T13:53Z — copy rewritten against CONTEXT.md glossary.
- 2026-08-19T13:25Z — first build from apps/party-tracker.

## Not yet in the twin
Walk history, Diagnostics, QR scan join, Managed Guests, Subgroup tags, route alternates.
