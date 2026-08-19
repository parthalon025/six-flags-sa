/**
 * Live stepped gate for the automation deploy pool (see vercel-budget.mjs).
 *
 * The categorical split in vercel-ignore.mjs already walls the 25-deploy user
 * reserve off from automation by construction (previews never build without
 * [vercel build] / VERCEL_USER_BUILD=1). This module adds a second, live
 * check on top of that: as production merges use up the ~75-deploy
 * automation pool, throttle harder before the account gets anywhere near the
 * shared 100/day cap, so a burst of merges can never crowd out the user's
 * reserve even if the categorical split ever has a gap.
 *
 * Vercel's Ignored Build Step runs after the deployment record already
 * exists, so "deployments today" (any state) is the right denominator — a
 * skipped build still occupies one of the day's 100 deployment slots.
 */
import { AUTOMATION_DEPLOY_BUDGET, USER_DEPLOY_RESERVE, commitSubjectWantsBuild } from './vercel-budget.mjs';

/** Below this fraction of the automation budget, proceed silently. */
export const GATE_WARN_RATIO = 0.6;
/** At/above this fraction, require explicit user approval ([vercel build]) to proceed. */
export const GATE_APPROVAL_RATIO = 0.9;

/** 'user' if the deployment's commit carried the user-directed marker, else 'automation'. */
export function classifyDeployment(deployment) {
  const subject = deployment?.meta?.githubCommitMessage || '';
  return commitSubjectWantsBuild(subject) ? 'user' : 'automation';
}

export function startOfUtcDayMs(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * @param {Array<object>} deployments - raw Vercel API deployment records
 * @returns {{ total: number, automation: number, user: number }}
 */
export function countTodayDeployments(deployments, { now = new Date() } = {}) {
  const cutoff = startOfUtcDayMs(now);
  const today = (deployments || []).filter((d) => (d.createdAt ?? d.created ?? 0) >= cutoff);
  let automation = 0;
  let user = 0;
  for (const d of today) {
    if (classifyDeployment(d) === 'user') user += 1;
    else automation += 1;
  }
  return { total: today.length, automation, user };
}

/**
 * Stepped gate over today's automation-pool usage.
 * @returns {{ tier: 'ok'|'warn'|'approval-required'|'blocked', allow: boolean, reason: string }}
 */
export function gateAutomationDeploy(automationUsedToday, { budget = AUTOMATION_DEPLOY_BUDGET } = {}) {
  const used = Math.max(0, automationUsedToday);
  const ratio = budget > 0 ? used / budget : 1;

  if (used >= budget) {
    return {
      tier: 'blocked',
      allow: false,
      reason: `automation deploy budget exhausted (${used}/${budget} today) — protecting the ${USER_DEPLOY_RESERVE}-deploy user reserve; add [vercel build] to deploy anyway`,
    };
  }
  if (ratio >= GATE_APPROVAL_RATIO) {
    return {
      tier: 'approval-required',
      allow: false,
      reason: `automation deploy budget at ${used}/${budget} (${Math.round(ratio * 100)}%) — this close to the cap needs explicit approval; add [vercel build] to the commit to proceed`,
    };
  }
  if (ratio >= GATE_WARN_RATIO) {
    return {
      tier: 'warn',
      allow: true,
      reason: `automation deploy budget at ${used}/${budget} (${Math.round(ratio * 100)}%) — approaching the cap, proceeding`,
    };
  }
  return {
    tier: 'ok',
    allow: true,
    reason: `automation deploy budget at ${used}/${budget} — proceeding`,
  };
}

/**
 * Fetch today's deployments for the project from the Vercel API.
 * Fails open (ok: false) with no network error thrown — callers should treat
 * that as "live gate unavailable, fall back to the categorical decision."
 */
export async function fetchDeploymentsToday({
  token = process.env.VERCEL_TOKEN,
  projectId = process.env.VERCEL_PROJECT_ID,
  teamId = process.env.VERCEL_TEAM_ID,
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  if (!token || !projectId) {
    return { ok: false, reason: 'VERCEL_TOKEN or VERCEL_PROJECT_ID not set — skipping live budget check', deployments: [] };
  }
  const params = new URLSearchParams({ projectId, limit: '100', since: String(startOfUtcDayMs(now)) });
  if (teamId) params.set('teamId', teamId);
  try {
    const response = await fetchImpl(`https://api.vercel.com/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return { ok: false, reason: `Vercel API ${response.status}`, deployments: [] };
    }
    const body = await response.json();
    return { ok: true, deployments: body.deployments ?? [] };
  } catch (err) {
    return { ok: false, reason: err.message || String(err), deployments: [] };
  }
}

/**
 * End-to-end live check: fetch today's deployments, count automation usage,
 * and gate. Falls open (allow: true, tier: 'unavailable') when the API isn't
 * reachable or isn't configured — the categorical split still applies.
 */
export async function checkLiveAutomationGate(options = {}) {
  const fetched = await fetchDeploymentsToday(options);
  if (!fetched.ok) {
    return { tier: 'unavailable', allow: true, reason: fetched.reason, counts: null };
  }
  const counts = countTodayDeployments(fetched.deployments, options);
  const gate = gateAutomationDeploy(counts.automation, options);
  return { ...gate, counts };
}
