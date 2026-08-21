/**
 * A tapped point on the map, named by what it is standing next to.
 *
 * Bare ground is the one thing a park map has most of and can say least about.
 * A Side Quest about a missing bench and a Mark left where the fireworks are
 * watched from both happen *between* the Places, so both need a way to say
 * "here" that is not a Place id. This is that way: one coordinate, described
 * in the same words the rest of the app uses for a Place — the Zone it falls
 * in, the nearest thing with a name, and how far the walk is.
 *
 * Coordinates only. The design twin stored the tap as x/y percentages of its
 * frame, which is correct for a prototype whose map never moves and wrong the
 * instant a real one pans: the same percentages point at a different patch of
 * park on the next frame. Lat/lng survives pan, zoom, rotation and a venue
 * reload.
 *
 * Pure: no React, no store, no clock. Everything it needs is handed in, so the
 * same call answers the same way from a component, a test or the console.
 */
/* Relative `.js` imports, like lib/eligibility.js, so the unit suite can load
   this in plain Node without the bundler alias. */
import { distance, formatDistance, formatWalk } from './geo.js';
import { identityOf } from './venue/ids.js';
import { placeContext } from './venue/placeContext.js';

/**
 * How close a tap has to land before the spot belongs to a Place rather than
 * to the ground. 34 m is about the depth of a queue entrance plus its plaza —
 * near enough that "By the Beast" is what a person standing there would say,
 * far enough that a tap across the midway does not steal a ride's name. It is
 * the twin's threshold, kept because the twin was drawn from this app.
 */
export const SPOT_NEAR_M = 34;

/**
 * Describe a tapped coordinate.
 *
 * @param {object} args
 * @param {number} args.lat            tapped latitude
 * @param {number} args.lng            tapped longitude
 * @param {Array}  [args.pois]         the venue's Places, for the nearest-name lookup
 * @param {object} [args.venue]        active venue — placeContext's World fallback
 * @param {object} [args.map]          venue map bundle — placeContext reads map.lands
 * @param {object} [args.me]           this phone's fix, or null
 * @returns {{
 *   lat: number, lng: number,
 *   zone: string|null, name: string, near: string|null, placeId: string|null,
 *   metres: number|null, walk: string|null, dist: string|null, reach: string|null
 * }}
 */
export function spotAt({ lat, lng, pois = [], venue = null, map = null, me = null }) {
  const here = { lat, lng };

  // Nearest named thing. One pass over a few hundred records, on a tap.
  let poi = null;
  let gap = Infinity;
  for (const p of pois || []) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) continue;
    const d = distance(lat, lng, p.lat, p.lng);
    if (d < gap) {
      gap = d;
      poi = p;
    }
  }

  /* The Zone comes from the real placeContext, on the nearest Place, rather
     than from a table of zone anchors: only names in `map.lands` are mapped
     Zones, and a spot that claimed one the venue never drew would be a spot
     lying about where it is. With no Zone the context falls back to the World,
     which is the honest answer and the same one PlaceList and PlaceDetail give
     for the same Place. */
  const context = poi ? placeContext(poi, venue, map) : null;
  const zone = context?.name || venue?.name || null;

  const anchored = Boolean(poi) && gap < SPOT_NEAR_M;

  /* How far the visitor is from the point they tapped. `me` may be null — the
     app runs without a fix (denied, indoors, manual pin not yet dropped), and
     a walk time invented from no position is worse than no walk time. Callers
     hide the line when these are null rather than printing an em dash. */
  const metres = me ? distance(me.lat, me.lng, lat, lng) : null;
  const walk = metres == null ? null : formatWalk(metres);
  const dist = metres == null ? null : formatDistance(metres);

  return {
    ...here,
    zone,
    name: anchored ? `By ${poi.n}` : 'Open ground',
    near: poi ? (anchored ? poi.n : `${formatDistance(gap)} from ${poi.n}`) : null,
    // Only an anchored spot carries a Place id. Beyond the threshold the spot
    // is ground that happens to have a neighbour, and filing a Mark or a Side
    // Quest against that neighbour would attach it to the wrong thing.
    placeId: anchored ? identityOf(poi) || null : null,
    metres,
    walk,
    dist,
    reach: metres == null ? null : `${walk} walk · ${dist}`,
  };
}
