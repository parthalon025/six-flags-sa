# Park Bound Watch Compass

Native watchOS sources for the facing-relative **Compass** (ADR-0011).

## Add the target in Xcode

1. Open `ios/App/App.xcworkspace`.
2. File → New → Target → watchOS → App → name `ParkBoundWatch`.
3. Add `WatchCompass.swift` to that target.
4. Share App Group / UserDefaults with the iOS app using key `parkbound-watch-compass-v1` (same as `packages/shared/compass.js`).

## Phone prefs

Me → Watch Compass writes the same JSON shape into `localStorage`. A later Capacitor plugin or WatchConnectivity session should mirror that blob into the Watch `UserDefaults`.

## Live marks

`WatchCompassView` accepts `marks` + `heading` from the phone. Until WatchConnectivity is wired, the Watch settings UI and Always On modes still compile and run with sample data.
