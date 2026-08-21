/**
 * The live overlay, as GeoJSON.
 *
 * ADR-0019 clause 4 moves party members, Marks, quest nodes and routes out of
 * ParkMap.jsx's hand-rolled SVG and into MapLibre sources, so every element
 * projects through the one camera and takes its pitch, fade, collision and
 * zoom-density from the engine instead of from a second projection written by
 * hand. This is the data half of that move: model in, FeatureCollections out.
 *
 * Pure. No DOM, no map handle, and — deliberately — no clock: `now` is an
 * argument, because staleness is the only thing here that depends on time and
 * a function that reads Date.now() cannot be given a known answer.
 *
 * It is also meant to be the *one* place two conversions live. Both are
 * written out longhand today in `displayGeoJson`
 * (packages/venue-builder/lib/display-tiles.mjs) and in `placesGeoJson`
 * (apps/party-tracker/components/DisplayMap.jsx); both should end up calling
 * `lngLat` instead of keeping a third and fourth copy of these two rules:
 *
 *   1. GeoJSON is lng-first. Every coordinate in this app is lat-first —
 *      `{lat, lng}` on members, Places and pins, `[lat, lng]` pairs on
 *      `route.points`. Getting that backwards puts a guest in Antarctica.
 *   2. A coordinate that is not two finite numbers has to be *dropped*. The
 *      tempting fallback is `p.lng || 0`, which lands the feature at [0, 0] —
 *      the Gulf of Guinea — where it reads as a real fix rather than as
 *      missing data.
 *
 * `lngLat` below is both rules in one function; nothing in this file builds a
 * coordinate any other way.
 *
 * Relative and workspace `.js` imports only, like lib/spot.js, so the unit
 * suite can load this in plain Node without the bundler alias.
 */
import { partyMarkerState } from '@party-tracker/shared/mapSymbols.js';

/**
 * The overlay's sources, by name. A MapLibre geojson source is added once and
 * fed with `setData` from then on, so `overlayGeoJson` always answers with all
 * five: a key that disappeared when its list emptied would leave the previous
 * frame's features on screen with nothing left to clear them.
 */
export const OVERLAY_LAYERS = Object.freeze(['members', 'route', 'marks', 'pins', 'places']);

/**
 * A `{lat, lng}` record as a GeoJSON position, or null if it is not a place.
 *
 * @param {{lat: *, lng: *}|null|undefined} point
 * @returns {[number, number]|null} `[lng, lat]`
 */
export function lngLat(point) {
  const lat = point?.lat;
  const lng = point?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

/** The same rule for the `[lat, lng]` pairs `routing.js` builds routes from. */
function lngLatPair(pair) {
  if (!Array.isArray(pair)) return null;
  return lngLat({ lat: pair[0], lng: pair[1] });
}

/** A Point feature. `id` is mirrored into the properties because a geojson
 *  source only exposes an id to feature-state through `promoteId`, and
 *  `promoteId` reads a property. */
function pointFeature(id, coordinates, properties) {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates },
    properties: { id, ...properties },
  };
}

const collection = (features) => ({ type: 'FeatureCollection', features });

/** Anything not a finite number becomes null, so the payload survives JSON.
 *  `partyMarkerState` returns Infinity for an age it cannot bound, and
 *  `JSON.stringify(Infinity)` is `null` — better to say null on purpose than
 *  to have the serializer say it behind our back. */
const finiteOr = (value, fallback = null) => (Number.isFinite(value) ? value : fallback);

const textOr = (value, fallback = null) => (typeof value === 'string' && value ? value : fallback);

function memberFeatures(members, now) {
  const features = [];
  for (const member of members || []) {
    const coordinates = lngLat(member);
    if (!coordinates) continue;
    const { age, stale, help, facing } = partyMarkerState(member, now);
    features.push(
      pointFeature(member?.id ?? null, coordinates, {
        name: textOr(member?.name),
        initials: textOr(member?.initials),
        colour: textOr(member?.colour),
        kit: textOr(member?.kit),
        // The Place they were last seen at, flattened to its name: a symbol
        // layer can put a string in a text-field and cannot put an object.
        place: textOr(member?.place?.name),
        stale,
        help,
        ageMs: finiteOr(age),
        facing: finiteOr(facing),
      }),
    );
  }
  return features;
}

/**
 * The walking route as one LineString, not one feature per leg.
 *
 * One geometry is what lets a single line layer case and dash the whole route
 * in one pass, and it is what `line-gradient` needs to paint walked and
 * remaining in different ink from `properties.fraction` (that gradient also
 * needs `lineMetrics: true` on the source — the renderer's business, not
 * this file's).
 */
