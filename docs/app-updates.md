# App updates — insider notes

**Audience:** whoever ships, hosts, or debugs deployments. Visitors see a version
number under **Day → Advanced** and in **Diagnostics**; they do not need this
page.

## What changed

- **Single version source:** `package.json` `version` (semver). `predev` /
  `prebuild` runs `scripts/inject-version.mjs`, which writes
  `public/app-version.json` (including a per-deploy `built` ISO timestamp) and
  rewrites the service-worker cache name (`tracker-<version>`).
- **Client stamp:** `NEXT_PUBLIC_APP_VERSION` and `NEXT_PUBLIC_APP_BUILT` from
  `next.config.mjs` — baked into the JS bundle at build time.
- **Server truth:** `/api/version` returns `{ version, protocol, built }`
  (`protocol` is still the party-wire compatibility number).
- **Update loop:** `lib/appUpdate.js` polls `/api/version` when online. A phone
  updates when the server reports a **higher semver** or the **same semver with
  a newer `built` stamp** — so merges that redeploy without bumping
  `package.json` still land. The loop probes `registration.update()`, activates
  a waiting worker, and reloads once if the bundle is behind but the worker has
  not caught up. Offline or timed-out checks are silent.

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

1. **Do not bump the version in your PR.** Leave `package.json`, stamped
   `public/app-version.json` / `public/sw.js`, and version-keyed release notes
   alone on feature branches — bumping them in the PR causes merge conflicts
   with the auto-bump commits on `main`.
2. **Merge to `main`.** GitHub Actions runs `scripts/bump-version.mjs`. It skips
   when the merge did not touch app paths (`scripts/lib/app-paths.json`).
   Otherwise it bumps from the PR title’s Conventional Commit type (`fix:`
   patch, `feat:` minor, breaking → major), updates `package-lock.json`, stamps
   `public/app-version.json` / `public/sw.js`, and adds a release-notes line
   from the PR title (or a generic fallback). Tag the PR title; `chore:` /
   `docs:` / `test:` skip even on app files. Untagged app merges still patch.
3. For richer release notes, put the headline in the PR title or edit
   `data/release-notes.json` on `main` after the bump commit — the workflow only
   adds an entry when the new version is missing.
4. Build and deploy as usual — inject also runs on `prebuild` / `predev` and
   stamps a fresh `built` time. Vercel **production** always builds for a `main`
   push that is not GitNexus-index-only (`scripts/lib/vercel-ignore.mjs`), so
   docs merges still move the live alias. Previews still skip when no app paths
   changed. The post-merge workflow amends the GitNexus refresh into the
   unpushed version-bump commit so Vercel does not see a gitnexus-only HEAD and
   skip the bump.
5. Phones online within ~5 minutes (or on tab focus) should update; offline
   phones stay on the last good build until they have connectivity.

**Merge conflicts:** when syncing a branch with `main`, keep `main`'s version for
`package.json`, `package-lock.json`, `public/app-version.json`, `public/sw.js`,
and `data/release-notes.json`. Your merge does not need to advance the semver.

**How to verify auto-update:** open **Day → Advanced → Diagnostics**. The
**Server version** should be higher than **Installed version** right after a
deploy; **Server build** should be newer than **Installed build** if the semver
already matched.

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
