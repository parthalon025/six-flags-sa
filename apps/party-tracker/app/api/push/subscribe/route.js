import { addSubscription, partyExists, removeSubscription, subscriptionsExist } from '@/lib/serverStore';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { badRequest, isId, json, readJson, serverError, tooManyRequests } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** One store write and no fan-out; anything slower than this is a stuck backend. */
export const maxDuration = 10;

/**
 * A push endpoint is a URL from the browser's push service, and they are long —
 * FCM's run to a few hundred characters. Generous, but not unbounded: this
 * string becomes a hash field in the store, and the store is the thing being
 * protected here.
 */
const MAX_ENDPOINT = 1024;
const MAX_BODY = 8 * 1024;

/** Remember where to knock for this phone, for as long as it is in this party. */
export async function POST(request) {
  try {
    const body = await readJson(request, MAX_BODY);
    if (!body) return badRequest('Bad request');

    const { partyId, memberId, subscription } = body;
    if (!isId(partyId) || !subscription?.endpoint) return badRequest('Bad request');
    if (typeof subscription.endpoint !== 'string' || subscription.endpoint.length > MAX_ENDPOINT) {
      return badRequest('Bad endpoint');
    }
    if (memberId != null && !isId(memberId)) return badRequest('Bad memberId');

    // Per party, not per address: a park is one wifi egress, so metering the
    // address here would meter the venue. See lib/rateLimit.js.
    const quota = await rateLimit('pushSubscribe', partyId);
    if (!quota.ok) return tooManyRequests(quota.retryAfter);

    // The same guard the mailbox uses. A party created while this API was
    // unreachable has no record here and is still entitled to notifications, so
    // an unknown party is not refused — but the request that opens a brand new
    // subscription list for one is charged, because that is how an anonymous
    // caller makes this store grow.
    if (!(await partyExists(partyId)) && !(await subscriptionsExist(partyId))) {
      const opening = await rateLimit('storeCreate', clientIp(request) ?? 'unknown');
      if (!opening.ok) return tooManyRequests(opening.retryAfter);
    }

    await addSubscription(partyId, memberId ? String(memberId) : null, subscription);
    return json({ ok: true });
  } catch {
    return serverError('Could not subscribe');
  }
}

/** Leaving a party takes the right to wake this phone with it. */
export async function DELETE(request) {
  try {
    const body = await readJson(request, MAX_BODY);
    if (!body) return badRequest('Bad request');

    const { partyId, endpoint } = body;
    if (!isId(partyId) || typeof endpoint !== 'string' || !endpoint) return badRequest('Bad request');
    if (endpoint.length > MAX_ENDPOINT) return badRequest('Bad endpoint');

    // Deliberately unmetered. Removing a subscription only ever shrinks the
    // store, and a phone that cannot unsubscribe keeps receiving pushes for a
    // party it has left — which is the failure this endpoint exists to prevent.
    await removeSubscription(partyId, endpoint);
    return json({ ok: true });
  } catch {
    return serverError('Could not unsubscribe');
  }
}
