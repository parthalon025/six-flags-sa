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
      self: id === 'me',
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
