/**
 * Overlay features as screen marks.
 *
 * Positions come from the map's own `project` — one camera, not a second
 * projection. The caller paints; this module only names what to paint.
 *
 * Place *names* are a second decision. Drawing every title at park-wide zoom
 * is the ransom-note map: 150 strings stacked on the same few hundred pixels.
 * `layoutOverlayLabels` applies the shared zoom ranks and the Declutter grid
 * so a name appears only when it has earned the zoom and the space.
 */
import { planZoom, symbolFor } from '@party-tracker/shared/mapSymbols.js';
import { metresPerPixel } from '@party-tracker/shared/zoomBands.js';
import { Declutter, boxAround, onScreen, textWidth } from './mapLabels.js';
import { markerDeclutterPriority, markerWantsLabel } from './mapVisual.js';

/** Kinds that keep a name without earning zoom. Places are the crowded
 *  set. Members, Meet, the car, and World Zones are sparse enough to pin. */
const isPinnedKind = (kind) => kind && kind !== 'place';

export const PLACE_LABEL_SIZE = 16;
export const PIN_LABEL_SIZE = 15;
export const ZONE_LABEL_SIZE = 14;
/* Below the disc, with a gap: a 16px name centred on y+LABEL_DY has its
   top clear of the drawn r=8 circle, so the box never claims its own pin.
   The renderer reads the same export — two offsets is two truths. */
export const LABEL_DY = 24;
const ICON_R = 8;

const KIND_LABEL = Object.freeze({
  zone: Object.freeze({ size: ZONE_LABEL_SIZE, dy: 0, className: 'landLabel', drawsPin: false }),
  place: Object.freeze({ size: PLACE_LABEL_SIZE, dy: LABEL_DY, className: 'poiLabel', drawsPin: true }),
});
const DEFAULT_KIND_LABEL = Object.freeze({
  size: PIN_LABEL_SIZE,
  dy: LABEL_DY,
  className: 'memName',
  drawsPin: true,
});

/** Paint facts for one mark kind — size, offset, class, and whether it is a pin. */
export function markLabelStyle(kind) {
  return KIND_LABEL[kind] || DEFAULT_KIND_LABEL;
}

/** px/m scale `labelWantedAtZoom` reads, from a MapLibre zoom. */
export function labelPlanZoom(zoom, latitude) {
  if (!Number.isFinite(zoom)) return 0;
  const mpp = metresPerPixel(zoom, { latitude: Number.isFinite(latitude) ? latitude : 0 });
  if (!Number.isFinite(mpp) || mpp <= 0) return 0;
  return planZoom(1 / mpp);
}

function iconBox(mark) {
  return boxAround(mark.x, mark.y, ICON_R, ICON_R);
}

function labelBox(mark) {
  const { size, dy } = markLabelStyle(mark.kind);
  const halfW = Math.max(8, textWidth(mark.name || '', size) / 2 + 2);
  return boxAround(mark.x, mark.y + dy, halfW, size * 0.55);
}

/**
 * Decide which marks print a name.
 *
 * Markers stay. Names are zoom-gated (rank 1 first) and collision-thinned
 * (lower `markerDeclutterPriority` wins). Without a layout, Members / Meet /
 * car / Zones stay named and Places stay quiet. With a layout, ride and
 * coaster names also print — they are the park-wide destination layer.
 *
 * @param {Array} marks `overlayMarks()` output
 * @param {object|null} [layout]
 * @param {number} [layout.zoom]
 * @param {number} [layout.latitude]
 * @param {number} [layout.width]
 * @param {number} [layout.height]
 * @param {Iterable} [layout.shownIds]
 * @param {*} [layout.navId]
 * @param {*} [layout.planNextId]
 * @param {*} [layout.selectedId]
 */
