/**
 * Map-facing GPS — keeps the real fix for intake and sharing, but shows the
 * visitor at the park entrance when they are not on site yet.
 */

import { arrivalPointForVenue } from '../venue/arrival.js';
import { withinBounds } from '../venue/store.js';
import { positionForMap } from './smooth.js';

/**
 * @param {{
 *   position: object | null,
 *   pois?: object[],
 *   bounds?: { north: number, south: number, east: number, west: number } | null,
 *   graph?: object | null,
 *   walking?: boolean,
 * }} opts
 */
export function mapDisplayPosition({ position, pois = [], bounds = null, graph = null, walking = false } = {}) {
  if (!position) return null;

  if (position.manual) {
    return positionForMap({ position, graph, bounds, walking });
  }

  const inside = bounds && withinBounds(bounds, position.lat, position.lng);
  if (inside) {
    return positionForMap({ position, graph, bounds, walking });
  }

  const arrival = arrivalPointForVenue(pois, bounds);
  if (!arrival) return position;

  const mock = {
    lat: arrival.lat,
    lng: arrival.lng,
    acc: position.acc ?? null,
    ts: position.ts,
    manual: false,
    arrival: true,
    arrivalLabel: arrival.label,
  };

  return positionForMap({ position: mock, graph, bounds, walking });
}
