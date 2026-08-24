/**
 * Orchestrator routing — which team member, which skill, which model.
 *
 * The roster is data (`roster.json`); this module is the judgment layer that
 * turns a task sentence into a dispatch: one member, the skills it must read
 * first, and the model tier it runs on. `renderSessionBrief()` is what the
 * SessionStart hook prints, so every session opens with the roster in context.
 *
 * Interface:
 *   loadRoster({ cwd })
 *   memberById(roster, id)
 *   routeTask(task, { roster })
 *   workflowFor(task, { roster })
 *   buildDispatchPrompt({ roster, member, task })
 *   renderRoster({ roster }) / renderSessionBrief({ roster })
 *   validateRoster(roster) / runOrchestratorChecks({ cwd })
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');

export const ROSTER_REL = 'scripts/lib/orchestrator/roster.json';
export const ORCHESTRATOR_SCHEMA = 1;

/** Subagent types the Agent tool can dispatch to. */
export const AGENT_TYPES = ['Explore', 'Plan', 'general-purpose', 'claude'];

/** The hook line that makes the orchestrator part of every session start. */
export const BRIEF_COMMAND = 'node scripts/orchestrator.mjs brief';

export function loadRoster({ cwd = root } = {}) {
  return JSON.parse(readFileSync(join(cwd, ROSTER_REL), 'utf8'));
}

export function memberById(roster, id) {
  return roster.members.find((m) => m.id === id) || null;
}

export function modelIdFor(roster, member) {
  return roster.models[member.model]?.id || member.model;
}

/** Lowercase, punctuation-free, space-padded — so ` ci ` never matches "specific". */
function normalize(text) {
  return ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/** Multi-word triggers are the specific ones, so they outweigh single words. */
function triggerScore(trigger) {
  return trigger.includes(' ') ? 2 : 1;
}

/**
 * A trigger matches whole words only, tolerating the plural/participle a task
 * sentence naturally uses — "the map crashes" must reach the same member as
 * "crash". Substrings never match: ` ci ` cannot fire on "specific".
 */
function triggerPattern(trigger) {
  const words = normalize(trigger).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^| )${words}(?:s|es|ed|ing)?(?: |$)`);
}

function matchTriggers(member, haystack) {
  return member.triggers.filter((t) => triggerPattern(t).test(haystack));
}

/**
 * Best member for a task, with the triggers that earned it. No trigger hit is
 * not an error: questions fall back to the scout, everything else to the
 * implementer — the two members whose failure mode is cheapest.
 */
export function routeTask(task, { roster = loadRoster() } = {}) {
  const haystack = normalize(task);
  const priority = (id) => {
    const index = roster.kindPriority.indexOf(roster.kinds[id]);
    return index < 0 ? roster.kindPriority.length : index;
  };
  const candidates = roster.members
    .map((member) => {
      const matched = matchTriggers(member, haystack);
      return {
        id: member.id,
        member,
        matched,
        score: matched.reduce((sum, t) => sum + triggerScore(t), 0),
      };
    })
    .filter((c) => c.score > 0)
    // Equal scores go to the more committal kind: "search for why the map is
    // crashing" hits scout and bug-hunter alike, and a read-only scout would
    // hand back a file list where a diagnosis was owed.
    .sort((a, b) => b.score - a.score || priority(a.id) - priority(b.id));

  if (candidates.length === 0) {
    const id = /^\s*(who|what|where|when|why|how|which|does|is|are|can)\b/i.test(String(task || '')) ||
      String(task || '').trim().endsWith('?')
      ? 'scout'
      : 'implementer';
    const member = memberById(roster, id);
    return { member, matched: [], score: 0, fallback: true, candidates: [] };
  }

  const best = candidates[0];
  return { member: best.member, matched: best.matched, score: best.score, fallback: false, candidates };
}

/**
 * The chain of members a task runs through. Routing picks the lead; the lead's
 * kind picks the chain, so "fix the flaky venue bake" gets diagnosis before
 * implementation and review before verification.
 */
export function workflowFor(task, { roster = loadRoster() } = {}) {
  const routed = routeTask(task, { roster });
  const kind = roster.kinds[routed.member.id] || 'change';
  const ids = roster.workflow[kind] || [routed.member.id];
  const stages = ids.map((id, index) => {
    const member = memberById(roster, id);
    return {
      phase: index + 1,
      id,
      role: member.role,
      agent: member.agent,
      model: member.model,
      modelId: modelIdFor(roster, member),
      effort: member.effort,
      skills: member.skills,
      lead: id === routed.member.id,
    };
  });
  return { kind, lead: routed.member.id, fallback: routed.fallback, matched: routed.matched, stages };
}

/** The prompt to hand a dispatched subagent — skills first, then the task, then the hand-back. */
export function buildDispatchPrompt({ roster = loadRoster(), member, task }) {
  const lines = [
    `You are the ${member.role} on this repo's agent team. ${member.brief}`,
    '',
    `Task: ${task}`,
    '',
  ];
  if (member.skills.length) {
    lines.push(
      `Read these global skills in full before you start (\`~/.agents/skills/<name>/SKILL.md\`): ${member.skills.join(', ')}.`,
    );
  }
  if (member.reads?.length) {
    lines.push(`Read these repo files first: ${member.reads.join(', ')}.`);
  }
  if (member.command) {
    lines.push(`Run \`${member.command}\` as part of the work.`);
  }
  lines.push('', 'Repo rules that bind you:');
  for (const rule of roster.repoRules) lines.push(`- ${rule}`);
  lines.push('', `Return: ${member.returns}`);
  return lines.join('\n');
}

function pad(value, width) {
  const s = String(value);
  return s + ' '.repeat(Math.max(0, width - s.length));
}

