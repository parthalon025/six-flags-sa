#!/usr/bin/env node
/**
 * Matt workflow — which skill is next (ask-matt flow as data).
 *
 *   node scripts/matt-workflow.mjs session [--effort <slug>] [--situation <key>]
 *   node scripts/matt-workflow.mjs next   [--effort <slug>]
 *   node scripts/matt-workflow.mjs check  --intent <implement|to-spec|...> [--effort <slug>]
 *   node scripts/matt-workflow.mjs skills
 *   node scripts/matt-workflow.mjs efforts
 *
 * Derives phase from `.scratch/<effort>/` — map, spec, tickets — never from memory.
 * See docs/agents/policies/matt-workflow.md.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO,
  SITUATIONS,
  checkIntent,
  effortPhase,
  listEfforts,
  phaseMeta,
  renderSkillMap,
  sessionBrief,
  skillMeta,
} from './lib/matt-workflow.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];
const effort = argValue('--effort');
const situation = argValue('--situation');
const intent = argValue('--intent');
const json = process.argv.includes('--json');

const USAGE = `Usage:
  node scripts/matt-workflow.mjs session [--effort <slug>] [--situation <key>]
  node scripts/matt-workflow.mjs next [--effort <slug>] [--json]
  node scripts/matt-workflow.mjs check --intent <name> [--effort <slug>]
  node scripts/matt-workflow.mjs skills
  node scripts/matt-workflow.mjs efforts [--json]

Situations: ${Object.keys(SITUATIONS).join(', ')}`;

function runSession() {
  console.log(sessionBrief({ cwd: root, effort, situation }));
  return 0;
}

function runNext() {
  const efforts = listEfforts(root);
  const slug = effort || efforts[0];
  if (!slug) {
    console.log(sessionBrief({ cwd: root, situation: situation || 'unsure' }));
    return 0;
  }
  const state = effortPhase(slug, root);
  const meta = phaseMeta(state.phase);
  const sk = skillMeta(meta.skill);
  if (json) {
    console.log(JSON.stringify({ effort: slug, phase: state.phase, skill: meta.skill, invoke: sk?.invoke, frontier: state.frontier }, null, 2));
    return 0;
  }
  console.log(`effort:  ${slug}`);
  console.log(`phase:   ${state.phase}`);
  console.log(`invoke:  ${sk?.invoke || meta.skill}`);
  console.log(`prompt:  ${meta.prompt}`);
  if (state.frontier) {
    console.log(`ticket:  ${state.frontier.id} ${state.frontier.title} (${state.frontier.status})`);
  }
  if (meta.forbid.length) console.log(`avoid:   ${meta.forbid.map((f) => `/${f}`).join(', ')}`);
  return 0;
}

function runCheck() {
  if (!intent) {
    console.error('check requires --intent <implement|to-spec|to-tickets|wayfinder|...>');
    return 1;
  }
  const result = checkIntent({ cwd: root, effort, intent });
  if (!result.ok) {
    console.error(`workflow:check FAILED\n${result.message}`);
    console.error('\nRun: npm run workflow:next');
    return 1;
  }
  console.log(result.message);
  return 0;
}

function runSkills() {
  console.log(renderSkillMap());
  return 0;
}

function runEfforts() {
  const efforts = listEfforts(root).map((slug) => {
    const state = effortPhase(slug, root);
    const meta = phaseMeta(state.phase);
    return { slug, phase: state.phase, skill: meta.skill, frontier: state.frontier?.id || null };
  });
  if (json) console.log(JSON.stringify(efforts, null, 2));
  else {
    for (const e of efforts) console.log(`${e.slug.padEnd(24)} ${e.phase.padEnd(12)} → ${e.skill}${e.frontier ? `  (#${e.frontier})` : ''}`);
  }
  return 0;
}

let code = 0;
switch (cmd) {
  case 'session':
    code = runSession();
    break;
  case 'next':
    code = runNext();
    break;
  case 'check':
    code = runCheck();
    break;
  case 'skills':
    code = runSkills();
    break;
  case 'efforts':
    code = runEfforts();
    break;
  default:
    console.error(USAGE);
    code = 1;
}
process.exit(code);
