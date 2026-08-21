#!/usr/bin/env node
/**
 * Orchestrator routing — roster shape, task routing, workflow chains, and the
 * session-start wiring that makes the roster load in every session.
 *
 *   node test/scripts/orchestrator.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEW_MODEL_DEFAULT } from '../../scripts/lib/matt-review.mjs';
import {
  AGENT_TYPES,
  BRIEF_COMMAND,
  briefWiredIn,
  buildDispatchPrompt,
  loadRoster,
  memberById,
  modelIdFor,
  renderSessionBrief,
  routeTask,
  runOrchestratorChecks,
  validateRoster,
  workflowFor,
} from '../../scripts/lib/orchestrator/route.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const roster = loadRoster({ cwd: root });

// validateRoster — the real roster is well formed
assert.deepEqual(validateRoster(roster), [], 'shipped roster has no shape problems');

// validateRoster — and it actually catches drift
{
  const broken = JSON.parse(JSON.stringify(roster));
  broken.members[0].model = 'gpt';
  broken.members[1].triggers = [];
  broken.workflow.change = [...broken.workflow.change, 'ghost'];
  const problems = validateRoster(broken).join('\n');
  assert.match(problems, /unknown model tier 'gpt'/);
  assert.match(problems, /no triggers/);
  assert.match(problems, /unknown member 'ghost'/);
}

// Every member names a dispatchable agent type
for (const member of roster.members) {
  assert.ok(AGENT_TYPES.includes(member.agent), `${member.id} uses a real agent type`);
}

// routeTask — the specific member wins over the generic one
assert.equal(routeTask('fix the flaky venue bake step', { roster }).member.id, 'venue-smith');
assert.equal(routeTask('review the diff on this branch', { roster }).member.id, 'reviewer');
assert.equal(routeTask('where does the party mesh sync live?', { roster }).member.id, 'scout');
assert.equal(routeTask('update AGENTS.md with the new policy', { roster }).member.id, 'scribe');
assert.equal(routeTask('triage the open issues', { roster }).member.id, 'triager');
assert.equal(
  routeTask('the map crashes on zoom out', { roster }).member.id,
  'bug-hunter',
  'a broken-behaviour sentence routes to diagnosis, not implementation',
);

// routeTask — fallbacks, and the reason is reported honestly
{
  const question = routeTask('is the roster loaded yet?', { roster });
  assert.equal(question.member.id, 'scout');
  assert.equal(question.fallback, true, 'no trigger hit is a fallback, not a match');
  const work = routeTask('tidy up the leaderboard copy', { roster });
  assert.equal(work.member.id, 'implementer');
  assert.equal(work.fallback, true);
}

// routeTask — an equal-score tie goes to the more committal kind, not to
// whichever member happens to sit first in the roster
{
  const routed = routeTask('search for why the map is crashing', { roster });
  assert.equal(routed.member.id, 'bug-hunter', 'a tie with the scout resolves to diagnosis');
  assert.ok(
    routed.candidates.some((c) => c.id === 'scout'),
    'the losing candidate is still reported, so the tie is auditable',
  );
  assert.deepEqual(
    workflowFor('search for why the map is crashing', { roster }).stages.map((s) => s.id),
    roster.workflow.bug,
    'the tie-break carries through to the workflow chain',
  );
}

// validateRoster — a kind missing from kindPriority is drift, not a detail
{
  const broken = JSON.parse(JSON.stringify(roster));
  broken.kindPriority = broken.kindPriority.filter((k) => k !== 'bug');
  assert.match(validateRoster(broken).join('\n'), /kindPriority/);
  const ruleless = JSON.parse(JSON.stringify(roster));
  ruleless.repoRules = [];
  assert.match(validateRoster(ruleless).join('\n'), /repoRules/);
}

// routeTask — word-boundary matching: ` ci ` must not match inside a longer word
assert.notEqual(
  routeTask('make the specific decision about pricing', { roster }).member.id,
  'verifier',
  'substring noise does not route work',
);

// routeTask — matched triggers are reported so the routing is auditable
{
  const routed = routeTask('diagnose the failing quest sync test', { roster });
  assert.equal(routed.member.id, 'bug-hunter');
  assert.ok(routed.matched.includes('diagnose'), 'the matched trigger is reported');
  assert.ok(routed.score > 0);
}

// workflowFor — code work ends with review then verification
{
  const plan = workflowFor('implement the credits settings tab', { roster });
  assert.equal(plan.kind, 'change');
  assert.equal(plan.lead, 'implementer');
  const ids = plan.stages.map((s) => s.id);
  assert.deepEqual(ids.slice(-2), ['reviewer', 'verifier'], 'review then verify closes every code chain');
  assert.ok(plan.stages.find((s) => s.lead).id === 'implementer');
  assert.ok(plan.stages.every((s) => s.modelId.startsWith('claude-')), 'every phase names a real model id');
}
{
  const plan = workflowFor('where is the zoom band table?', { roster });
  assert.deepEqual(plan.stages.map((s) => s.id), ['scout'], 'a question is one scout, not a five-phase chain');
}
{
  const plan = workflowFor('the venue tiles export is broken', { roster });
  assert.equal(plan.kind, 'venue');
  assert.ok(plan.stages.map((s) => s.id).includes('venue-smith'));
}

// The reviewer runs on the model the pre-merge standards gate stamps
assert.equal(
  modelIdFor(roster, memberById(roster, 'reviewer')),
  REVIEW_MODEL_DEFAULT,
  'reviewer tier tracks scripts/lib/matt-review.mjs — one source of truth for the review model',
);

// buildDispatchPrompt — skills, repo reads, and the hand-back contract all land
{
  const member = memberById(roster, 'implementer');
  const prompt = buildDispatchPrompt({ roster, member, task: 'add a quest filter' });
  assert.match(prompt, /add a quest filter/, 'the task is in the prompt');
  assert.match(prompt, /tdd/, 'the member skills are named');
  for (const rule of roster.repoRules) {
    assert.ok(prompt.includes(rule), 'every roster repo rule is bound into the dispatch');
  }
  assert.match(prompt, /Return:/, 'the hand-back contract is stated');
}

// renderSessionBrief — every member is visible at session start
{
  const brief = renderSessionBrief({ roster });
  for (const member of roster.members) {
    assert.ok(brief.includes(member.id), `${member.id} appears in the session brief`);
  }
  assert.match(brief, /orchestrator\.mjs route/, 'the brief carries the routing command');
  assert.match(brief, /orchestrator\.mjs plan/, 'the brief carries the planning command');
}

// briefWiredIn — the SessionStart contract, both directions
assert.equal(briefWiredIn({ hooks: { SessionStart: [{ hooks: [{ command: BRIEF_COMMAND }] }] } }), true);
assert.equal(briefWiredIn({ hooks: { SessionStart: [{ hooks: [{ command: 'node scripts/worktree.mjs status' }] }] } }), false);
assert.equal(briefWiredIn({}), false, 'a settings file with no hooks is not wired');

// The repo really does run the brief at session start
{
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(briefWiredIn(settings), true, '.claude/settings.json runs the orchestrator brief on SessionStart');
}

// Full repo check — reads, commands, and hook wiring all resolve
assert.deepEqual(runOrchestratorChecks({ cwd: root }), [], 'roster matches the repo on disk');

console.log('orchestrator.test.mjs: ok');
