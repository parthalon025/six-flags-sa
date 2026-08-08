import { publicSnapshot, reduce } from '@/lib/core/state';
import { readParty, resolveCode, writeParty } from '@/lib/serverStore';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import {
  badRequest,
  isId,
  json,
  notFound,
  readJson,
  serverError,
  str,
  tooManyRequests,
} from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** See app/api/mailbox/[partyId]/route.js — one hop to the store, no more. */
export const maxDuration = 10;

/**
 * Join by code. The caller brings its own member id — it is the same id the
 * peer uses on every other transport, so a party that fails over from WebRTC to
 * the relay keeps one roster instead of gaining a duplicate of everybody.
 */
export async function POST(request) {
  try {
    // This is also the endpoint a code is guessed at. Six characters from a
    // 32-symbol alphabet is a billion codes and codes expire in hours, so the
    // search was never going to land — but a ceiling turns "would not work" into
    // "cannot be attempted", and costs an honest joiner nothing.
    const quota = await rateLimit('partyJoin', clientIp(request) ?? 'unknown');
    if (!quota.ok) return tooManyRequests(quota.retryAfter);

    const body = await readJson(request);
    if (!body) return badRequest('Malformed body');

    const member = body.member;
    if (!member || typeof member !== 'object' || !isId(member.id)) {
      return badRequest('Bad member');
    }

    const partyId = await resolveCode(body.code);
    if (!partyId) return notFound('No such party');
    let party = await readParty(partyId);
    if (!party) return notFound('No such party');

    const now = Date.now();
    // An empty party has no host yet. First one in takes it, which `join` then
    // reads back to stamp the member's role.
    if (!party.leader) {
      party = reduce(party, { kind: 'set-leader', from: member.id, body: { leader: member.id } }, now).state;
    }
    party = reduce(
      party,
      {
        kind: 'join',
        from: member.id,
        body: { name: str(member.name || 'Guest', 24), avatar: member.avatar ?? null },
      },
      now,
    ).state;

    await writeParty(partyId, party);
    return json({ partyId, snapshot: publicSnapshot(party) });
  } catch {
    return serverError('Could not join');
  }
}
