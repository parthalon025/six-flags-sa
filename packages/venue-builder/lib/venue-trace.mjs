/**
 * Folding what was traced off a picture into the venue it belongs to.
 *
 * Four kinds of thing come out of a park's own map, and each of them lands
 * somewhere different:
 *
 *   entrance / exit  onto the ride they belong to, as `e` and `out`. A place
 *                    here has always been one point, and for a ride taken from
 *                    its track that point is the middle of the track — so
 *                    "walk me to Diamondback" walks you to the top of the lift
 *                    hill, over a fence, rather than to the back of the queue.
 *                    The ride keeps its own position for the map; the entrance
 *                    is where walking to it means.
 *   route            into the drawn paths, which is also the routing graph:
 *                    lib/routing.js welds `map.path` into the walkable network,
 *                    so a traced cut-through is routable the moment it lands,
 *                    with no other change anywhere.
 *   place            a new POI, for the things OpenStreetMap has not got at all.
 *
 * An entrance or an exit lands only if it carries the `src` block the tracer
 * stamped on it — the image, the model, and how far out the fit was — with
 * `by` translated to the one word the rest of the pipeline weighs a trace
 * under. That block is the difference between data and decoration: a pin
 * surveyed off a sign and a pin read off a drawing at nine metres of error are
 * different claims, and once they are in the same file with no way to tell
 * them apart, the second one has quietly become the first. So the block is
 * read off the feature rather than asserted by this file, and a point that
 * carries none is reported as skipped instead of being signed on its behalf.
 *
 * A traced *route* is not weighed by anything: it is geometry the router walks,
 * and it carries whatever the tracer said about it without this file adding to
 * it either way.
 */

import { tracedSrc } from './attractions.mjs';

/** Metres between two lat/lngs, near enough at the scale of one venue. */
const metresBetween = (a, b) => {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110540);
};

/**
 * Apply a traced GeoJSON to a venue in progress.
 *
 * @param pois    the places, mutated in place where a trace lands on one
 * @param layers  the drawn geometry, so routes can join `path`
 * @param traced  the parsed output of scripts/trace-venue.mjs
 * @returns what happened, in enough detail for the build to print it
 */
export function applyTrace(pois, layers, traced) {
  const features = traced?.features || [];
  const out = { entrances: 0, exits: 0, routes: 0, places: 0, unmatched: [], skipped: [] };
  if (!features.length) return out;

  /* The tracer signs every feature and signs the collection once, with the
     same block. Either will do — both are its own statement about the fit. */
  const stamp = traced?.properties?.traced;

  const byName = new Map();
  for (const p of pois) {
    const key = String(p.n).toLowerCase();
    if (byName.has(key)) byName.get(key).push(p);
    else byName.set(key, [p]);
  }

  for (const f of features) {
    const props = f.properties || {};
    const geom = f.geometry || {};
    const kind = props.kind;

    if (kind === 'route') {
      if (geom.type !== 'LineString' || (geom.coordinates || []).length < 2) {
        out.skipped.push(`${props.n || 'a route'}: not a line`);
        continue;
      }
      /* Into `path` rather than a layer of its own. A traced cut-through is a
         path — it is walked, it is drawn like one, and the router takes it from
         there. A new layer would have needed the renderer and the router both
         taught about it to do exactly what this does for nothing. */
      layers.path.push({
        n: props.n || '',
        r: geom.coordinates.map(([lng, lat]) => [lng, lat]),
        src: props.src || null,
      });
      out.routes += 1;
      continue;
    }

    if (geom.type !== 'Point') {
      out.skipped.push(`${props.n || props.of || 'a feature'}: not a point`);
      continue;
    }
    const [lng, lat] = geom.coordinates;
    const at = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };

    if (kind === 'entrance' || kind === 'exit') {
      const targets = byName.get(String(props.of).toLowerCase());
      if (!targets) {
        /* Named a ride this venue has not got. Said out loud rather than
           dropped, because it is the same failure as an override that lands on
           nothing — a correction that silently did not happen — and it has the
           same two causes: the park renamed the ride, or the trace has a typo. */
        out.unmatched.push(`${props.of} (${kind})`);
        continue;
      }
      /* A traced point that lands a long way from the ride it claims to belong
         to is a mis-click, not an entrance. Half a kilometre of park is enough
         rope; beyond that the pixel was almost certainly read off the wrong
         part of the drawing. */
      const far = targets.every((t) => metresBetween(at, t) > 500);
      if (far) {
        out.skipped.push(`${props.of}: its ${kind} traced ${Math.round(metresBetween(at, targets[0]))} m away`);
        continue;
      }
      /* The tracer's own block — image, model, error — kept whole, with `by`
         translated from the tool's word to the kind of source `WEIGHTS`
         scores it under, so a reader never has to know which writer it is
         talking to.

         Required, not minted. This used to stamp `by: 'traced'` onto whatever
         arrived, so a feature carrying no block at all was written into the
         bundle as a signed weight-3 coordinate with no image and no error —
         and `fromTrace` read it straight back as evidence on the next run. The
         signature is the difference between a pin surveyed off a sign and a
         pin read off a drawing at nine metres of error; inventing one makes
         the second into the first, quietly, in the file. */
      const src = tracedSrc(props, stamp);
      if (!src) {
        out.skipped.push(`${props.of}: its ${kind} carries no src block, so there is nothing to weigh it as`);
        continue;
      }
      for (const t of targets) {
        if (kind === 'exit') {
          t.out = { ...at, src };
          continue;
        }
        /* Into `e`, beside whatever the builder derived from a named one-way
           queue, rather than into a second field of its own. One concept, one
           place to read it — the app takes the first entrance and does not want
           to learn that a traced one lives somewhere else. Replaces an entry
           from the same kind of source rather than stacking, so re-running a
           trace corrects rather than accreting. */
        const kept = (t.e || []).filter((x) => x.src?.by !== src.by);
        t.e = [{ ...at, n: props.n || `${props.of} entrance`, src }, ...kept];
      }
      out[kind === 'entrance' ? 'entrances' : 'exits'] += 1;
      continue;
    }

    // A place OpenStreetMap has not got. Merged onto one of the same name if
    // there is one, so re-running a trace corrects rather than duplicates.
    const existing = byName.get(String(props.n || '').toLowerCase());
    const { kind: _kind, of: _of, ...rest } = props;
    if (existing) {
      for (const t of existing) Object.assign(t, rest, at);
    } else {
      const made = { n: props.n || 'Unnamed', c: props.c || 'landmark', ...rest, ...at };
      pois.push(made);
      byName.set(String(made.n).toLowerCase(), [made]);
    }
    out.places += 1;
  }

  return out;
}
