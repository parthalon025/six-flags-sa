# Auth provider and session model

Park Bound uses **Auth.js (NextAuth v5)** with email magic link (primary) and optional Google OAuth, JWT session cookies, and a soft gate: anonymous users may browse the map and join or host a **Party** by display name; **Contributions**, **Side Quest** submit, saving **Managed Guests**, and cross-day **Plan** sync require a signed-in **Profile**. Offline UX caches a profile snapshot in IndexedDB after login; map/routing stay offline from venue JSON. Server identity lives in plain Postgres (no PostGIS).

Expanded write-up: `docs/superpowers/specs/adr-auth-profiles.md`.
