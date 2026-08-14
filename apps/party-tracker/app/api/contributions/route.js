import { insertContribution, getContribution, listContributions } from '@/lib/contributions/store';
import { validateContributionPost } from '@/lib/contributions/validate';
import { rateLimit } from '@/lib/rateLimit';
import { badRequest, json, notFound, tooManyRequests, readJson, isId } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Durable map contributions (Side Quest / gap payloads).
 * POST — submit pending contribution (requires signed-in authorId on client).
 * GET  — list by venueId / status (public read for overlays sync — v1 basic).
 */

export async function POST(request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const limited = await rateLimit('contributionPost', ip);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = await readJson(request, 64 * 1024);
  if (!body) return badRequest('Malformed or oversized body');

  const parsed = validateContributionPost(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const row = await insertContribution(parsed.contribution);
  return json({ ok: true, contribution: row }, 201);
}

export async function GET(request) {
  const url = new URL(request.url);
  const venueId = url.searchParams.get('venueId') || '';
  const status = url.searchParams.get('status') || '';
  const id = url.searchParams.get('id') || '';

  if (id) {
    if (!isId(id)) return badRequest('Invalid id');
    const row = await getContribution(id);
    if (!row) return notFound();
    return json({ contribution: row });
  }

  const opts = { limit: Number(url.searchParams.get('limit') || 100) };
  if (venueId) {
    if (!/^[a-z0-9-]{1,64}$/.test(venueId)) return badRequest('Invalid venueId');
    opts.venueId = venueId;
  }
  if (status) opts.status = status;

  const rows = await listContributions(opts);
  return json({ contributions: rows, count: rows.length });
}
