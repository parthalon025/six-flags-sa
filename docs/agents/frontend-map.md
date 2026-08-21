# Front-end map

<!-- GENERATED FILE — do not edit by hand.
     Written by scripts/frontend-map.mjs (scripts/lib/frontend-map/).
     Rebuild: npm run frontend:map      Verify: npm run frontend:map:check -->

Everything below is read out of the app at build time. Nothing here is transcribed, so
this file is wrong only for as long as the code is — which is the whole point: the
hand-written screen map this replaces named `components/WorldPicker.jsx` and
`lib/worlds.js`, and neither existed.

**Before you touch a component, read the screen table.** Before you touch a class, check
whether it is shared.

Read from: `apps/party-tracker/app/page.js`, `apps/party-tracker/components`, `apps/party-tracker/app/globals.css`, `docs/agents/policies/builder-app-contract.md`.

## Screens → the component that owns them

Derived from `apps/party-tracker/app/page.js`: `TAB_ORDER` and `ROOT_TITLES` for the tab roots,
`VIEW_TITLES` for the pushed screens, and the `{view === … && (` render branch that
draws each one. **Owner** is what the branch mounts directly; **also renders** is
everything deeper, which is furniture inside markup `page.js` writes itself. A screen
whose branch mounts no component of its own says so — that is where the edit goes.

| screen | kind | title | owner | also renders | branch |
| --- | --- | --- | --- | --- | --- |
| `explore` | tab | (the search field — no large title) | `PlaceList` — `apps/party-tracker/components/PlaceList.jsx` | — | apps/party-tracker/app/page.js:3334 |
| `party` | tab | Party | `PartyPanel` — `apps/party-tracker/components/PartyPanel.jsx` | `IntelligencePanel` | apps/party-tracker/app/page.js:3411 |
| `quests` | tab | Side Quests | `SideQuestsPanel` — `apps/party-tracker/components/SideQuestsPanel.jsx` | — | apps/party-tracker/app/page.js:3573 |
| `rides` | tab | Plan | `PlanPanel` — `apps/party-tracker/components/PlanPanel.jsx` | — | apps/party-tracker/app/page.js:3602 |
| `settings` | tab | Me | `MePanel` — `apps/party-tracker/components/MePanel.jsx` | — | apps/party-tracker/app/page.js:3643 |
| `route` | view | Trail | `DirectionsPanel` — `apps/party-tracker/components/DirectionsPanel.jsx` | — | apps/party-tracker/app/page.js:3375 |
| `place` | view | Place | `PlaceDetail` — `apps/party-tracker/components/PlaceDetail.jsx` | — | apps/party-tracker/app/page.js:3388 |
| `categories` | view | On the map | **drawn inline** in `apps/party-tracker/app/page.js` | — | apps/party-tracker/app/page.js:3793 |
| `venues` | view | Explore Worlds | **drawn inline** in `apps/party-tracker/app/page.js` | `Icon` | apps/party-tracker/app/page.js:3819 |
| `diagnostics` | view | Diagnostics | `Diagnostics` — `apps/party-tracker/components/Diagnostics.jsx` | — | apps/party-tracker/app/page.js:3895 |
| `movement` | view | Walk history | `MovementHistoryPanel` — `apps/party-tracker/components/MovementHistoryPanel.jsx` | — | apps/party-tracker/app/page.js:3789 |
| `watch-compass` | view | Watch Compass | `WatchCompassSettings` — `apps/party-tracker/components/WatchCompassSettings.jsx` | — | apps/party-tracker/app/page.js:3766 |
| `closet` | view | Collection | `WorldCloset` — `apps/party-tracker/components/WorldCloset.jsx` | — | apps/party-tracker/app/page.js:3709 |
| `marks` | view | Marks | `WorldMarks` — `apps/party-tracker/components/WorldMarks.jsx` | — | apps/party-tracker/app/page.js:3737 |
| `notifications` | view | Notifications | `PushSettings` — `apps/party-tracker/components/PushSettings.jsx` | — | apps/party-tracker/app/page.js:3690 |
| `hidden-cards` | view | What the panel shows | `HiddenCards` — `apps/party-tracker/components/HiddenCards.jsx` | — | apps/party-tracker/app/page.js:3701 |

