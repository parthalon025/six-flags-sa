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
import { Map as MapLibreMap } from 'maplibre-gl';
import { BANDS } from '@party-tracker/shared/zoomBands.js';
import {
  bandLayer,
  bandedWorldStyle,
  lineCollection,
  OVERLAY_SOURCES,
  PLACES_SOURCE,
  pointCollection,
} from './mapViewStyle.js';

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
 */
export function createMapLibreRenderer({ onError = null, onCameraMoved = null } = {}) {
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
    });

  return {
    attach(container, view) {
      map = new MapLibreMap({
        container,
        style: bandedWorldStyle(view),
        center: [view.camera.center.lng, view.camera.center.lat],
        zoom: view.camera.zoom,
        pitch: view.camera.pitch,
        bearing: view.camera.bearing,
        attributionControl: false,
      });
      map.on('error', (event) => onError?.(event?.error ?? new Error('MapLibre error')));
      map.on('load', () => {
        loaded = true;
        while (queued.length > 0) queued.shift()(map);
      });
      // Every move, gesture or ours, and continuously rather than at the end
      // of one: the tilt has to track a pinch as it happens. Our own moves
      // come back through here too and that is fine — the seam drops a camera
      // it is already at, and pitch is not part of what it compares, so the
      // pitch this handler causes cannot cause another.
      map.on('move', () => {
        if (!onCameraMoved || !map) return;
        const centre = map.getCenter();
        onCameraMoved({
          center: { lng: centre.lng, lat: centre.lat },
          zoom: map.getZoom(),
          bearing: map.getBearing(),
        });
      });
      paint(view.plan);
      setData(PLACES_SOURCE, pointCollection(view.places));
    },

    /** Applied property by property rather than as one jumpTo, and only where
     *  it differs. During a pinch the camera the seam hands back *is* the
     *  gesture's own, so the only thing left to apply is the derived pitch —
     *  writing the rest back would fight the gesture handler for the camera
     *  mid-pinch. */
    camera({ center, zoom, pitch, bearing, ease }) {
      if (!map) return;
      if (ease) {
        map.easeTo({ center: [center.lng, center.lat], zoom, pitch, bearing, duration: ease.durationMs });
        return;
      }
      if (map.getZoom() !== zoom) map.setZoom(zoom);
      if (map.getBearing() !== bearing) map.setBearing(bearing);
      if (Math.abs(map.getPitch() - pitch) > 0.01) map.setPitch(pitch);
      const centre = map.getCenter();
      if (centre.lng !== center.lng || centre.lat !== center.lat) {
        map.setCenter([center.lng, center.lat]);
      }
    },

    paint,

    overlay(model) {
      setData(OVERLAY_SOURCES.members, pointCollection(model.members));
      setData(OVERLAY_SOURCES.nodes, pointCollection(model.nodes));
      setData(OVERLAY_SOURCES.route, lineCollection(model.route));
    },

    pick(point) {
      if (!map || !loaded || !map.getLayer(PLACES_SOURCE)) return null;
      const [feature] = map.queryRenderedFeatures([point.x, point.y], { layers: [PLACES_SOURCE] });
      return feature?.properties?.id ?? null;
    },

    detach() {
      queued.length = 0;
      loaded = false;
      map?.remove();
      map = null;
    },
  };
}
