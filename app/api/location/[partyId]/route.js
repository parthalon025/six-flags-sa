import { isValidLocation } from '@/lib/core/state';
import { commandRoute } from '@/app/api/_lib/party';
import { badRequest, isId, readJson, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export async function POST(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

    const body = await readJson(request);
    if (!body) return badRequest('Malformed body');
    const raw = body.location;
    if (!raw || typeof raw !== 'object') return badRequest('Missing location');

    const location = {
      lat: Number(raw.lat),
      lng: Number(raw.lng),
      acc: num(raw.acc),
      heading: num(raw.heading),
      speed: num(raw.speed),
      // A fix without a timestamp is stamped on arrival; the reducer needs one
      // to reject reordered packets and would otherwise drop the update whole.
      ts: num(raw.ts) ?? Date.now(),
    };
    if (!isValidLocation(location)) return badRequest('Bad location');

    return commandRoute({ partyId, memberId: body.memberId, kind: 'location', body: { location } });
  } catch {
    return serverError('Store unavailable');
  }
}