### Chrome and overlays

Mounted by `apps/party-tracker/app/page.js` outside any screen branch: the map under the sheet, the tab
bar, and the gates and splashes that cover them. Editing one of these changes every
screen at once.

- `AuthBridge` — `apps/party-tracker/components/AuthBridge.jsx`
- `AuthGate` — `apps/party-tracker/components/AuthGate.jsx`
- `BrandLockup` — `apps/party-tracker/components/BrandLockup.jsx`
- `BrandMark` — `apps/party-tracker/components/BrandMark.jsx`
- `CompassTape` — `apps/party-tracker/components/CompassTape.jsx`
- `DisplayMap` — `apps/party-tracker/components/DisplayMap.jsx`
- `GpsGate` — `apps/party-tracker/components/GpsGate.jsx`
- `IntroSplash` — `apps/party-tracker/components/IntroSplash.jsx`
- `MapAttribution` — `apps/party-tracker/components/MapAttribution.jsx`
- `NavBanner` — `apps/party-tracker/components/NavBanner.jsx`
- `NavBar` — `apps/party-tracker/components/NavBar.jsx`
- `ParkMap` — `apps/party-tracker/components/ParkMap.jsx`
- `ParkPrompt` — `apps/party-tracker/components/ParkPrompt.jsx`
- `RoutePreview` — `apps/party-tracker/components/RoutePreview.jsx`
- `SelectionCapsule` — `apps/party-tracker/components/SelectionCapsule.jsx`
- `SpotCapsule` — `apps/party-tracker/components/SpotCapsule.jsx`
- `TabBar` — `apps/party-tracker/components/TabBar.jsx`
- `VenueLoadFade` — `apps/party-tracker/components/VenueLoadFade.jsx`
- `WeatherBanner` — `apps/party-tracker/components/WeatherBanner.jsx`

### On disk, imported by nothing

- `GlanceRail.jsx`
- `UpdateSplash.jsx`

A file no importer names is not necessarily dead, but editing one ships nothing. Check
before you spend a pass on it.

## Shared classes — changing one is a cross-screen edit

Every class name that appears in a `className` on two or more files under
`apps/party-tracker/components/` or in `app/page.js`. Static names only: a
`${…}` hole in a template contributes nothing, because a class that only exists at
runtime is not a class this map can promise anything about.

**A class on this list is shared. Do not give it a local override.** Four agents each
patching `.chip.on` in their own component is how one considered change becomes four
that disagree; settle the rule once, in `globals.css`, before anyone edits.

`rule?` is whether `globals.css` has a selector for the name — **no rule** means the
class is being written and nothing styles it.

