/**
 * Matt workflow — derive the next skill from scratch state, not memory.
 *
 * Maps the ask-matt flow (main, on-ramps, standalones, vocabulary) onto
 * `.scratch/<effort>/` artifacts: map.md, spec.md, issues/*.md.
 *
 * Interface:
 *   SKILLS, FLOWS, listEfforts, parseTicket, effortPhase, frontier, sessionBrief
 *   checkIntent({ cwd, effort, intent })
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { epicNowLine, loadOperatingStack, shouldPrintEpicNow } from './operating-stack.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '../..');
export const SCRATCH = '.scratch';

/** Global skill paths under ~/.agents/skills — not vendored in repo. */
export const SKILL_ROOT = join(process.env.HOME || '', '.agents/skills');

/**
 * Full skill catalog from ask-matt. `flow` groups skills for the session map.
 * `invoke` is the user-facing slash command or npm script.
 */
export const SKILLS = Object.freeze({
  'setup-matt-pocock-skills': {
    flow: 'precondition',
    invoke: '/setup-matt-pocock-skills',
    label: 'Setup Matt skills',
    when: 'First engineering session — configure issue tracker, triage labels, doc layout.',
  },
  'ask-matt': {
    flow: 'router',
    invoke: '/ask-matt',
    label: 'Ask Matt (router)',
    when: 'Unsure which skill or flow fits — routes you; does no work itself.',
  },
  wayfinder: {
    flow: 'on-ramp',
    invoke: '/wayfinder',
    label: 'Wayfinder',
    when: 'Huge, foggy effort — chart decision tickets on the map until the way is clear. Hands off to /to-spec; never straight to /implement.',
  },
  triage: {
    flow: 'on-ramp',
    invoke: '/triage',
    label: 'Triage',
    when: 'Raw incoming bugs/requests you did not create — not /to-tickets output.',
  },
  'diagnosing-bugs': {
    flow: 'on-ramp',
    invoke: '/diagnosing-bugs',
    label: 'Diagnosing bugs',
    when: 'Reproducible bug that resists a first glance — tight red loop first, regression test, then fix.',
  },
  'improve-codebase-architecture': {
    flow: 'health',
    invoke: '/improve-codebase-architecture',
    label: 'Improve codebase architecture',
    when: 'Spare moment — surface deepening opportunities; feed ideas into /grill-with-docs.',
  },
  'grill-with-docs': {
    flow: 'main',
    invoke: '/grill-with-docs',
    label: 'Grill with docs',
    when: 'Sharpen an idea in-repo — updates CONTEXT.md and ADRs. Prefer over /grill-me when a repo exists.',
  },
  'grill-me': {
    flow: 'standalone',
    invoke: '/grill-me',
    label: 'Grill me (stateless)',
    when: 'Sharpen a plan with no working directory — saves nothing locally.',
  },
  grilling: {
    flow: 'primitive',
    invoke: '/grilling',
    label: 'Grilling (primitive)',
    when: 'Interview only — used inside wayfinder, triage, grill-with-docs.',
  },
  research: {
    flow: 'standalone',
    invoke: '/research',
    label: 'Research',
    when: 'Background reading legwork → cited markdown for /grill-with-docs.',
  },
  prototype: {
    flow: 'standalone',
    invoke: '/prototype',
    label: 'Prototype',
    when: 'Runnable answer to a design question — bridged with /handoff from main flow.',
  },
  handoff: {
    flow: 'boundary',
    invoke: '/handoff',
    label: 'Handoff',
    when: 'New harness, directory, colleague, or mid-phase side task — portable markdown.',
  },
  'to-spec': {
    flow: 'main',
    invoke: '/to-spec',
    label: 'To spec',
    when: 'Collapse settled decisions into spec.md — after wayfinder or grill; no interview.',
  },
  'to-tickets': {
    flow: 'main',
    invoke: '/to-tickets',
    label: 'To tickets',
    when: 'Split spec into tracer-bullet tickets with blocking edges — same context as /to-spec.',
  },
  implement: {
    flow: 'main',
    invoke: '/implement',
    label: 'Implement',
    when: 'One ticket per fresh context — drives /tdd, then /code-review before commit.',
  },
  tdd: {
    flow: 'main',
    invoke: '/tdd',
    label: 'TDD',
    when: 'Concrete behaviour test-first — inside /implement or standalone small change.',
  },
  'code-review': {
    flow: 'main',
    invoke: '/code-review',
    label: 'Code review',
    when: 'Pre-merge Standards + Spec axes; stamp matt-review-pass.json on code diffs.',
  },
  'domain-modeling': {
    flow: 'vocabulary',
    invoke: '/domain-modeling',
    label: 'Domain modeling',
    when: 'Words and ADRs — glossary discipline under /grill-with-docs.',
  },
  'codebase-design': {
    flow: 'vocabulary',
    invoke: '/codebase-design',
    label: 'Codebase design',
    when: 'Module, seam, depth — design bench for architecture work.',
  },
  'resolving-merge-conflicts': {
    flow: 'standalone',
    invoke: '/resolving-merge-conflicts',
    label: 'Resolving merge conflicts',
    when: 'Mid-merge/rebase — resolve by intent, never --abort.',
  },
  'to-questionnaire': {
    flow: 'standalone',
    invoke: '/to-questionnaire',
    label: 'To questionnaire',
    when: 'Blocker is someone else — write them a questionnaire.',
  },
  wizard: {
    flow: 'standalone',
    invoke: '/wizard',
    label: 'Wizard',
    when: 'Human-only steps — credentials, dashboards, secrets.',
  },
  'wait-what': {
    flow: 'standalone',
    invoke: '/wait-what',
    label: 'Wait what',
    when: 'Re-pitch the last message in plain English with CONTEXT vocabulary.',
  },
  teach: {
    flow: 'standalone',
    invoke: '/teach',
    label: 'Teach',
    when: 'Multi-session learning workspace.',
  },
  'writing-for-agents': {
    flow: 'standalone',
    invoke: '/writing-for-agents',
    label: 'Writing for agents',
    when: 'Author skills, AGENTS.md, policies — then agent-docs:build.',
  },
  verify: {
    flow: 'main',
    invoke: 'npm run test:pre-merge-vertical',
    label: 'Verify (vertical e2e)',
    when: 'Prove end-to-end before merge — every code chain ends here.',
  },
});

