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
2. Build and deploy as usual — inject runs automatically.
3. Phones online within ~5 minutes (or on next focus) should update; offline
   phones stay on the last good build until they have connectivity.

If `protocol` in `lib/core/protocol.js` ever changes, that is a separate,
harder compatibility break — this machinery only tracks the **app build**
version, not the party wire format.
