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

/** Live overlay kinds ADR-0012 never drops a name for. Places are the
 *  crowded set; everything else (Members, Meet, the car) is sparse. */
const isPinnedKind = (kind) => kind && kind !== 'place';

export const PLACE_LABEL_SIZE = 16;
export const PIN_LABEL_SIZE = 15;
/* Below the disc, with a gap: a 16px name centred on y+LABEL_DY has its
   top clear of the drawn r=8 circle, so the box never claims its own pin.
   The renderer reads the same export — two offsets is two truths. */
export const LABEL_DY = 24;
const ICON_R = 8;

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
  const size = mark.kind === 'place' ? PLACE_LABEL_SIZE : PIN_LABEL_SIZE;
  const halfW = Math.max(8, textWidth(mark.name || '', size) / 2 + 2);
  return boxAround(mark.x, mark.y + LABEL_DY, halfW, size * 0.55);
}

/**
 * Decide which marks print a name.
 *
 * Markers stay. Names are zoom-gated (rank 1 first) and collision-thinned
 * (lower `markerDeclutterPriority` wins). Without a layout, Members / Meet /
 * car stay named and Places stay quiet — the safe default for a park-wide
 * opening camera.
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
  const list = (marks || []).map((mark) => ({ ...mark, label: false }));
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

  for (const mark of list) grid.claim(iconBox(mark), true);

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
    if (!markerWantsLabel({
      isSelected: mark.id === selectedId,
      isNav,
      isPlanNext,
      rank: symbolFor(mark.category).rank,
      zPlan,
      wasShown: shown.has(mark.id),
    })) continue;
    tryLabel(mark, isNav || isPlanNext);
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
 * @returns {{ kind: string, className: string, id: *, name: string, self: boolean, x: number, y: number }[]}
 */
export function overlayMarks(overlay, project) {
  const marks = [];
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
      label: false,
      x: point.x,
      y: point.y,
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
      label: true,
      x: point.x,
      y: point.y,
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
      label: true,
      x: point.x,
      y: point.y,
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

  return { marks: layoutOverlayLabels(overlayMarks(overlay, project), extras.layout), paths, cone };
}
