'use client';

/* The World map (ADR-0019 clauses 3-4, slice h11).
 *
 * ADR-0019 clause 3 makes MapLibre *the* map view and retires the SVG world
 * viewer; clause 4 moves the live Overlay into it, so party dots, Marks, quest
 * pins and the route project through the one camera instead of through a
 * second projection written by hand. This file is the caller side of that.
 *
 * It holds no map knowledge and draws nothing itself. Its whole job is turning
 * what the app knows into what a map view takes:
 *
 *   Truth into map data — `lib/worldGeo.js` for the World's own geometry,
 *   `lib/overlayGeo.js` for the live Overlay. Both pure, both tested without a
 *   browser, and both *one* conversion: the SVG renderer projected the same
 *   rows a second time by hand, and two projections of one Truth is how a
 *   party dot and the route it is walking end up disagreeing on screen — the
 *   failure ADR-0021 clause 3 is written against.
 *
 *   Props into a camera — Follow, focus, route framing, Go's walking zoom and
 *   course-up lift become one `{center, resolution, fit, bearing, lift}`
 *   request.
 *   Pitch is deliberately not in that list: ADR-0019 clause 2 derives it from
 *   zoom and ADR-0021 clause 4 stages the ease clear of every band handoff, so
 *   it is the seam's to work out, never a caller's to set.
 *
 * Everything below the seam — which band is drawn, what stands in for one that
 * has not arrived, how a Member's dot is painted, gestures, collision — lives
 * in `lib/mapView.js` and its MapLibre adapter, and `components/ParkMapGl.jsx`
 * is the thin bit of that which needs a browser.
 *
 * ## The shipped renderer
 *
 * MapLibre is the only engine (slice h18). `parkMapRenderer()` answers `gl`.
 * Overlay marks on the canvas use the engine's own `project`, so party dots
 * and the route share one camera.
 *
 * ## What the ported path does not carry yet
 *
 * Named rather than discovered later. Each is a Truth-side or style-side job
 * that the SVG renderer did inline and the ported path has nowhere to put yet:
 * Eligibility colouring on Place markers, the selected Place's highlight and
 * its coaster track, alternative routes and their tap targets, the walked /
 * remaining split of a running route, the heading cone and Kit badges, land
 * labels along their district, the scale bar, and a Skin's Custom map layer
 * (which ADR-0013 compiles into the display pack rather than drawing in
 * React). The perf HUD (`onMapStats`) reports from the SVG path only.
 *
 * And the baked bands themselves. `worldFor()` answers `{id, bounds,
 * geometry}` with no `bands` key, because nothing in the app has a display
 * pack to hand it — `components/BandedWorldMap.jsx`, the #527 dev spike, is
 * the only place a `bands` map is built at all. So `bandedWorldStyle` makes
 * zero `band-*` layers here and the ported path ships the vector tier alone:
 * ADR-0019's never-fails fallback, drawing on its own rather than standing in
 * for art that has not arrived. Wiring a World's display pack into `worldFor`
 * is the slice that turns the band machinery on; until then every band test in
 * `test/app/map-view.test.mjs` drives a World the shipped map never builds.
 *
 * And the opening camera differs. The SVG path opens on the venue's declared
 * `center`; the ported path opens on `frameBounds(world.bounds)`, the bbox's
 * geometric centre. Those are not the same point at any shipped venue —
 * measured against the committed `map.json` files: kings-island 291 m,
 * cedar-point 152 m, big-kahunas 115 m, six-flags-fiesta-texas 77 m. It costs
 * nothing while the SVG ships, and it is a silent regression on every venue's
 * first paint the day the renderer flips, so slice h18 has to resolve it or
 * accept it out loud rather than discover it. Named here because everything
 * else on this list was, and this one was found by a mutation sweep instead.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import MapLegend from './MapLegend';
import { identityOf } from '@/lib/venue/ids';
import { mapThemePack } from '@/lib/mapThemeTokens';
import { overlayGeoJson } from '@/lib/overlayGeo';
import { parkMapRenderer } from '@/lib/mapLibreConfigured';
import { boundsOfPoints, cameraRequest, overlayModel, worldFor } from '@/lib/parkMapView';

/* MapLibre is a large dependency and the shipped renderer is still the SVG
   one, so the engine loads only for the guest who is actually drawing through
   it. `ssr: false` for the ordinary reason: it needs a canvas. */
const ParkMapGl = dynamic(() => import('./ParkMapGl'), { ssr: false });

/** Which renderer this phone is drawing through.
 *
 *  The build's answer is the same on the server and on the first client
 *  render, which is what SSR requires. The `?parkMap=` escape is not — it is
 *  read from the URL — so it lands as a post-mount flip, the same shape
 *  page.js uses for its own `?displayMap=svg` parity escape. */
