// The catalogue the API serves, which is the same catalogue the browser holds.
//
// Ids are slugged in lib/park.js and nowhere else — an id that meant one thing
// on a phone and another in a response would break every ride report crossing
// between them.
//
// Not a route: App Router only treats route.js as an endpoint.

export { POIS as RIDES, POI_BY_ID as RIDE_BY_ID } from '@/lib/park';
