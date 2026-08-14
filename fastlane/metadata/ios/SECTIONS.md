# App Store Connect — section → file

Full submission checklist: [SUBMISSION.md](./SUBMISSION.md)  
App Privacy answers: [APP_PRIVACY.md](./APP_PRIVACY.md)

Paste from each file into App Store Connect, or upload with:

```bash
# Local (requires .env + secrets/AuthKey*.p8)
FASTLANE_METADATA_ONLY=true bundle exec fastlane ios metadata

# GitHub Actions (no Mac) — see .github/workflows/ios-app-store-metadata.yml
```

| App Store Connect section | Field limit | File |
|---------------------------|-------------|------|
| **App Information → Name** | 30 chars | `en-US/name.txt` |
| **App Information → Primary category** | enum | `primary_category.txt` |
| **App Information → Secondary category** | enum | `secondary_category.txt` |
| **Version → Subtitle** | 30 chars | `en-US/subtitle.txt` |
| **Version → Promotional Text** | 170 chars | `en-US/promotional_text.txt` |
| **Version → Description** | 4,000 chars | `en-US/description.txt` |
| **Version → Keywords** | 100 chars | `en-US/keywords.txt` |
| **Version → What's New** | 4,000 chars | `en-US/release_notes.txt` |
| **Version → Support URL** | URL | `en-US/support_url.txt` |
| **Version → Marketing URL** | URL | `en-US/marketing_url.txt` |
| **App Privacy → Privacy Policy URL** | URL | `en-US/privacy_url.txt` |
| **App Information → Copyright** | text | `copyright.txt` |
| **Age rating** | JSON | `age_rating.json` |
| **App Review → Notes** | 4,000 chars | `review_information/notes.txt` |
| **App Review → Contact Email** | email | `review_information/email_address.txt` |
| **App Review → First Name** | text | `review_information/first_name.txt` |
| **App Review → Last Name** | text | `review_information/last_name.txt` |
| **App Review → Phone** | E.164 | `review_information/phone_number.txt` (add file when ready) |

Identifiers (SKU, bundle ID, Apple ID, team) live in `fastlane/store-identifiers.json` — set in Connect when creating the app, not via these text files.

## Not in metadata files (Connect UI only)

- Screenshots → `fastlane/screenshots/ios/` (set `IOS_SKIP_SCREENSHOTS=false` to upload)
- App Privacy questionnaire → use `APP_PRIVACY.md`
- Pricing (Free) and availability
- Review contact phone (add `review_information/phone_number.txt` or Connect UI)
- TestFlight / IPA build

## Blockers before submit

- Deploy `/privacy` (route added — must be live on parkbound.kurat0r.ai)
- At least one iPhone 6.5" screenshot set
- TestFlight build uploaded
- Complete App Privacy in Connect