export function renderRoster({ roster = loadRoster() } = {}) {
  const rows = roster.members.map((m) => [
    m.id,
    m.agent,
    modelIdFor(roster, m),
    m.skills.join(', ') || '—',
    m.brief,
  ]);
  const widths = [0, 1, 2, 3].map((i) =>
    Math.max(...rows.map((r) => r[i].length), ['member', 'agent', 'model', 'skills'][i].length),
  );
  const header = `${pad('member', widths[0])}  ${pad('agent', widths[1])}  ${pad('model', widths[2])}  ${pad('skills', widths[3])}  when`;
  const body = rows.map(
    (r) => `${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${pad(r[2], widths[2])}  ${pad(r[3], widths[3])}  ${r[4]}`,
  );
  return [header, ...body].join('\n');
}

/**
 * Printed by the SessionStart hook. Kept to a screen: the roster, the two
 * commands that route work to it, and the rule that makes it non-optional.
 */
export function renderSessionBrief({ roster = loadRoster() } = {}) {
  return [
    '[orchestrator] You are the orchestrator for this repo. Dispatch work to the team below —',
    'do not do multi-step work solo. Match the member, then run it on that member\'s model with',
    'that member\'s skills already read.',
    '',
    renderRoster({ roster }),
    '',
    `Route one task:      node scripts/orchestrator.mjs route "<task>"    → member, model, dispatch prompt`,
    `Plan the chain:      node scripts/orchestrator.mjs plan "<task>"     → phases for the Workflow tool`,
    '',
    'Executive resume:    npm run resume:start      → NOW + open inventory + Matt workflow (session open)',
    '                     npm run resume:check      → drift if NOW ≠ worktrees/PRs',
    'Matt workflow:       npm run workflow:next    → which skill to invoke now (/wayfinder, /to-spec, /implement, …)',
    '                     npm run workflow:check -- --intent implement  → gate skipping steps',
    'Trains H/I:          npm run train:next        → orthogonal display/imagery slices',
    '',
    'Rules: one member per dispatch; every code chain ends with reviewer then verifier;',
    'the lead member does the judgment, the orchestrator does the routing.',
    `Roster: ${ROSTER_REL} — edit that, not this text.`,
  ].join('\n');
}

/** Shape checks that need no filesystem — safe on any roster object. */
export function validateRoster(roster) {
  const problems = [];
  if (roster.schema !== ORCHESTRATOR_SCHEMA) {
    problems.push(`roster schema ${roster.schema} != ${ORCHESTRATOR_SCHEMA}`);
  }
  const seen = new Set();
  for (const member of roster.members) {
    const where = `member ${member.id}`;
    if (seen.has(member.id)) problems.push(`duplicate ${where}`);
    seen.add(member.id);
    if (!roster.models[member.model]) problems.push(`${where}: unknown model tier '${member.model}'`);
    if (!AGENT_TYPES.includes(member.agent)) problems.push(`${where}: unknown agent type '${member.agent}'`);
    if (!member.triggers?.length) problems.push(`${where}: no triggers — nothing would ever route to it`);
    if (!member.returns) problems.push(`${where}: no returns contract`);
    if (!roster.kinds[member.id]) problems.push(`${where}: no workflow kind`);
  }
  for (const [kind, ids] of Object.entries(roster.workflow)) {
    for (const id of ids) {
      if (!seen.has(id)) problems.push(`workflow '${kind}' names unknown member '${id}'`);
    }
  }
  if (!roster.repoRules?.length) problems.push('roster has no repoRules — dispatches would carry no repo constraints');
  for (const kind of new Set(Object.values(roster.kinds))) {
    if (!roster.kindPriority.includes(kind)) {
      problems.push(`kind '${kind}' is missing from kindPriority — its tie-breaks would be arbitrary`);
    }
  }
  for (const [id, kind] of Object.entries(roster.kinds)) {
    if (!seen.has(id)) problems.push(`kinds names unknown member '${id}'`);
    if (!roster.workflow[kind]) problems.push(`member ${id} maps to unknown workflow kind '${kind}'`);
  }
  return problems;
}

/** Does this settings file wire the brief into SessionStart? */
export function briefWiredIn(settingsJson) {
  const hooks = settingsJson?.hooks?.SessionStart || [];
  return hooks.some((entry) =>
    (entry.hooks || []).some((h) => String(h.command || '').includes(BRIEF_COMMAND)),
  );
}

/** Full check against the real repo — shape, referenced files, npm commands, hook wiring. */
export function runOrchestratorChecks({ cwd = root } = {}) {
  const roster = loadRoster({ cwd });
  const problems = validateRoster(roster);

  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  for (const member of roster.members) {
    for (const rel of member.reads || []) {
      if (!existsSync(join(cwd, rel))) {
        problems.push(`member ${member.id}: reads missing file ${rel}`);
      }
    }
    const command = member.command;
    if (!command) continue;
    const npmScript = command.match(/^npm run ([\w:-]+)/);
    if (npmScript && !pkg.scripts?.[npmScript[1]]) {
      problems.push(`member ${member.id}: command references missing npm script '${npmScript[1]}'`);
    }
    const nodeScript = command.match(/^node ([\w./-]+)/);
    if (nodeScript && !existsSync(join(cwd, nodeScript[1]))) {
      problems.push(`member ${member.id}: command references missing script ${nodeScript[1]}`);
    }
  }

  const settingsPath = join(cwd, '.claude/settings.json');
  if (!existsSync(settingsPath)) {
    problems.push('.claude/settings.json missing — the brief cannot run at session start');
  } else if (!briefWiredIn(JSON.parse(readFileSync(settingsPath, 'utf8')))) {
    problems.push(`.claude/settings.json SessionStart does not run \`${BRIEF_COMMAND}\``);
  }

  return problems;
}
