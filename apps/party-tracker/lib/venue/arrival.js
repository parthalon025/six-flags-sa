/**
 * Guest arrival point — where to drop the map pin when the phone is not on site.
 *
 * Real GPS is kept for intake and party sharing; this is only for drawing the
 * visitor on the loaded park map so they do not open into empty space.
 */

const ARRIVAL_IDS = ['main-entrance', 'entrance'];

const GUEST_PARKING = /main|preferred|general|guest|public|front|visitor/i;
const STAFF_PARKING = /staff|rv|bus|handicap|disabled|employee|service/i;

/**
 * @param {Array<{ i?: string, n?: string, lat?: number, lng?: number, c?: string }>} pois
 * @param {{ north: number, south: number, east: number, west: number } | null | undefined} bounds
 * @returns {{ lat: number, lng: number, label: string } | null}
 */
export function arrivalPointForVenue(pois = [], bounds = null) {
  const list = Array.isArray(pois) ? pois : [];

  for (const id of ARRIVAL_IDS) {
    const poi = list.find((p) => p.i === id && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (poi) return { lat: poi.lat, lng: poi.lng, label: poi.n || 'Entrance' };
  }

  const parking = list.find(
    (p) =>
      p.c === 'parking' &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      GUEST_PARKING.test(p.n || '') &&
      !STAFF_PARKING.test(p.n || ''),
  );
  if (parking) return { lat: parking.lat, lng: parking.lng, label: parking.n || 'Parking' };

  const gate = list.find(
    (p) => p.c === 'gate' && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  if (gate) return { lat: gate.lat, lng: gate.lng, label: gate.n || 'Entrance' };

  if (bounds) {
    return {
      lat: bounds.south + (bounds.north - bounds.south) * 0.08,
      lng: (bounds.east + bounds.west) / 2,
      label: 'Entrance',
    };
  }

  return null;
}
