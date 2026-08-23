/**
 * The MapLibre adapter for the map view seam (lib/mapView.js).
 *
 * Everything here is translation: a band plan becomes layer visibility, a
 * camera becomes jumpTo/easeTo, an Overlay becomes GeoJSON sources, a screen
 * point becomes a queryRenderedFeatures. No decision this file makes is about
 * the map — which band to draw, what tilt to hold, what a picked id means all
 * live on the other side of the seam, which is what lets those be tested
 * without a browser and lets a second renderer answer the same questions.
 *
 * One thing it does own: readiness. MapLibre cannot be told anything about its
 * sources until it has loaded a style, and the seam should not have to know
 * that, so calls that arrive early are queued and replayed on load.
 */
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
import { BANDS } from '@party-tracker/shared/zoomBands.js';
import { OVERLAY_LAYERS } from './overlayGeo.js';
import { constrainCameraPitch, mapWritesForCamera } from './mapViewCameraApply.js';
import { worldLodVisibility } from './worldLod.js';
import {
  bandLayer,
  bandedWorldStyle,
  OVERLAY_SOURCES,
  PLACES_LAYER,
  worldLayer,
} from './mapViewStyle.js';

/** Same-origin worker the spike route already serves. Turbopack rewrites
 *  maplibre-gl's `import.meta.url` to a non-http value, so the default
 *  worker URL is empty and `new Map` never reaches `load`. */
/** Among overlapping place hit-targets, the nearest geometry wins — not
 *  source order. Park-wide ride discs sit on top of each other; first-in-
 *  layer was opening Castaway Cove when the tap was on Aruba Tuba. */
export function closestPlaceId(features, point, project) {
  let bestId = null;
  let bestD = Infinity;
  for (const feature of features || []) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const at = project?.({ lng: coords[0], lat: coords[1] });
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
    const d = (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
    if (d >= bestD) continue;
    bestD = d;
    bestId = feature.properties?.id ?? feature.id ?? null;
  }
  return bestId;
}

const MAPLIBRE_WORKER_URL = '/api/display-spike/maplibre-gl-worker.mjs';
let workerPointed = false;
function ensureMapLibreWorker() {
  if (workerPointed) return;
  setWorkerUrl(MAPLIBRE_WORKER_URL);
  workerPointed = true;
}

/**
 * A renderer for mountMapView().
 *
 * @param {object} options
 * @param {(error: Error) => void} [options.onError] told about MapLibre's own
 *   failures, which arrive asynchronously and belong to the caller's UI.
 * @param {(camera: {center: {lng: number, lat: number}, zoom: number, bearing: number}) => void}
 *   [options.onCameraMoved] fires when the *guest* moves the camera — a pinch
 *   or a drag. Hand it back through the view's setCamera so the band chooser
 *   hears about it; the seam drops a camera it is already at, so the round
 *   trip settles rather than echoing.
 * @param {(tap: {point: {x: number, y: number}, lngLat: {lng: number, lat: number}}) => void}
 *   [options.onTap] a tap on the map, in both currencies: the screen point to
 *   hand the seam's `hitTest`, and the ground it landed on. Unprojecting is
 *   the engine's job and only the engine can do it — which is why the tap
 *   comes out here rather than the seam growing an `unproject`.
 */