function useRenderer() {
  const [renderer, setRenderer] = useState(() => parkMapRenderer({ search: '' }));
  useEffect(() => {
    setRenderer(parkMapRenderer({ search: window.location.search }));
  }, []);
  return renderer;
}

function ParkMap(props) {
  const renderer = useRenderer();
  const {
    data,
    pois,
    me,
    members,
    meet,
    spot,
    car,
    marks = [],
    overlayPins = [],
    route,
    routeProgress = null,
    puck,
    follow,
    focusPoint,
    theme,
    eligibility,
    visibleCategories,
    onToggleCategory,
    mapKeyHidden = false,
    navZoom = null,
    fitPoints,
    fitKey = null,
    rotation = 0,
    liftCentre = 0,
    bottomInset = 190,
    fogFilter = null,
    onSelectPoi,
    onMapTap,
    onUserPan,
  } = props;

  const palette = useMemo(() => mapThemePack(theme), [theme]);

  /* The World, as the map view takes it — or null when this venue cannot be
     drawn yet, which is the ported path standing aside rather than framing a
     camera on a guess. */
  const world = useMemo(() => (renderer === 'gl' ? worldFor(data) : null), [renderer, data]);

  /* Only the Places the guest has left switched on. Which Places to draw is a
     Truth-side question — a category switched off is a Place not on the map,
     not a Place painted invisibly — so it is answered here rather than as a
     layer filter. */
  const shownPois = useMemo(
    () => (visibleCategories ? (pois || []).filter((p) => visibleCategories.has(p.c)) : pois || []),
    [pois, visibleCategories],
  );

  /* The live Overlay, as GeoJSON. One conversion, in `lib/overlayGeo.js`: the
     SVG renderer projected these same rows a second time by hand, and two
     projections of one Truth is how a party dot and the route it is walking
     end up disagreeing on screen. Staleness is the only thing in it that
     depends on time, and it refreshes when the roster does — which on a live
     Party is every fix. */
  const overlay = useMemo(() => {
    if (renderer !== 'gl') return null;
    const now = Date.now();
    return overlayGeoJson(
      overlayModel(
        { members, me, puck, route, progress: routeProgress, marks, pois: shownPois, meet, spot, car, overlayPins },
        { now },
      ),
      { now },
    );
  }, [renderer, members, me, puck, route, routeProgress, marks, shownPois, meet, spot, car, overlayPins]);

  /* One camera request, from every prop that has an opinion about where the
     camera should be. The `center` prop is not one of them: it is where the
     map opens, which `ParkMapGl` does from the World's own bounds at mount.
     Feeding it in here would re-centre the park on every fix — `anchor` is a
     fresh object each time one lands — and undo the guest's pan. */
  const anchor = puck ?? me ?? null;
  const fit = useMemo(() => (fitKey ? boundsOfPoints(fitPoints) : null), [fitKey, fitPoints]);
  const camera = useMemo(
    () => cameraRequest({
      follow,
      anchor,
      focusPoint,
      fit,
      scale: navZoom,
      bearing: rotation,
      lift: liftCentre,
    }),
    [follow, anchor, focusPoint, fit, navZoom, rotation, liftCentre],
  );

  if (!world) {
    return <div data-testid="park-map-gl" className="mapMissing" />;
  }

  // The category key, over the canvas. The SVG renderer keeps its own; drawn
  // here so the ported path is not a map a guest cannot filter.
  const legend = (
    <div className="mapFurniture">
      <MapLegend
        palette={palette}
        visibleCategories={visibleCategories}
        onToggleCategory={onToggleCategory}
        heightFilterOn={Boolean(
          eligibility
            && (pois || []).some((p) => {
              const kind = eligibility.at(identityOf(p)).kind;
              return kind && kind !== 'eligible';
            }),
        )}
        hidden={mapKeyHidden}
      />
    </div>
  );

  return (
    <ParkMapGl
      world={world}
      palette={palette}
      skin={theme ?? null}
      // Every Place, not just the shown ones: this is the seam's own lookup for
      // a pick, and it is fixed at mount. Handing it the filtered list would
      // make a Place switched back on after mount draw fine and then throw on
      // the tap that found it.
      places={pois || []}
      overlay={overlay}
      camera={camera}
      insetBottom={bottomInset}
      onSelectPlace={onSelectPoi}
      onMapTap={onMapTap}
      onUserPan={onUserPan}
      style={
        fogFilter
          ? { filter: `saturate(${fogFilter.saturate}) brightness(${fogFilter.brightness})` }
          : null
      }
    >
      {legend}
    </ParkMapGl>
  );
}

/* The same memo boundary this file has always had. Whichever renderer draws,
   the map re-renders only when a prop actually changed — page.js re-renders on
   every fix, every roster message and every sheet drag. */
export default memo(ParkMap);
