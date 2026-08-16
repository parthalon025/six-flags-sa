# Park Bound Watch Compass

Native watchOS companion for the facing-relative **Compass** (ADR-0011).

## What’s in the repo

| Path | Role |
|------|------|
| `ParkBoundWatchApp.swift` | `@main` Watch app |
| `WatchCompass.swift` | Dial + settings UI |
| `WatchCompassSession.swift` | WatchConnectivity receive + sample marks |
| `../App/WatchCompassPhoneSession.swift` | iPhone WCSession sender |
| `../App/WatchCompassPlugin.swift` | Capacitor `WatchCompass.pushState` |
| `App.xcodeproj` | Watch target + Embed Watch Content (via wire script) |
| `packages/shared/compass.js` → `watchCompassPushState` | Shared mark payload |
| `apps/party-tracker/lib/native.js` → `pushWatchCompass` | JS → Capacitor |

Bundle IDs:

- Phone: `ai.kurat0r.parkbound`
- Watch: `ai.kurat0r.parkbound.watchkitapp`
- App Group: `group.ai.kurat0r.parkbound`
- Prefs key: `parkbound-watch-compass-v1` (same as `packages/shared/compass.js`)

## Commands (any OS)

```bash
npm run ios:wire-watch      # idempotent pbxproj wire
npm run ios:check-watch     # assert wiring
node test/scripts/wire-watch-target.test.mjs
```

## Build on a Mac

```bash
cd ios/App
xcodebuild \
  -project App.xcodeproj \
  -scheme App \
  -destination 'generic/platform=watchOS Simulator' \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Or open `ios/App/App.xcworkspace`, select the **App** scheme, and run on an iPhone + Watch simulator pair.

CI: `.github/workflows/ios-watch-compile.yml` runs the unsigned simulator compile on `macos-14`.

## Still needs a human Apple Developer step

1. Enable App Group `group.ai.kurat0r.parkbound` for both App IDs in the developer portal.
2. Create the Watch App ID `ai.kurat0r.parkbound.watchkitapp` if missing.
3. First archive with signing for TestFlight / App Store.
