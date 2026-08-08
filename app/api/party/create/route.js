import { createParty } from '@/lib/core/state';
import { allocateParty, usingRedis, writeParty } from '@/lib/serverStore';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import {
  badRequest,
  isId,
  json,
  readJson,
  serverError,
  str,
  tooManyRequests,
} from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** See app/api/mailbox/[partyId]/route.js — one hop to the store, no more. */
export const maxDuration = 10;

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
    // The only unauthenticated endpoint that mints storage from nothing, so it
    // is the one that has to be metered by caller rather than by party. The
    // ceiling is high on purpose: a park is one NAT, and a limit tuned to an
    // attacker would be a limit on the crowd this app was built for.
    const quota = await rateLimit('partyCreate', clientIp(request) ?? 'unknown');
    if (!quota.ok) return tooManyRequests(quota.retryAfter);

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
