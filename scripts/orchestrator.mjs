#!/usr/bin/env node
/**
 * Orchestrator CLI — thin over scripts/lib/orchestrator/route.mjs.
 *
 *   node scripts/orchestrator.mjs brief                # session-start roster (SessionStart hook)
 *   node scripts/orchestrator.mjs list [--json]        # the team
 *   node scripts/orchestrator.mjs route "<task>"       # member + model + dispatch prompt
 *   node scripts/orchestrator.mjs plan "<task>"        # the phase chain for the Workflow tool
 *   node scripts/orchestrator.mjs check                # roster drift vs the repo (exit 1 on problems)
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDispatchPrompt,
  loadRoster,
  modelIdFor,
  renderRoster,
  renderSessionBrief,
  routeTask,
  runOrchestratorChecks,
  workflowFor,
} from './lib/orchestrator/route.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function runBrief({ cwd = root } = {}) {
  console.log(renderSessionBrief({ roster: loadRoster({ cwd }) }));
  return 0;
}

export function runList({ cwd = root, json = false } = {}) {
  const roster = loadRoster({ cwd });
  if (json) console.log(JSON.stringify(roster, null, 2));
  else console.log(renderRoster({ roster }));
  return 0;
}

export function runRoute({ cwd = root, task, json = false } = {}) {
  if (!task) {
    console.error('Usage: orchestrator.mjs route "<task>"');
    return 1;
  }
  const roster = loadRoster({ cwd });
  const routed = routeTask(task, { roster });
  const member = routed.member;
  if (json) {
    console.log(
      JSON.stringify(
        {
          member: member.id,
          agent: member.agent,
          model: modelIdFor(roster, member),
          effort: member.effort,
          skills: member.skills,
          matched: routed.matched,
          fallback: routed.fallback,
          prompt: buildDispatchPrompt({ roster, member, task }),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const why = routed.fallback ? 'no trigger matched — default lead' : `matched: ${routed.matched.join(', ')}`;
  console.log(`member: ${member.id} (${member.role})`);
  console.log(`agent:  ${member.agent}   model: ${modelIdFor(roster, member)}   effort: ${member.effort}`);
  console.log(`skills: ${member.skills.join(', ') || '—'}`);
  console.log(`why:    ${why}`);
  console.log('');
  console.log('--- dispatch prompt ---');
  console.log(buildDispatchPrompt({ roster, member, task }));
  return 0;
}

export function runPlan({ cwd = root, task, json = false } = {}) {
  if (!task) {
    console.error('Usage: orchestrator.mjs plan "<task>"');
    return 1;
  }
  const plan = workflowFor(task, { roster: loadRoster({ cwd }) });
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  console.log(`kind: ${plan.kind}   lead: ${plan.lead}${plan.fallback ? ' (fallback)' : ''}`);
  for (const stage of plan.stages) {
    const mark = stage.lead ? '*' : ' ';
    console.log(
      `${mark} ${stage.phase}. ${stage.id} — agent ${stage.agent}, model ${stage.modelId}, effort ${stage.effort}${
        stage.skills.length ? `, skills ${stage.skills.join('/')}` : ''
      }`,
    );
  }
  return 0;
}

export function runCheck({ cwd = root } = {}) {
  const problems = runOrchestratorChecks({ cwd });
  if (problems.length) {
    for (const p of problems) console.error(`orchestrator: ${p}`);
    return 1;
  }
  console.log('orchestrator: roster ok');
  return 0;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const json = argv.includes('--json');
  const task = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ');
  let code = 1;
  try {
    if (cmd === 'brief') code = runBrief();
    else if (cmd === 'list') code = runList({ json });
    else if (cmd === 'route') code = runRoute({ task, json });
    else if (cmd === 'plan') code = runPlan({ task, json });
    else if (cmd === 'check') code = runCheck();
    else console.error('Usage: orchestrator.mjs <brief|list|route|plan|check> [task] [--json]');
  } catch (err) {
    // The brief runs from a SessionStart hook: a broken roster must not cost
    // the session its other hooks.
    console.error(`orchestrator: ${err.message}`);
    code = cmd === 'brief' ? 0 : 1;
  }
  process.exit(code);
}