export function layoutOverlayLabels(marks, layout = null) {
  const list = (marks || []).map((mark) => ({
    ...mark,
    label: false,
    pin: mark.kind !== 'zone',
  }));
  if (!layout) {
    for (const mark of list) {
      if (isPinnedKind(mark.kind) && mark.name) mark.label = true;
    }
    return list;
  }

  const { zoom, latitude, width, height, shownIds, navId, planNextId, selectedId } = layout;
  const zPlan = labelPlanZoom(zoom, latitude);
  const shown = shownIds instanceof Set ? shownIds : new Set(shownIds || []);
  const grid = new Declutter();
  const hasViewport = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  const visible = (box) => !hasViewport || onScreen(box, width, height);

  for (const mark of list) {
    // Place discs are dense at park-wide. Claiming every one vetoes ride
    // names — the destination layer — so only live pins reserve their box.
    if (mark.kind === 'place' || mark.kind === 'zone') continue;
    grid.claim(iconBox(mark), true);
  }

  const tryLabel = (mark, pinned) => {
    if (!mark.name) return;
    const box = labelBox(mark);
    if (!visible(box)) return;
    if (grid.claim(box, pinned)) mark.label = true;
  };

  for (const mark of list) {
    if (isPinnedKind(mark.kind)) tryLabel(mark, true);
  }

  const priorityOf = ({ mark, index }) => markerDeclutterPriority({
    isSelected: mark.id === selectedId,
    isNav: mark.id === navId,
    isPlanNext: mark.id === planNextId,
    rank: symbolFor(mark.category).rank,
    index,
  });
  const places = list
    .map((mark, index) => ({ mark, index }))
    .filter(({ mark }) => mark.kind === 'place')
    .sort((a, b) => priorityOf(a) - priorityOf(b));

  for (const { mark } of places) {
    const isNav = mark.id === navId;
    const isPlanNext = mark.id === planNextId;
    const wanted = {
      isNav,
      isPlanNext,
      rank: symbolFor(mark.category).rank,
      zPlan,
      wasShown: shown.has(mark.id),
      category: mark.category,
    };
    if (!markerWantsLabel({ ...wanted, isSelected: mark.id === selectedId })) {
      mark.pin = isNav || isPlanNext || mark.id === selectedId;
      continue;
    }
    tryLabel(mark, isNav || isPlanNext);
    // A disc without a name is the black mass. Named rides keep a pin;
    // Go / Plan / selection keep one even when the sheet holds the title.
    mark.pin = mark.label || isNav || isPlanNext || mark.id === selectedId;
  }

  return list;
}

function projectPoint(project, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const point = project?.({ lng, lat });
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return point;
}

/**
 * @param {object} overlay overlayGeoJson's five collections
 * @param {(lngLat: {lng: number, lat: number}) => {x: number, y: number}|null} project
 * @returns {{ kind: string, className: string, id: *, name: string, category?: string|null, self: boolean, label: boolean, x: number, y: number }[]}
 */
function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 1) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = ring.length > 1
    && Array.isArray(first) && Array.isArray(last)
    && first[0] === last[0] && first[1] === last[1];
  const verts = closed ? ring.slice(0, -1) : ring;
  let lng = 0;
  let lat = 0;
  let n = 0;
  for (const pair of verts) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) continue;
    lng += pair[0];
    lat += pair[1];
    n += 1;
  }
  if (!n) return null;
  return [lng / n, lat / n];
}

