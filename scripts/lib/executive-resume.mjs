/**
 * Executive resume — one source of truth for NOW + open inventory across sessions.
 *
 * Canonical split (grilled spec):
 *   - now + human.*  → GitHub executive dashboard issue (survives cloud VM death)
 *   - inventory      → regenerated locally from git / gh / .scratch / train plan
 *   - resume.md      → rendered view; never hand-edited
 *
 * Interface:
 *   emptyResume, loadLocal, saveLocal, renderMarkdown, refreshInventory, checkDrift
 *   agentPatch, mergeFromRemote, pullFromIssue, pushToIssue, sessionStartBrief
 *   endTurn, subscribeTimerInstructions, platformChange, createGoalObjective
 *   timerPrompt, TIMER_HOURS
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEfforts, effortPhase } from './matt-workflow.mjs';
import { fillHumanBrief, gatherBriefFacts } from './executive-resume-brief.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '../..');
export const SCRATCH = '.scratch';
export const RESUME_JSON = `${SCRATCH}/resume.json`;
export const RESUME_MD = `${SCRATCH}/resume.md`;
export const POINTER_FILE = `${SCRATCH}/executive-dashboard.json`;
export const JSON_MARKER_START = '<!-- executive-resume-json:v1 -->';
export const JSON_MARKER_END = '<!-- /executive-resume-json -->';
export const SCHEMA = 1;
export const TIMER_HOURS = 12;
export const TIMER_SECONDS = TIMER_HOURS * 60 * 60;
/** Wired into SessionStart and Cloud environment start. */
export const RESUME_START_COMMAND = 'node scripts/executive-resume.mjs start';
export const RESUME_END_TURN_COMMAND = 'node scripts/executive-resume.mjs end-turn';

export function detectPlatform() {
  if (process.env.CURSOR_CLOUD === '1' || process.env.CURSOR_CLOUD === 'true') return 'cursor-cloud';
  if (process.env.CLAUDE_CODE === '1' || process.env.CLAUDE_CODE === 'true') return 'claude-code';
  if (process.env.CURSOR_AGENT === '1') return 'cursor-cloud';
  return 'cursor-local';
}

/** @returns {import('./executive-resume.mjs').ExecutiveResume} */
export function emptyResume({ platform = detectPlatform() } = {}) {
  return {
    schema: SCHEMA,
    updatedAt: new Date().toISOString(),
    platform,
    previousPlatform: null,
    now: {
      task: '',
      ticket: null,
      doneWhen: [],
      nextStep: '',
      inScope: [],
      worktree: null,
      branch: null,
      draftPr: null,
    },
    human: {
      parkingLot: [],
      blockedOnMe: [],
      notes: '',
      overview: '',
    },
    lastStop: {
      iWasDoing: '',
      at: null,
    },
    inventory: {
      draftPrs: [],
      worktrees: [],
      claimedTickets: [],
      handoffIssues: [],
      trainNext: null,
      workflowEfforts: [],
      parkingLot: [],
      blockedOnMe: [],
    },
    timer: {
      everyHours: TIMER_HOURS,
      lastFiredAt: null,
    },
  };
}

export function resumePaths(root = REPO) {
  return {
    json: join(root, RESUME_JSON),
    md: join(root, RESUME_MD),
    pointer: join(root, POINTER_FILE),
  };
}

function ensureScratch(root) {
  mkdirSync(join(root, SCRATCH), { recursive: true });
}

/** @param {string} root */
export function loadLocal(root = REPO) {
  const { json } = resumePaths(root);
  if (!existsSync(json)) return emptyResume();
  try {
    return { ...emptyResume(), ...JSON.parse(readFileSync(json, 'utf8')), schema: SCHEMA };
  } catch {
    return emptyResume();
  }
}

/** @param {object} resume @param {string} root */
export function saveLocal(resume, root = REPO) {
  ensureScratch(root);
  const next = { ...resume, schema: SCHEMA, updatedAt: new Date().toISOString() };
  writeFileSync(join(root, RESUME_JSON), `${JSON.stringify(next, null, 2)}\n`);
  writeFileSync(join(root, RESUME_MD), renderMarkdown(next));
  return next;
}

