# Design: Profile signup (Clerk, Google + Apple)

**Date:** 2026-08-14  
**Status:** Accepted — ready for implementation  
**ADR:** [`../../adr/0030-clerk-profile-signup.md`](../../adr/0030-clerk-profile-signup.md)  
**Glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)

## Summary

Families browse and join a **Party** by name. A **Profile** appears only when something durable needs it — **Contribution**, **Managed Guest**, cross-day **Plan**, park-wide trust. Sign-in is Clerk with **Google** and **Apple** only; Postgres holds the **Profile** row; the Capacitor store app uses **native** OAuth sheets.

## Scenes (accepted)

### Gate without account

Dana is a name-only **Member**. At Diamondback’s height sign she taps Submit. The answer **stashes** on device. She taps Sign in with Google; if she dismisses the sheet, the stash stays. When sign-in completes, upload runs and **Overlay** updates.

### Same phone, auto-bind

Dana’s roster name is “Dana.” Google sign-in succeeds on the same phone. The unbound **Member** on that device binds to the new **Profile** without a second prompt.

### Teen

Jordan (15, own phone) signs in with Apple. His **Contribution** attributes to Jordan’s **Profile**, not Dana’s. Phoneless Mia stays a **Managed Guest** under Dana.

### Store binary

TestFlight build shows **Sign in with Apple** and **Google**, Apple on top. Native system sheets — not a WebView OAuth popup. Play build: Google on top, Apple equivalent.

### Delete account

Settings → Delete **Profile** removes Clerk user, Postgres row, and **Managed Guests**. **Contributions** remain as park truth; author name is stripped. Public `https://…/delete-account` satisfies Play Console.

## Implementation order

1. Clerk application (new app id), social-only, Native API on  
2. `@clerk/nextjs` + middleware (map/party public; webhooks public)  
3. Sign-in callback → upsert `profiles`; EP.5 auto-bind **Member**  
4. Replace `apps/party-tracker/lib/auth/session.js` stub; side-quest stash + gate  
5. Capacitor: `capacitor-clerk` (or bridge) for native Google/Apple  
6. Delete flow + deletion URL  
7. EP.3 functional tests

## Out of scope (this ship)

- Rewriting party mesh or venue builder  
- Clerk Billing / Organizations  
- Email login fallback
