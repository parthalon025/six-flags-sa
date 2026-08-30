# Worktree isolation

Implementation, refactors, and parallel agent work run in a git worktree. Create one before the first edit; remove it when the task is done.

- Create: `npm run worktree:create -- <slug>` (Claude Code: `EnterWorktree` or `claude --worktree <slug>`). The script cuts from `origin/main`.
- Finish: `npm run worktree:remove -- <slug>` after the branch is pushed or the work is discarded — that also deletes the `worktree-*` branch (local, and origin when empty, merged, or discarded). `npm run worktree:prune` drops leftover `worktree-*` branches with no worktree; `--merged` also drops merged worktrees.
- Keep the main checkout on `main`. Remove only the worktree this session created.
- **Nothing local is the only copy.** `npm run worktree:preserve` pushes every branch holding commits not on `origin/main` to `archive/<name>`, whatever the branch is called. The repo runs it automatically on **session start** (a `SessionStart` hook in `.claude/settings.json`, ahead of `prune`); nothing in the repo schedules it more often than that, so a long-running session should re-run it by hand or from its own timer. It is idempotent — a branch already archived at its current tip is skipped. It never deletes and never force-pushes: a branch whose history was rewritten is pushed to `archive/<name>-<sha>` so both copies survive. A non-zero exit means a rescue **failed** and that work is still only on disk.
- Do not rely on `prune` to protect work. It refuses to delete a branch with unique commits, but refusing to delete is not the same as keeping, and it only ever looked at `worktree-*` — which is how `slice-h14` and `slice-h18` sat as the only copy of two files for a week (#803).
- On Windows: every Read/Edit/Bash uses the absolute `WORKTREE=` path (dispatched `isolation: worktree` leaves CWD on the primary checkout). Delete only via the script — recursive `rm` follows NTFS junctions and can wipe files outside the worktree.

Read `scripts/worktree.mjs` for the commands.

Concurrent Cloud Agent tasks share `/workspace`. Do not `git checkout` there — use `npm run worktree:create` (`scripts/worktree.mjs`) so another task cannot clobber uncommitted files.
