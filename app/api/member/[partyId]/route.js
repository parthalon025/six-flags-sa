import { commandRoute } from '@/app/api/_lib/party';
import { badRequest, isId, readJson, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/**
 * Edit your own record. `memberId` is both the subject and the author: the
 * reducer only ever applies a patch to `from`, so there is no shape of request
 * that lets one member rewrite another.
 */
export async function PATCH(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

    const body = await readJson(request);
    if (!body) return badRequest('Malformed body');
    if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
      return badRequest('Bad patch');
    }

    return commandRoute({
      partyId,
      memberId: body.memberId,
      kind: 'patch-member',
      body: { patch: body.patch },
    });
  } catch {
    return serverError('Store unavailable');
  }
}
