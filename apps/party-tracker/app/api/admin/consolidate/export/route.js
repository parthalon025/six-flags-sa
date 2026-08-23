import { buildConsolidateExport } from '@party-tracker/shared/consolidateExport.js';
import { listConsolidateCandidates } from '@/lib/contributions/store';
import { requestIsOperator } from '@/lib/adminToken';
import { badRequest, json, notFound } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Operator export of accepted durable contributions for consolidate / Databricks.
 * GET /api/admin/consolidate/export?venueId=kings-island
 */
export async function GET(request) {
  if (!(await requestIsOperator(request))) return notFound();

  const url = new URL(request.url);
  const venueId = url.searchParams.get('venueId') || '';
  const runId = url.searchParams.get('runId') || undefined;

  let rows = await listConsolidateCandidates();
  if (venueId) {
    if (!/^[a-z0-9-]{1,64}$/.test(venueId)) return badRequest('Invalid venueId');
    rows = rows.filter((r) => r.venueId === venueId);
  }

  return json(buildConsolidateExport(rows, { runId }));
}
