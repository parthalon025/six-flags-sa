import { insertObservation, getObservation, listObservations } from '@/lib/observations/store';
import { validateObservationAppend, ID_RE } from '@party-tracker/shared/observations.js';
import { rateLimit } from '@/lib/rateLimit';
import { badRequest, json, notFound, tooManyRequests, readJson, isId } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Append-only observation series (E7.1).
 * POST — append one observation row.
 * GET  — list by venueId / placeId (public read for sync — v1 basic).
 */

export async function POST(request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const limited = await rateLimit('observationPost', ip);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = await readJson(request, 16 * 1024);
  if (!body) return badRequest('Malformed or oversized body');

  const parsed = validateObservationAppend(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const row = await insertObservation(parsed.observation);
  return json({ ok: true, observation: row }, 201);
}

export async function GET(request) {
  const url = new URL(request.url);
  const venueId = url.searchParams.get('venueId') || '';
  const placeId = url.searchParams.get('placeId') || '';
  const id = url.searchParams.get('id') || '';

  if (id) {
    if (!isId(id)) return badRequest('Invalid id');
    const row = await getObservation(id);
    if (!row) return notFound();
    return json({ observation: row });
  }

  const opts = { limit: Number(url.searchParams.get('limit') || 100) };
  if (venueId) {
    if (!ID_RE.test(venueId)) return badRequest('Invalid venueId');
    opts.venueId = venueId;
  }
  if (placeId) {
    if (!ID_RE.test(placeId)) return badRequest('Invalid placeId');
    opts.placeId = placeId;
  }

  const rows = await listObservations(opts);
  return json({ observations: rows, count: rows.length });
}
