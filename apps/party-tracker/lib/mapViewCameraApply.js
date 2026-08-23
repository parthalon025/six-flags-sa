/**
 * How the MapLibre adapter writes a camera the seam already decided.
 *
 * MapLibre's public setters (setPitch, setZoom, setCenter, setBearing) all
 * go through jumpTo(), and jumpTo() begins with stop(). stop() kills an
 * in-flight pinch. The only derived field during a pinch is pitch — so a
 * setPitch on every move event inside the staged ease (ADR-0021 clause 4)
 * is a gesture-killing hitch in that zoom window, then a return to normal
 * once pitch is constant and the setter is skipped.
 *
 * Two answers, both pure:
 *
 *   mapWritesForCamera — whether this frame may jump, ease, or do nothing.
 *   A pinch already applied zoom/center/bearing; that frame is nothing.
 *
 *   constrainCameraPitch — the transformCameraUpdate that folds derived
 *   pitch into the *same* transform as the gesture, so the tilt still
 *   tracks zoom without a second jump.
 */
export function mapWritesForCamera(held, wanted) {
  if (wanted?.ease) return { kind: 'ease' };
  const samePlace = held.center.lng === wanted.center.lng
    && held.center.lat === wanted.center.lat
    && held.zoom === wanted.zoom
    && held.bearing === wanted.bearing;
  if (samePlace) return { kind: 'none' };
  return { kind: 'jump' };
}

/** MapLibre's transformCameraUpdate: overwrite pitch, leave the rest. */
export function constrainCameraPitch(pitchAt) {
  if (typeof pitchAt !== 'function') {
    throw new Error('constrainCameraPitch needs the seam\'s pitchAt(zoom)');
  }
  return (next) => ({ pitch: pitchAt(next.zoom) });
}
