# Matt Pocock skills — global only

Canonical install: [mattpocock/skills](https://github.com/mattpocock/skills) via [skills.sh](https://skills.sh/), **globally** under `~/.agents/skills`. This repo must not vendor a second copy.

## Rules

1. **Do not add** `.agents/skills/` or `skills-lock.json` in this repo. Those duplicate the global install and show up in every agent session.
2. **Do not commit** agent junction/copy trees (`agent/`, `.claude/skills/<matt-skill>/`). Keep gitnexus skills under `.claude/skills/gitnexus/` only.
3. **Upgrade globally**, not in this repo:

```bash
npx skills add mattpocock/skills -g -y --skill '*'
```

4. CI runs `npm run skills:check` so a vendored tree cannot land again.

## What `skills:check` verifies

- `skills-lock.json` is absent
- `.agents/skills/` has no skill folders

See `scripts/check-skills-lock.mjs`.
