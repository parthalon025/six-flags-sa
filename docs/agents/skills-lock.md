# Matt Pocock skills — lock and anti-drift

Canonical install: [mattpocock/skills](https://github.com/mattpocock/skills) via [skills.sh](https://skills.sh/), vendored under `.agents/skills/` and pinned by `skills-lock.json`.

## Rules

1. **Do not hand-edit** files under `.agents/skills/`. Local edits are drift.
2. **Do not commit** agent junction/copy trees (`agent/`, `.claude/skills/<matt-skill>/`). Canonical files live only in `.agents/skills/`.
3. **Intentional upgrades** refresh the lock and the vendored trees together:

```bash
npx skills@latest update -p -y
npm run skills:check
```

4. **Restore from the lock** (after a bad local edit or a fresh clone missing trees):

```bash
npx skills@latest experimental_install
npm run skills:check
```

5. CI runs `npm run skills:check` on every PR/push so folder hashes must match `skills-lock.json`.

## What `skills:check` verifies

- Every entry in `skills-lock.json` exists under `.agents/skills/<name>/`
- Each folder's content hash matches `computedHash` (skills CLI algorithm, **LF-normalized** so Windows and Linux CI agree)
- Every lock entry sources `mattpocock/skills`
- No unexpected extra skill folders under `.agents/skills/` beyond the lock

`npm run skills:update` / `skills:restore` rewrite lock hashes after the skills CLI refresh (the upstream CLI may hash CRLF on Windows).
