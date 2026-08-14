# Park Bound: Explore — App Store submission pack

Everything below is filled in repo files. Upload with GitHub Actions (**iOS App Store metadata** workflow) or `FASTLANE_METADATA_ONLY=true bundle exec fastlane ios metadata` on a machine with Ruby and `.env`.

## App record (App Store Connect → App Information)

| Field | Value | Source |
|-------|--------|--------|
| **Name** | Park Bound: Explore | `en-US/name.txt` |
| **Subtitle** | Explore more. Stress less. | `en-US/subtitle.txt` |
| **Bundle ID** | `ai.kurat0r.parkbound` | `store-identifiers.json` |
| **SKU** | `parkbound-ios` | `store-identifiers.json` |
| **Apple ID** | `269608486` | `.env` `APP_STORE_APPLE_ID` |
| **Primary language** | English (U.S.) | `en-US/` |
| **Primary category** | Navigation (`NAVIGATION`) | `primary_category.txt` |
| **Secondary category** | Travel (`TRAVEL`) | `secondary_category.txt` |
| **Copyright** | 2026 Kurat0r | `copyright.txt` |
| **Content rights** | Contains third-party content — we have rights (park map sources + our renders) | `Fastfile` submission_information |
| **Age rating** | 4+ expected (no mature content; UGC + unrestricted web) | `age_rating.json` |

## Version listing (App Store → iOS App)

Version string comes from **`apps/party-tracker/package.json`** (same as TestFlight/build via fastlane). Before metadata upload, create that version in App Store Connect if it does not exist yet.

| Field | Source file |
|-------|-------------|
| Promotional Text | `en-US/promotional_text.txt` |
| Description | `en-US/description.txt` |
| Keywords | `en-US/keywords.txt` |
| What's New | `en-US/release_notes.txt` |
| Marketing URL | `https://parkbound.kurat0r.ai` |
| Support URL | `https://parkbound.kurat0r.ai` |
| Privacy Policy URL | `https://parkbound.kurat0r.ai/privacy` |

## App Review contact

| Field | Value |
|-------|--------|
| First name | Justin |
| Last name | McFarland |
| Email | parthalon025@gmail.com |
| Phone | **Add in Connect** — not in repo (verify your number) |
| Notes | `review_information/notes.txt` |

## Export compliance (set on submit)

| Question | Answer |
|----------|--------|
| Uses encryption? | Yes (HTTPS/TLS) |
| Exempt? | Yes — standard HTTPS only, no custom crypto |
| IDFA / tracking? | No |

## App Privacy (Connect questionnaire — manual)

Use `APP_PRIVACY.md` in this folder when filling **App Privacy** in Connect. Summary:

- **Location** — precise, linked to identity when Profile signed in; app functionality + Party
- **Contact info** — email/name from Apple/Google via Clerk when signed in
- **User content** — Contributions, ride reports (Profile or display name)
- **Identifiers** — Clerk user id for Profile
- **Diagnostics** — Vercel Analytics / Speed Insights (performance, not ads)
- **Not collected for tracking** — no ad network, no IDFA

## Pricing and availability

| Field | Suggested |
|-------|-----------|
| Price (download) | **Free** |
| Profile IAP | **$10.00 / year** — product `parkbound_profile_annual`, display name **Profile** (auto-renewable). Guest map / Party-by-name stay free. |
| Availability | United States (expand later) |
| Pre-order | No |
| Store commission | App Store Small Business Program — **submitted 2026-08-14** (team `CDHJC4MH4G`); 15% starts 15 days after end of fiscal month of approval |

## Still required before you tap Submit

- [x] **App Store Small Business Program** — enrollment submitted 2026-08-14 (Account Holder Justin McFarland / team `CDHJC4MH4G`); await Apple email; 15% rate starts 15 days after fiscal month of approval
- [x] **Paid Apps Agreement** — signed; status **Processing** (banking also processing ~24h). Confirm **Active** before first IAP sale
- [ ] **Profile IAP** — Free download; create auto-renewable **Profile** at **$10.00/yr** (`parkbound_profile_annual` in `store-identifiers.json`) once Paid Apps Agreement is Active
- [ ] **App version** in Connect matches `apps/party-tracker/package.json` (metadata upload uses that semver)
- [ ] **Privacy URL live** — deploy app with `/privacy` (added in `apps/party-tracker/app/privacy/page.js`)
- [x] **App Preview** — iPhone 6.9" slot (`IPHONE_67`, 886×1920, 15–30s). Encode with `npm run store:app-preview`; metadata workflow uploads `fastlane/app_previews/`
- [ ] **Screenshots** — iPhone 6.5" (1284×2778) minimum; add under `fastlane/screenshots/ios/` then set `IOS_SKIP_SCREENSHOTS=false`
- [ ] **TestFlight or App Store build** — IPA from macOS CI or cloud Mac (`fastlane ios beta`)
- [ ] **App Privacy** questionnaire completed in Connect using `APP_PRIVACY.md`
- [ ] **Review phone number** in Connect
- [ ] **Google Play** — separate track; Android metadata in `metadata/android/en-US/`

## GitHub secrets (for metadata workflow)

`APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY` (base64 `.p8`), `APP_STORE_APPLE_ID`

Optional: `APP_STORE_REVIEW_PHONE` — **required** for first metadata upload. E.164 review contact phone (e.g. `+12125551234`).

Optional variable: `IOS_APP_VERSION` (defaults to `apps/party-tracker/package.json` version).