| class | files | rule? | used by |
| --- | --- | --- | --- |
| `.fine` | 28 | yes | `AuthGateActions.jsx` `Diagnostics.jsx` `DirectionsPanel.jsx` `HeightPanel.jsx` `HiddenCards.jsx` `InstallCard.jsx` `IntroSplash.jsx` `MePanel.jsx` `MovementHistoryPanel.jsx` `NameOnFinds.jsx` `PartyPanel.jsx` `PlaceDetail.jsx` `PlaceList.jsx` `PlanPanel.jsx` `PlanStops.jsx` `ProfileJourney.jsx` `PushSettings.jsx` `QrScanner.jsx` `RankPrizeCatalog.jsx` `RoutePreview.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `SignInCard.jsx` `UpdateSplash.jsx` `WatchCompassSettings.jsx` `WorldCloset.jsx` `WorldMarks.jsx` `page.js` |
| `.on` | 22 | yes | `GlanceRail.jsx` `GpsGate.jsx` `HeightPanel.jsx` `IntelligencePanel.jsx` `IntroSplash.jsx` `MapLegend.jsx` `NameOnFinds.jsx` `NavBar.jsx` `PartyPanel.jsx` `PlaceDetail.jsx` `PlaceList.jsx` `PlanPanel.jsx` `RoutePreview.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `TabBar.jsx` `WatchCompassSettings.jsx` `WeatherBanner.jsx` `WorldCloset.jsx` `WorldMarks.jsx` `WorldPicker.jsx` `page.js` |
| `.btn` | 21 | yes | `DirectionsPanel.jsx` `GlanceRail.jsx` `GpsGate.jsx` `InstallCard.jsx` `IntelligencePanel.jsx` `IntroSplash.jsx` `PartyPanel.jsx` `PlaceDetail.jsx` `PlaceList.jsx` `PlanStops.jsx` `PushSettings.jsx` `QrScanner.jsx` `SelectionCapsule.jsx` `SideQuestsPanel.jsx` `SignInCard.jsx` `SpotCapsule.jsx` `UpdateSplash.jsx` `WatchCompassSettings.jsx` `WorldMarks.jsx` `WorldPicker.jsx` `page.js` |
| `.label` | 20 | yes | `Diagnostics.jsx` `DirectionsPanel.jsx` `HeightPanel.jsx` `HiddenCards.jsx` `IntelligencePanel.jsx` `MePanel.jsx` `MovementHistoryPanel.jsx` `PartyPanel.jsx` `PlaceList.jsx` `PlanPanel.jsx` `ProfileJourney.jsx` `PushSettings.jsx` `RankPrizeCatalog.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `SignInCard.jsx` `WatchCompassSettings.jsx` `WorldCloset.jsx` `WorldMarks.jsx` `WorldPicker.jsx` |
| `.primary` | 15 | yes | `DirectionsPanel.jsx` `GpsGate.jsx` `InstallCard.jsx` `IntroSplash.jsx` `PartyPanel.jsx` `PlaceDetail.jsx` `PushSettings.jsx` `SelectionCapsule.jsx` `SideQuestsPanel.jsx` `SpotCapsule.jsx` `UpdateSplash.jsx` `WatchCompassFace.jsx` `WorldMarks.jsx` `WorldPicker.jsx` `page.js` |
| `.small` | 14 | yes | `DirectionsPanel.jsx` `GlanceRail.jsx` `IntelligencePanel.jsx` `IntroSplash.jsx` `PartyPanel.jsx` `PlaceDetail.jsx` `PlaceList.jsx` `PlanStops.jsx` `QrScanner.jsx` `SelectionCapsule.jsx` `SideQuestsPanel.jsx` `SpotCapsule.jsx` `WorldMarks.jsx` `page.js` |
| `.row` | 12 | yes | `HiddenCards.jsx` `MePanel.jsx` `MovementHistoryPanel.jsx` `NameOnFinds.jsx` `ProfileJourney.jsx` `PushSettings.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `WatchCompassSettings.jsx` `WorldCloset.jsx` `WorldMarks.jsx` `page.js` |
| `.rowList` | 12 | yes | `HiddenCards.jsx` `MePanel.jsx` `MovementHistoryPanel.jsx` `NameOnFinds.jsx` `ProfileJourney.jsx` `PushSettings.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `WatchCompassSettings.jsx` `WorldCloset.jsx` `WorldMarks.jsx` `page.js` |
| `.rowText` | 12 | yes | `HiddenCards.jsx` `MePanel.jsx` `MovementHistoryPanel.jsx` `NameOnFinds.jsx` `ProfileJourney.jsx` `PushSettings.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `WatchCompassSettings.jsx` `WorldCloset.jsx` `WorldMarks.jsx` `page.js` |
| `.block` | 10 | yes | `AuthGateActions.jsx` `DirectionsPanel.jsx` `HeightPanel.jsx` `MovementHistoryPanel.jsx` `PartyPanel.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `SignInCard.jsx` `WatchCompassSettings.jsx` `WorldMarks.jsx` |
| `.rect` | 10 | yes | `GpsGate.jsx` `IntroSplash.jsx` `PartyPanel.jsx` `PlaceDetail.jsx` `PushSettings.jsx` `SideQuestsPanel.jsx` `SpotCapsule.jsx` `WorldMarks.jsx` `WorldPicker.jsx` `page.js` |
| `.chip` | 9 | yes | `HeightPanel.jsx` `IntelligencePanel.jsx` `MovementHistoryPanel.jsx` `PartyPanel.jsx` `PlaceList.jsx` `SideQuestsPanel.jsx` `WorldCloset.jsx` `WorldMarks.jsx` `page.js` |
| `.rowValue` | 9 | yes | `HiddenCards.jsx` `MovementHistoryPanel.jsx` `ProfileJourney.jsx` `PushSettings.jsx` `SettingsPanel.jsx` `WatchCompassSettings.jsx` `WorldCloset.jsx` `WorldMarks.jsx` `page.js` |
| `.chips` | 8 | yes | `HeightPanel.jsx` `IntelligencePanel.jsx` `MovementHistoryPanel.jsx` `PartyPanel.jsx` `PlaceList.jsx` `SideQuestsPanel.jsx` `WorldMarks.jsx` `page.js` |
| `.flat` | 8 | yes | `HiddenCards.jsx` `NameOnFinds.jsx` `ProfileJourney.jsx` `PushSettings.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `WorldCloset.jsx` `WorldMarks.jsx` |
| `.gate` | 6 | yes | `AuthGate.jsx` `GpsGate.jsx` `IntroSplash.jsx` `ParkPrompt.jsx` `UpdateSplash.jsx` `page.js` |
| `.wrap` | 6 | yes | `IntelligencePanel.jsx` `MovementHistoryPanel.jsx` `PartyPanel.jsx` `SideQuestsPanel.jsx` `WorldMarks.jsx` `page.js` |
| `.field` | 5 | yes | `PartyPanel.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` `WorldPicker.jsx` `page.js` |
| `.gateCard` | 5 | yes | `AuthGate.jsx` `GpsGate.jsx` `IntroSplash.jsx` `ParkPrompt.jsx` `UpdateSplash.jsx` |
| `.approx` | 4 | yes | `NavBanner.jsx` `PartyPanel.jsx` `PlaceDetail.jsx` `RoutePreview.jsx` |
| `.btnQuiet` | 4 | yes | `AuthGateActions.jsx` `GpsGate.jsx` `InstallCard.jsx` `WorldPicker.jsx` |
| `.gateEyebrow` | 4 | yes | `GpsGate.jsx` `IntroSplash.jsx` `ParkPrompt.jsx` `UpdateSplash.jsx` |
| `.gateFine` | 4 | yes | `AuthGate.jsx` `GpsGate.jsx` `UpdateSplash.jsx` `WorldPicker.jsx` |
| `.icn` | 4 | yes | `IntroSplash.jsx` `NavBar.jsx` `WorldPicker.jsx` `page.js` |
| `.joinRow` | 4 | yes | `DirectionsPanel.jsx` `PartyPanel.jsx` `PlaceDetail.jsx` `PlanStops.jsx` |
| `.labelRight` | 4 | yes | `DirectionsPanel.jsx` `PartyPanel.jsx` `PlaceList.jsx` `WorldPicker.jsx` |
| `.muted` | 4 | yes | `AuthGateActions.jsx` `GpsGate.jsx` `WatchCompassFace.jsx` `WorldPicker.jsx` |
| `.accent` | 3 | yes | `PushSettings.jsx` `SettingsPanel.jsx` `WorldCloset.jsx` |
| `.codeBox` | 3 | yes | `DirectionsPanel.jsx` `IntroSplash.jsx` `PartyPanel.jsx` |
| `.dayMoment` | 3 | yes | `MovementHistoryPanel.jsx` `SettingsPanel.jsx` `SideQuestsPanel.jsx` |
| `.earned` | 3 | yes | `ProfileJourney.jsx` `RankPrizeCatalog.jsx` `WorldMarks.jsx` |
| `.gateFirstRun` | 3 | yes | `GpsGate.jsx` `IntroSplash.jsx` `page.js` |
| `.warnText` | 3 | yes | `AuthGateActions.jsx` `PartyPanel.jsx` `SignInCard.jsx` |
| `.bad` | 2 | yes | `Diagnostics.jsx` `HeightPanel.jsx` |
| `.brandMark` | 2 | yes | `MovementHistoryPanel.jsx` `SettingsPanel.jsx` |
| `.codeText` | 2 | yes | `IntroSplash.jsx` `PartyPanel.jsx` |
| `.column` | 2 | yes | `DirectionsPanel.jsx` `PartyPanel.jsx` |
| `.confirmed` | 2 | yes | `NavBanner.jsx` `PlaceDetail.jsx` |
| `.dayTrailPath` | 2 | yes | `IntelligencePanel.jsx` `MovementHistoryPanel.jsx` |
| `.dot` | 2 | yes | `PlaceDetail.jsx` `PlaceList.jsx` |
| `.gateBrandLockup` | 2 | yes | `AuthGate.jsx` `GpsGate.jsx` |
| `.gateError` | 2 | yes | `GpsGate.jsx` `WorldPicker.jsx` |
| `.gateStep` | 2 | yes | `GpsGate.jsx` `WorldPicker.jsx` |
| `.gateStepLabel` | 2 | yes | `GpsGate.jsx` `WorldPicker.jsx` |
| `.gateSteps` | 2 | yes | `GpsGate.jsx` `WorldPicker.jsx` |
| `.ghost` | 2 | **no rule** | `SignInCard.jsx` `WatchCompassSettings.jsx` |
| `.iconOnly` | 2 | yes | `PartyPanel.jsx` `PlaceDetail.jsx` |
| `.introList` | 2 | yes | `IntroSplash.jsx` `UpdateSplash.jsx` |
| `.labelAction` | 2 | yes | `HeightPanel.jsx` `PartyPanel.jsx` |
| `.mapWrap` | 2 | yes | `DisplayMap.jsx` `ParkMap.jsx` |
| `.markGlyph` | 2 | yes | `WorldCloset.jsx` `WorldMarks.jsx` |
| `.open` | 2 | yes | `MapLegend.jsx` `PlaceList.jsx` |
| `.poiHalo` | 2 | yes | `MapSymbols.jsx` `ParkMap.jsx` |
| `.searchField` | 2 | yes | `WorldPicker.jsx` `page.js` |
| `.searchIn` | 2 | yes | `WorldPicker.jsx` `page.js` |
| `.segmented` | 2 | yes | `SettingsPanel.jsx` `WatchCompassSettings.jsx` |
| `.settingsTopic` | 2 | yes | `PlanPanel.jsx` `SettingsPanel.jsx` |
| `.settingsTopics` | 2 | yes | `PlanPanel.jsx` `SettingsPanel.jsx` |
| `.signInActions` | 2 | yes | `AuthGateActions.jsx` `SignInCard.jsx` |
| `.tab` | 2 | yes | `SettingsPanel.jsx` `WatchCompassSettings.jsx` |
| `.updateNotesBlock` | 2 | yes | `IntroSplash.jsx` `UpdateSplash.jsx` |
| `.updateNotesVersion` | 2 | yes | `IntroSplash.jsx` `UpdateSplash.jsx` |
| `.venueList` | 2 | yes | `WorldPicker.jsx` `page.js` |
| `.venueRow` | 2 | yes | `WorldPicker.jsx` `page.js` |
| `.verdict` | 2 | yes | `PlaceDetail.jsx` `PlaceList.jsx` |
| `.wxWhy` | 2 | yes | `PlaceDetail.jsx` `WeatherBanner.jsx` |

