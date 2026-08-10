import { fanOut, pushConfigured } from '@/lib/push/server';
import { rateLimit } from '@/lib/rateLimit';
import { badRequest, isId, json, readJson, serverError, tooManyRequests } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/**
 * Longer than the store routes: this one waits on a push service per phone in
 * the party, not on Redis. Still bounded, because a push service that has
 * stopped answering must not bill for the platform default before giving up.
 */
export const maxDuration = 20;

/** A sealed notification is small — smaller than a mailbox frame, by design. */
const MAX_BODY = 16 * 1024;

/**
 * Relay one sealed notification to the rest of a party.
 *
 * `sealed` is opaque here, in the same way a mailbox frame is: this route
 * neither reads it nor could. Sender and party come in the clear because
 * routing needs them, which is the same trade the mailbox already makes.
 *
 * Unlike the mailbox, one request here becomes one outbound message per
 * subscribed phone, so this is the only endpoint in the app that amplifies.
 * That is what the rate limit is for, and why it is tighter than the relay's.
 */
export async function POST(request) {
  try {
    if (!pushConfigured) return json({ error: 'Push is not configured' }, 503);

    const body = await readJson(request, MAX_BODY);
    if (!body) return badRequest('Bad request');

    const { partyId, from, sealed, urgent } = body;
    if (!isId(partyId) || !sealed) return badRequest('Bad request');
    if (from != null && !isId(from)) return badRequest('Bad from');

    // Per party, for the NAT reason in lib/rateLimit.js — and because the party
    // is also what bounds the blast radius of a single request.
    const quota = await rateLimit('pushSend', partyId);
    if (!quota.ok) return tooManyRequests(quota.retryAfter);

    const result = await fanOut(partyId, {
      sealed,
      exclude: from ? String(from) : null,
      urgent: Boolean(urgent),
    });
    return json({ ok: true, ...result });
  } catch {
    return serverError('Could not send');
  }
}