export const FLOWS = Object.freeze({
  precondition: 'Run once before first engineering flow',
  router: 'Start here when unsure',
  'on-ramp': 'Generates work → merges onto main flow',
  main: 'idea → ship',
  health: 'Codebase upkeep',
  vocabulary: 'Runs beneath other skills',
  standalone: 'Reach for directly',
  primitive: 'Interview engine inside other skills',
  boundary: 'Phase transitions',
});

/** Ordered main-flow phases derived from scratch artifacts. */
export const PHASE_ORDER = Object.freeze([
  'route',
  'wayfinder',
  'grill',
  'research',
  'prototype',
  'spec',
  'tickets',
  'implement',
  'review',
  'verify',
  'done',
]);

const PHASE_META = Object.freeze({
  route: {
    skill: 'ask-matt',
    prompt: 'You have no active effort map. Invoke /ask-matt or start /wayfinder for foggy work.',
    forbid: ['implement', 'to-spec'],
  },
  wayfinder: {
    skill: 'wayfinder',
    prompt: 'Fog on the map — resolve open decision tickets. Update map.md. Do NOT /implement or /to-spec until the map clears.',
    forbid: ['implement', 'to-spec', 'to-tickets'],
  },
  grill: {
    skill: 'grill-with-docs',
    prompt: 'Open grilling or unspecified decisions — run /grill-with-docs (or resolve wayfinder child tickets).',
    forbid: ['implement'],
  },
  research: {
    skill: 'research',
    prompt: 'Open research ticket — run /research, then fold citations into the map.',
    forbid: ['implement'],
  },
  prototype: {
    skill: 'prototype',
    prompt: 'Open prototype ticket — /handoff out, /prototype, /handoff back with learnings.',
    forbid: ['implement'],
  },
  spec: {
    skill: 'to-spec',
    prompt: 'Decisions are settled — collapse into .scratch/<effort>/spec.md with /to-spec. Stay in one context window.',
    forbid: ['implement', 'wayfinder'],
  },
  tickets: {
    skill: 'to-tickets',
    prompt: 'Spec exists — split into tracer-bullet tickets with /to-tickets. Do not /implement until tickets are approved.',
    forbid: ['implement', 'wayfinder'],
  },
  implement: {
    skill: 'implement',
    prompt: 'Work the frontier ticket only. Fresh context per ticket. /tdd inside; /code-review before commit.',
    forbid: ['wayfinder', 'to-spec', 'to-tickets'],
  },
  review: {
    skill: 'code-review',
    prompt: 'Run /code-review (Standards + Spec) and stamp matt-review-pass.json before merge.',
    forbid: [],
  },
  verify: {
    skill: 'verify',
    prompt: 'Run npm run test:pre-merge-vertical and assert the output.',
    forbid: [],
  },
  done: {
    skill: 'ask-matt',
    prompt: 'Effort complete — pick next work with /ask-matt or /improve-codebase-architecture.',
    forbid: [],
  },
});