function applyWorldLod(map, groups) {
  const vis = worldLodVisibility(groups);
  for (const [key, visible] of Object.entries(vis)) {
    const id = key === 'path-case' ? `${worldLayer('path')}-case` : worldLayer(key);
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

export function createMapLibreRenderer({ onError = null, onCameraMoved = null, onTap = null, onLoad = null } = {}) {
  let map = null;
  let loaded = false;
  const queued = [];

  const whenLoaded = (fn) => {
    if (loaded && map) fn(map);
    else queued.push(fn);
  };

  const setData = (source, data) =>
    whenLoaded((m) => m.getSource(source)?.setData(data));

  const paint = (plan) =>
    whenLoaded((m) => {
      for (const band of BANDS) {
        const layer = bandLayer(band.id);
        if (!m.getLayer(layer)) continue;
        m.setLayoutProperty(layer, 'visibility', plan.draw.includes(band.id) ? 'visible' : 'none');
      }
      applyWorldLod(m, plan.worldLod);
    });

  return {
    engine: () => map,

    attach(container, view) {
      ensureMapLibreWorker();
      if (typeof view.pitchAt !== 'function') {
        throw new Error(
          'MapLibre renderer needs view.pitchAt so derived pitch lands in the same '
            + 'transform as a pinch — setPitch is jumpTo, and jumpTo stops the gesture',
        );
      }
      map = new MapLibreMap({
        container,
        style: bandedWorldStyle(view),
        center: [view.camera.center.lng, view.camera.center.lat],
        zoom: view.camera.zoom,
        pitch: view.camera.pitch,
        bearing: view.camera.bearing,
        attributionControl: false,
        transformCameraUpdate: constrainCameraPitch(view.pitchAt),
      });
      map.on('error', (event) => onError?.(event?.error ?? new Error('MapLibre error')));
      map.on('load', () => {
        loaded = true;
        while (queued.length > 0) queued.shift()(map);
        onLoad?.();
      });
      // Every move, gesture or ours, and continuously rather than at the end
      // of one: the tilt has to track a pinch as it happens. Our own moves
      // come back through here too and that is fine — the seam drops a camera
      // it is already at, and pitch is not part of what it compares, so the
      // pitch this handler causes cannot cause another.
      map.on('move', () => {
        if (!map) return;
        if (!onCameraMoved) return;
        const centre = map.getCenter();
        onCameraMoved({
          center: { lng: centre.lng, lat: centre.lat },
          zoom: map.getZoom(),
          bearing: map.getBearing(),
        });
      });
      map.on('click', (event) => {
        onTap?.({
          point: { x: event.point.x, y: event.point.y },
          lngLat: { lng: event.lngLat.lng, lat: event.lngLat.lat },
        });
      });
      paint(view.plan);
      // Places are not seeded here. They arrive with the Overlay, through the
      // one conversion in lib/overlayGeo.js — a second conversion at attach is
      // how a Place ends up drawn in one position and tapped in another.
    },

    /** One jump or one ease, never a chain of setters. Each public setter
     *  is jumpTo, and jumpTo calls stop() — which is the pinch-killing hitch
     *  in the pitch-ease window. A pinch already wrote zoom/center/bearing,
     *  so that frame is a no-op; tilt is transformCameraUpdate's job. */
    camera(wanted) {
      if (!map) return;
      const centre = map.getCenter();
      const write = mapWritesForCamera(
        {
          center: { lng: centre.lng, lat: centre.lat },
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        },
        wanted,
      );
      // Pitch is omitted on purpose: transformCameraUpdate is the only writer,
      // so a jump or ease cannot drift from the curve the pinch already uses.
      const camera = {
        center: [wanted.center.lng, wanted.center.lat],
        zoom: wanted.zoom,
        bearing: wanted.bearing,
      };
      if (write.kind === 'ease') {
        map.easeTo({ ...camera, duration: wanted.ease.durationMs });
        return;
      }
      if (write.kind === 'jump') map.jumpTo(camera);
    },

    paint,

    /** One setData per collection, every time. The seam always hands over all
     *  of them — a collection left out of a frame would leave the last frame's
     *  features on screen with nothing to clear them. */
    overlay(model) {
      for (const name of OVERLAY_LAYERS) setData(OVERLAY_SOURCES[name], model[name]);
    },

    pick(point) {
      if (!map || !loaded || !map.getLayer(PLACES_LAYER)) return null;
      const features = map.queryRenderedFeatures([point.x, point.y], { layers: [PLACES_LAYER] });
      return closestPlaceId(features, point, ({ lng, lat }) => {
        const at = map.project([lng, lat]);
        return { x: at.x, y: at.y };
      });
    },

    project({ lng, lat } = {}) {
      if (!map || !loaded || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      const point = map.project([lng, lat]);
      return { x: point.x, y: point.y };
    },

    detach() {
      queued.length = 0;
      loaded = false;
      map?.remove();
      map = null;
    },
  };
}