function routeFeatures(route, progress) {
  const coordinates = [];
  for (const pair of route?.points || []) {
    const position = lngLatPair(pair);
    if (position) coordinates.push(position);
  }
  // Two points is the least a LineString can be. Emitting a shorter one hands
  // MapLibre geometry it will reject on load.
  if (coordinates.length < 2) return [];

  const travelled = finiteOr(progress?.travelled);
  const remaining = finiteOr(progress?.remaining);
  const walked = travelled === null || remaining === null ? null : travelled + remaining;
  const fraction = walked ? Math.min(1, Math.max(0, travelled / walked)) : null;

  return [
    {
      type: 'Feature',
      id: 'route',
      geometry: { type: 'LineString', coordinates },
      properties: {
        id: 'route',
        legs: coordinates.length - 1,
        // How far along the party is. `leg` is the index routeProgress()
        // reports; null means nobody has started walking this one yet.
        leg: finiteOr(progress?.leg),
        travelledMetres: travelled,
        remainingMetres: remaining,
        fraction,
        arrived: Boolean(progress?.arrived),
        metres: finiteOr(route?.metres),
        seconds: finiteOr(route?.seconds),
        mode: textOr(route?.mode),
        via: textOr(route?.via),
      },
    },
  ];
}

/** Marks left at a Place carry no fix of their own — `world.js` makeMark()
 *  stores lat/lng null — so the Place list is where the coordinate comes from,
 *  exactly as ParkMap resolves it today. A Mark with neither is dropped. */
function markFeatures(marks, pois) {
  const features = [];
  for (const mark of marks || []) {
    const own = lngLat(mark);
    const place = own
      ? null
      : (pois || []).find((p) => p?.i === mark?.placeId || p?.id === mark?.placeId);
    const coordinates = own || lngLat(place);
    if (!coordinates) continue;
    features.push(
      pointFeature(mark?.id ?? null, coordinates, {
        type: textOr(mark?.type),
        phrase: textOr(mark?.phrase),
        placeId: textOr(mark?.placeId),
        opacity: finiteOr(mark?.opacity, 1),
      }),
    );
  }
  return features;
}

/**
 * Points somebody chose, rather than Places the park has: the Rally Point, a
 * named patch of ground, the car, and Overlay's own queue pins and path
 * crumbs. One source, told apart by `properties.kind`, so the style picks the
 * icon and this file does not.
 */
function pinFeatures({ meet, spot, car, overlayPins }) {
  const features = [];
  const push = (id, kind, point, label) => {
    const coordinates = lngLat(point);
    if (!coordinates) return;
    features.push(pointFeature(id, coordinates, { kind, label: textOr(label) }));
  };
  push('meet', 'meet', meet, meet?.label);
  push('spot', 'spot', spot, spot?.name ?? spot?.label);
  push('car', 'car', car, car?.label);
  for (const pin of overlayPins || []) {
    push(pin?.id ?? null, textOr(pin?.kind, 'fact'), pin, pin?.label);
  }
  return features;
}

/** The venue's Places. `name`, `category` and `land` are named to match what
 *  display-tiles.mjs `displayGeoJson` bakes into the pack's own places layer,
 *  so a style written against one mostly reads the other; that adapter calls
 *  its identity field `key` rather than `id`, which is the one difference and
 *  worth settling when the two converge. */
function placeFeatures(pois) {
  const features = [];
  for (const poi of pois || []) {
    const coordinates = lngLat(poi);
    if (!coordinates) continue;
    features.push(
      pointFeature(poi?.i ?? poi?.id ?? null, coordinates, {
        name: textOr(poi?.n ?? poi?.name),
        category: textOr(poi?.c ?? poi?.category),
        land: textOr(poi?.a ?? poi?.land),
      }),
    );
  }
  return features;
}

/**
 * Build the overlay's five FeatureCollections.
 *
 * @param {object|null} model
 * @param {Array}  [model.members]      roster rows — `{id, name, lat, lng, ts, ...}`
 * @param {object} [model.route]        a `routing.js` route — `{points: [[lat, lng]], metres, ...}`
 * @param {object} [model.progress]     `routeProgress()`'s answer, or null before the walk starts
 * @param {Array}  [model.marks]        `visibleMarks()` output
 * @param {Array}  [model.pois]         the venue's Places, also used to place Marks left at one
 * @param {object} [model.meet]         Rally Point — `{lat, lng, label}`
 * @param {object} [model.spot]         a named patch of ground — see lib/spot.js
 * @param {object} [model.car]          where the car is
 * @param {Array}  [model.overlayPins]  Overlay's queue pins and path crumbs
 * @param {object} options
 * @param {number} options.now          milliseconds since epoch, for staleness
 * @returns {{members: object, route: object, marks: object, pins: object, places: object}}
 */
export function overlayGeoJson(model, { now } = {}) {
  if (!Number.isFinite(now)) {
    throw new TypeError('overlayGeoJson needs a finite `now` in ms — it must not read the clock itself');
  }
  return {
    members: collection(memberFeatures(model?.members, now)),
    route: collection(routeFeatures(model?.route, model?.progress)),
    marks: collection(markFeatures(model?.marks, model?.pois)),
    pins: collection(pinFeatures(model || {})),
    places: collection(placeFeatures(model?.pois)),
  };
}
