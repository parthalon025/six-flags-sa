/**
 * Derives OpenRouteService route-QA samples from a venue's own POIs.
 * Deliberately dependency-free (no other lib/adapters/* imports) so it can be
 * unit-tested by the CI Gate job, which runs test/scripts/*.test.mjs without
 * node_modules installed (see scripts/ci/gate-tests.mjs).
 *
 * "Entrance" POIs use the same 'gate' category as the rest of the builder
 * (venue-checklist.mjs's "A way in" check).
 */
const ORS_ENTRANCE_CATEGORIES = ['gate', 'parking'];
const ORS_DESTINATION_CATEGORIES = ['coaster', 'ride', 'show', 'landmark'];
const ORS_MIN_SAMPLES = 3;
const ORS_MAX_SAMPLES = 4;

function hasCoords(poi) {
  return Boolean(poi) && Number.isFinite(poi.lat) && Number.isFinite(poi.lng);
}

/**
 * Derive a small, fixed set of OpenRouteService route samples from a venue's
 * own POIs: one entrance/parking POI as the walking origin, paired with a
 * few ride/attraction POIs (one per distinct category, for variety) as
 * destinations. Deliberately simple — straightforward filtering, no
 * route-graph logic. Returns [] when the venue's POIs can't cleanly support
 * at least ORS_MIN_SAMPLES samples (missing coordinates, no entrance-like
 * POI, too few distinct attraction categories) rather than guessing.
 * @param {object[]} [pois]
 * @returns {{ from: { lat: number, lng: number }, to: { lat: number, lng: number }, label: string }[]}
 */
export function deriveOrsRouteSamples(pois = []) {
  const usable = (pois || []).filter(hasCoords);
  const from = ORS_ENTRANCE_CATEGORIES.map((cat) => usable.find((p) => p.c === cat)).find(Boolean);
  if (!from) return [];

  const seenCategories = new Set();
  const destinations = [];
  for (const poi of usable) {
    if (poi === from || !ORS_DESTINATION_CATEGORIES.includes(poi.c) || seenCategories.has(poi.c)) continue;
    seenCategories.add(poi.c);
    destinations.push(poi);
    if (destinations.length >= ORS_MAX_SAMPLES) break;
  }
  if (destinations.length < ORS_MIN_SAMPLES) return [];

  return destinations.map((to) => ({
    from: { lat: from.lat, lng: from.lng },
    to: { lat: to.lat, lng: to.lng },
    label: `${from.n || from.i} → ${to.n || to.i}`,
  }));
}
