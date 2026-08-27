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
 * The selected Place's coaster track, alternative-route tap targets, Kit
 * badges, land names along the district (centroids for now), the scale bar,
 * and a Skin's Custom map layer (ADR-0013 compiles that into the display
 * pack). The
 * perf HUD (`onMapStats`) is not wired on the GL path yet.
 *
 * Certified baked Skins get a mid-band raster from `bakedWorldBands`. Pixel
 * tycoon is declared baked but has no pack yet, so it stays on OSM.
 *
 * The opening camera prefers `world.center` (the venue's declared centre)
 * over the bbox midpoint. That is the h18 resolution of the 77–291 m gap
 * the two renderers used to open on.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import MapLegend from './MapLegend';
import { identityOf } from '@/lib/venue/ids';
import { bakedWorldBands } from '@/lib/customMap';
import { overlayGeoJson } from '@/lib/overlayGeo';
import { parkMapRenderer } from '@/lib/mapLibreConfigured';
import { boundsOfPoints, cameraRequest, overlayModel, parkMapPalettes, worldFor } from '@/lib/parkMapView';

/* MapLibre is a large dependency and the shipped renderer. `ssr: false`
   for the ordinary reason: it needs a canvas. */
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
    routeDone = [],
    alternatives = null,
    puck,
    heading = null,
    follow,
    focusPoint,
    theme,
    eligibility,
    visibleCategories,
    onToggleCategory,
    mapKeyHidden = false,
    selected = null,
    routeTargetName = null,
    planNextPlaceId = null,
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

  const { surface, pins } = useMemo(() => parkMapPalettes(theme), [theme]);

  /* The World, as the map view takes it — or null when this venue cannot be
     drawn yet, which is the ported path standing aside rather than framing a
     camera on a guess. */
  const world = useMemo(() => {
    if (renderer !== 'gl') return null;
    const base = worldFor(data);
    if (!base) return null;
    const bands = bakedWorldBands(base.id, theme);
    return bands ? { ...base, bands } : base;
  }, [renderer, data, theme]);

  /* Only the Places the guest has left switched on. Which Places to draw is a
     Truth-side question — a category switched off is a Place not on the map,
     not a Place painted invisibly — so it is answered here rather than as a
     layer filter. */
  const shownPois = useMemo(
    () => (visibleCategories ? (pois || []).filter((p) => visibleCategories.has(p.c)) : pois || []),
    [pois, visibleCategories],
  );

  const categoryCounts = useMemo(() => {
    const out = new Map();
    (pois || []).forEach((p) => out.set(p.c, (out.get(p.c) || 0) + 1));
    return out;
  }, [pois]);
  const presentCategories = useMemo(() => new Set(categoryCounts.keys()), [categoryCounts]);

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
    return <div data-testid="park-map-gl" className="mapMissing" data-follow={follow ? '1' : '0'} />;
  }

  // The category key, over the canvas. The SVG renderer keeps its own; drawn
  // here so the ported path is not a map a guest cannot filter.
  const legend = (
    <div className="mapFurniture">
      <MapLegend
        palette={pins}
        visibleCategories={visibleCategories}
        onToggleCategory={onToggleCategory}
        presentCategories={presentCategories}
        categoryCounts={categoryCounts}
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
      palette={surface}
      pinPalette={pins}
      eligibility={eligibility}
      skin={theme ?? null}
      // Every Place, not just the shown ones: this is the seam's own lookup for
      // a pick, and it is fixed at mount. Handing it the filtered list would
      // make a Place switched back on after mount draw fine and then throw on
      // the tap that found it.
      places={pois || []}
      overlay={overlay}
      alternatives={alternatives}
      routeDone={routeDone}
      puck={puck}
      heading={heading}
      rotation={rotation}
      navId={routeTargetName}
      planNextId={planNextPlaceId}
      selectedId={selected ? identityOf(selected) : null}
      camera={camera}
      follow={follow}
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
