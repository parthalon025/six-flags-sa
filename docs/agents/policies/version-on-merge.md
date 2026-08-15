# App version — auto-bumped on merge

The app build version (`package.json` `version`) is **not** something PR authors bump. After every merge to `main`, GitHub Actions (`.github/workflows/bump-version.yml`) runs `scripts/bump-version.mjs`, which:

- skips when the merge did not touch app paths (`scripts/lib/app-paths.json`)
- otherwise bumps from the PR title's Conventional Commit type: `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major
- `chore:` / `docs:` / `test:` / `refactor:` / `perf:` / `ci:` / `style:` skip even if app files moved
- untagged sentence titles still patch when app files changed
- stamps `apps/party-tracker/public/app-version.json` and `apps/party-tracker/public/sw.js` when it does bump
- adds an `apps/party-tracker/data/release-notes.json` entry from the PR title (or a generic fallback)

Tag the **PR title** (`feat:`, `fix:`, `feat!:`). Do not edit version files.

This keeps version bumps off the PR path so they do not block merges or create avoidable conflicts.

## Never bump version in a PR

Do **not** edit these in feature branches:

- `package.json` `version`
- `package-lock.json` version fields
- `apps/party-tracker/public/app-version.json`
- `apps/party-tracker/public/sw.js` service-worker cache name
- `apps/party-tracker/data/release-notes.json` entries for versions that do not exist on `main` yet

`predev` / `prebuild` may rewrite stamped files locally from the current `package.json` version — that is fine. Do not commit those stamp-only changes unless you are fixing the bump workflow itself.

## Resolving merge conflicts on version files

When merging or rebasing `main` into a branch, if any of the files above conflict:

- **AGENTS.md / automation default:** keep `main`'s side (the higher semver and its stamped artifacts). Your PR does not need to advance the version; the bump workflow does that after merge.
- **CLAUDE.md / interactive merge:** fix simple conflicts with `main`, present the user with each conflict and explanation. The bump workflow assigns the next version after your PR merges.

## Custom release notes

The workflow seeds release notes from the PR title. For richer bullets, either put the headline in the PR title or edit `apps/party-tracker/data/release-notes.json` on `main` after the bump commit lands — do not guess a future version number in the PR.
