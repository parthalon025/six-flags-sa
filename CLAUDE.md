<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **six-flags-sa** (3002 symbols, 7886 relationships, 255 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/six-flags-sa/context` | Codebase overview, check index freshness |
| `gitnexus://repo/six-flags-sa/clusters` | All functional areas |
| `gitnexus://repo/six-flags-sa/processes` | All execution flows |
| `gitnexus://repo/six-flags-sa/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Agent handoff — out-of-scope issues

When you encounter errors, failures, or problems **outside the scope of your current task**, file a GitHub issue for handoff instead of fixing them inline or ignoring them.

### When to file

- Test, lint, or build failures unrelated to your assigned work
- Bugs or regressions in code you are not changing
- Broken CI, missing dependencies, or environment/setup blockers
- Tech debt or follow-ups that would expand scope

### When not to file

- Problems you can fix within the current task without scope creep
- Expected behavior or intentional tradeoffs
- Duplicates of an existing open issue (link the existing issue instead)

### How to file

Use the **Agent handoff** issue template (`.github/ISSUE_TEMPLATE/agent-handoff.yml`) or:

```bash
gh issue create --template agent-handoff.yml
```

Each issue must include:

1. **What failed** — concise title focused on the problem, not your task
2. **Where you saw it** — file paths, commands, CI run URL
3. **Reproduction** — steps or the exact failing command with output
4. **Impact** — blocking vs. non-blocking for the work you were doing
5. **Suggested fix** — optional, if you have a concrete direction

After filing, mention the issue number in your task summary and continue with your assigned work.

## Builder ↔ app contract

The venue builder (`scripts/build-venue.mjs` and its helpers in `scripts/lib/`, plus `scripts/attractions.mjs`, `scripts/trace-venue.mjs`, `scripts/venue-*.mjs`) is the only thing allowed to write `public/venues/*.map.json`, `public/venues/*.pois.json`, `public/venues/manifest.json` and the generated `lib/venueIndex.js`. Everything the app reads at runtime comes out of that pipeline.

### Builder output is wrong → fix the builder, not the output

If a generated file under `public/venues/` or `lib/venueIndex.js` is wrong — a missing ride, a wrong height, a bad tag mapping, a stale manifest entry — never hand-edit the generated JSON/JS to patch it. Fix it at the source instead:

- A tag rule, inference or pipeline bug → fix the builder code (`scripts/build-venue.mjs`, `scripts/attractions.mjs`, `scripts/lib/*.mjs`).
- A one-off correction for a single venue (height, area, alias, hand-added place, district tint, recipe/box/sources) → fix that venue's own input file under `data/venues/<id>.*.json` (`overrides.json`, `sources.json`, `recipe.json`, `ids.json`, `attractions.json`, `heights.json`).

Then regenerate the output with the matching script — `npm run venues:build`, `venues:rebuild`, `venues:overrides`, `venues:reindex` or `venues:attractions` — instead of editing the regenerated file by hand. `data/venues/` is builder input and is meant to be hand-edited; `public/venues/*.json` and `lib/venueIndex.js` are builder output and are not.

### Prove the fix works in the app

A fix isn't done when the regenerated JSON looks right on its own. After rebuilding, confirm it in the app:

- `npm run venues:report <id>` to sanity-check the rebuilt venue.
- The relevant suite (`npm test`, `npm run test:functional`, `npm run test:visual`, etc.) and/or a manual check of the affected screen, so the fix is proven against the running app and not just the file on disk.

### App change touches the builder's contract → validate against the builder

Going the other way: if an app change reads a new or changed shape from `public/venues/*.json`, `manifest.json` or `lib/venueIndex.js` (a new field, a renamed key, a new required invariant), don't assume the builder already produces it. Before shipping:

- Confirm the builder actually emits that shape for every shipped venue, or update the builder so it does.
- Rerun `npm run venues:build`/`venues:rebuild` (or at minimum `npm run venues:report`) for the affected venues to check the contract holds across all of them, not just the one you tested with.
- Update the builder section of `README.md` if the on-disk contract changed, so the next person building a venue sees the same shape the app now expects.

### Ask before guessing

If it's unclear whether a file is builder input (edit it) or builder output (regenerate it, don't hand-edit it) — or whether a fix belongs in the builder vs. the app — ask before proceeding rather than guessing.

## App version — auto-bumped on merge

The app build semver is **not** bumped in PRs. After every merge to `main`, `.github/workflows/bump-version.yml` runs `scripts/bump-version.mjs` to increment `package.json`, stamp `public/app-version.json` / `public/sw.js`, and add a `data/release-notes.json` line from the PR title. This keeps version bumps off the merge path.

### Never bump version in a PR

Do not edit `package.json` `version`, `package-lock.json` version fields, `public/app-version.json`, `public/sw.js`, or future `data/release-notes.json` keys in feature branches.

### Merge conflicts on version files

When syncing with `main`, if those files conflict, keep `main`'s side. The bump workflow assigns the next version after your PR merges.
