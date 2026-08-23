import { appendGuestTraces, guestTraceStats, listGuestTraces, tracesToFeatureCollection } from '@/lib/guestTraces';
import { validateTraceUpload } from '@/lib/gps/movementLog';
import { requestIsOperator } from '@/lib/adminToken';
import { rateLimit } from '@/lib/rateLimit';
import { badRequest, json, notFound, tooManyRequests, readJson, isId } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Guest walk traces + ground-truth pins for path and entrance research.
 *
 * POST — anonymised Feature / FeatureCollection (LineString walks and Point
 *        entrance/exit/amenity sightings) from phones.
 * GET  — operator export (token gated like /api/metrics). Never mutates venues.
 */

export async function POST(request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const limited = await rateLimit('guestTraceUpload', ip);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = await readJson(request, 512 * 1024);
  if (!body) return badRequest('Malformed or oversized body');

  const parsed = validateTraceUpload(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const result = await appendGuestTraces(parsed.traces);
  return json({
    ok: true,
    stored: result.stored,
    venues: result.venues,
    note: 'Traces and ground-truth pins queued for builder research. They do not change the live map.',
  });
}

export async function GET(request) {
  if (!(await requestIsOperator(request))) return notFound();

  const url = new URL(request.url);
  const venueId = url.searchParams.get('venueId') || '';
  if (!isId(venueId)) return badRequest('venueId required');

  const limit = Number(url.searchParams.get('limit') || 100);
  const format = url.searchParams.get('format') || 'json';
  const traces = await listGuestTraces(venueId, { limit });
  const stats = await guestTraceStats(venueId);

  if (format === 'geojson') {
    return json(tracesToFeatureCollection(traces));
  }

  return json({ ...stats, traces });
}
