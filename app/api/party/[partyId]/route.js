import { publicSnapshot } from '@/lib/core/state';
import { deleteParty, readParty } from '@/lib/serverStore';
import { badRequest, forbidden, isId, json, notFound, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');
    const party = await readParty(partyId);
    if (!party) return notFound('No such party');
    return json(publicSnapshot(party));
  } catch {
    return serverError('Store unavailable');
  }
}

/**
 * Destroying a party is the one privileged operation here, so it needs the
 * token minted at create time — `Authorization: Bearer <token>` or `?token=`.
 * Every other route is guarded by knowing the party id, which is what the
 * relay's threat model actually assumes.
 */
export async function DELETE(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

    const party = await readParty(partyId);
    if (!party) return json({ ok: true }); // already gone is the requested state

    if (party.token) {
      const header = request.headers.get('authorization') || '';
      const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
      const supplied = bearer || new URL(request.url).searchParams.get('token');
      if (supplied !== party.token) return forbidden('Bad party token');
    }

    await deleteParty(partyId);
    return json({ ok: true });
  } catch {
    return serverError('Store unavailable');
  }
}
