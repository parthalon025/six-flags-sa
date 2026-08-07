// rides.json is keyed by nothing — it is a flat list of park POIs whose only
// stable field is the name. The API needs addressable records, so ids are
// slugged from the name here and nowhere else.
//
// Names are not unique either (ten "Restrooms"), so a repeat gets a numeric
// suffix in file order. That is stable as long as rides.json is only appended
// to; reordering the file would move a handful of ids.
//
// Not a route: App Router only treats route.js as an endpoint.

import raw from '@/lib/rides.json';

const slug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const seen = new Map();

export const RIDES = raw.map((poi) => {
  const base = slug(poi.n) || 'poi';
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return { id: n === 1 ? base : `${base}-${n}`, ...poi };
});

export const RIDE_BY_ID = new Map(RIDES.map((ride) => [ride.id, ride]));
