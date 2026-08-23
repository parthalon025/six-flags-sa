# ADR-0022 — Operator Profile via Clerk private metadata

**Status:** Accepted — 2026-08-23
**Depends on:** [ADR-0010 Clerk profile signup](./0010-clerk-profile-signup.md), [ADR-0009 ship Gaps](./0009-ship-gaps.md)

## Context

One signed-in **Profile** (the product owner) needs the full shipped closet, Steward **Title**, and operator routes on production, without minting every guest at Steward and without putting **XP** in Clerk public metadata. The Title ladder and Field Research loop stay the guest path.

## Decision

1. Clerk Backend `private_metadata.admin === true` is the Operator bit. The phone never reads it. `POST /api/profile/sync` asks Clerk Backend and, when true, writes Steward / 3000 into Postgres (ADR-0010: Postgres still owns **XP** / **Title**).
2. That session opens every shipped **Skin** and **Kit**, including season and **World**-kind Wear. An **Offer** from this Profile carries `unrestricted` so a guest who accepts may Wear it out of season or on the wrong World kind.
3. Operator sessions may pass `adminPermitted` alongside `METRICS_TOKEN` / `GUEST_TRACES_TOKEN`. The token stays for scripts.
4. Not included: Wayfarer / full-ontology Create (not built), auto-scored Gaps, skipping the second-**Party** Overlay / Marks gate.
5. Reset is taking `private_metadata.admin` off that Clerk user. Next sync stops granting. Clerk Organizations stay a non-goal (ADR-0010).

Canonical language: **Operator** in root `CONTEXT.md`. Internal name in code may say godmode; guests never see that word.

## Consequences

- Sync re-applies the grant whenever Clerk still says admin, including after a DB wipe (once the Profile is minted again).
- A guest’s own locker is unchanged unless they accept an Operator Offer.
- Operator is not a **Title**. Me still reads as the display name with Steward underneath.