/** Situations with no scratch effort — on-ramps and standalones. */
export const SITUATIONS = Object.freeze({
  unsure: { skill: 'ask-matt', prompt: 'Invoke /ask-matt' },
  fog: { skill: 'wayfinder', prompt: 'Start /wayfinder — create .scratch/<effort>/map.md' },
  bug: { skill: 'diagnosing-bugs', prompt: 'Invoke /diagnosing-bugs — reproduce before theorising' },
  triage: { skill: 'triage', prompt: 'Invoke /triage — raw incoming issues only' },
  conflict: { skill: 'resolving-merge-conflicts', prompt: 'Invoke /resolving-merge-conflicts' },
  health: { skill: 'improve-codebase-architecture', prompt: 'Invoke /improve-codebase-architecture' },
  teach: { skill: 'teach', prompt: 'Invoke /teach' },
  jargon: { skill: 'wait-what', prompt: 'Invoke /wait-what' },
  credentials: { skill: 'wizard', prompt: 'Invoke /wizard for human-only setup' },
});

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** @param {string} root repo root */
export function listEfforts(root = REPO) {
  const scratch = join(root, SCRATCH);
  if (!existsSync(scratch)) return [];
  return readdirSync(scratch)
    .filter((name) => {
      const p = join(scratch, name);
      return statSync(p).isDirectory() && !name.startsWith('.');
    })
    .sort();
}

/**
 * @param {string} file
 * @returns {{ id: string, title: string, status: string, blockedBy: string[], type?: string, path: string }}
 */
