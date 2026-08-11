import { appendGuestTraces, guestTraceStats, listGuestTraces, tracesToFeatureCollection } from '@/lib/guestTraces';
import { validateTraceUpload } from '@/lib/gps/movementLog';
import { rateLimit } from '@/lib/rateLimit';
import { badRequest, json, notFound, tooManyRequests, readJson, isId } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Guest walk traces for path-geometry research.
 *
 * POST — anonymised Feature / FeatureCollection / compact session from phones.
 * GET  — operator export (token gated like /api/metrics). Never mutates venues.
 */

const TOKEN = process.env.GUEST_TRACES_TOKEN || process.env.METRICS_TOKEN;

function permitted(request) {
  if (!TOKEN) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const query = new URL(request.url).searchParams.get('token') || '';
  return bearer === TOKEN || query === TOKEN;
}

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
    note: 'Traces queued for builder research. They do not change the live map.',
  });
}

export async function GET(request) {
  if (!permitted(request)) return notFound();

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
