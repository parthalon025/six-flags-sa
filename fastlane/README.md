# Parkbound — Fastlane deployment

Automated release pipeline for **iOS** (App Store Connect / TestFlight) and **Android** (Google Play Console). Secrets are loaded exclusively from environment variables via a root `.env` file — nothing is hardcoded in the Fastlane scripts.

## Directory layout

```
fastlane/
├── Appfile                      # Bundle IDs, team IDs (from ENV)
├── Fastfile                     # Unified iOS + Android lanes
├── metadata/
│   ├── ios/en-US/               # App Store listing copy
│   └── android/en-US/           # Play Store listing copy
├── app_previews/
│   └── en-US/                   # App Store preview videos (`npm run store:app-preview`)
└── screenshots/
    ├── ios/                     # App Store screenshots (add per device)
    └── android/                 # Play Store screenshots (add per device)
```

Store metadata uses **distinct trees** for each platform (`metadata/ios/` vs `metadata/android/`).

Identifiers for App Store Connect / Play Console live in [`store-identifiers.json`](store-identifiers.json) (SKU, bundle ID, package name).

## Prerequisites

Generate the Android upload keystore (no paid accounts required):

```bash
npm run store:prepare
```

That writes `secrets/parkbound-upload.keystore` (gitignored) and prints the
cert fingerprint for Play App Links. After Apple Developer ($99) and Google
Play ($25), copy `.env.example` → `.env`, add Firebase plists, set
`IOS_TEAM_ID` and `ANDROID_CERT_SHA256` on Vercel, then run the lanes below.

### Toolchain

| Tool | Version | Purpose |
|------|---------|---------|
| Ruby | 3.2+ | Fastlane runtime |
| Bundler | 2.x | Lock gem versions |
| Node.js | 22+ | Build the Next.js web app |
| Xcode | 15+ | iOS archive & signing (macOS CI runner) |
| Android SDK | API 34+ | Android App Bundle build |

Install Ruby gems from the repository root:

```bash
bundle install
```

### Native shells

Park Bound ships as a **Next.js PWA** (`apps/party-tracker`). Official store binaries are Capacitor shells around that app — [ADR-0005](../docs/adr/0005-store-capacitor-shell.md). Native projects live at `ios/` and `android/` (`ai.kurat0r.parkbound`). `npm run cap:sync` stamps the app version, then copies `native/www` and plugin registrations. The WebView loads `https://parkbound.kurat0r.ai` so `/api/*` stays on the deployed origin (do not static-export the Next app).

```bash
npm run cap:sync
npm run cap:open:android   # Windows / Android Studio
npm run cap:open:ios       # macOS / Xcode
```

Adjust `WEB_APP_PATH`, `IOS_WORKSPACE_PATH`, and `ANDROID_PROJECT_PATH` in `.env` if your layout differs.

### Apple — App Store Connect API Key

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access** → **Integrations** → **App Store Connect API**.
2. Create a key with **App Manager** (or Admin) role. Download the `.p8` file once — it cannot be re-downloaded.
3. Store the key outside version control, e.g. `secrets/AuthKey_ABC123XYZ.p8`.
4. Copy **Key ID** and **Issuer ID** into `.env`.

Authentication uses the API key exclusively — no Apple ID session or app-specific password is required.

### Google Play — service account