export function parseTicket(file) {
  const body = readText(file);
  const base = file.split('/').pop() || '';
  const id = base.replace(/\.md$/, '').split('-')[0] || base;
  const titleMatch = body.match(/^#\s+\d+:\s*(.+)$/m);
  const statusMatch = body.match(/^\*\*Status:\*\*\s*(.+)$/m) || body.match(/^Status:\s*(.+)$/m);
  const blockedMatch = body.match(/^\*\*Blocked by:\*\*\s*(.+)$/m) || body.match(/^Blocked by:\s*(.+)$/m);
  const typeMatch = body.match(/^\*\*Type:\*\*\s*(.+)$/m) || body.match(/^Type:\s*(.+)$/m);
  const blockedRaw = (blockedMatch?.[1] || 'None').trim();
  const blockedBy =
    /^none/i.test(blockedRaw) || blockedRaw === '—'
      ? []
      : blockedRaw.split(/[,;]/).map((s) => s.trim().replace(/^ticket\s+/i, '').split(/\s/)[0]);
  const rawStatus = (statusMatch?.[1] || 'open').trim().toLowerCase();
  const status = rawStatus.split(/[(\[`]/)[0].trim();
  const whatToBuild = /\*\*What to build:\*\*/m.test(body);
  const isWayfinder = Boolean(typeMatch) || /^## Question/m.test(body);
  return {
    id,
    title: titleMatch?.[1]?.trim() || base,
    status,
    blockedBy,
    type: typeMatch?.[1]?.trim().toLowerCase(),
    whatToBuild,
    isWayfinder: isWayfinder && !whatToBuild,
    path: file,
  };
}

/** @param {string} effortDir absolute path to .scratch/<effort> */
export function loadTickets(effortDir) {
  const issues = join(effortDir, 'issues');
  if (!existsSync(issues)) return [];
  return readdirSync(issues)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseTicket(join(issues, f)));
}

function ticketResolved(tickets, blockerId) {
  const t = tickets.find((x) => x.id === blockerId || x.id.startsWith(`${blockerId}-`));
  if (!t) return false;
  return isResolvedStatus(t.status);
}

function isBlocked(ticket, tickets) {
  return ticket.blockedBy.some((b) => !ticketResolved(tickets, b));
}

function isWayfinderTicket(ticket) {
  return ticket.isWayfinder === true;
}

function isResolvedStatus(status) {
  return ['resolved', 'superseded', 'cancelled', 'wontfix'].includes(status);
}

function implTickets(tickets) {
  return tickets.filter((t) => t.whatToBuild && !isWayfinderTicket(t));
}

/** First startable ticket by number. */
export function frontier(tickets) {
  const sorted = [...tickets].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  for (const t of sorted) {
    if (isBlocked(t, tickets)) continue;
    if (['open', 'claimed', 'ready-for-agent', 'ready-for-human'].includes(t.status)) return t;
  }
  return null;
}

/** Frontier among implementation tickets only (no **Type:** field). */
export function implFrontier(tickets) {
  return frontier(implTickets(tickets));
}

function hasOpenWayfinderTickets(tickets) {
  return tickets.some(
    (t) =>
      isWayfinderTicket(t) &&
      ['grilling', 'research', 'prototype', 'task'].includes(t.type) &&
      ['open', 'claimed'].includes(t.status) &&
      !isBlocked(t, tickets),
  );
}

function hasOpenResearchTickets(tickets) {
  return tickets.some((t) => t.type === 'research' && ['open', 'claimed'].includes(t.status) && !isBlocked(t, tickets));
}

function hasOpenPrototypeTickets(tickets) {
  return tickets.some((t) => t.type === 'prototype' && ['open', 'claimed'].includes(t.status) && !isBlocked(t, tickets));
}

function hasImplTickets(tickets) {
  return implTickets(tickets).some((t) =>
    ['ready-for-agent', 'claimed', 'resolved'].includes(t.status),
  );
}

function allImplDone(tickets) {
  const impl = implTickets(tickets).filter((t) =>
    ['ready-for-agent', 'claimed', 'resolved'].includes(t.status),
  );
  return impl.length > 0 && impl.every((t) => isResolvedStatus(t.status));
}

/**
 * @param {string} effort slug under .scratch
 * @param {string} [root]
 */
export function effortPhase(effort, root = REPO) {
  const dir = join(root, SCRATCH, effort);
  if (!existsSync(dir)) return { phase: 'route', effort, dir: null, tickets: [], frontier: null };

  const tickets = loadTickets(dir);
  const hasSpec = existsSync(join(dir, 'spec.md'));
  const hasMap = existsSync(join(dir, 'map.md'));
  const f = implFrontier(tickets);
  const wayfinderF = frontier(tickets.filter(isWayfinderTicket));

  if (!hasMap && !hasSpec && tickets.length === 0) {
    return { phase: 'route', effort, dir, tickets, frontier: f };
  }

  if (hasMap && !hasSpec && hasOpenWayfinderTickets(tickets)) {
    if (hasOpenResearchTickets(tickets)) {
      return { phase: 'research', effort, dir, tickets, frontier: wayfinderF };
    }
    if (hasOpenPrototypeTickets(tickets)) {
      return { phase: 'prototype', effort, dir, tickets, frontier: wayfinderF };
    }
    return { phase: 'wayfinder', effort, dir, tickets, frontier: wayfinderF };
  }

  if (!hasSpec) {
    const mapBody = readText(join(dir, 'map.md'));
    if (/## Not yet specified/i.test(mapBody) && /-\s+\*\*/.test(mapBody.split('## Not yet specified')[1] || '')) {
      return { phase: 'grill', effort, dir, tickets, frontier: f };
    }
    return { phase: 'spec', effort, dir, tickets, frontier: f };
  }

  if (!hasImplTickets(tickets)) {
    return { phase: 'tickets', effort, dir, tickets, frontier: f };
  }

  if (allImplDone(tickets)) {
    return { phase: 'done', effort, dir, tickets, frontier: f };
  }

  if (f && (f.status === 'ready-for-agent' || f.status === 'claimed')) {
    return { phase: 'implement', effort, dir, tickets, frontier: f };
  }

  if (f && f.status === 'ready-for-human') {
    return { phase: 'grill', effort, dir, tickets, frontier: f };
  }

  return { phase: 'tickets', effort, dir, tickets, frontier: f };
}

export function skillMeta(skillId) {
  return SKILLS[skillId] || null;
}

export function phaseMeta(phase) {
  return PHASE_META[phase] || PHASE_META.route;
}

/**
 * @param {{ cwd?: string, effort?: string, situation?: string }} opts
 */
export function sessionBrief({ cwd = REPO, effort, situation } = {}) {
  const efforts = listEfforts(cwd);
  const active = effort || efforts[0] || null;
  const lines = ['# Matt workflow session brief', ''];

  if (situation && SITUATIONS[situation]) {
    const s = SITUATIONS[situation];
    const sk = SKILLS[s.skill];
    lines.push(`## Situation: ${situation}`);
    lines.push(`**Invoke:** ${sk?.invoke || s.skill}`);
    lines.push(s.prompt);
    lines.push('');
  }

  if (efforts.length === 0 && !situation) {
    lines.push('No `.scratch/` efforts yet.');
    lines.push('');
    lines.push('**Start here:**');
    lines.push('- Foggy multi-session build → `/wayfinder` (creates `.scratch/<effort>/map.md`)');
    lines.push('- Unsure → `/ask-matt`');
    lines.push('- Incoming bugs → `/triage`');
    lines.push('- Broken build → `/diagnosing-bugs`');
    lines.push('');
  }

  if (efforts.length === 0 && !effort) {
    const stack = loadOperatingStack();
    lines.push(epicNowLine(stack));
    lines.push(`**Operating stack:** \`${stack.adr}\` · \`scripts/lib/operating-stack.json\``);
    lines.push('');
  }

  for (const slug of effort ? [effort] : efforts) {
    const state = effortPhase(slug, cwd);
    const meta = phaseMeta(state.phase);
    const sk = SKILLS[meta.skill];
    lines.push(`## Effort: ${slug}`);
    lines.push(`**Phase:** ${state.phase}`);
    lines.push(`**Invoke now:** ${sk?.invoke || meta.skill}`);
    lines.push(`**Prompt:** ${meta.prompt}`);
    if (state.frontier) {
      lines.push(`**Frontier ticket:** ${state.frontier.id} — ${state.frontier.title} (${state.frontier.status})`);
      lines.push(`  file: ${state.frontier.path.replace(`${cwd}/`, '')}`);
    }
    const stack = loadOperatingStack();
    if (shouldPrintEpicNow(slug, stack)) {
      lines.push(epicNowLine(stack));
      lines.push(`**Operating stack:** \`${stack.adr}\` · \`scripts/lib/operating-stack.json\``);
    }
    if (meta.forbid.length) {
      lines.push(`**Do NOT yet:** ${meta.forbid.map((f) => `/${f}`).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Main flow (idea → ship)');
  lines.push('`/grill-with-docs` → [`/prototype` via `/handoff`] → `/to-spec` → `/to-tickets` → `/implement` (+`/tdd`, `/code-review`) → `npm run test:pre-merge-vertical`');
  lines.push('');
  lines.push('## On-ramps');
  lines.push('`/wayfinder` · `/triage` · `/diagnosing-bugs` → merge at `/to-spec`');
  lines.push('');
  lines.push('## Full skill map');
  lines.push('`npm run workflow:skills`');
  lines.push('');
  lines.push('Trains H/I (orthogonal): `npm run train:next`');
  lines.push('Route one task: `npm run orchestrator:route -- "<task>"`');
  lines.push('Executive resume: `npm run resume:start` → NOW + inventory (see executive-resume policy)');

  return lines.join('\n');
}

export function checkIntent({ cwd = REPO, effort, intent }) {
  const efforts = listEfforts(cwd);
  const slug = effort || efforts[0];
  if (!slug) {
    if (intent === 'implement') {
      return {
        ok: false,
        message: 'No .scratch effort — run /wayfinder or /grill-with-docs before /implement.',
      };
    }
    return { ok: true, message: 'No active effort.' };
  }

  const state = effortPhase(slug, cwd);
  const meta = phaseMeta(state.phase);
  const forbidden = meta.forbid.includes(intent);
  if (forbidden) {
    const sk = SKILLS[meta.skill];
    return {
      ok: false,
      message:
        `Workflow gate: effort "${slug}" is in phase **${state.phase}**. `
        + `Invoke **${sk?.invoke || meta.skill}** first — not /${intent}. `
        + meta.prompt,
    };
  }
  return { ok: true, message: `Phase ${state.phase} allows /${intent}.` };
}

/**
 * Pre-merge gate when venue-builder changes while workflow phase forbids implement.
 * @param {{ files?: string[], cwd?: string }} opts
 * @returns {string|null}
 */
export function workflowBlockReason({ files, cwd = REPO }) {
  if (!files?.some((f) => f.startsWith('packages/venue-builder/'))) return null;
  const efforts = listEfforts(cwd);
  if (efforts.length === 0) return null;

  /* Which effort is this diff actually working? A diff that edits an effort's own
     `.scratch/<slug>/` files names it, and then that is the effort to judge. Only
     when the diff names none do we fall back to weighing them all. */
  const named = efforts.filter((slug) => files.some((f) => f.startsWith(`.scratch/${slug}/`)));
  const judged = named.length ? named : efforts;

  /* Block when no candidate effort is ready to implement — not when some effort
     is not. Asking "does any effort forbid implement?" meant one unrelated effort
     parked at spec froze every builder change in the repo, including work driven
     by an effort sitting in implement. The gate is here to catch builder code
     written ahead of its own effort's thinking, which is a claim about the effort
     the work belongs to, not about the least advanced effort on disk. */
  const results = judged.map((slug) => checkIntent({ cwd, effort: slug, intent: 'implement' }));
  if (results.some((r) => r.ok)) return null;
  return `${results[0].message}\nRun: npm run workflow:next`;
}

/** Render skill catalog grouped by flow. */
export function renderSkillMap() {
  const lines = ['# Matt skills (from ask-matt)', ''];
  for (const [flowKey, flowLabel] of Object.entries(FLOWS)) {
    lines.push(`## ${flowLabel}`);
    for (const [id, sk] of Object.entries(SKILLS)) {
      if (sk.flow !== flowKey) continue;
      lines.push(`- **${sk.invoke}** — ${sk.label}: ${sk.when}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
