# Official apps are Capacitor shells around the PWA

Park Bound stays a Next.js PWA (`apps/party-tracker`). App Store and Play listings are Capacitor native shells around that same phone app, with native background **Location** and push so a pocketed **Host** still updates the **Party**. The PWA remains a first-class **Invite** path. Store upload is Fastlane (`fastlane/`). `/api/*` stays on the deployed origin — do not static-export the Next app. A Play-only Trusted Web Activity and a bare WebView of the live site are rejected: they do not keep **Location** alive in a pocket, and Apple guideline 4.2 rejects a repackaged website. The first store binary must use native Location, APNs / FCM, and Universal Links / App Links for **Invite**; iOS archives need a Mac or macOS CI.

Upload procedure: `fastlane/README.md`. Earlier idea capture: `docs/research/2026-08-10-native-app-ar-map-styles-session.md`.
