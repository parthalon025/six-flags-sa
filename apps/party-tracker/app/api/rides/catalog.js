// A venue's POI list has no ids — it is a flat list whose only stable field is
// the name. The API needs addressable records, so ids are slugged on the way
// in, by the one rule in lib/venue/ids.js that the browser and the standalone
// host also use.
//
// Every venue in the build is indexed, not just the default one, so a caller
// can ask for `?venue=<id>` and get that park's list.
//
// Not a route: App Router only treats route.js as an endpoint.

import { DEFAULT_VENUE_ID, POIS_BY_VENUE, VENUES } from '@/lib/venueIndex';
import { indexById, withIds } from '@/lib/venue/ids';

const catalogues = new Map(
  Object.entries(POIS_BY_VENUE).map(([id, pois]) => {
    const rides = withIds(pois);
    return [id, { rides, byId: indexById(rides) }];
  }),
);

export const VENUE_IDS = VENUES.map((v) => v.id);

/** The catalogue for a venue id, falling back to the default venue. */
export const catalogFor = (id) =>
  catalogues.get(id) || catalogues.get(DEFAULT_VENUE_ID) || { rides: [], byId: new Map() };

export const defaultVenueId = () => DEFAULT_VENUE_ID;
