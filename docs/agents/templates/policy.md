# {Policy title}

{One-sentence summary of when this policy applies. Front-load the **leading word**.}

## When this applies

- {Distinct branch / trigger 1}
- {Distinct branch / trigger 2}

## Rules

{In-file reference the agent consults on demand. Prefer pointers to scripts over restating script logic.}

| Concern | Use this |
|---------|----------|
| {Example} | `{npm run …}` or `scripts/lib/…` |

## Ask before guessing

{Optional — when human judgment is required and automation cannot decide.}

---

**After editing:** add or update the policy in `scripts/lib/agent-docs/manifest.json`, then run `npm run agent-docs:build`.

**GitHub issue forms:** policy text lives here; the form YAML lives in `docs/agents/templates/github/<name>.yml` and is registered in `manifest.json` → `github.issueTemplates`.
