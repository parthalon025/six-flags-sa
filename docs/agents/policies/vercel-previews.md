# Vercel previews — don't spam builds

This project is limited to **100 Vercel deployments per day** on the account. **Twenty-five are reserved for explicit user directive only.** Agents and automation must not consume that reserve.

## User reserve: 25 deploys/day (user directive only)

A preview or discretionary deploy may run only when the **user** authorized it:

- `[vercel build]` in the commit subject (user adds this), or
- `VERCEL_USER_BUILD=1` on the Vercel project (user sets in the dashboard)

Agents must **not** add `[vercel build]`, set `VERCEL_USER_BUILD`, or push branches hoping for a preview. When the user asks to deploy or preview, they consume their reserve; otherwise use local build and CI.

The remaining **~75 deploys/day** are for automation — mainly production `main` merges that touch app paths (`scripts/lib/vercel-ignore.mjs`).

## Agents: no preview pushes by default

- No branch or PR push just to "see it on Vercel" when `npm run build -w @party-tracker/app` and Playwright/manual checks suffice.
- `cursor/*` and `worktree-*` previews are skipped by ignoreCommand unless user-directed.
- Human PR previews are also skipped unless user-directed — do not assume a PR needs Vercel.

## When a user-directed preview IS warranted

Only after the user explicitly asks — PWA/service worker, Vercel routing, production env vars, CDN headers, or a defect that does not reproduce locally. The user (not the agent) adds `[vercel build]` or flips `VERCEL_USER_BUILD=1`.

## Which commits build on Vercel

**Do not restate this in agent docs** — `scripts/vercel-ignore.sh` (wired in `vercel.json`) decides whether a commit needs a Vercel build. Read that script if you need the path list.
