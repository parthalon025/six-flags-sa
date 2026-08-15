# Worktree isolation

Implementation, refactors, and parallel agent work run in a git worktree. Create one before the first edit; remove it when the task is done.

- Create: `npm run worktree:create -- <slug>` (Claude Code: `EnterWorktree` or `claude --worktree <slug>`). The script cuts from `origin/main`.
- Finish: `npm run worktree:remove -- <slug>` after the branch is pushed or the work is discarded — that also deletes the `worktree-*` branch (local, and origin when empty, merged, or discarded). `npm run worktree:prune` drops leftover `worktree-*` branches with no worktree; `--merged` also drops merged worktrees.
- Keep the main checkout on `main`. Remove only the worktree this session created.
- On Windows: every Read/Edit/Bash uses the absolute `WORKTREE=` path (dispatched `isolation: worktree` leaves CWD on the primary checkout). Delete only via the script — recursive `rm` follows NTFS junctions and can wipe files outside the worktree.

Read `scripts/worktree.mjs` for the commands.

Concurrent Cloud Agent tasks share `/workspace`. Do not `git checkout` there — use `npm run worktree:create` (`scripts/worktree.mjs`) so another task cannot clobber uncommitted files.
