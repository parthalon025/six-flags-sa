/*
 * Waking a phone that is in a pocket.
 *
 * The rest of this app is careful that nothing in the middle can read a party's
 * traffic, and a notification is the most revealing frame there is — it says a
 * name, and often where that name is. So it is sealed with the party key before
 * it is handed over, exactly like a mailbox frame, and opened again by the
 * service worker on the receiving phone.
 *
 * That leaves three parties seeing three different things:
 *
 *   this server        an endpoint and a blob
 *   the push service   the same, plus whose phone it is going to
 *   the phone          the words
 *
 * The push service is told to keep it for a few minutes and then give up: a
 * "someone needs help" that surfaces an hour later is worse than one that never
 * arrives, because it is read as current.
 */
import webpush from 'web-push';
import { readSubscriptions, removeSubscription } from '@/lib/serverStore';

const PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
/** A contact address is required by the spec so a push service can complain. */
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:nobody@example.com';

export const pushConfigured = Boolean(PUBLIC && PRIVATE);
export const publicKey = PUBLIC;

if (pushConfigured) webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);

/** How long a push service should keep trying. Past this it is stale news. */
const TTL_SECONDS = 300;

/**
 * Send one sealed envelope to every phone in the party except the one that sent
 * it. Subscriptions the push service reports as finished are dropped — a phone
 * that has uninstalled or revoked permission must not be retried forever.
 *
 * @returns `{ sent, gone }`
 */
export async function fanOut(partyId, { sealed, exclude = null, urgent = false }) {
  if (!pushConfigured) return { sent: 0, gone: 0 };
  const subs = await readSubscriptions(partyId);
  const body = JSON.stringify({ pid: partyId, sealed });
  let sent = 0;
  let gone = 0;
  let failed = 0;
  let lastError = null;

  await Promise.all(
    subs.map(async ({ memberId, sub }) => {
      if (exclude && memberId === exclude) return;
      try {
        await webpush.sendNotification(sub, body, {
          TTL: TTL_SECONDS,
          urgency: urgent ? 'high' : 'normal',
        });
        sent += 1;
      } catch (err) {
        // 404 and 410 are the push service saying this endpoint is finished.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          gone += 1;
          await removeSubscription(partyId, sub.endpoint).catch(() => {});
          return;
        }
        // Anything else is counted and reported rather than swallowed. A push
        // that silently never sends is indistinguishable from one nobody sent,
        // and that is how notifications end up mysteriously "not working".
        failed += 1;
        lastError = err?.statusCode ? `${err.statusCode}` : err?.message || 'unknown';
      }
    }),
  );

  return { sent, gone, failed, lastError };
}
