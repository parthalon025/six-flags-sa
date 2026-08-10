/**
 * Imagery-surveyed geometry and places that OpenStreetMap does not carry.
 *
 * Unlike a traced park map — which needs a georeferenced fit — an imagery
 * dataset is a GeoJSON file whose features were read off orthophotos or other
 * aerial sources and signed with a `src` block. Paths land in `map.path` and
 * join the routing graph; rides and other places are added only when nothing
 * of the same name is already here.
 */

/** Metres between two lat/lngs at the scale of one venue. */
const metresBetween = (a, b) => {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110540);
};

/**
 * The provenance block on a feature, or nothing if the feature makes no claim.
 *
 * Required rather than minted: an unsigned coordinate is refused, for the same
 * reason traced pins without a fit error are refused.
 */
export function imagerySrc(props, stamp) {
  if (props?.src?.by) return props.src;
  if (stamp?.by) return { ...stamp, ...(props.note ? { note: props.note } : {}) };
  return null;
}

/**
 * Fold an imagery GeoJSON into a venue in progress.
 *
 * Feature kinds (via `kind` or `layer`):
 *   path / route  — LineString into `layers.path` (walkable immediately)
 *   ride          — Point with `c: ride|coaster`, added when not a duplicate
 *   place         — Point with `c` set, added or patched by name
 *
 * @returns counts and anything that was skipped, for the build log
 */
export function applyImagery(pois, layers, collection, { metres = 15 } = {}) {
  const features = collection?.features || [];
  const stamp = collection?.properties?.imagery;
  const out = { paths: 0, rides: 0, places: 0, skipped: [], duplicates: [] };
  if (!features.length) return out;

  const byName = new Map();
  for (const p of pois) {
    const key = String(p.n).toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }

  const nearDuplicate = (at, category) =>
    pois.some(
      (p) => p.c === category && metresBetween(at, p) < metres,
    );

  for (const f of features) {
    const props = f.properties || {};
    const geom = f.geometry || {};
    const kind = props.kind || props.layer;
    const label = props.n || props.name || props.of || 'a feature';
    const src = imagerySrc(props, stamp);

    if (kind === 'path' || kind === 'route' || props.layer === 'path') {
      if (geom.type !== 'LineString' || (geom.coordinates || []).length < 2) {
        out.skipped.push(`${label}: not a line`);
        continue;
      }
      if (!src) {
        out.skipped.push(`${label}: no src block`);
        continue;
      }
      layers.path.push({
        n: props.n || props.name || '',
        r: geom.coordinates.map(([lng, lat]) => [lng, lat]),
        src,
      });
      out.paths += 1;
      continue;
    }

    if (geom.type !== 'Point') {
      out.skipped.push(`${label}: not a point`);
      continue;
    }

    if (!src) {
      out.skipped.push(`${label}: no src block`);
      continue;
    }

    const [lng, lat] = geom.coordinates;
    const at = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
    const category = props.c || (kind === 'ride' ? 'ride' : kind === 'coaster' ? 'coaster' : 'landmark');
    const { kind: _k, layer: _l, name: _name, ...rest } = props;
    const display = props.n || props.name || 'Unnamed';

    if (category === 'ride' || category === 'coaster') {
      const existing = byName.get(String(display).toLowerCase());
      if (existing?.length) {
        out.duplicates.push(display);
        continue;
      }
      if (nearDuplicate(at, category)) {
        out.duplicates.push(display);
        continue;
      }
      const made = { n: display, c: category, ...rest, ...at };
      pois.push(made);
      byName.set(String(display).toLowerCase(), [made]);
      out.rides += 1;
      continue;
    }

    const existing = byName.get(String(display).toLowerCase());
    if (existing) {
      for (const t of existing) Object.assign(t, rest, at);
    } else {
      const made = { n: display, c: category, ...rest, ...at };
      pois.push(made);
      byName.set(String(display).toLowerCase(), [made]);
    }
    out.places += 1;
  }

  return out;
}
