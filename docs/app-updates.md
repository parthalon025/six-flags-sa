# App updates — insider notes

**Audience:** whoever ships, hosts, or debugs deployments. Visitors see a version
number under **Me → Advanced** and in **Diagnostics**; they do not need this
page.

## What changed

- **Single version source:** `package.json` `version` (semver). `predev` /
  `prebuild` runs `scripts/inject-version.mjs`, which writes
  `public/app-version.json` and rewrites the service-worker cache name
  (`tracker-<version>`).
- **Client stamp:** `NEXT_PUBLIC_APP_VERSION` from `next.config.mjs` — baked into
  the JS bundle at build time.
- **Server truth:** `/api/version` returns `{ version, protocol }` (unchanged
  shape; `protocol` is still the party-wire compatibility number).
- **Update loop:** `lib/appUpdate.js` polls `/api/version` when online, probes
  `registration.update()`, activates a waiting worker, and reloads once if the
  bundle is behind but the worker has not caught up. Offline or timed-out checks
  are silent.

## What it brings

- **Deploy and forget for phones with signal.** A visitor who installed the PWA
  last month picks up a new build on the next open (or tab focus) without
  reinstalling from the home screen.
- **Park-safe offline behaviour.** No error toasts when the check fails; the
  cached shell and map keep working — the same premise as the rest of the
  offline stack.
- **Supportable.** Diagnostics shows installed vs server version and whether the
  last probe saw the network, so “are you on the old build?” is one screen
  instead of guessing cache state.
- **Cache hygiene.** Each release gets its own SW cache bucket; `activate` drops
  older `tracker-*` keys so stale geometry does not linger beside a new shell.

## Shipping a release

1. Bump `version` in `package.json` (semver).
2. Add user-facing bullets to `data/release-notes.json` for that version — they
   show once on the startup splash the first time someone opens the new build.
3. Build and deploy as usual — inject runs automatically.
4. Phones online within ~5 minutes (or on next focus) should update; offline
   phones stay on the last good build until they have connectivity.

## User-facing update notes

- **Where:** full-screen splash (same chrome as the location gate), before the
  map or the location ask.
- **When:** first open after an update, for every version between the last one
  they acknowledged and the build now installed.
- **Storage:** `tracker-release-notes-seen` in localStorage — dismissed with
  **Continue**.
- **Offline:** notes ship in the bundle via `data/release-notes.json`, so they
  do not need a network fetch.

If `protocol` in `lib/core/protocol.js` ever changes, that is a separate,
harder compatibility break — this machinery only tracks the **app build**
version, not the party wire format.