1. In [Google Play Console](https://play.google.com/console) → **Setup** → **API access**, link a Google Cloud project.
2. Create a **service account** with **Release manager** permissions.
3. Download the JSON key to `secrets/google-play-service-account.json`.
4. Grant the service account access to your app in Play Console.

### Android upload keystore

Create a release keystore (once) and reference it in `.env`:

```bash
keytool -genkeypair -v \
  -keystore secrets/parkbound-upload.keystore \
  -alias parkbound \
  -keyalg RSA -keysize 2048 -validity 10000
```

Configure the same keystore in `android/app/build.gradle` or rely on Fastlane’s injected signing properties (see `ANDROID_KEYSTORE_*` in `.env.example`).

## Environment setup

```bash
cp .env.example .env
# Edit .env with your team IDs, key paths, and signing credentials
```

Required variables:

| Variable | Description |
|----------|-------------|
| `IOS_BUNDLE_IDENTIFIER` | Xcode bundle ID (`ai.kurat0r.parkbound`) |
| `IOS_TEAM_ID` | Apple Developer Team ID |
| `IOS_ITC_TEAM_ID` | App Store Connect Team ID |
| `APP_STORE_CONNECT_API_KEY_ID` | 10-character Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | UUID Issuer ID |
| `APP_STORE_CONNECT_API_KEY_PATH` | Path to `.p8` file |
| `ANDROID_PACKAGE_NAME` | Gradle `applicationId` |
| `GOOGLE_PLAY_JSON_KEY_PATH` | Path to service account JSON |
| `ANDROID_KEYSTORE_*` | Upload keystore path, alias, passwords |

## Release planning

Most changes ship **without** a new App Store binary — the WebView loads `https://parkbound.kurat0r.ai`. Classify your branch:

```bash
npm run store:release-plan
```

Full checklists (web vs metadata vs native, workflow map, review best practices): [docs/guide/store-releases.md](../docs/guide/store-releases.md).

## Lanes

All lanes build the web app, sync Capacitor (when installed), stamp the semver from `apps/party-tracker/package.json`, then compile and upload.

### iOS

```bash
bundle exec fastlane ios beta          # Build → TestFlight
bundle exec fastlane ios production    # Build → App Store (submit for review)
```

### Android

```bash
bundle exec fastlane android beta          # Build AAB → internal testing track
bundle exec fastlane android production    # Build AAB → production track
```

Default tracks are controlled by `ANDROID_BETA_TRACK` (`internal`) and `ANDROID_PRODUCTION_TRACK` (`production`).

### Both platforms

```bash
bundle exec fastlane beta
bundle exec fastlane production
```

## Versioning

- **Version name** (`1.1.15`) is read from `apps/party-tracker/package.json` and written into the native projects before each build.
- **Android version code** defaults to `major*10000 + minor*100 + patch` (e.g. `1.1.15` → `10115`). Override with `ANDROID_VERSION_CODE` when needed.
- **iOS build number** is incremented automatically by Xcode during archive when using automatic signing in CI (`setup_ci`).

## Store metadata

Edit listing copy under:

- `fastlane/metadata/ios/en-US/` — `name.txt`, `subtitle.txt`, `description.txt`, `keywords.txt`, `promotional_text.txt`, `release_notes.txt`, URL fields
- `fastlane/metadata/ios/review_information/` — App Review notes and contact email
- `fastlane/metadata/ios/copyright.txt` — copyright line
- Section → Connect field map: `fastlane/metadata/ios/SECTIONS.md`
- `fastlane/metadata/android/en-US/` — `title.txt`, `short_description.txt`, `full_description.txt`

Add per-release Android changelogs at:

```
fastlane/metadata/android/en-US/changelogs/<versionCode>.txt
```

Generate listing art, screenshots, and the iPhone App Preview (no paid accounts):

```bash
npm run store:icons
npm run store:screenshots
npm run store:app-preview
```

Glance at the PNGs, then set `IOS_SKIP_SCREENSHOTS=false`, `ANDROID_SKIP_SCREENSHOTS=false`, and `ANDROID_SKIP_IMAGES=false`. Preview videos upload with metadata even when screenshots are skipped — `app_previews_path` in the Fastfile. Paste `fastlane/store-declarations.json` into App Store privacy nutrition and Play Data safety.

### Push metadata from GitHub (no Mac)

Workflow: [`.github/workflows/ios-app-store-metadata.yml`](../.github/workflows/ios-app-store-metadata.yml)

Runs on **ubuntu** — uploads `fastlane/metadata/ios/` via `bundle exec fastlane ios metadata` (no Xcode build).

**Repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|--------|
| `APP_STORE_CONNECT_API_KEY_ID` | e.g. `45W483PCTK` |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID from App Store Connect → Integrations |
| `APP_STORE_CONNECT_API_KEY` | Base64-encoded `.p8` file (`base64 -w0 AuthKey.p8` on Linux; `[Convert]::ToBase64String([IO.File]::ReadAllBytes('AuthKey.p8'))` on PowerShell) |
| `APP_STORE_APPLE_ID` | Optional numeric app ID (e.g. `269608486`) |
| `APP_STORE_REVIEW_PHONE` | **Required** for first upload — E.164 review phone (e.g. `+12125551234`) |

**Repository variable** (optional): `IOS_APP_VERSION` — override App Store Connect version; default is `apps/party-tracker/package.json` `version`. That version must already exist in Connect before metadata upload.

Native `android/` and `ios/` marketing versions are stamped from the same file via `npm run cap:sync` (`scripts/stamp-native-version.mjs`).

Refresh listing identifier fields (name, subtitle, categories, URLs, copyright) from `fastlane/store-identifiers.json` with `npm run store:scaffold-metadata` (see `fastlane/metadata/ios/SECTIONS.md`).

Trigger manually: **Actions → iOS App Store metadata → Run workflow**. Pushes to `main` that touch `fastlane/metadata/ios/**` or `fastlane/app_previews/**` also run this workflow.

Local (any OS with Ruby):

```bash
export FASTLANE_METADATA_ONLY=true
bundle exec fastlane ios metadata
```

## CI integration

Run on a **macOS** runner for iOS (Xcode required). Android can build on Linux or macOS.

Example GitHub Actions secrets (map to `.env` or export before `fastlane`):

| Secret | Maps to |
|--------|---------|
| `APP_STORE_CONNECT_API_KEY_ID` | `APP_STORE_CONNECT_API_KEY_ID` |
| `APP_STORE_CONNECT_ISSUER_ID` | `APP_STORE_CONNECT_ISSUER_ID` |
| `APP_STORE_CONNECT_API_KEY` | Base64-encoded `.p8` contents → write to temp file, set `APP_STORE_CONNECT_API_KEY_PATH` |
| `GOOGLE_PLAY_JSON_KEY` | Base64-encoded JSON → write to temp file, set `GOOGLE_PLAY_JSON_KEY_PATH` |
| `ANDROID_KEYSTORE` | Base64-encoded keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |
| `IOS_TEAM_ID` | Developer Team ID |
| `IOS_ITC_TEAM_ID` | App Store Connect Team ID |

Minimal CI step:

```yaml
- name: Deploy beta
  env:
    CI: true
  run: |
    echo "$APP_STORE_CONNECT_API_KEY" | base64 -d > /tmp/asc.p8
    echo "$GOOGLE_PLAY_JSON_KEY" | base64 -d > /tmp/play.json
    export APP_STORE_CONNECT_API_KEY_PATH=/tmp/asc.p8
    export GOOGLE_PLAY_JSON_KEY_PATH=/tmp/play.json
    bundle exec fastlane beta
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing required environment variables` | Copy `.env.example` → `.env` and fill every required field |
| `iOS workspace not found` | Run `npx cap add ios` or fix `IOS_WORKSPACE_PATH` |
| `Android project not found` | Run `npx cap add android` or fix `ANDROID_PROJECT_PATH` |
| Code signing errors (iOS) | Confirm `IOS_TEAM_ID`, valid distribution cert, and automatic signing in Xcode |
| Play upload rejected | Ensure version code is monotonically increasing and the service account has release permissions |
| API key auth failure | Verify Key ID, Issuer ID, and that the `.p8` path is readable |

## Security

- Never commit `.env`, `secrets/`, `*.p8`, or service account JSON.
- Rotate API keys and service accounts on a schedule.
- Use least-privilege roles (App Manager for ASC, Release manager for Play).
