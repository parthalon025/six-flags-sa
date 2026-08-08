// Ride reports over the cloud fallback, for the phones that could not reach
// each other directly. Same command, same reducer, same rules as the peer path
// — this route only carries it.
//
// Sits beside /api/favorites rather than under /api/rides, which is the static
// catalogue: a report is party state and belongs with the party endpoints.

import { commandRoute } from '@/app/api/_lib/party';
import { badRequest, isId, readJson, serverError } from '@/app/api/_lib/http';
import { RIDE_STATUSES } from '@/lib/core/state';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

    const body = await readJson(request);
    if (!body) return badRequest('Malformed body');
    if (!isId(body.rideId)) return badRequest('Bad rideId');

    // null is a retraction, which is a legitimate report and not a missing one.
    const status = body.status ?? null;
    if (status !== null && !RIDE_STATUSES.has(status)) return badRequest('Bad status');

    return commandRoute({
      partyId,
      memberId: body.memberId,
      kind: 'set-ride-status',
      body: { rideId: body.rideId, status, note: body.note ?? null },
    });
  } catch {
    return serverError('Store unavailable');
  }
}
