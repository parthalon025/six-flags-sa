# Issue tracker: local markdown

Feature work, wayfinding, and specs for this repo live as markdown files under `.scratch/` (gitignored — session-local scratch).

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Tickets are one file per issue at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is a `Status:` line near the top of each issue file (see [triage-labels.md](../triage-labels.md))
- Comments append under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or ticket number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (Destination / Notes / Decisions-so-far / Not yet specified / Out of scope)
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md` — `Type:` (`research` / `prototype` / `grilling` / `task`), `Status:` (`open` / `claimed` / `resolved`), question in body
- **Blocking**: `Blocked by: NN, NN` near the top (or `None`). Unblocked when every listed ticket is `resolved`
- **Frontier**: scan `issues/` for open, unblocked, unclaimed tickets; first by number wins
- **Claim**: set `Status: claimed` before work
- **Resolve**: append `## Answer`, set `Status: resolved`, gist + link under **Decisions so far** in `map.md`

### Active wayfinder effort

| Effort | Map |
| --- | --- |
| factories → app end-state | `.scratch/factories-to-app/map.md` (supersedes GitHub #625–630) |

## Implementation tickets (`/to-tickets`)

Same `issues/` folder; use the to-tickets template:

- `What to build`, `Blocked by`, `Status: ready-for-agent`, acceptance checkboxes
- Work the frontier: any ticket whose blockers are all `resolved`

## GitHub coexistence

**Agent handoff** and production triage still use GitHub Issues — see [github-issue-tracker policy](./github-issue-tracker.md). Do not file wayfinding maps or feature specs on GitHub; use `.scratch/` instead.
