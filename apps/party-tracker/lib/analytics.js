/**
 * Thin wrapper around Vercel Web Analytics custom events.
 *
 * Failures are swallowed — analytics must never break a park day. Events are
 * named for the park-day funnel, not for page views (those are automatic).
 *
 * The `@vercel/analytics` import is lazy so bare-node unit tests that pull in
 * venue/party callers never have to resolve the browser package.
 */

/** @param {string} name @param {Record<string, string | number | boolean | null | undefined>} [data] */
export function track(name, data) {
  if (typeof window === 'undefined') return;
  const cleaned = {};
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (value == null) continue;
      cleaned[key] = value;
    }
  }
  import('@vercel/analytics')
    .then((mod) => {
      try {
        mod.track(name, cleaned);
      } catch {
        // ignore
      }
    })
    .catch(() => {
      // ignore
    });
}

export const AnalyticsEvents = {
  partyCreated: (partyId) => track('party_created', { partyId: String(partyId || '').slice(0, 64) }),
  partyJoined: (partyId) => track('party_joined', { partyId: String(partyId || '').slice(0, 64) }),
  venueLoaded: (venueId) => track('venue_loaded', { venueId: String(venueId || '').slice(0, 64) }),
  routeDrawn: (venueId) => track('route_drawn', { venueId: String(venueId || '').slice(0, 64) }),
};
