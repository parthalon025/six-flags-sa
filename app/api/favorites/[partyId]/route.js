import { commandRoute } from '@/app/api/_lib/party';
import { badRequest, isId, readJson, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

    const body = await readJson(request);
    if (!body) return badRequest('Malformed body');
    if (!isId(body.rideId)) return badRequest('Bad rideId');
    if (typeof body.favorite !== 'boolean') return badRequest('Bad favorite');

    return commandRoute({
      partyId,
      memberId: body.memberId,
      kind: 'set-favorite',
      body: { rideId: body.rideId, favorite: body.favorite },
    });
  } catch {
    return serverError('Store unavailable');
  }
}
