# Executive Resume Human Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At `npm run resume:start`, print **one** terminal executive brief (Overview → NOW → Factories → App → Wayfinder → Hanging) filled by the script from canonical facts.

**Architecture:** Add a deep brief module (`scripts/lib/executive-resume-brief.mjs`) with a small interface (`gatherBriefFacts`, `fillHumanBrief`). Wire `sessionStartBrief` to print that string once, keep CreateGoal/ritual, and stop dumping the full Matt workflow session brief beside it. Wayfinder facts reuse `effortPhase` / `loadTickets` / `listEfforts` from `matt-workflow.mjs` (no second map parser).

**Tech Stack:** Node ESM (`scripts/lib/*.mjs`), node:assert tests (`test/scripts/executive-resume*.test.mjs`), `gh` via injectable runner, existing resume pointer #643.

**Spec:** `docs/superpowers/specs/2026-08-25-executive-resume-human-brief-design.md`

## Global Constraints

- One printed human brief only — never brief + second spoken/workflow dump as required reading  
- Hanging tickets: GitHub labels `ready-for-agent` or `ready-for-human` only  
- Wayfinder: `.scratch/<effort>/map.md` + open/claimed wayfinder decision tickets by **title**; phase from `effortPhase`  
- Version health (when shown): Clerk package vs lockfile — not app version vs `main`  
- Terminal prose / markdown headings — no HTML  
- Do not edit app version stamp files  
- Policy docs: one pointer sentence; no restated template logic  
- TDD: failing test → implement → pass → commit per task  

---

## File map

| File | Responsibility |
|------|----------------|
| `scripts/lib/executive-resume-brief.mjs` | **New.** `gatherBriefFacts`, `fillHumanBrief`, path classifiers, Clerk health, GitHub triage gather, wayfinder gather |
| `scripts/lib/executive-resume.mjs` | Call brief module from `sessionStartBrief` / optionally `print`; keep NOW/inventory/JSON unchanged |
| `scripts/lib/matt-workflow.mjs` | **Reuse only** (`listEfforts`, `effortPhase`, `loadTickets`). Export nothing new unless a tiny helper is required for destination parse locality |
| `test/scripts/executive-resume-brief.test.mjs` | **New.** Output assertions on `fillHumanBrief` / gather helpers |
| `test/scripts/executive-resume.test.mjs` | Keep existing NOW/drift tests; add start-brief smoke that human brief headings appear and full workflow dump does not |
| `docs/agents/policies/executive-resume.md` | One pointer to the design + note that start prints the human brief |
| `docs/superpowers/specs/2026-08-25-executive-resume-human-brief-design.md` | Already approved (incl. Wayfinder) — do not re-litigate in code comments |

`renderMarkdown` remains the **ops inventory** view for `resume:print` / push body unless a later task explicitly switches `print` — this plan switches **`start`** (and documents that `print` stays inventory until optional follow-up).

---

### Task 1: Pure template filler `fillHumanBrief`

**Files:**
- Create: `scripts/lib/executive-resume-brief.mjs`
- Create: `test/scripts/executive-resume-brief.test.mjs`
- Modify: `scripts/ci/manifest.mjs` (add the new test file next to `executive-resume.test.mjs` if not globbed)
- Modify: `scripts/ci/test-estate.mjs` (map new test to `ci-gate` like the sibling)

**Interfaces:**
- Consumes: nothing from resume module yet  
- Produces: `fillHumanBrief(facts: BriefFacts) => string`

`BriefFacts` shape (freeze this for later tasks):

```js
/**
 * @typedef {{
 *   overview?: string,
 *   now: { task?: string, doneWhen?: string[], nextStep?: string, ticket?: string },
 *   factoriesStanding: string,
 *   appStanding: string,
 *   wayfinder: Array<{
 *     slug: string,
 *     phase: string,
 *     destination?: string,
 *     tickets: Array<{ id: string, title: string, status: string }>
 *   }>,
 *   hanging: Array<{ kind: 'github'|'blocked'|'parking', title: string, number?: number, label?: string }>,
 *   clerkHealth?: { ok: boolean, declared?: string, locked?: string, detail: string } | null,
 *   warnings?: string[],
 * }} BriefFacts
 */
```

