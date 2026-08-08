import { reduce } from '@/lib/core/state';
import { readParty, writeParty } from '@/lib/serverStore';
import { badRequest, isId, json, readJson, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** See app/api/mailbox/[partyId]/route.js — one hop to the store, no more. */
export const maxDuration = 10;

/**
 * Leaving is idempotent and never fails: a party or member that is already gone
 * is the outcome the caller asked for. Clients fire this from a pagehide
 * handler, where a 404 would only produce noise nobody can act on.
 */
export async function POST(request) {
  try {
    const body = await readJson(request);
    if (!body) return badRequest('Malformed body');
    if (!isId(body.partyId) || !isId(body.memberId)) return badRequest('Bad ids');

    const party = await readParty(body.partyId);
    if (party?.members[body.memberId]) {
      const { state } = reduce(party, { kind: 'leave', from: body.memberId, body: {} }, Date.now());
      await writeParty(body.partyId, state);
    }
    return json({ ok: true });
  } catch {
    return serverError('Could not leave');
  }
}
