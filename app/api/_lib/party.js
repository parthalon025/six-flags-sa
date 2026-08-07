// The single path every party mutation in this API takes.
//
// Routes differ only in the command they build. Load, reduce, persist and the
// failure modes around them are identical, and copying that sequence into six
// route files is exactly how the rules drift apart from lib/core/state.js.

import { reduce } from '@/lib/core/state';
import { readParty, writeParty } from '@/lib/serverStore';
import { badRequest, isId, json, notFound, serverError } from './http';

export async function commandRoute({ partyId, memberId, kind, body = {} }) {
  if (!isId(partyId)) return badRequest('Bad partyId');
  if (!isId(memberId)) return badRequest('Bad memberId');

  let party;
  try {
    party = await readParty(partyId);
  } catch {
    return serverError('Store unavailable');
  }
  if (!party) return notFound('No such party');
  if (!party.members[memberId]) return notFound('No such member');

  // `reduce` may decide nothing changed and leave version alone; the write
  // still happens because a no-op heartbeat has moved lastSeen.
  const { state } = reduce(party, { kind, from: memberId, body }, Date.now());
  try {
    await writeParty(partyId, state);
  } catch {
    return serverError('Store unavailable');
  }
  return json({ version: state.version });
}
