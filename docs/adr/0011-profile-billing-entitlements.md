# Profile billing and entitlements (Clerk identity, store payment)

**Status:** Accepted — 2026-08-15  
**Depends on:** [`0010-clerk-profile-signup.md`](./0010-clerk-profile-signup.md), [`0005-store-capacitor-shell.md`](./0005-store-capacitor-shell.md)  
**Canonical SKU:** `parkbound_profile_annual` ($10/year) in `fastlane/store-identifiers.json`

Park Bound separates **identity** from **payment**. Clerk signs users in with Google or Apple. **Profile** subscription revenue flows through **App Store**, **Google Play**, or **web checkout (Stripe)** — never Clerk Billing and never two rails for the same user.

## Decision

| Layer | Owner | Notes |
|-------|--------|--------|
| Sign-in | **Clerk** | Google + Apple only; free |
| Profile row | **Postgres** `users` / `profiles` | Minted on `POST /api/profile/sync` |
| Paid entitlement | **Postgres** `profile_entitlements` | One row per store transaction |
| iOS payment | **StoreKit** / App Store Connect | SKU `parkbound_profile_annual` |
| Android payment | **Google Play Billing** | Same product id namespace |
| Web payment | **Stripe** (future) | Blocked inside Capacitor shell |
| Clerk Billing | **Off** | Never enable — avoids double charge |

## Entitlement ledger

```text
profile_entitlements
  user_id  → profiles.users
  source   → apple | google | stripe | grant | prelaunch
  original_transaction_id → UNIQUE per source (no double grant)
  status   → active | grace | expired | revoked
```

`POST /api/profile/sync` returns `{ profile, entitlement, billing }` so the client cache stays aligned with the server ledger.

## Billing modes

| `PROFILE_BILLING_MODE` | Behaviour |
|------------------------|-----------|
| `prelaunch` (default) | Sign-in mints a **prelaunch** entitlement until StoreKit ships |
| `enforce` | Paid features require an active store/web entitlement — sign-in alone is not enough |

Flip to `enforce` when the store binary with StoreKit purchase UI is live.

## Native shell rules

- Capacitor WebView must **not** show web checkout or Clerk Billing (Guideline 3.1.1).
- `webCheckoutAllowed({ isNative: true })` → `false`.
- `allowedPaymentChannel({ isNative: true, platform: 'ios' })` → `apple`.

## Apple ↔ Clerk sync

| Artifact | Value |
|----------|--------|
| Bundle ID | `ai.kurat0r.parkbound` |
| Clerk Apple Services ID | `ai.kurat0r.parkbound.web` |
| Associated domains | `applinks:parkbound.kurat0r.ai` |
| Web credentials | `webcredentials:clerk.parkbound.kurat0r.ai`, `webcredentials:accounts.parkbound.kurat0r.ai` |
| Native redirect | `ai.kurat0r.parkbound://callback` |

Run `npm run billing:sync-check` before store submit to catch drift.

## Non-goals

- Clerk Billing or Organizations billing.
- Separate “Clerk Profile” SKU — Profile is always the store product above.
- Client-trusted entitlement minting without server verification.

## Follow-ons

| Work | When |
|------|------|
| StoreKit purchase UI + receipt verify | Store binary with IAP |
| `POST /api/billing/apple` App Store Server Notifications v2 | Production IAP |
| Google Play RTDN | Android IAP |
| Stripe checkout + web entitlement writer | Web-only subscribers |

## Consequences

- Auth copy states sign-in is **free**; Profile subscription is **store-billed**.
- Managed Guests / planner sync gate on entitlement when `enforce` is on.
- Prelaunch entitlement is revoked or migrated when real store rows arrive.
