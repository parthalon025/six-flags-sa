#!/usr/bin/env node
/**
 * Executive resume — merge, drift, render, agent patch boundaries.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentPatch,
  applySessionPlatform,
  checkDrift,
  createGoalObjective,
  emptyResume,
  endTurn,
  gatherDraftPrs,
  loadLocal,
  mergeFromRemote,
  parseJsonComment,
  platformChange,
  refreshInventory,
  renderMarkdown,
  saveLocal,
  subscribeTimerInstructions,
  wrapJsonComment,
} from '../../scripts/lib/executive-resume.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'exec-resume-'));
const root = join(scratch, 'repo');
mkdirSync(join(root, '.scratch', 'eff-a', 'issues'), { recursive: true });

writeFileSync(join(root, '.scratch/eff-a/issues/03-task.md'), '**Status:** claimed\n');

const runner = (cmd, args) => {
  if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
    return JSON.stringify([{ number: 99, title: 'Draft', url: 'https://x/99', headRefName: 'cursor/foo', isDraft: true }]);
  }
  if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list') return '[]';
  if (cmd === 'git' && args[0] === 'worktree') {
    return 'worktree /workspace/.claude/worktrees/foo\nbranch refs/heads/worktree-foo\n\n';
  }
  if (cmd === 'node' && args[0]?.includes('train-plan')) return 'No startable slice.';
  throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
};

let resume = emptyResume({ platform: 'cursor-cloud' });
resume.now.task = 'Fix map LOD';
resume.now.branch = 'worktree-other';
resume = refreshInventory(resume, { cwd: root, runner });
assert.equal(resume.inventory.claimedTickets.length, 1);
assert.match(renderMarkdown(resume), /Fix map LOD/);

const drift = checkDrift(resume);
assert.equal(drift.ok, false);
assert.match(drift.warnings.join(' '), /branch/i);

const remote = emptyResume();
remote.now.task = 'From GitHub';
remote.human.parkingLot = ['billing later'];
const merged = mergeFromRemote(resume, remote);
assert.equal(merged.now.task, 'From GitHub');
assert.deepEqual(merged.human.parkingLot, ['billing later']);

const patched = agentPatch(merged, { nextStep: 'Run test', iWasDoing: 'Added case' });
assert.equal(patched.now.nextStep, 'Run test');
assert.equal(patched.lastStop.iWasDoing, 'Added case');

const parsed = parseJsonComment(wrapJsonComment({ now: { task: 'x' }, human: { parkingLot: [] } }));
assert.equal(parsed.now.task, 'x');

saveLocal(patched, root);
const onDisk = readFileSync(join(root, '.scratch/resume.json'), 'utf8');
assert.match(onDisk, /Run test/);
assert.equal(loadLocal(root).now.nextStep, 'Run test');

// Platform change detection
const beforeSwitch = emptyResume({ platform: 'cursor-local' });
beforeSwitch.platform = 'cursor-local';
const { changed, previous, current } = platformChange(beforeSwitch, 'cursor-cloud');
assert.equal(changed, true);
assert.equal(previous, 'cursor-local');
assert.equal(current, 'cursor-cloud');
const afterSwitch = applySessionPlatform(beforeSwitch, 'cursor-cloud');
assert.equal(afterSwitch.platform, 'cursor-cloud');
assert.equal(afterSwitch.previousPlatform, 'cursor-local');

// CreateGoal objective
assert.match(createGoalObjective({ now: { task: 'Ship resume', nextStep: 'Run tests' } }), /Ship resume — next: Run tests/);
assert.match(createGoalObjective({ now: { task: 'Ship resume', nextStep: '' } }), /Ship resume/);

// Draft PRs — all open drafts, not @me only
const drafts = gatherDraftPrs({
  cwd: root,
  runner: (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      return JSON.stringify([
        { number: 1, title: 'Mine', url: 'https://x/1', headRefName: 'cursor/a', isDraft: true },
        { number: 2, title: 'Other', url: 'https://x/2', headRefName: 'cursor/b', isDraft: true },
        { number: 3, title: 'Ready', url: 'https://x/3', headRefName: 'main', isDraft: false },
      ]);
    }
    throw new Error('unexpected');
  },
});
assert.equal(drafts.length, 2);
assert.equal(drafts[0].number, 1);

// endTurn + timer subscription shape
const turned = endTurn({ resume: patched, nextStep: 'Commit', iWasDoing: 'Tests pass', root, runner });
assert.equal(turned.now.nextStep, 'Commit');
assert.equal(turned.lastStop.iWasDoing, 'Tests pass');
const timerFired = endTurn({ resume: turned, markTimer: true, root, runner });
assert.ok(timerFired.timer.lastFiredAt);
const sub = subscribeTimerInstructions();
assert.equal(sub.name, 'executive-resume-12h');
assert.equal(sub.delaySeconds, 43200);

rmSync(scratch, { recursive: true, force: true });
console.log('executive-resume tests ok');