Total distinct classes in use: **575**, of which **66** are shared.

## Constants that exist twice

A CSS custom property and a JS constant that have to hold the same number are two
copies of one decision, and two copies drift. `--peek` said `308px` while
`SHEET_PEEK_PX` computed `236`; no test failed, because the layout was not broken —
only briefly wrong on the first paint, at the one stop the app rests on.

The pairs are not kept in a list here. `globals.css` states each one in its own
comment — "This must equal SHEET_PEEK_PX in lib/sheet.js", "Held in step with
NIGHT_BARRED / DAY_BARRED in lib/theme.js" — and this table is that sentence, read.
Write the relationship as `CONSTANT in path/to/file.js` and it gets checked from the
next build.

`npm run frontend:map:check` **fails** on a diverged pair.

| token | palette | CSS | constant | file | JS | state |
| --- | --- | --- | --- | --- | --- | --- |
| `--peek` | night | `236px` | `SHEET_PEEK_PX` | `apps/party-tracker/lib/sheet.js` | `236` | agree |
| `--shut` | night | `84px` | `SHUT_PX` | `apps/party-tracker/app/page.js` | — | **unresolved** |
| `--barred` | night | `#FF6B6B` | `NIGHT_BARRED` | `apps/party-tracker/lib/theme.js` | `#FF6B6B` | agree |
| `--barred` | day | `#D64545` | `DAY_BARRED` | `apps/party-tracker/lib/theme.js` | `#D64545` | agree |

