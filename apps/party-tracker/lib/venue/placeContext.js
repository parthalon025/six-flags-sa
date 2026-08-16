/**
 * The geographic context a Place can state honestly.
 *
 * `poi.a` is assigned from every named OpenStreetMap area, including areas
 * outside the drawn World. Only names in `map.lands` are mapped Zones. Every
 * other Place belongs to the active World without inventing a Zone.
 */
export function placeContext(poi, venue, map) {
  const zone = poi?.a && map?.lands?.some((land) => land.n === poi.a) ? poi.a : null;
  return zone
    ? { kind: 'zone', name: zone }
    : venue?.name
      ? { kind: 'world', name: venue.name }
      : null;
}
