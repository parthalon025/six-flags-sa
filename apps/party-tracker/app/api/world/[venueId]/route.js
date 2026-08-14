import { listVenueMarks, postVenueMark, postVenueThanks } from '@/lib/worldMarks';
import { isAllowedSign, MARK_TYPES } from '@/lib/world';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { badRequest, forbidden, json, tooManyRequests, readJson, isId, str } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Park-wide Marks. GET is public (fade + evidence already applied).
 * POST needs a Profile id — same soft-gate as Side Quest submit.
 */

export async function GET(request, { params }) {
  const { venueId } = await params;
  if (!isId(venueId)) return badRequest('venueId required');
  const url = new URL(request.url);
  const partyId = str(url.searchParams.get('partyId'), 64) || null;
  const listed = await listVenueMarks(venueId, { partyId });
  return json({ ok: true, venueId, ...listed });
}

export async function POST(request, { params }) {
  const { venueId } = await params;
  if (!isId(venueId)) return badRequest('venueId required');

  const ip = clientIp(request) || 'unknown';
  const limited = await rateLimit('worldMark', ip);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = await readJson(request);
  if (!body) return badRequest('Malformed body');

  const profileId = str(body.profileId, 64);
  if (!profileId) return forbidden('Profile required');
  const partyId = str(body.partyId, 64) || null;
  const action = str(body.action, 16);

  if (action === 'thanks') {
    const targetId = str(body.targetId, 80);
    if (!targetId) return badRequest('targetId required');
    const world = await postVenueThanks(venueId, {
      profileId,
      partyId,
      targetId,
      now: Date.now(),
    });
    return json({ ok: true, world });
  }

  if (action !== 'mark') return badRequest('action must be mark or thanks');

  const type = str(body.type, 24);
  if (!MARK_TYPES.includes(type)) return badRequest('unknown Mark type');
  if (type === 'sign' && body.phrase && !isAllowedSign(body.phrase)) {
    return badRequest('sign phrase is not on the closed list');
  }

  const world = await postVenueMark(venueId, {
    id: str(body.id, 80) || null,
    type,
    placeId: str(body.placeId, 80) || null,
    lat: Number(body.lat),
    lng: Number(body.lng),
    authorId: profileId,
    authorPartyId: partyId,
    phrase: body.phrase ? str(body.phrase, 80) : null,
    now: Number.isFinite(Number(body.now)) ? Number(body.now) : Date.now(),
  });
  return json({ ok: true, world });
}