export function overlayMarks(overlay, project, extras = {}) {
  const marks = [];
  for (const feature of extras.lands?.features || []) {
    const name = feature.properties?.name;
    if (!name) continue;
    const ring = feature.geometry?.coordinates?.[0];
    const point = projectPoint(project, ringCentroid(ring));
    if (!point) continue;
    marks.push({
      kind: 'zone',
      className: 'landMarker',
      id: `zone:${name}`,
      name,
      self: false,
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
  }
  for (const feature of overlay?.places?.features || []) {
    const point = projectPoint(project, feature.geometry?.coordinates);
    if (!point) continue;
    marks.push({
      kind: 'place',
      className: 'poiMarker',
      id: feature.properties?.id ?? feature.id,
      name: feature.properties?.name || '',
      category: feature.properties?.category || null,
      self: false,
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
  }
  for (const feature of overlay?.members?.features || []) {
    const point = projectPoint(project, feature.geometry?.coordinates);
    if (!point) continue;
    const id = feature.properties?.id ?? feature.id;
    marks.push({
      kind: 'member',
      className: 'memMarker',
      id,
      name: feature.properties?.name || '',
      self: Boolean(feature.properties?.self) || id === 'me',
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
  }
  for (const feature of overlay?.pins?.features || []) {
    const point = projectPoint(project, feature.geometry?.coordinates);
    if (!point) continue;
    const kind = feature.properties?.kind || 'pin';
    marks.push({
      kind,
      className: kind === 'meet' ? 'meetPin' : 'mapPin',
      id: feature.properties?.id ?? feature.id,
      name: feature.properties?.label || '',
      self: false,
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
  }
  return marks;
}

function pathFromLngLat(coordinates, project) {
  const pts = [];
  for (const pair of coordinates || []) {
    const point = projectPoint(project, pair);
    if (point) pts.push(point);
  }
  if (pts.length < 2) return null;
  return `M${pts[0].x} ${pts[0].y}${pts.slice(1).map((p) => `L${p.x} ${p.y}`).join('')}`;
}

function latLngToLngLat(points) {
  const out = [];
  for (const pair of points || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    out.push([pair[1], pair[0]]);
  }
  return out;
}

/**
 * Route, walked-behind and alternative lines, plus the heading cone — the
 * same `project` the marks use, so a route and a party dot cannot disagree.
 *
 * @param {object} overlay
 * @param {(lngLat: {lng: number, lat: number}) => {x: number, y: number}|null} project
 * @param {object} [extras]
 * @param {Array} [extras.alternatives] other routes (`points` are lat-first)
 * @param {Array} [extras.routeDone] walked `[lat, lng]` pairs
 * @param {{lat: number, lng: number, course?: number}|null} [extras.puck]
 * @param {number} [extras.heading] compass heading; wins over course
 * @param {number} [extras.rotation] map bearing in degrees
 * @param {object} [extras.layout] handed to `layoutOverlayLabels` — zoom,
 *   latitude, width, height, shownIds, navId, planNextId, selectedId
 * @param {object} [extras.lands] World `lands` FeatureCollection — named Zones
 */
export function overlayChrome(overlay, project, extras = {}) {
  const paths = [];
  for (const feature of overlay?.route?.features || []) {
    const d = pathFromLngLat(feature.geometry?.coordinates, project);
    if (!d) continue;
    const direct = feature.properties?.mode === 'direct';
    paths.push({
      id: feature.properties?.id ?? feature.id ?? 'route',
      className: direct ? 'routeLine direct' : 'routeLine',
      d,
    });
  }
  const done = pathFromLngLat(latLngToLngLat(extras.routeDone), project);
  if (done) paths.push({ id: 'route-done', className: 'routeDone', d: done });
  for (const alt of extras.alternatives || []) {
    const d = pathFromLngLat(latLngToLngLat(alt?.points), project);
    if (!d) continue;
    paths.push({ id: `alt-${alt.index ?? paths.length}`, className: 'altLine', d });
  }

  let cone = null;
  const puck = extras.puck;
  if (puck && Number.isFinite(puck.lat) && Number.isFinite(puck.lng)) {
    const point = projectPoint(project, [puck.lng, puck.lat]);
    if (point) {
      const rotation = Number.isFinite(extras.rotation) ? extras.rotation : 0;
      // Same source mapRotationDegrees uses: compass heading wins, then the
      // route course. A heading of 0 with a southbound course used to point
      // the cone the wrong way by 180°.
      const facing = Number.isFinite(extras.heading)
        ? extras.heading
        : Number.isFinite(puck.course)
          ? puck.course
          : rotation;
      // Overlay SVG is screen-aligned. Course-up already rotates the camera
      // by `rotation`, so facing − rotation is 0 — the wrap the walk suite
      // uses for "straight ahead". An extra 180° reads as 180° off.
      cone = {
        x: point.x,
        y: point.y,
        rotate: facing - rotation,
      };
    }
  }

  return {
    marks: layoutOverlayLabels(overlayMarks(overlay, project, extras), extras.layout),
    paths,
    cone,
  };
}
