# Clerk profile signup (Google + Apple)

**Status:** Accepted — 2026-08-14  
**Supersedes:** [`0001-auth-profiles.md`](./0001-auth-profiles.md) (Auth.js)  
**Depends on:** [`0005-store-capacitor-shell.md`](./0005-store-capacitor-shell.md) (native store binaries)  
**Backlog:** EP.1 (provider), EP.2–EP.6 (schema, UX, cache, bind, managed guests)

Park Bound uses **Clerk** for sign-in. **Profile** minting and attribution stay in plain Postgres (`users` / `profiles`). Soft gates match [`CONTEXT.md`](../../CONTEXT.md): map and **Party** stay name-first; gated features need a signed-in **Profile**.

## Decision

| Choice | Value |
|--------|--------|
| IdP | **Clerk** (dedicated application under the existing paid account — dev + prod instances; not shared with other products) |
| Providers | **Google** + **Sign in with Apple** only — email, password, phone login, and magic link **disabled** in Clerk. First/last name are optional (Apple Hide My Email does not send them). |
| Session | Clerk session (httpOnly cookies on web; secure token cache in native shell) |
| Profile row | Mint `users` / `profiles` in the **sign-in callback** or first authenticated API call — **not** blocked on async webhooks |
| Webhooks | Verified `user.created` / `user.updated` / `user.deleted` for sync and delete — backup, not onboarding gate |
| Display name | From Google / Apple at mint; editable in Settings — no extra name field at signup |
| Member bind | On successful sign-in, **auto-bind** the unbound device **Member** on that phone to the new **Profile** |
| Gated submit w/o Profile | **Stash** gap **Side Quest** / **Contribution** locally; upload after sign-in; keep stash if OAuth sheet is dismissed |
| Store auth | Native Google / Apple sheets in the Capacitor shell ([`0005`](./0005-store-capacitor-shell.md)); Clerk web buttons on PWA — **not** OAuth inside WKWebView |
| Store buttons | Apple first on iOS, Google first on Android; equal visual weight (App Store Guideline 4.8) |
| Account deletion | In-app + public HTTPS deletion URL (Play requirement); delete Clerk user + our **Profile** + **Managed Guests**; strip **Contribution** attribution, keep park facts |
| Teens | Device-holding **Member** may mint their own **Profile** on that phone — not parent-only |
| No email fallback | Browse / **Party** without Google or Apple; gated features wait — no third login path |

## Soft gate (unchanged)

```text
Anonymous                         Signed-in Profile
─────────                         ─────────────────
View map                          View map
Pick venue                        Pick venue
Join / host Party (name + Location)   Same; Member binds on sign-in
In-party Ride report (name)       Same + XP when Profile attached
                                  Gap Side Quest / Contribution
                                  Managed Guests, cross-day Plan sync
                                  Park-wide Observation / Overlay (+ 2nd Party)
```

No sign-in prompt before a gate fires (no “create account at breakfast”). Anonymous gap submit is forbidden server-side; local stash is allowed until upload.

## Surfaces

| Surface | Sign-in UI |
|---------|------------|
| PWA / Safari | Clerk web — official Google + Apple buttons |
| iOS store app | Native Sign in with Apple + Google via Capacitor bridge (`capacitor-clerk` or equivalent); Clerk Native API enabled |
| Android store app | Native Google + Sign in with Apple (OAuth strategy on Android); same Clerk application |

Clerk Dashboard: **Native Applications** on; Associated Domains / deep links per Clerk + Capacitor docs.

## Security

- Clerk owns OAuth client secrets, session revocation, and signed webhooks (`verifyWebhook`).
- Postgres owns **Contribution** attribution, **Managed Guests**, **XP** / **Title** — not Clerk public metadata.
- Never mint `user_id` from the client alone; server `auth()` + callback creates the row.
- Webhook route is public (excluded from Clerk middleware protection).

## Non-goals

- Auth.js / NextAuth, email magic link, passwords.
- Clerk Organizations (family = **Profile** + **Managed Guests**, not B2B tenants).
- Email-as-last-resort login for kiosks.
- Device-only anonymous profiles that later claim **Contributions**.
- Hard wall before map draw.

## Follow-ons

| ID | Work |
|----|------|
| EP.2 / E0.3–4 | `users.clerk_id`, `profiles` migrations + shared types |
| EP.3 | Replace stub `SignInCard`; gate UI; native Capacitor sign-in |
| EP.4 | IndexedDB profile snapshot after login |
| EP.5 | Auto-bind **Member** on sign-in (this ADR) |
| EP.6 | **Managed Guest** under **Profile** |
| Store | Account deletion page URL in Play Data safety; Settings → Delete **Profile** |

## Production Apple web (do not revert)

Canonical IDs, Clerk signup flags, and Apple Developer checklist: [`scripts/lib/clerk-apple-prod-spec.json`](../../scripts/lib/clerk-apple-prod-spec.json).

- After changing Clerk prod: `npm run clerk:check -- --instance prod`
- `npm run clerk:setup -- --instance prod` runs that check
- CI asserts the checked-in prod patch cannot require phone or names (`test/scripts/clerk-apple-prod.test.mjs`)

## Consequences

- Supersede Auth.js references in code, ADR-0001, and `adr-auth-profiles.md`.
- EP.3 tests: anonymous map OK; party by name OK; contribute blocked until signed in; stash survives dismissed OAuth; bind sets `Member.userId`.
- Functional tests must not assume `sessionStorage` fake magic link.

Expanded history: [`../superpowers/specs/2026-08-14-profile-signup-design.md`](../superpowers/specs/2026-08-14-profile-signup-design.md).
