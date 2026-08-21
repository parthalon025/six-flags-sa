# GitNexus index — not on GitHub

The `.gitnexus/` graph is **session-local** (gitignored). Do not commit it, and do not commit GitNexus-generated hunks in the docs analyze rewrites — `GENERATED_DOC_PATHS` in `scripts/lib/gitnexus-docs.mjs` is the list.

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
`onnxruntime-node` postinstall tries to download a native binary and hits
`read ECONNRESET` through the outbound proxy. npm aborts the *whole* install
when that script fails, so `@ladybugdb/core` never gets its `lbugjs.node`
either and `gitnexus analyze` exits non-zero with no output.

`scripts/gitnexus-sync.mjs` repairs this itself. After `analyze` fails twice
(once plain, once `--force`) it reinstalls with
`npm i -g gitnexus --ignore-scripts` and then runs *only* LadybugDB's
installer, which copies a prebuilt binary out of the
`@ladybugdb/core-<platform>` package npm already fetched — no network. Then it
retries `analyze`. Embedding and FTS features stay unavailable in that mode;
the code graph, `impact`, and `detect_changes` do not need them.

If even that fails — no registry at all — the script still exits `0` rather
than crashing the session. `.gitnexus/run.cjs` never materializes; don't block
on GitNexus tools, fall back to `git grep -n` / manual caller search to scope
impact analysis for that session instead.

## What analyze rewrites

`analyze` rewrites generated hunks in `AGENTS.md`, `CLAUDE.md`, **and its own
skill docs** under `.claude/skills/gitnexus/` — it will silently drop a section
this repo added there by hand. That list is `GENERATED_DOC_PATHS` in
`scripts/lib/gitnexus-docs.mjs`; read it there rather than trusting a copy in
prose. The sync script reverts those paths, but only the ones *that run*
dirtied: it snapshots `git status` first, so a doc you were already editing
survives. Running `gitnexus analyze` directly bypasses that guard — check
`git status` afterwards if you do.

## Feature PRs

Stage task files only. Leave `.gitnexus/` out (it should not appear in `git status` as a tracked path). If analyze dirtied any `GENERATED_DOC_PATHS` entry, restore it.

## Manual commands

| Command | Purpose |
|---------|---------|
| `npm run gitnexus:startup` | Rebuild the session-local index |
| `node .gitnexus/run.cjs status` | Check freshness (after startup) |
| `node .gitnexus/run.cjs analyze` | Rebuild index only |
