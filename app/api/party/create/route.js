import { createParty } from '@/lib/core/state';
import { allocateParty, usingRedis, writeParty } from '@/lib/serverStore';
import { badRequest, isId, json, readJson, serverError, str } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/**
 * Allocate a cloud-hosted party. `durable` is false when the store is a
 * process-local Map, which tells the client this party will not survive a
 * redeploy and that it should prefer a phone or self-hosted host.
 *
 * The party starts with no leader: whoever joins first is elected in the join
 * route, so a code can be handed out before anyone has opened the app.
 */
export async function POST(request) {
  try {
    const body = await readJson(request);
    if (!body) return badRequest('Malformed body');

    const { partyId, code, token } = await allocateParty();
    const party = createParty({
      id: partyId,
      name: str(body.name || 'Party', 40),
      leader: isId(body.leader) ? body.leader : null,
      transport: 'cloud-relay',
    });
    // `code` and `token` ride along on the record; publicSnapshot whitelists
    // the domain fields, so neither can leak through a snapshot.
    await writeParty(partyId, { ...party, code, token });

    return json({ partyId, code, token, durable: usingRedis });
  } catch {
    return serverError('Could not start a party');
  }
}