## Contrast — measured, not eyeballed

Both palettes, from the same `globals.css` the app ships. This app is used outdoors in
direct sun and the stylesheet already records that a lighter treatment "fails on outdoor
glare", so a pairing that is merely close to its floor is a pairing to look at.

| pairing | use | where | floor | Park Midnight | Trail | state |
| --- | --- | --- | --- | --- | --- | --- |
| `--label` on `--bg` | Body text on the app background | `html, body` | 4.5:1 | 16.23 | 14.32 | passes |
| `--label` on `--bg2` | Body text on a sheet | `.sheet` | 4.5:1 | 14.32 | 15.74 | passes |
| `--label2` on `--bg2` | Secondary ink on a sheet | `.questBlurb` | 4.5:1 | 6.31 | 4.57 | passes |
| `#0B1829` on `--aqua` | Dark ink on a selected topic chip | `.settingsTopic.on` | 4.5:1 | 7.28 | 7.28 | passes |
| `--onTint` on `--adventure` | White on the primary action | `.btn.primary` | 4.5:1 | 2.84 | 2.84 | **below floor** |
| `--onTint` on `--signal` | White on an alert fill | `.chip.danger.on` | 4.5:1 | 3.69 | 3.69 | **below floor** |
| `--sep` on `--bg2` | A hairline separator — decorative, not judged | `.row + .row` | 3:1 | 1.56 | 1.38 | reference |
| `--onTint` on `--aqua` | White on a navigation tint | `rejected — see .settingsTopic.on` | 4.5:1 | 2.45 | 2.45 | rejected |
| `--label3` on `--bg2` | The twin's 11.5px section eyebrow | `rejected — see .label` | 4.5:1 | 2.87 | 2.19 | rejected |

