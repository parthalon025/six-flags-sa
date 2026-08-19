/**
 * Live stepped gate on the automation deploy pool — throttles harder as
 * production merges approach the ~75-deploy automation budget, and always
 * leaves the user's [vercel build] override available.
 */
import assert from 'node:assert/strict';
import {
  classifyDeployment,
  countTodayDeployments,
  gateAutomationDeploy,
  fetchDeploymentsToday,
  checkLiveAutomationGate,
  startOfUtcDayMs,
  GATE_WARN_RATIO,
  GATE_APPROVAL_RATIO,
} from '../../scripts/lib/vercel-deploy-gate.mjs';
import { AUTOMATION_DEPLOY_BUDGET } from '../../scripts/lib/vercel-budget.mjs';

assert.equal(
  classifyDeployment({ meta: { githubCommitMessage: 'fix: map [vercel build]' } }),
  'user',
);
assert.equal(classifyDeployment({ meta: { githubCommitMessage: 'fix: map' } }), 'automation');
assert.equal(classifyDeployment({}), 'automation', 'missing commit metadata defaults to automation');

const now = new Date('2026-08-19T18:00:00Z');
const cutoff = startOfUtcDayMs(now);
const deployments = [
  { createdAt: cutoff + 1000, meta: { githubCommitMessage: 'feat: a' } }, // automation, today
  { createdAt: cutoff + 2000, meta: { githubCommitMessage: 'feat: b [vercel build]' } }, // user, today
  { createdAt: cutoff - 1000, meta: { githubCommitMessage: 'feat: yesterday' } }, // before cutoff
];
const counts = countTodayDeployments(deployments, { now });
assert.deepEqual(counts, { total: 2, automation: 1, user: 1 });

// Tiers step down as automation usage climbs toward the budget.
assert.equal(gateAutomationDeploy(0).tier, 'ok');
assert.equal(gateAutomationDeploy(Math.floor(AUTOMATION_DEPLOY_BUDGET * GATE_WARN_RATIO) - 1).tier, 'ok');
const warn = gateAutomationDeploy(Math.ceil(AUTOMATION_DEPLOY_BUDGET * GATE_WARN_RATIO));
assert.equal(warn.tier, 'warn');
assert.equal(warn.allow, true);
const approval = gateAutomationDeploy(Math.ceil(AUTOMATION_DEPLOY_BUDGET * GATE_APPROVAL_RATIO));
assert.equal(approval.tier, 'approval-required');
assert.equal(approval.allow, false);
assert.match(approval.reason, /\[vercel build\]/);
const blocked = gateAutomationDeploy(AUTOMATION_DEPLOY_BUDGET);
assert.equal(blocked.tier, 'blocked');
assert.equal(blocked.allow, false);
assert.equal(gateAutomationDeploy(AUTOMATION_DEPLOY_BUDGET + 10).tier, 'blocked');

// Never blocks negative/garbage input into a false "ok".
assert.equal(gateAutomationDeploy(-5).tier, 'ok');

// fetchDeploymentsToday fails open without credentials — no network call made.
{
  const result = await fetchDeploymentsToday({ token: undefined, projectId: undefined });
  assert.equal(result.ok, false);
  assert.deepEqual(result.deployments, []);
}

// fetchDeploymentsToday fails open on a non-OK response.
{
  const result = await fetchDeploymentsToday({
    token: 't',
    projectId: 'p',
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /403/);
}

// fetchDeploymentsToday fails open when the request throws.
{
  const result = await fetchDeploymentsToday({
    token: 't',
    projectId: 'p',
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /network down/);
}

// checkLiveAutomationGate: unavailable check falls open (allow: true).
{
  const result = await checkLiveAutomationGate({ token: undefined, projectId: undefined });
  assert.equal(result.tier, 'unavailable');
  assert.equal(result.allow, true);
  assert.equal(result.counts, null);
}

// checkLiveAutomationGate: end-to-end with a mocked fetch over the budget.
{
  const budgetBusters = Array.from({ length: AUTOMATION_DEPLOY_BUDGET }, (_, i) => ({
    createdAt: cutoff + i,
    meta: { githubCommitMessage: 'feat: merge' },
  }));
  const result = await checkLiveAutomationGate({
    token: 't',
    projectId: 'p',
    now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ deployments: budgetBusters }) }),
  });
  assert.equal(result.tier, 'blocked');
  assert.equal(result.allow, false);
  assert.equal(result.counts.automation, AUTOMATION_DEPLOY_BUDGET);
}

console.log('vercel-deploy-gate: ok');
