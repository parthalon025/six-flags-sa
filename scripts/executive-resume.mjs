#!/usr/bin/env node
/**
 * Executive resume — NOW + inventory across sessions and platforms.
 *
 *   npm run resume:init     Create GitHub executive dashboard issue + pointer
 *   npm run resume:pull     Issue → .scratch/resume.json (+ refresh inventory)
 *   npm run resume:push     Local now/human → issue + refresh
 *   npm run resume:refresh  Regenerate inventory only
 *   npm run resume:print    Exec markdown to stdout
 *   npm run resume:check    Drift warnings (NOW vs inventory)
 *   npm run resume:start    Session start brief (resume + Matt workflow + ritual)
 *   npm run resume:agent-patch -- --next "..." [--doing "..."]
 *
 * See docs/agents/policies/executive-resume.md
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentPatch,
  checkDrift,
  initDashboardIssue,
  loadLocal,
  pullFromIssue,
  pushToIssue,
  refreshInventory,
  renderMarkdown,
  saveLocal,
  sessionStartBrief,
  timerPrompt,
  TIMER_HOURS,
} from './lib/executive-resume.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cmd = process.argv[2];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const USAGE = `Usage:
  node scripts/executive-resume.mjs init
  node scripts/executive-resume.mjs pull | push | refresh | print | check | start
  node scripts/executive-resume.mjs agent-patch --next "<step>" [--doing "<text>"]
  node scripts/executive-resume.mjs timer-prompt

Timer: subscribe with cursor-subscriptions subscribe_timer — delaySeconds ${12 * 60 * 60}, name executive-resume-12h`;

let code = 0;
try {
  switch (cmd) {
    case 'init': {
      const resume = initDashboardIssue({ root });
      console.log(renderMarkdown(resume));
      console.error('\nPin the JSON comment on the issue, then set NOW in GitHub or .scratch/resume.json human fields.');
      break;
    }
    case 'pull': {
      console.log(renderMarkdown(pullFromIssue({ root })));
      break;
    }
    case 'push': {
      console.log(renderMarkdown(pushToIssue({ resume: loadLocal(root), root })));
      break;
    }
    case 'refresh': {
      console.log(renderMarkdown(saveLocal(refreshInventory(loadLocal(root), { cwd: root }), root)));
      break;
    }
    case 'print':
      console.log(renderMarkdown(refreshInventory(loadLocal(root), { cwd: root })));
      break;
    case 'check': {
      const resume = refreshInventory(loadLocal(root), { cwd: root });
      const drift = checkDrift(resume);
      if (drift.ok) console.log('resume:check ok — NOW matches inventory');
      else {
        console.log('resume:check DRIFT');
        for (const w of drift.warnings) console.log(`  - ${w}`);
        code = 1;
      }
      break;
    }
    case 'start':
      console.log(sessionStartBrief({ root }));
      break;
    case 'agent-patch': {
      const next = argValue('--next');
      const doing = argValue('--doing');
      let resume = agentPatch(loadLocal(root), { nextStep: next, iWasDoing: doing });
      resume = saveLocal(refreshInventory(resume, { cwd: root }), root);
      try {
        resume = pushToIssue({ resume, root });
      } catch (err) {
        console.error(`push skipped: ${err.message}`);
      }
      console.log(renderMarkdown(resume));
      break;
    }
    case 'timer-prompt':
      console.log(timerPrompt());
      console.error(`\n(${TIMER_HOURS}h timer — use cursor-subscriptions subscribe_timer with delaySeconds ${12 * 60 * 60})`);
      break;
    default:
      console.error(USAGE);
      code = 1;
  }
} catch (err) {
  console.error(err.message || err);
  code = 1;
}
process.exit(code);
