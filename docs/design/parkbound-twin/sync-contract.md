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

**Updated 2026-08-20 after the import landed.** Paths are relative to
`apps/party-tracker` unless they start with `packages/` or are repo-root files.

Two things this table got wrong before, kept here because they are the reason
the whole reconciliation was expensive: it pointed at `components/WorldPicker.jsx`
and `lib/worlds.js`, and **neither existed** — that screen was split across
`GpsGate`'s inner `ParkSection` and `ParkPrompt.jsx`. `WorldPicker.jsx` genuinely
exists now; `lib/worlds.js` never did, and the real module is `lib/venueIndex.js`.

Every path below was verified against the working tree. The same table lives in
`scripts/lib/design-bundle/sources.mjs` as `SCREEN_MAP`, where
`npm run design:check` re-verifies it on every run — so the next time a component
moves, CI says so instead of a design session finding out. See
[`../WORKING-WITH-CLAUDE-DESIGN.md`](../WORKING-WITH-CLAUDE-DESIGN.md).

| Project screen | Repo files |
| --- | --- |
| Sign in (Profile gate) | components/AuthGate.jsx, components/AuthGateActions.jsx, components/OAuthButtons.jsx, components/SignInCard.jsx, lib/auth/authCopy.js |
| Intro / onboarding | components/IntroSplash.jsx, lib/brand.js, lib/introGate.js |
| Location gate | components/GpsGate.jsx, components/ParkPrompt.jsx, lib/geo.js |
| World pick | components/WorldPicker.jsx, lib/venueIndex.js |
| Explore (map + sheet) | components/ParkMap.jsx, components/PlaceList.jsx, lib/sheet.js, lib/theme.js, lib/mapThemeTokens.js |
| Selection capsule | components/SelectionCapsule.jsx |
| Spot (bare-ground tap) | components/SpotCapsule.jsx, components/SpotBanner.jsx, lib/spot.js |
| Map furniture (Key, scale) | components/MapLegend.jsx, components/MapSymbols.jsx, components/MapAttribution.jsx |
| Plan (Stops + Heights) | components/PlanPanel.jsx, components/PlanStops.jsx, components/HeightPanel.jsx, lib/park.js, lib/plan.js, lib/eligibility.js |
| Place detail | components/PlaceDetail.jsx |
| Party + roster | components/PartyPanel.jsx, lib/party/client.js |
| Walking directions | components/NavBar.jsx, components/NavBanner.jsx, components/DirectionsPanel.jsx, components/RoutePreview.jsx, lib/routing.js |
| Side Quests (tab root) | components/SideQuestsPanel.jsx, lib/sideQuests.js |
| Me (tab root) | components/MePanel.jsx, components/ProfileJourney.jsx, components/TitleProgress.jsx, components/RankPrizeCatalog.jsx, packages/shared/questScore.js |
| Settings (pushed under Me) | components/SettingsPanel.jsx, components/InstallCard.jsx, components/NameOnFinds.jsx, lib/credits.js |
| Notifications (pushed under Settings) | components/PushSettings.jsx |
| What the panel shows (pushed under Settings) | components/HiddenCards.jsx |
| Collection (pushed under Me) | components/WorldCloset.jsx, lib/world.js |
| Marks (pushed under Collection) | components/WorldMarks.jsx, lib/worldMarks.js |
| Walk history (pushed under Settings) | components/MovementHistoryPanel.jsx |
| Diagnostics (pushed under Settings) | components/Diagnostics.jsx |
| Chrome (tabs, compass) | components/TabBar.jsx, components/CompassTape.jsx, app/page.js, app/globals.css |
| Icons & brand marks | components/Icon.jsx, components/BrandMark.jsx, components/BrandLockup.jsx, public/icon.svg |
| Language / copy | CONTEXT.md, lib/brand.js |

### On disk, mounted nowhere
A file existing is a weaker fact than a file being used.

| File | Why |
| --- | --- |
| components/GlanceRail.jsx | Explore is search → context → list now; the rail is not mounted anywhere. Kept on disk so the removal stays revertible. |

### What moved in this import
- **Me is a root.** It opens on the guest's own standing; Settings and Collection
  are pushed views beneath it, and Marks is pushed beneath Collection. The old
  single `Settings (You/Map/Phone/More)` row is now four rows.
- **`WorldPicker.jsx` exists**, used by both `GpsGate` and `ParkPrompt`.
- **Marks split out of Collection** into `WorldMarks.jsx`, and only `sign` and
  `beacon` are hand-placeable — see `PLACEABLE_MARK_TYPES` in `lib/world.js`.
- **New:** `SpotCapsule`, `SpotBanner` and `lib/spot.js` (the bare-ground map
  tap), `SelectionCapsule`, `MePanel`, `NameOnFinds`, `PushSettings`,
  `HiddenCards`.

## Sync history
- 2026-08-20 — **screen map corrected in-repo after the import landed**, not by a
  design-side sync: Me became a root with Settings / Collection / Marks pushed
  beneath it, `WorldPicker.jsx` became real, `GlanceRail` came unmounted, and the
  Spot flow arrived. Every path re-verified, and the table put under
  `npm run design:check` so it cannot rot silently again.
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
