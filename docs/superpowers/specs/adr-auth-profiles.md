# ADR: Auth provider and session model (EP.1)

**Status:** Superseded — 2026-08-14  
**Canonical:** [`../../adr/0010-clerk-profile-signup.md`](../../adr/0010-clerk-profile-signup.md)  
**Historical note:** This document records the 2026-08-11 Auth.js decision. Implementation follows Clerk per ADR-0010.

**Backlog:** EP.1 → EP.2–EP.5  
**North star:** Explore more, stress less — profiles exist so family prefs, party trust, and **Side Quest** progress survive the park day without forcing a hard wall before the map.

## Decision (historical — Auth.js)

Use **Auth.js (NextAuth v5)** on the existing Next.js party-tracker app.

| Choice | Value |
|--------|--------|
| Providers | Email **magic link** (primary) + optional **Google OAuth** |
| Session | JWT session cookies (HTTP-only, Secure, SameSite=Lax) |
| Soft gate | Anonymous users may **browse the map** and join/host a **Party** by name; **Contributions**, **Side Quest** submit, and cross-day **Plan** sync require a signed-in **Profile** |
| Offline | After login, cache `user_id`, display name, avatar key, rank/passport snapshot in **IndexedDB**; map/routing still work fully offline from venue JSON |
| Server store | Plain Postgres (no PostGIS) for users/profiles — see E0.2–E0.4 |

## Why Auth.js

- Fits the monorepo Next.js app without a separate IdP product.
- Magic link keeps family onboarding low-friction on park Wi‑Fi (no password to forget).
- Google OAuth is an optional convenience for returning users.
- Session model is well understood; token storage stays in first-party cookies, not `localStorage`.

## Soft gate (not hard block)

```text
Anonymous          Signed-in
─────────          ─────────
View map           View map
Pick venue         Pick venue
Join / host Party  Join / host Party (Member may bind Profile)
Local height UI    Profile + Managed Guest heights
                   Submit Side Quests / Contributions
                   Sync contribution + observation queues
                   Plan personalization / sync across days
```

Anonymous contribution and anonymous **Side Quest** submit are **forbidden**. Local draft queues may exist but upload rejects without `user_id`. Name-first **Party** join is allowed.

## Offline session

1. Login succeeds → write IndexedDB `parkbound.profile` snapshot.  
2. Service worker continues to serve venue JSON offline.  
3. If cookie session expires while offline, keep using cached identity for **local** queues; require re-auth before next server sync.  
4. Never store magic-link tokens or refresh secrets in IndexedDB — only profile fields needed for UX and attribution.

## Non-goals

- Device-only anonymous “profiles” that later claim contributions.
- Hard wall that blocks map draw until sign-in.
- PostGIS, native biometric login, or enterprise SSO (can revisit).

## Follow-ons

| ID | Work |
|----|------|
| EP.2 / E0.3–4 | `users` / `profiles` tables + shared types |
| EP.3 | Sign-in UI + soft-gate chrome |
| EP.4 | IndexedDB profile cache |
| EP.5 | Party members bind to `user_id` |

## Consequences

- EP.3 functional tests must cover: anonymous map OK; party join by name OK; contribute blocked until signed in.
- Consolidate and living-map paths always attribute to `authorId` → profile.
- **Side Quests** (E9/E10) score against the same profile — no parallel guest XP identity.
