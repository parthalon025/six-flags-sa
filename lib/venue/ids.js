/* Stable ids for a venue's places.
 *
 * A venue file is a flat list whose only stable field is the name, and names
 * are not unique — one park has ten "Restrooms". Anything that has to *address*
 * a place rather than merely draw it needs an id: a ride report on the wire, a
 * favourite, a target.
 *
 * The rule lives here alone because it has to produce the same answer in three
 * places that never share a module graph — the browser's venue store, the API
 * catalogue, and the standalone host in /server, which reads the venue file off
 * disk and cannot import a bundler-aliased path. An id that meant one thing on
 * a phone and another on the host it is talking to would land a "closed" report
 * on the wrong restroom.
 *
 * A repeat gets a numeric suffix in file order, which is stable as long as a
 * venue file is only appended to. Rebuilding a venue from OpenStreetMap can
 * move a handful of ids, which is why the name is accepted as a lookup key too.
 *
 * Relative and with the extension: /server and the unit suite import this into
 * bare node, where the '@/…' alias does not exist.
 */

export const slug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** @returns a new array of POIs, each with an `id`. Input is not mutated. */
export function withIds(pois) {
  const seen = new Map();
  return (pois || []).map((poi) => {
    const base = slug(poi.n) || 'poi';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n === 1 ? base : `${base}-${n}`, ...poi };
  });
}

/** Both the id and the lowercased name resolve, so a human can type either. */
export function indexById(pois) {
  const byId = new Map();
  for (const poi of pois) {
    byId.set(poi.id, poi);
    if (!byId.has(poi.n.toLowerCase())) byId.set(poi.n.toLowerCase(), poi);
  }
  return byId;
}
