# GitNexus index — not on GitHub

The `.gitnexus/` graph is **session-local** (gitignored). Do not commit it, and do not commit GitNexus-generated hunks in `AGENTS.md` / `CLAUDE.md`.

## On start

Cursor Cloud Agent `start` runs `node scripts/gitnexus-sync.mjs startup`. Claude Code
sessions (CLI and web) run the same command automatically via the
`SessionStart` hook in `.claude/settings.json` — both agents build the index
the same way, so neither depends on the model remembering the manual step.

If you're driving a session by hand outside those hooks, run it yourself
once per substantive session:

```bash
npm run gitnexus:startup
```

That rebuilds `.gitnexus/` on disk. Query the graph while you work.

## When install fails

In sandboxed/proxied containers, GitNexus install can fail: the
`onnxruntime-node` postinstall tries to download a native binary and can hit
`read ECONNRESET` through the outbound proxy. `scripts/gitnexus-sync.mjs`
already tolerates this — it catches the failure, restores `AGENTS.md` /
`CLAUDE.md` if `analyze` dirtied them, logs a warning, and exits `0` rather
than crashing the session.

When this happens, `.gitnexus/run.cjs` never materializes. Don't block on
GitNexus tools: fall back to `git grep -n` / manual caller search to scope
impact analysis for that session instead.

## Feature PRs

Stage task files only. Leave `.gitnexus/` out (it should not appear in `git status` as a tracked path). If analyze dirtied `AGENTS.md` / `CLAUDE.md`, restore them.

## Manual commands

| Command | Purpose |
|---------|---------|
| `npm run gitnexus:startup` | Rebuild the session-local index |
| `node .gitnexus/run.cjs status` | Check freshness (after startup) |
| `node .gitnexus/run.cjs analyze` | Rebuild index only |