Floors: 4.5:1 for normal text (WCAG 2.1 SC 1.4.3 Contrast (Minimum)); 3:1 for graphical objects and UI components (WCAG 2.1 SC 1.4.11 Non-text Contrast).

Run `npm run frontend:contrast` for the gate. It fails on a **new** failure or on a
tracked one that has got worse, and reports the known ones without failing — otherwise
it could not be run at all on the day it landed.

- `--onTint` on `--adventure` (`.btn.primary`) reads **2.84:1**, under its 4.5:1 floor.
- `--onTint` on `--signal` (`.chip.danger.on`) reads **3.69:1**, under its 4.5:1 floor.

## The factory boundary — not a design surface

Generated by the venue builder, per [docs/agents/policies/builder-app-contract.md](policies/builder-app-contract.md). Never
hand-edit these to fix what you see on the map; fix the builder or that venue's input
and regenerate.

- `apps/party-tracker/public/venues/*.map.json`
- `apps/party-tracker/public/venues/*.pois.json`
- `apps/party-tracker/public/venues/*.gaps.json`
- `apps/party-tracker/public/venues/manifest.json`
- `apps/party-tracker/lib/venueIndex.js`

Builder **input**, and meant to be hand-edited: `packages/venue-builder/data/venues/`.

A design canvas will contain a hand-drawn park map because a prototype needs something
to stand on. It is scenery. Redesign the chrome that floats above it.

## Gaps — what this map could not derive

The map the design import shipped named files that did not exist, and nothing said so.
These are the questions this generator could not answer honestly. An unresolved entry is
worth more than a confident wrong one.

- --shut (night) → SHUT_PX is neither an export of apps/party-tracker/app/page.js nor a literal const in it — did you mean SHEET_SHUT_PX in lib/sheet.js?
