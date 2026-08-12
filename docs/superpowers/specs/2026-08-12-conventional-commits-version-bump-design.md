# Design: Conventional Commits version bump

**Date:** 2026-08-12  
**Status:** Approved — implemented in `feat/conventional-commits-version-bump`  
**Related:** `.github/workflows/bump-version.yml`, `scripts/bump-version.mjs`, `scripts/lib/app-paths.json`, `apps/party-tracker/lib/version.js`

---

## Problem

Every merge to `main` used to increment **patch**, including docs-only work. Feature and fix looked the same in the number visitors see.

## Decision

Two gates, in order. A skip is a successful no-op (no bump commit).

1. **App paths** — diff `HEAD^1`…`HEAD`. No match in `scripts/lib/app-paths.json` (same list Vercel ignore reads) → skip, even if the title is `feat:`.
2. **Conventional Commit kind** — PR title plus this merge’s commit messages. Highest wins: breaking / `type!:` → major; `feat:` → minor; `fix:` → patch; `chore:` `docs:` `test:` `refactor:` `perf:` `ci:` `style:` → skip; untagged sentence + app files → patch.

Agents tag the **PR title**. They never edit version files.

## Non-goals

No `semantic-release` package. Party-wire `protocol` unchanged. Humans are not required to use Conventional Commits.
