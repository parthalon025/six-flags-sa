import { acceptContribution } from '@/lib/contributions/store';
import { requestIsOperator } from '@/lib/adminToken';
import { badRequest, json, notFound, isId } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Steward accept — promote a pending durable contribution for consolidate export.
 * POST /api/admin/contributions/:id/accept
 */
export async function POST(request, { params }) {
  if (!(await requestIsOperator(request))) return notFound();

  const id = String((await params)?.id || '').trim();
  if (!id || !isId(id)) return badRequest('Invalid id');

  const row = await acceptContribution(id);
  if (!row) return notFound();
  return json({ ok: true, contribution: row });
}
