import { readParty } from '@/lib/serverStore';
import { badRequest, isId, json, notFound, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** The roster on its own, for callers that poll it far more often than the rest. */
export async function GET(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');
    const party = await readParty(partyId);
    if (!party) return notFound('No such party');
    return json({ members: Object.values(party.members) });
  } catch {
    return serverError('Store unavailable');
  }
}
