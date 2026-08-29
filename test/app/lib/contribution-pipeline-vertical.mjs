/**
 * Contribution pipeline vertical — submit → steward accept → consolidate dry-run.
 *
 * Public seam exercised end to end:
 *   submit() — POST /api/contributions or the same validate+insert the route uses
 *   acceptContribution — steward promotion to accepted
 *   venues:consolidate dry-run CLI — plan output without writing venue data
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Fixture body: durable height_rule for kings-island / Orion (independent of code). */
export const PIPELINE_CONTRIBUTION_BODY = Object.freeze({
  authorId: 'usr_pipeline_finder',
  venueId: 'kings-island',
  placeId: 'orion',
  kind: 'height_rule',
  payload: { placeName: 'Orion', min: 54, note: 'Contribution pipeline vertical fixture' },
});

/**
 * @param {{ submit: () => Promise<{ id: string, status: string, venueId: string }>, accept?: (id: string) => Promise<object> }} opts
 * @returns {Promise<{ contributionId: string, plan: object }>}
 */
export async function assertContributionConsolidatePipeline({ submit, accept }) {
  const { acceptContribution, getContribution } = await import(
    '../../../apps/party-tracker/lib/contributions/store.js'
  );
  const { buildConsolidateExport } = await import(
    '../../../packages/shared/consolidateExport.js'
  );

  const pending = await submit();
  assert.equal(pending.status, 'pending', 'submit leaves contribution pending');
  assert.ok(pending.id?.startsWith('c_'), 'contribution id is minted');

  const accepted = accept
    ? await accept(pending.id)
    : await acceptContribution(pending.id);
  assert.ok(accepted, 'steward accept returns the row');
  assert.equal(accepted.status, 'accepted');
  if (!accept) {
    assert.equal((await getContribution(pending.id))?.status, accepted.status);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'pb-consolidate-'));
  const queuePath = join(tmp, 'queue.json');
  try {
    writeFileSync(queuePath, JSON.stringify(buildConsolidateExport([accepted])));
    const stdout = execFileSync(
      'node',
      [
        'packages/venue-builder/bin/consolidate.mjs',
        '--dry-run',
        '--json',
        '--force',
        '--venue',
        'kings-island',
        '--queue',
        queuePath,
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const report = JSON.parse(stdout);

    assert.equal(report.writes?.length || 0, 0, 'dry-run must not write venue data');
    assert.equal(report.applied.length, 1, 'one height plan expected');

    const plan = report.applied[0];
    assert.equal(plan.action, 'heights');
    assert.equal(plan.venueId, 'kings-island');
    assert.equal(plan.contributionId, pending.id);
    assert.equal(plan.placeName, 'Orion');

    return { contributionId: pending.id, plan };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * POST body the production route would accept.
 * @param {string} base origin without trailing slash
 */
export async function submitContributionViaApi(base) {
  const res = await fetch(`${base}/api/contributions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(PIPELINE_CONTRIBUTION_BODY),
  });
  if (res.status !== 201) {
    throw new Error(`contribution POST ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const { contribution } = await res.json();
  return contribution;
}

function operatorTokenFromEnv() {
  return process.env.GUEST_TRACES_TOKEN || process.env.METRICS_TOKEN || '';
}

/**
 * Whether the running server exposes operator routes (steward accept, metrics).
 * Production `next start` without METRICS_TOKEN / GUEST_TRACES_TOKEN returns 404 —
 * the contribution-pipeline module should skip rather than fail (#774).
 *
 * @param {string} base origin without trailing slash
 * @param {{ fetchFn?: typeof fetch }} [opts]
 */
export async function contributionOperatorPathAvailable(base, { fetchFn = globalThis.fetch } = {}) {
  const token = operatorTokenFromEnv();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetchFn(`${base}/api/metrics`, { headers });
  if (res.ok) return true;
  if (res.status === 404) {
    return {
      ok: false,
      status: 404,
      reason: 'operator routes gated (no METRICS_TOKEN / Clerk operator session)',
    };
  }
  const body = typeof res.text === 'function' ? (await res.text()).slice(0, 120) : '';
  return { ok: false, status: res.status, body };
}

/**
 * Whether the running server can accept a durable contribution POST.
 * Cloud agents with DATABASE_URL but no migrated test profiles get 500 — skip HTTP.
 */
export async function contributionPostAvailable(base) {
  const res = await fetch(`${base}/api/contributions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(PIPELINE_CONTRIBUTION_BODY),
  });
  if (res.status === 201) return true;
  return { ok: false, status: res.status, body: (await res.text()).slice(0, 120) };
}

/** Steward accept through the operator route so the server store is exercised. */
export async function acceptContributionViaApi(base, id) {
  const token = operatorTokenFromEnv();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${base}/api/admin/contributions/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
    headers,
  });
  if (res.status !== 200) {
    throw new Error(`contribution accept ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const { contribution } = await res.json();
  return contribution;
}

/**
 * Full HTTP pipeline against a running production server.
 * @param {string} base origin without trailing slash
 */
export async function assertContributionConsolidatePipelineHttp(base) {
  return assertContributionConsolidatePipeline({
    submit: () => submitContributionViaApi(base),
    accept: (id) => acceptContributionViaApi(base, id),
  });
}

/** Same contract as POST /api/contributions without HTTP — store + validate seam. */
export async function submitContributionViaStoreSeam() {
  const { validateContributionPost } = await import(
    '../../../apps/party-tracker/lib/contributions/validate.js'
  );
  const { insertContribution } = await import(
    '../../../apps/party-tracker/lib/contributions/store.js'
  );
  const parsed = validateContributionPost(PIPELINE_CONTRIBUTION_BODY);
  if (!parsed.ok) throw new Error(parsed.error);
  return insertContribution(parsed.contribution);
}
