import { jsonCached, notFound } from '@/app/api/_lib/http';
import { VENUE_IDS, catalogFor, defaultVenueId } from '../catalog';

/**
 * One ride from the static catalogue — same caching rules as `/api/rides`.
 * No party in the body, so the CDN may hold it.
 */
export async function GET(request, { params }) {
  const { id } = await params;
  const asked = new URL(request.url).searchParams.get('venue');
  const venue = asked && VENUE_IDS.includes(asked) ? asked : defaultVenueId();
  const ride = catalogFor(venue).byId.get(String(id ?? '').toLowerCase());
  if (!ride) return notFound('No such ride');
  return jsonCached({ venue, ...ride }, { maxAge: 3600, sMaxAge: 86400, swr: 86400 });
}
