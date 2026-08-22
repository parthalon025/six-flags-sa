/**
 * Overlay features as screen marks.
 *
 * Positions come from the map's own `project` — one camera, not a second
 * projection. The caller paints; this module only names what to paint.
 */

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
      self: false,
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
      id: 'route',
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
    const point = project?.({ lng: puck.lng, lat: puck.lat });
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
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

  return { marks: overlayMarks(overlay, project), paths, cone };
}
