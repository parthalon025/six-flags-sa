import { jsonCached } from '@/app/api/_lib/http';
import { VENUE_IDS, catalogFor, defaultVenueId } from './catalog';

/**
 * The place catalogue for a venue. Static data with no party in it, so unlike
 * everything else in this API it is safe to cache — deliberately no
 * `force-dynamic` and no no-store header.
 */
export function GET(request) {
  const asked = new URL(request.url).searchParams.get('venue');
  const venue = asked && VENUE_IDS.includes(asked) ? asked : defaultVenueId();
  const { rides } = catalogFor(venue);
  const data = { venue, venues: VENUE_IDS, rides, count: rides.length };
  return jsonCached(data, { maxAge: 3600, sMaxAge: 86400, swr: 86400 });
}