- [ ] **Step 1: Write the failing test**

Create `test/scripts/executive-resume-brief.test.mjs`:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fillHumanBrief } from '../../scripts/lib/executive-resume-brief.mjs';

const text = fillHumanBrief({
  overview: 'Parkbound helps families navigate the park together.',
  now: { task: 'Harden resume brief', doneWhen: ['One brief prints'], nextStep: 'Wire gather' },
  factoriesStanding: 'Venue builder bake path is green.',
  appStanding: 'Nothing in flight under this label set.',
  wayfinder: [
    {
      slug: 'factories-to-app',
      phase: 'wayfinder',
      destination: 'Factories feed the live app map',
      tickets: [{ id: '01', title: 'Who owns display bake?', status: 'open' }],
    },
  ],
  hanging: [
    { kind: 'github', title: 'Pin dashboard JSON', number: 643, label: 'ready-for-human' },
    { kind: 'blocked', title: 'Approve brief design' },
  ],
  clerkHealth: { ok: true, declared: '7.7.5', locked: '7.7.5', detail: 'Clerk @clerk/nextjs matches lockfile.' },
});

const headings = [...text.matchAll(/^## .+$/gm)].map((m) => m[0]);
assert.deepEqual(headings, [
  '## Overview',
  '## NOW',
  '## Factories',
  '## App',
  '## Wayfinder',
  '## Hanging / waiting on you',
]);
assert.match(text, /^# Executive brief/m);
assert.match(text, /Who owns display bake\?/);
assert.match(text, /Pin dashboard JSON \(#643\)/);
assert.match(text, /Clerk @clerk\/nextjs matches lockfile/);
assert.doesNotMatch(text, /<html/i);
console.log('executive-resume-brief template ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/scripts/executive-resume-brief.test.mjs`  
Expected: FAIL — module not found / `fillHumanBrief` not exported

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/executive-resume-brief.mjs`:

```js
/**
 * Executive human brief — one fixed template filled from canonical facts.
 * Spec: docs/superpowers/specs/2026-08-25-executive-resume-human-brief-design.md
 */

/** @param {import('./executive-resume-brief.mjs').BriefFacts | object} facts */
export function fillHumanBrief(facts) {
  const lines = ['# Executive brief', ''];

  lines.push('## Overview', facts.overview?.trim() || '_Set NOW and human notes — overview is composed from facts._', '');

  lines.push('## NOW');
  const task = facts.now?.task?.trim() || '_(unset — set before coding)_';
  lines.push(task);
  if (facts.now?.nextStep?.trim()) lines.push(`Next: ${facts.now.nextStep.trim()}`);
  if (facts.now?.doneWhen?.length) {
    for (const d of facts.now.doneWhen) lines.push(`- Done when: ${d}`);
  }
  lines.push('');

  lines.push('## Factories', facts.factoriesStanding?.trim() || 'Nothing in flight under this label set.', '');
  lines.push('## App', facts.appStanding?.trim() || 'Nothing in flight under this label set.', '');

  lines.push('## Wayfinder');
  if (!facts.wayfinder?.length) {
    lines.push('No active wayfinder map.');
  } else {
    const anyTickets = facts.wayfinder.some((w) => w.tickets?.length);
    if (!anyTickets) {
      lines.push('Maps clear — no open decision tickets.');
    }
    for (const w of facts.wayfinder) {
      lines.push(`**${w.slug}** — phase \`${w.phase}\``);
      if (w.destination?.trim()) lines.push(`Destination: ${w.destination.trim()}`);
      for (const t of w.tickets || []) {
        lines.push(`- ${t.title}${t.id ? ` (${t.id})` : ''} · ${t.status}`);
      }
    }
  }
  lines.push('');

  lines.push('## Hanging / waiting on you');
  if (!facts.hanging?.length) {
    lines.push('- _(none)_');
  } else {
    for (const h of facts.hanging) {
      if (h.kind === 'github') {
        const num = h.number != null ? ` (#${h.number})` : '';
        const lab = h.label ? ` · \`${h.label}\`` : '';
        lines.push(`- ${h.title}${num}${lab}`);
      } else {
        lines.push(`- ${h.title}`);
      }
    }
  }
  lines.push('');

  if (facts.clerkHealth?.detail) {
    lines.push(`_Version: ${facts.clerkHealth.detail}_`, '');
  }
  if (facts.warnings?.length) {
    lines.push('⚠️ Brief warnings:');
    for (const w of facts.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
```

Wire the new test into `scripts/ci/manifest.mjs` and `scripts/ci/test-estate.mjs` the same way as `test/scripts/executive-resume.test.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/scripts/executive-resume-brief.test.mjs`  
Expected: `executive-resume-brief template ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/executive-resume-brief.mjs test/scripts/executive-resume-brief.test.mjs scripts/ci/manifest.mjs scripts/ci/test-estate.mjs
git commit -m "feat(agents): fillHumanBrief fixed executive template"
```

---

### Task 2: Wayfinder gather (reuse matt-workflow)

**Files:**
- Modify: `scripts/lib/executive-resume-brief.mjs`
- Modify: `test/scripts/executive-resume-brief.test.mjs`

**Interfaces:**
- Consumes: `listEfforts`, `effortPhase`, `loadTickets` from `./matt-workflow.mjs`  
- Produces: `gatherWayfinderFacts(root: string) => BriefFacts['wayfinder']`

Rules:
- Include effort only if `map.md` exists  
- Phase from `effortPhase(slug, root).phase`  
- Tickets: from `loadTickets`, keep those with `ticket.isWayfinder === true` and status in `open` | `claimed`  
- Destination: first non-empty bullet or paragraph under `## Destination` (or `# Destination`) in `map.md`; if missing, omit  
- If maps exist but no open/claimed wayfinder tickets, still return the effort rows with `tickets: []` so `fillHumanBrief` can say “Maps clear…”

- [ ] **Step 1: Write the failing test**

Append to `test/scripts/executive-resume-brief.test.mjs`:

```js
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherWayfinderFacts } from '../../scripts/lib/executive-resume-brief.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'brief-wf-'));
const root = join(scratch, 'repo');
const effort = join(root, '.scratch', 'factories-to-app');
mkdirSync(join(effort, 'issues'), { recursive: true });
writeFileSync(
  join(effort, 'map.md'),
  '# Map\n\n## Destination\n\nFactories feed the live app map\n\n## Decisions so far\n\n- none\n',
);
writeFileSync(
  join(effort, 'issues/01-who-owns-bake.md'),
  '# 01: Who owns display bake?\n\n**Type:** grilling\n\n**Status:** open\n\n**Blocked by:** None\n\n## Question\n\nWho?\n',
);
writeFileSync(
  join(effort, 'issues/02-impl.md'),
  '# 02: Implement bake\n\n**Status:** ready-for-agent\n\n**What to build:**\n\n- bake\n',
);

const wf = gatherWayfinderFacts(root);
assert.equal(wf.length, 1);
assert.equal(wf[0].slug, 'factories-to-app');
assert.match(wf[0].destination, /Factories feed/);
assert.equal(wf[0].tickets.length, 1);
assert.equal(wf[0].tickets[0].title, 'Who owns display bake?');
assert.ok(!wf[0].tickets.some((t) => /Implement bake/.test(t.title)));

rmSync(scratch, { recursive: true, force: true });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/scripts/executive-resume-brief.test.mjs`  
Expected: FAIL — `gatherWayfinderFacts` not exported

- [ ] **Step 3: Write minimal implementation**

In `executive-resume-brief.mjs`:

```js
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effortPhase, listEfforts, loadTickets } from './matt-workflow.mjs';

function readDestination(mapPath) {
  if (!existsSync(mapPath)) return undefined;
  const body = readFileSync(mapPath, 'utf8');
  const part = body.split(/^##?\s+Destination\s*$/im)[1];
  if (!part) return undefined;
  const until = part.split(/^##\s+/m)[0] || part;
  const line = until
    .split('\n')
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .find((l) => l && !l.startsWith('#'));
  return line;
}

export function gatherWayfinderFacts(root) {
  const out = [];
  for (const slug of listEfforts(root)) {
    const dir = join(root, '.scratch', slug);
    const mapPath = join(dir, 'map.md');
    if (!existsSync(mapPath)) continue;
    const state = effortPhase(slug, root);
    const tickets = loadTickets(dir)
      .filter((t) => t.isWayfinder && ['open', 'claimed'].includes(t.status))
      .map((t) => ({ id: t.id, title: t.title, status: t.status }));
    out.push({
      slug,
      phase: state.phase,
      destination: readDestination(mapPath),
      tickets,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/scripts/executive-resume-brief.test.mjs`  
Expected: PASS (template + wayfinder)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/executive-resume-brief.mjs test/scripts/executive-resume-brief.test.mjs
git commit -m "feat(agents): gather wayfinder facts for executive brief"
```

---

### Task 3: Standing lines, GitHub hanging, Clerk health, `gatherBriefFacts`

**Files:**
- Modify: `scripts/lib/executive-resume-brief.mjs`
- Modify: `test/scripts/executive-resume-brief.test.mjs`

**Interfaces:**
- Consumes: resume object (`now`, `human`, `inventory`), injectable `runner` for `gh`  
- Produces: `gatherBriefFacts({ resume, root, runner }) => BriefFacts`

Path classifiers (exact prefixes; a worktree/PR path “touches” if branch name or listed path contains them — for inventory without file lists, use **NOW branch/worktree/task text** + `human.notes` / parking strings):

```js
export const FACTORY_HINTS = [
  'venue-builder',
  'venues/',
  'venues:',
  'train:',
  'train H',
  'train I',
  'display bake',
  'factory',
];
export const APP_HINTS = ['party-tracker', 'apps/party-tracker', 'clerk', 'profile', 'capacitor'];
```

Standing algorithm:
1. Collect text blobs: `now.task`, `now.nextStep`, `now.branch`, `now.worktree`, `human.notes`, inventory worktree slugs/branches, draft PR titles  
2. If any blob matches a FACTORY hint (case-insensitive) → factoriesStanding = `In flight: <now.task or matching PR/worktree one-liner>.`  
3. Else factoriesStanding = `Nothing in flight under this label set.`  
4. Same for APP_HINTS → appStanding  
5. Overview: if `human.overview` (optional string on human) trim use it; else compose:  
   `Parkbound executive focus: ${now.task}.` + if factories not empty-line set append factories sentence once + if app distinct append app sentence once — **skip** appending a standing sentence that equals another already used (dedupe)

GitHub hanging:

```js
export function gatherGithubHanging({ cwd, runner }) {
  // gh issue list --label ready-for-agent --label ready-for-human is OR in gh? 
  // Use two calls and merge by number; ignore other labels.
}
```

Each issue → `{ kind: 'github', title, number, label }` preferring `ready-for-human` when both.

Also append `human.blockedOnMe` → `{ kind: 'blocked', title }` and `human.parkingLot` → `{ kind: 'parking', title }`.

Clerk health:

```js
export function gatherClerkHealth(root) {
  // read apps/party-tracker/package.json dependencies['@clerk/nextjs']
  // read package-lock.json packages['node_modules/@clerk/nextjs'].version OR nested lock entry
  // return { ok, declared, locked, detail }
}
```

On read failure: `null` (omit from brief).

Warnings: if `gh` throws for hanging → `warnings: ['GitHub hanging inventory incomplete']` and do **not** pretend all-clear (hanging may still list human.*).

- [ ] **Step 1: Write the failing tests** (filter + standing + clerk)

```js
import {
  classifyStanding,
  fillHumanBrief,
  gatherBriefFacts,
  gatherClerkHealth,
  gatherGithubHanging,
} from '../../scripts/lib/executive-resume-brief.mjs';

assert.equal(
  classifyStanding({
    blobs: ['feat: party-tracker clerk profile'],
    factoryHints: FACTORY_HINTS,
    appHints: APP_HINTS,
  }).app,
  true,
);

const hang = gatherGithubHanging({
  cwd: root,
  runner: (cmd, args) => {
    if (cmd === 'gh' && args.includes('ready-for-agent')) {
      return JSON.stringify([
        { number: 1, title: 'Agent work', labels: [{ name: 'ready-for-agent' }] },
        { number: 2, title: 'Noise', labels: [{ name: 'needs-triage' }] },
      ]);
    }
    if (cmd === 'gh' && args.includes('ready-for-human')) {
      return JSON.stringify([{ number: 3, title: 'Need human', labels: [{ name: 'ready-for-human' }] }]);
    }
    return '[]';
  },
});
assert.deepEqual(
  hang.map((h) => h.number).sort(),
  [1, 3],
);

// gatherBriefFacts integration with empty gh + wayfinder fixture from Task 2 pattern
```

Add clerk fixture: temp `apps/party-tracker/package.json` + minimal lockfile stub asserting mismatch detail when versions differ.

- [ ] **Step 2: Run tests — expect FAIL** on missing exports

- [ ] **Step 3: Implement** `classifyStanding`, `gatherGithubHanging`, `gatherClerkHealth`, `gatherBriefFacts`, export `FACTORY_HINTS` / `APP_HINTS`

For `gh` calls use the same style as `gatherHandoffIssues` in `executive-resume.mjs`:

```js
runner('gh', ['issue', 'list', '--label', 'ready-for-agent', '--state', 'open', '--json', 'number,title,labels'], { cwd, encoding: 'utf8' })
```

Filter client-side: keep issue only if labels include exactly one of the two allowed names (drop `needs-triage`-only rows even if a bad fixture returns them).

- [ ] **Step 4: Run** `node test/scripts/executive-resume-brief.test.mjs` — PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/executive-resume-brief.mjs test/scripts/executive-resume-brief.test.mjs
git commit -m "feat(agents): gatherBriefFacts for standing, hanging, Clerk, wayfinder"
```

---

### Task 4: Wire `sessionStartBrief` to one human brief

**Files:**
- Modify: `scripts/lib/executive-resume.mjs` (`sessionStartBrief` ~564–605)
- Modify: `test/scripts/executive-resume.test.mjs`

**Interfaces:**
- Consumes: `gatherBriefFacts`, `fillHumanBrief`  
- Produces: updated `sessionStartBrief()` string

Behavior change:
1. After refresh inventory / drift / goal (unchanged)  
2. Primary body = `fillHumanBrief(gatherBriefFacts({ resume, root, runner }))`  
3. Then ritual + CreateGoal block (keep)  
4. **Remove** embedding full `mattWorkflowBrief({ cwd: root, situation })` from the start print  
5. Add one ritual line: `Matt skill gate: npm run workflow:next` (pointer only)  
6. `resume:print` keeps `renderMarkdown` (ops inventory) — do not switch in this task  

- [ ] **Step 1: Failing test** in `executive-resume.test.mjs`

```js
import { sessionStartBrief } from '../../scripts/lib/executive-resume.mjs';

// use temp root with resume.json + empty gh runner
const start = sessionStartBrief({ root, runner });
assert.match(start, /# Executive brief/);
assert.match(start, /## Wayfinder/);
assert.match(start, /## Hanging \/ waiting on you/);
assert.match(start, /CreateGoal/);
assert.doesNotMatch(start, /# Matt workflow session brief/);
assert.doesNotMatch(start, /### Draft PRs/); // inventory dump not in start human brief
```

- [ ] **Step 2: Run — expect FAIL** (still prints renderMarkdown + workflow brief)

- [ ] **Step 3: Implement** import + replace body in `sessionStartBrief`

```js
import { fillHumanBrief, gatherBriefFacts } from './executive-resume-brief.mjs';
// ...
const brief = fillHumanBrief(gatherBriefFacts({ resume, root, runner }));
const lines = [
  brief,
  '---',
  '',
  '## Session start ritual',
  // platform / confirm NOW / workflow:check / CreateGoal / end-turn
  'Matt skill gate: `npm run workflow:next` (not duplicated here).',
];
```

Keep `situation` param unused or pass only into a warning if you must — do not reintroduce full session brief.

- [ ] **Step 4: Run** both test files — PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/executive-resume.mjs test/scripts/executive-resume.test.mjs
git commit -m "feat(agents): resume:start prints one human brief"
```

---

### Task 5: Policy pointer + empty human.overview note

**Files:**
- Modify: `docs/agents/policies/executive-resume.md`
- Run: `npm run agent-docs:build` if the policy is in the agent-docs manifest (it is)

- [ ] **Step 1: Edit policy** — under Session start ritual / Canonical split, add one short pointer:

```markdown
### Human brief (session start)

`npm run resume:start` prints one **executive brief** (Overview, NOW, Factories, App, Wayfinder, Hanging). Spec: [2026-08-25-executive-resume-human-brief-design.md](../../superpowers/specs/2026-08-25-executive-resume-human-brief-design.md). Optional `human.overview` on the dashboard JSON overrides composed Overview. Ops inventory remains `npm run resume:print`.
```

Do not paste the template into the policy.

- [ ] **Step 2: Ensure `emptyResume` / merge allow `human.overview` string** if missing — add field default `overview: ''` in `emptyResume().human` in `executive-resume.mjs` and a tiny assert in existing test that merge preserves it.

- [ ] **Step 3: `npm run agent-docs:build` && `npm run agent-docs:check`**

- [ ] **Step 4: Commit**

```bash
git add docs/agents/policies/executive-resume.md scripts/lib/executive-resume.mjs test/scripts/executive-resume.test.mjs AGENTS.md CLAUDE.md .cursor/rules 2>/dev/null
git commit -m "docs(agents): point executive-resume policy at human brief"
```

---

### Task 6: Pre-merge proof

**Files:** none new

- [ ] **Step 1: Run** `node test/scripts/executive-resume-brief.test.mjs && node test/scripts/executive-resume.test.mjs`

- [ ] **Step 2: Run** `npm run test:pre-merge-vertical` (or the vertical that includes `ci-gate` / these script tests). Fix failures at the root cause.

- [ ] **Step 3: Manual smoke** (terminal):

```bash
npm run resume:start
```

Expected: `# Executive brief` with `## Wayfinder` present; no `# Matt workflow session brief`; CreateGoal block still present.

Capture stdout to `/opt/cursor/artifacts/resume-start-brief.txt` for the PR walkthrough.

- [ ] **Step 4: Commit stamps if required** (`matt-review-pass.json` / local-ci stamp per repo norms) then push.

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|------------------|------|
| Path B single template | 1, 4 |
| Overview / NOW / Factories / App / Hanging | 1, 3 |
| **Wayfinder** section + matt-workflow reuse | 2, 3 |
| GitHub label filter only | 3 |
| Clerk package vs lockfile | 3 |
| No second workflow dump on start | 4 |
| Policy pointer only | 5 |
| Output-asserted tests | 1–4, 6 |
| Honest empty Factories/App/Wayfinder lines | 1 |
| gh hang incomplete warning | 3 |

## Placeholder / consistency scan

- Function names locked: `fillHumanBrief`, `gatherBriefFacts`, `gatherWayfinderFacts`, `gatherGithubHanging`, `gatherClerkHealth`, `classifyStanding`  
- Heading string locked: `## Hanging / waiting on you`  
- `resume:print` stays inventory in this plan (explicit non-switch)

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-25-executive-resume-human-brief.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
