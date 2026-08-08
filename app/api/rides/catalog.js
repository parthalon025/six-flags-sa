// A venue's POI list has no ids — it is a flat list whose only stable field is
// the name. The API needs addressable records, so ids are slugged from the name
// here and nowhere else.
//
// Names are not unique either (ten "Restrooms" in one park), so a repeat gets a
// numeric suffix in file order. That is stable as long as the venue file is
// only appended to; rebuilding a venue from OpenStreetMap can move a handful of
// ids, which is why the name is accepted as a lookup key too.
//
// Every venue in the build is indexed, not just the default one, so a caller
// can ask for `?venue=<id>` and get that park's list.
//
// Not a route: App Router only treats route.js as an endpoint.

import { DEFAULT_VENUE_ID, POIS_BY_VENUE, VENUES } from '@/lib/venueIndex';

const slug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function withIds(pois) {
  const seen = new Map();
  return pois.map((poi) => {
    const base = slug(poi.n) || 'poi';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n === 1 ? base : `${base}-${n}`, ...poi };
  });
}

const catalogues = new Map(
  Object.entries(POIS_BY_VENUE).map(([id, pois]) => {
    const rides = withIds(pois);
    const byId = new Map();
    for (const ride of rides) {
      byId.set(ride.id, ride);
      byId.set(ride.n.toLowerCase(), ride);
    }
    return [id, { rides, byId }];
  }),
);

export const VENUE_IDS = VENUES.map((v) => v.id);

/** The catalogue for a venue id, falling back to the default venue. */
export const catalogFor = (id) =>
  catalogues.get(id) || catalogues.get(DEFAULT_VENUE_ID) || { rides: [], byId: new Map() };

export const defaultVenueId = () => DEFAULT_VENUE_ID;
