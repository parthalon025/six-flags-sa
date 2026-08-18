'use client';

/**
 * Shared gate for deciding whether a mailbox base is worth an SSE attempt.
 *
 * Pulled out of mailboxClient.js so mailboxClient.js and mailboxPoller.js can
 * both depend on it without depending on each other (#478).
 */

export const normalizeBase = (base) => String(base || '').replace(/\/+$/, '');

/**
 * Bases known to have no `/stream`. One page, one answer, no retries.
 *
 * The relay in app/api deliberately implements no SSE — serverless gives no
 * useful guarantee about how long a response may stay open — while the
 * standalone Node host in /server does. Asking anyway costs a 404 per peer per
 * page load, which is real console noise for a fact that is knowable up front:
 * a base that is this app's own origin IS that relay. Anything else is asked
 * once, and a stream that never opens is remembered here as absent.
 */
const noStream = new Set();

const ownOrigin = () => (typeof window === 'undefined' ? '' : normalizeBase(window.location.origin));

/** True if `base` is worth attempting an EventSource against. */
export function mayStream(base) {
  const root = normalizeBase(base);
  if (noStream.has(root)) return false;
  // An empty base is a relative URL, which is this app's own origin too.
  return Boolean(root) && root !== ownOrigin();
}

/** Remember that `base` serves no stream. Permanent for this page. */
export function markNoStream(base) {
  noStream.add(normalizeBase(base));
}
