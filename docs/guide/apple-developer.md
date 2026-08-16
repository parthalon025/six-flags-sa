# Apple Developer — Identifiers vs Xcode

[← Guide index](index.md) · Inventory: [`scripts/lib/apple-developer.json`](../../scripts/lib/apple-developer.json)

IDs, later App IDs, and which **surface** owns each row live in that JSON (`now` / `later` / `never`). `node test/scripts/apple-developer.test.mjs` checks the Capacitor shell against **now** Xcode rows.

## Surfaces

| Surface | Where you click |
|---------|-----------------|
| **identifiers** | [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) |
| **xcode** | Xcode → Park Bound target → **Signing & Capabilities** (and `Info.plist` / `App.entitlements`) |
| **keys** | Apple Developer **Keys**, or App Store Connect **Users and Access** for the ASC API key |
| **connect** | App Store Connect (IAP product, not an Identifier) |

**Background Modes** (Location updates, Remote notifications) are **xcode** only. They are not App ID capability checkboxes.

## Sign in with Apple (web / Clerk)

Values: `siwaWeb` and `services-id` in the JSON. Clerk production already takes the SIWA `.p8` from gitignored `scripts/lib/clerk-apple-connection.json` (`npm run clerk:setup -- --instance prod`).

1. Identifiers → **Services IDs** → `ai.kurat0r.parkbound.web`.
2. Enable **Sign In with Apple** → **Configure**.
3. **Primary App ID:** `ai.kurat0r.parkbound`.
4. **Domains and Subdomains:** `clerk.parkbound.kurat0r.ai` (no `https://`).
5. **Return URLs:** copy Clerk Dashboard Apple SSO **Return URL**. Expected: `https://clerk.parkbound.kurat0r.ai/v1/oauth_callback`.
6. Save. Smoke: [parkbound.kurat0r.ai/sign-in](https://parkbound.kurat0r.ai/sign-in) → Apple.

The SIWA key is `ZZNS5TWZ74`. The App Store Connect API key is a different key (Users and Access) — do not paste it into Clerk.

Create **later** identifier rows only when that Xcode target exists (widget, Watch, App Clip, App Group, NFC).
