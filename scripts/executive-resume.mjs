#!/usr/bin/env node
/**
 * Executive resume — NOW + inventory across sessions and platforms.
 *
 *   npm run resume:init     Create GitHub executive dashboard issue + durable pointer
 *   npm run resume:link -- --issue <n>   Link committed pointer to existing issue (e.g. 643)
 *   npm run resume:pull     Issue → .scratch/resume.json (+ refresh inventory)
 *   npm run resume:push     Local now/human → issue + refresh
 *   npm run resume:refresh  Regenerate inventory only
 *   npm run resume:print    Human prose to stdout (add --markdown for full inventory)
 *   npm run resume:check    Drift warnings (NOW vs inventory)
 *   npm run resume:start    Session start brief (prose + Matt workflow)
 *   npm run resume:agent-patch -- --next "..." [--doing "..."]
 *   npm run resume:end-turn -- --next "..." [--doing "..."]
 *   npm run resume:timer-fired [--next "..." --doing "..."]
 *   npm run resume:subscribe-timer
 *
 * See docs/agents/policies/executive-resume.md
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentPatch,
  checkDrift,
  endTurn,
  initDashboardIssue,
  linkDashboard,
  loadLocal,
  pullFromIssue,
  pushToIssue,
  refreshInventory,
  renderMarkdown,
  renderProse,
  saveLocal,
  sessionStartBrief,
  subscribeTimerInstructions,
  timerPrompt,
  TIMER_HOURS,
} from './lib/executive-resume.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cmd = process.argv[2];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

/** Terminal output for humans — prose by default; --markdown for the full wall. */
function show(resume) {
  console.log(hasFlag('--markdown') ? renderMarkdown(resume) : renderProse(resume));
}

const USAGE = `Usage:
  node scripts/executive-resume.mjs init
  node scripts/executive-resume.mjs link --issue <number> [--url <url>]
  node scripts/executive-resume.mjs pull | push | refresh | print | check | start
  node scripts/executive-resume.mjs print [--markdown]
  node scripts/executive-resume.mjs agent-patch --next "<step>" [--doing "<text>"]
  node scripts/executive-resume.mjs end-turn --next "<step>" [--doing "<text>"]
  node scripts/executive-resume.mjs timer-fired [--next "<step>" --doing "<text>"]
  node scripts/executive-resume.mjs timer-prompt | subscribe-timer

Timer: subscribe with cursor-subscriptions subscribe_timer — delaySeconds ${12 * 60 * 60}, name executive-resume-12h`;

let code = 0;
try {
  switch (cmd) {
    case 'init': {
      const resume = initDashboardIssue({ root });
      show(resume);
      console.error('\nPin the JSON comment on the issue, then set NOW in GitHub or .scratch/resume.json human fields.');
      break;
    }
    case 'link': {
      const issue = argValue('--issue');
      if (!issue) {
        console.error('resume:link requires --issue <number> (e.g. 643)');
        code = 1;
        break;
      }
      const pointer = linkDashboard({ issueNumber: Number(issue), url: argValue('--url') || null, root });
      console.log(JSON.stringify(pointer, null, 2));
      console.error(`Linked durable pointer → #${pointer.issueNumber}${pointer.url ? ` (${pointer.url})` : ''}`);
      break;
    }
    case 'pull': {
      show(pullFromIssue({ root }));
      break;
    }
    case 'push': {
      show(pushToIssue({ resume: loadLocal(root), root }));
      break;
    }
    case 'refresh': {
      show(saveLocal(refreshInventory(loadLocal(root), { cwd: root }), root));
      break;
    }
    case 'print':
      show(refreshInventory(loadLocal(root), { cwd: root }));
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
      show(resume);
      break;
    }
    case 'timer-prompt':
      console.log(timerPrompt());
      console.error(`\n(${TIMER_HOURS}h timer — use npm run resume:subscribe-timer for args)`);
      break;
    case 'subscribe-timer':
      console.log(JSON.stringify(subscribeTimerInstructions(), null, 2));
      break;
    case 'end-turn': {
      const next = argValue('--next');
      const doing = argValue('--doing');
      if (!next && !doing) {
        console.error('end-turn requires --next and/or --doing');
        code = 1;
        break;
      }
      show(endTurn({ nextStep: next, iWasDoing: doing, root }));
      break;
    }
    case 'timer-fired': {
      const next = argValue('--next');
      const doing = argValue('--doing');
      show(endTurn({ nextStep: next, iWasDoing: doing, markTimer: true, root }));
      console.error('\nAsk the user: "Still on NOW or switch?"');
      break;
    }
    default:
      console.error(USAGE);
      code = 1;
  }
} catch (err) {
  console.error(err.message || err);
  code = 1;
}
process.exit(code);
