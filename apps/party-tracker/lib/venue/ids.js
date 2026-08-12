/* Stable ids for a venue's places.
 *
 * A place has two strings and they are not the same string. `i` is its key —
 * what a ride report on the wire, a favourite and a nav target are addressed
 * by. `n` is its title — what a visitor reads. A park renaming a ride changes
 * the title and must not change the key, because an edit is filed under the key
 * and an edit whose key moved is not moved, it is lost.
 *
 * The key is issued at build time and written into the bundle, from a ledger
 * committed beside the venue's overrides file. See scripts/lib/venue-ids.mjs
 * for how a rebuild matches a place back to the number it already had; nothing
 * about that reaches a phone, which only ever reads `i`.
 *
 * The rule lives here alone because it has to produce the same answer in three
 * places that never share a module graph — the browser's venue store, the API
 * catalogue, and the standalone host in /server, which reads the venue file off
 * disk and cannot import a bundler-aliased path. An id that meant one thing on
 * a phone and another on the host it is talking to would land a "closed" report
 * on the wrong restroom.
 *
 * ## The fallback, and what it cannot do
 *
 * A venue built before keys existed carries no `i`, and those bundles still
 * have to load — a phone updates its app long before it updates its precached
 * map. So a place with no key gets the old rule: `slug(n)`, and a numeric
 * suffix counted off in file order for a repeat.
 *
 * That fallback is a way of not crashing, not a stability guarantee, and this
 * is the honest statement of its limits: an id it produces moves when the place
 * is renamed, moves when the file is reordered, and moves when a place earlier
 * in the file with the same name is added or removed. It is exactly the
 * behaviour this module was written to stop relying on. The only thing that
 * makes it safe today is that a bundle on disk is a fixed file. Rebuild that
 * venue and the keys become real; until then, treat an unkeyed venue's ids as
 * valid for as long as nobody touches the bundle.
 *
 * Where the two mix, the keys win and the fallback steps around them, so a
 * hand-added place in an otherwise keyed venue cannot collide with a real key.
 *
 * Relative and with the extension: /server and the unit suite import this into
 * bare node, where the '@/…' alias does not exist.
 */

export const slug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The key a place was issued, or null if it was built before there were any. */
export const keyOf = (poi) =>
  poi && typeof poi.i === 'string' && poi.i ? poi.i : null;

/** The title a place is displayed under. Never an identity — see the header. */
export const titleOf = (poi) => (poi ? String(poi.n ?? '') : '');

/** Identity for list keys and label hysteresis. Never the printed title alone —
 *  a park has dozens of "Restrooms", and a React key of the title leaves SVG
 *  text stuck on screen while the map pans. Prefers the issued key, then the
 *  withIds fallback, then a coordinate suffix so an unkeyed bundle still
 *  paints without ghost labels. */
export const identityOf = (poi) => {
  if (!poi) return '';
  const issued = keyOf(poi);
  if (issued) return issued;
  if (typeof poi.id === 'string' && poi.id) return poi.id;
  const title = titleOf(poi);
  const lat = poi.lat;
  const lng = poi.lng;
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${title}@${lat},${lng}`;
  return title;
};

/** True when two records are the same Place, not merely the same title. */
export const samePlace = (a, b) => Boolean(a && b && identityOf(a) && identityOf(a) === identityOf(b));

/**
 * Resolve a place from a list. `ref` may be an issued id, a title, or a
 * place-like / nav object (`placeId`, `i`, `id`, `n`, `label`). Identity
 * wins; title is only the fallback for older payloads that carried a label
 * and no id.
 */
export function findPlace(pois, ref) {
  const list = pois || [];
  if (ref == null || ref === '') return null;
  const id =
    typeof ref === 'string'
      ? ref
      : ref.placeId || identityOf(ref) || '';
  if (id) {
    const byId = list.find((p) => identityOf(p) === id || p.i === id || p.id === id);
    if (byId) return byId;
  }
  const title = typeof ref === 'string' ? ref : titleOf(ref) || ref.label || '';
  if (!title) return null;
  return list.find((p) => p.n === title) || null;
}

/** Nav payload for walking to a place. Carries `placeId` so two restrooms
 *  with the same title do not resolve to the first one in the file. */
export function placeNav(poi) {
  if (!poi) return null;
  return {
    kind: 'poi',
    label: titleOf(poi),
    lat: poi.lat,
    lng: poi.lng,
    placeId: identityOf(poi),
  };
};

/** @returns a new array of POIs, each with an `id`. Input is not mutated. */
export function withIds(pois) {
  const list = pois || [];
  /* Reserved before anything is derived, so a fallback id can never be handed
     a name that a real key downstream already owns. */
  const taken = new Set();
  for (const poi of list) {
    const key = keyOf(poi);
    if (key) taken.add(key);
  }
  const seen = new Map();
  return list.map((poi) => {
    const key = keyOf(poi);
    if (key) return { id: key, ...poi };
    const base = slug(poi.n) || 'poi';
    let n = (seen.get(base) ?? 0) + 1;
    let id = n === 1 ? base : `${base}-${n}`;
    while (taken.has(id)) {
      n += 1;
      id = `${base}-${n}`;
    }
    seen.set(base, n);
    taken.add(id);
    return { id, ...poi };
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