/** Remote wins for now + human; local agent fields preserved when merging. */
export function mergeFromRemote(local, remote) {
  const base = emptyResume({ platform: local.platform || remote.platform });
  return {
    ...base,
    ...local,
    ...remote,
    now: { ...base.now, ...remote.now, nextStep: local.now?.nextStep || remote.now?.nextStep || '' },
    human: { ...base.human, ...remote.human },
    lastStop: { ...base.lastStop, ...local.lastStop },
    timer: { ...base.timer, ...local.timer },
    platform: local.platform || remote.platform,
  };
}

/** Agent may update nextStep + lastStop only. */
export function agentPatch(resume, { nextStep, iWasDoing } = {}) {
  const next = { ...resume };
  if (nextStep !== undefined) next.now = { ...next.now, nextStep };
  if (iWasDoing !== undefined) {
    next.lastStop = { iWasDoing, at: new Date().toISOString() };
  }
  return next;
}

export function wrapJsonComment(json) {
  return `${JSON_MARKER_START}\n${JSON.stringify(json, null, 2)}\n${JSON_MARKER_END}`;
}

export function parseJsonComment(body) {
  const text = String(body || '');
  const start = text.indexOf(JSON_MARKER_START);
  const end = text.indexOf(JSON_MARKER_END);
  if (start < 0 || end < 0 || end <= start) return null;
  const slice = text.slice(start + JSON_MARKER_START.length, end).trim();
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

export function loadPointer(root = REPO) {
  const { pointer } = resumePaths(root);
  if (!existsSync(pointer)) return null;
  try {
    return JSON.parse(readFileSync(pointer, 'utf8'));
  } catch {
    return null;
  }
}

export function savePointer(pointer, root = REPO) {
  ensureScratch(root);
  writeFileSync(join(root, POINTER_FILE), `${JSON.stringify(pointer, null, 2)}\n`);
}

function runGh(args, { cwd = REPO, runner = execFileSync } = {}) {
  try {
    return runner('gh', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const msg = err.stderr?.toString?.() || err.message || 'gh failed';
    throw new Error(msg.trim());
  }
}

function runGit(args, { cwd = REPO, runner = execFileSync } = {}) {
  try {
    return runner('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

export function gatherDraftPrs({ cwd = REPO, runner = execFileSync } = {}) {
  try {
    const out = runGh(
      ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,url,headRefName,isDraft'],
      { cwd, runner },
    );
    const rows = JSON.parse(out || '[]');
    return rows.filter((r) => r.isDraft).map((r) => ({
      number: r.number,
      title: r.title,
      url: r.url,
      branch: r.headRefName,
    }));
  } catch {
    return [];
  }
}

export function gatherHandoffIssues({ cwd = REPO, runner = execFileSync } = {}) {
  try {
    const out = runGh(
      ['issue', 'list', '--label', 'agent-handoff', '--state', 'open', '--limit', '20', '--json', 'number,title,url'],
      { cwd, runner },
    );
    return JSON.parse(out || '[]');
  } catch {
    return [];
  }
}

export function gatherWorktrees({ cwd = REPO, runner = execFileSync } = {}) {
  const rows = [];
  try {
    const out = runGit(['worktree', 'list', '--porcelain'], { cwd, runner });
    const blocks = out.split('\n\n').filter(Boolean);
    for (const block of blocks) {
      const lines = block.split('\n');
      const pathLine = lines.find((l) => l.startsWith('worktree '));
      const branchLine = lines.find((l) => l.startsWith('branch '));
      if (!pathLine) continue;
      const path = pathLine.slice('worktree '.length);
      const branch = branchLine ? branchLine.slice('branch refs/heads/'.length) : null;
      if (path.includes('/.claude/worktrees/')) {
        rows.push({ path, branch, slug: path.split('/').pop() });
      }
    }
  } catch {
    /* no git */
  }
  return rows;
}

export function gatherClaimedTickets(root = REPO) {
  const rows = [];
  for (const slug of listEfforts(root)) {
    const dir = join(root, SCRATCH, slug, 'issues');
    if (!existsSync(dir)) continue;
    for (const name of readDirSafe(dir)) {
      if (!name.endsWith('.md')) continue;
      const body = readFileSync(join(dir, name), 'utf8');
      const status = body.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1]?.trim() || '';
      if (status === 'claimed') {
        rows.push({ effort: slug, file: `${SCRATCH}/${slug}/issues/${name}`, status });
      }
    }
  }
  return rows;
}

function readDirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function gatherWorkflowEfforts(root = REPO) {
  return listEfforts(root).map((slug) => {
    const state = effortPhase(slug, root);
    return {
      slug,
      phase: state.phase,
      frontier: state.frontier ? { id: state.frontier.id, title: state.frontier.title } : null,
    };
  });
}

export function gatherTrainNext({ cwd = REPO, runner = execFileSync } = {}) {
  try {
    return runner('node', ['scripts/train-plan.mjs', 'next'], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/** Regenerate inventory; mirror human parking/blocked into inventory for exec view. */
export function refreshInventory(resume, { cwd = REPO, runner = execFileSync } = {}) {
  const inventory = {
    draftPrs: gatherDraftPrs({ cwd, runner }),
    worktrees: gatherWorktrees({ cwd, runner }),
    claimedTickets: gatherClaimedTickets(cwd),
    handoffIssues: gatherHandoffIssues({ cwd, runner }),
    trainNext: gatherTrainNext({ cwd, runner }),
    workflowEfforts: gatherWorkflowEfforts(cwd),
    parkingLot: [...(resume.human?.parkingLot || [])],
    blockedOnMe: [...(resume.human?.blockedOnMe || [])],
  };
  return { ...resume, inventory };
}

/** @returns {{ ok: boolean, warnings: string[] }} */
export function checkDrift(resume) {
  const warnings = [];
  const { now, inventory } = resume;
  if (now.branch) {
    const match = inventory.worktrees.some((w) => w.branch === now.branch);
    if (!match && inventory.worktrees.length) warnings.push(`NOW branch "${now.branch}" not in open worktrees`);
  }
  if (now.worktree) {
    const match = inventory.worktrees.some((w) => w.slug === now.worktree);
    if (!match && inventory.worktrees.length) warnings.push(`NOW worktree "${now.worktree}" not in inventory`);
  }
  if (now.draftPr) {
    const prNum = String(now.draftPr).match(/\/pull\/(\d+)/)?.[1];
    const match = inventory.draftPrs.some(
      (p) => p.url === now.draftPr || String(p.number) === String(now.draftPr) || (prNum && String(p.number) === prNum),
    );
    if (!match && inventory.draftPrs.length) warnings.push(`NOW draft PR not in open draft list`);
  }
  return { ok: warnings.length === 0, warnings };
}

/** Detect platform switch since last session (grilled: refresh inventory on platform change). */
export function platformChange(resume, platform = detectPlatform()) {
  const previous = resume.platform && resume.platform !== 'unknown' ? resume.platform : resume.previousPlatform;
  const changed = Boolean(previous && platform && previous !== platform);
  return { changed, previous, current: platform };
}

export function applySessionPlatform(resume, platform = detectPlatform()) {
  const { changed, previous, current } = platformChange(resume, platform);
  return {
    ...resume,
    previousPlatform: changed ? previous : resume.previousPlatform,
    platform: current,
  };
}

/** CreateGoal objective string from NOW (grilled session ritual step 3). */
export function createGoalObjective(resume) {
  const { task, nextStep } = resume.now || {};
  if (!task?.trim()) return 'Set executive resume NOW task before coding.';
  return nextStep?.trim() ? `${task} — next: ${nextStep}` : task;
}

export function markTimerFired(resume) {
  return {
    ...resume,
    timer: { ...resume.timer, everyHours: TIMER_HOURS, lastFiredAt: new Date().toISOString() },
  };
}

export function renderMarkdown(resume) {
  const lines = [
    '# Executive resume — Parkbound',
    '',
    `_Updated: ${resume.updatedAt || '—'} · Platform: ${resume.platform || '—'}_`,
    '',
    '## NOW (one task only)',
    '',
  ];
  const { now, human, lastStop, inventory } = resume;
  lines.push(`**Task:** ${now.task || '_(unset — set before coding)_'}`);
  if (now.ticket) lines.push(`**Ticket:** ${now.ticket}`);
  lines.push(`**Next step:** ${now.nextStep || '_(unset)_'}`);
  if (now.worktree) lines.push(`**Worktree:** ${now.worktree}`);
  if (now.branch) lines.push(`**Branch:** ${now.branch}`);
  if (now.draftPr) lines.push(`**Draft PR:** ${now.draftPr}`);
  lines.push('');
  lines.push('**Done when:**');
  for (const item of now.doneWhen?.length ? now.doneWhen : ['_(none)_']) lines.push(`- [ ] ${item}`);
  lines.push('');
  lines.push('**In scope:**');
  for (const p of now.inScope?.length ? now.inScope : ['_(none)_']) lines.push(`- ${p}`);
  lines.push('');
  lines.push('## Last stop');
  lines.push(lastStop.iWasDoing || '_(empty)_');
  if (lastStop.at) lines.push(`_at ${lastStop.at}_`);
  lines.push('');
  lines.push('## Open inventory (regenerated — do not hand-edit)');
  lines.push('');
  lines.push('### Draft PRs');
  if (!inventory.draftPrs?.length) lines.push('- _(none)_');
  else for (const p of inventory.draftPrs) lines.push(`- #${p.number} \`${p.branch}\` — ${p.title}`);
  lines.push('');
  lines.push('### Worktrees');
  if (!inventory.worktrees?.length) lines.push('- _(none)_');
  else for (const w of inventory.worktrees) lines.push(`- \`${w.slug}\` → ${w.branch}`);
  lines.push('');
  lines.push('### Claimed tickets (.scratch)');
  if (!inventory.claimedTickets?.length) lines.push('- _(none)_');
  else for (const t of inventory.claimedTickets) lines.push(`- ${t.effort}: ${t.file}`);
  lines.push('');
  lines.push('### Agent-handoff queue');
  if (!inventory.handoffIssues?.length) lines.push('- _(none)_');
  else for (const i of inventory.handoffIssues) lines.push(`- #${i.number} — ${i.title}`);
  lines.push('');
  lines.push('### Matt workflow efforts');
  if (!inventory.workflowEfforts?.length) lines.push('- _(none)_');
  else {
    for (const e of inventory.workflowEfforts) {
      const fr = e.frontier ? ` · frontier #${e.frontier.id}` : '';
      lines.push(`- **${e.slug}** — phase \`${e.phase}\`${fr}`);
    }
  }
  lines.push('');
  lines.push('### Train frontier');
  lines.push('```');
  lines.push(inventory.trainNext || '(npm run train:next unavailable)');
  lines.push('```');
  lines.push('');
  lines.push('## Parking lot (human-only)');
  if (!human.parkingLot?.length) lines.push('- _(empty)_');
  else for (const x of human.parkingLot) lines.push(`- ${x}`);
  lines.push('');
  lines.push('## Blocked on me (human-only)');
  if (!human.blockedOnMe?.length) lines.push('- _(empty)_');
  else for (const x of human.blockedOnMe) lines.push(`- ${x}`);
  if (human.notes) {
    lines.push('');
    lines.push('## Notes');
    lines.push(human.notes);
  }
  lines.push('');
  lines.push('---');
  lines.push('Commands: `npm run resume:refresh` · `npm run resume:pull` · `npm run resume:push` · `npm run workflow:next`');
  return `${lines.join('\n')}\n`;
}

export function extractRemoteResume(payload) {
  if (!payload) return null;
  if (payload.now && payload.human) return payload;
  return parseJsonComment(payload.body || payload);
}

export function pullFromIssue({ root = REPO, runner = execFileSync, pointer: ptrIn } = {}) {
  const pointer = ptrIn || loadPointer(root);
  if (!pointer?.issueNumber) {
    throw new Error(`No executive dashboard issue — run: npm run resume:init`);
  }
  let remote = null;
  if (pointer.jsonCommentId) {
    try {
      const out = runGh(['api', `repos/{owner}/{repo}/issues/comments/${pointer.jsonCommentId}`], { cwd: root, runner });
      remote = extractRemoteResume(JSON.parse(out));
    } catch {
      /* fall through */
    }
  }
  if (!remote) {
    try {
      const issue = runGh(['issue', 'view', String(pointer.issueNumber), '--json', 'body,comments'], { cwd: root, runner });
      const parsed = JSON.parse(issue);
      remote = parseJsonComment(parsed.body);
      if (!remote && parsed.comments) {
        for (let i = parsed.comments.length - 1; i >= 0; i--) {
          remote = parseJsonComment(parsed.comments[i].body);
          if (remote) {
            pointer.jsonCommentId = parsed.comments[i].id;
            savePointer(pointer, root);
            break;
          }
        }
      }
    } catch {
      /* fall through */
    }
  }
  if (!remote) {
    try {
      const comments = runGh(
        ['issue', 'view', String(pointer.issueNumber), '--comments', '--json', 'comments'],
        { cwd: root, runner },
      );
      const { comments: list } = JSON.parse(comments);
      for (let i = list.length - 1; i >= 0; i--) {
        remote = parseJsonComment(list[i].body);
        if (remote) {
          pointer.jsonCommentId = list[i].id;
          savePointer(pointer, root);
          break;
        }
      }
    } catch {
      /* no remote */
    }
  }
  const local = loadLocal(root);
  const merged = remote ? mergeFromRemote(local, remote) : local;
  return saveLocal(refreshInventory(merged, { cwd: root, runner }), root);
}

export function pushToIssue({ resume, root = REPO, runner = execFileSync, pointer: ptrIn } = {}) {
  const pointer = ptrIn || loadPointer(root);
  if (!pointer?.issueNumber) throw new Error('No executive dashboard issue — run: npm run resume:init');

  const bodyMd = renderMarkdown(refreshInventory(resume, { cwd: root, runner }));
  const payload = {
    schema: resume.schema,
    updatedAt: new Date().toISOString(),
    platform: resume.platform,
    now: resume.now,
    human: resume.human,
    lastStop: resume.lastStop,
    timer: resume.timer,
  };
  const commentBody = wrapJsonComment(payload);

  runGh(['issue', 'edit', String(pointer.issueNumber), '--body', bodyMd.slice(0, 65000)], { cwd: root, runner });

  if (pointer.jsonCommentId) {
    try {
      runGh(
        ['api', '-X', 'PATCH', `repos/{owner}/{repo}/issues/comments/${pointer.jsonCommentId}`, '-f', `body=${commentBody}`],
        { cwd: root, runner },
      );
    } catch {
      pointer.jsonCommentId = null;
    }
  }
  if (!pointer.jsonCommentId) {
    const out = runGh(['issue', 'comment', String(pointer.issueNumber), '--body', commentBody], { cwd: root, runner });
    try {
      const parsed = JSON.parse(out);
      pointer.jsonCommentId = parsed.id;
    } catch {
      /* gh issue comment may print url only */
    }
  }
  savePointer(pointer, root);
  return saveLocal(refreshInventory(resume, { cwd: root, runner }), root);
}

export function initDashboardIssue({ root = REPO, runner = execFileSync } = {}) {
  const body = [
    '# Executive dashboard',
    '',
    'Pinned JSON comment holds **NOW** + **human** fields (parking lot, blocked on me).',
    'Local `.scratch/resume.json` is the agent API; inventory regenerates on refresh.',
    '',
    '**Pin the latest comment** that starts with `<!-- executive-resume-json:v1 -->`.',
    '',
    renderMarkdown(emptyResume()),
  ].join('\n');
  const url = runGh(
    ['issue', 'create', '--title', 'Executive dashboard — resume NOW + open inventory', '--body', body],
    { cwd: root, runner },
  );
  const num = url.match(/\/issues\/(\d+)/)?.[1];
  if (!num) throw new Error(`Could not parse issue number from: ${url}`);
  const pointer = { issueNumber: Number(num), jsonCommentId: null, url };
  savePointer(pointer, root);
  const resume = saveLocal(emptyResume(), root);
  return pushToIssue({ resume, root, runner, pointer });
}

export function sessionStartBrief({ root = REPO, runner = execFileSync, situation } = {}) {
  let resume = loadLocal(root);
  const platform = detectPlatform();
  try {
    resume = pullFromIssue({ root, runner });
  } catch {
    /* local-only until issue pinned */
  }
  const { changed, previous, current } = platformChange(resume, platform);
  resume = applySessionPlatform(resume, current);
  resume = saveLocal(refreshInventory(resume, { cwd: root, runner }), root);
  const drift = checkDrift(resume);
  const goal = createGoalObjective(resume);
  const brief = fillHumanBrief(gatherBriefFacts({ resume, root, runner }));
  const lines = [
    brief,
    '---',
    '',
    '## Session start ritual',
    '1. **Platform** — executive brief above was regenerated from NOW, inventory, and wayfinder facts.',
  ];
  if (changed) {
    lines.push(`2. ⚠️ **Platform changed:** \`${previous}\` → \`${current}\` — confirm NOW or say **switch**.`);
  } else {
    lines.push('2. Confirm NOW or say **switch**.');
  }
  lines.push(
    '3. Run `npm run workflow:check -- --intent implement` before coding.',
    '4. **CreateGoal** (required):',
    '```',
    goal,
    '```',
    '5. Do not edit human.parkingLot or human.blockedOnMe.',
    '6. **End of every turn** with code changes: `npm run resume:end-turn -- --next "..." --doing "..."`',
    'Matt skill gate: `npm run workflow:next` (not duplicated here).',
  );
  if (drift.warnings.length) {
    lines.push('', '⚠️ **Drift warnings:**', ...drift.warnings.map((w) => `- ${w}`), '', 'Still on NOW? Say yes or switch.');
  }
  void situation;
  return lines.join('\n');
}

export function timerPrompt() {
  return [
    'Executive resume 12h timer fired.',
    'Run: npm run resume:timer-fired',
    'Then ask the user: "Still on NOW or switch?"',
    'Update lastStop + nextStep only; never edit human.parkingLot or human.blockedOnMe without user approval.',
    'Run npm run workflow:next and surface the Matt workflow gate if phase forbids implement.',
  ].join(' ');
}

/** Instructions printed by resume:subscribe-timer (grilled: Cursor timer, 12h). */
export function subscribeTimerInstructions() {
  return {
    name: 'executive-resume-12h',
    delaySeconds: TIMER_SECONDS,
    prompt: timerPrompt(),
    note: 'Subscribe via cursor-subscriptions subscribe_timer at session open; re-subscribe each new cloud session.',
  };
}

/** End-of-turn + timer-fired: refresh inventory, optional agent patch, mark timer. */
export function endTurn({ resume, nextStep, iWasDoing, markTimer = false, root = REPO, runner = execFileSync } = {}) {
  let next = resume || loadLocal(root);
  if (nextStep !== undefined || iWasDoing !== undefined) {
    next = agentPatch(next, { nextStep, iWasDoing });
  }
  if (markTimer) next = markTimerFired(next);
  next = saveLocal(refreshInventory(next, { cwd: root, runner }), root);
  try {
    return pushToIssue({ resume: next, root, runner });
  } catch {
    return next;
  }
}
