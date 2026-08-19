import { thankContribution } from '@/lib/contributions/store';
import { ID_RE } from '@/lib/contributions/validate';
import { rateLimit } from '@/lib/rateLimit';
import { badRequest, json, notFound, tooManyRequests, readJson, isId } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Thanks the finder of a Contribution (Death Stranding like).
 * POST { contributionId, thankerId } — thankerId is the signed-in Profile,
 * same client trust model and field naming as the contributions POST's
 * authorId (the world route's Mark thanks says profileId; deliberate local
 * consistency over cross-route sameness). Idempotent per (contribution,
 * thanker); self-thanks never count. Shares the worldMark budget: the same
 * "Thanks at a Place" gesture, different target.
 */
export async function POST(request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const limited = await rateLimit('worldMark', ip);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = await readJson(request, 4 * 1024);
  if (!body) return badRequest('Malformed or oversized body');

  const contributionId = String(body.contributionId || '').trim();
  const thankerId = String(body.thankerId || '').trim();
  if (!isId(contributionId)) return badRequest('contributionId required');
  // thankerId lands in a users(id)-shaped column — identity-grade check,
  // same bar as the contributions POST's authorId.
  if (!ID_RE.test(thankerId)) return badRequest('thankerId required');

  const result = await thankContribution({ contributionId, thankerId });
  if (!result.ok && result.reason === 'not_found') return notFound();
  if (!result.ok) return badRequest(result.reason);
  return json({
    ok: true,
    counted: result.counted,
    thanksCount: result.thanksCount ?? 0,
    reason: result.reason,
  });
}
