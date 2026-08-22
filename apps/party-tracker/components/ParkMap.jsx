'use client';

/* The World map (ADR-0019 clauses 3-4, slices h11 and h18).
 *
 * ADR-0019 clause 3 makes MapLibre *the* map view and retires the SVG world
 * viewer; clause 4 moves the live Overlay into it, so party dots, Marks, quest
 * pins and the route project through the one camera instead of through a
 * second projection written by hand. Slice h11 built the ported path beside
 * the SVG one; slice h18 deleted the SVG one. This file is the caller side of
 * what is left, and there is only one side now.
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
 * ## How a World opens
 *
 * On the whole park, and then on the guest — the opening view decision slice
 * h18 records, and `lib/openingView.js` is where it lives. It is deliberately
 * neither renderer's old behaviour: the SVG viewer opened on the venue's
 * declared `meta.center`, the ported path on the geometric centre of the truth
 * bounds, and those are 77 m (six-flags-fiesta-texas) to 291 m (kings-island)
 * apart. This file used to carry that divergence as a gap, because whichever
 * point lost the argument would have become a silent regression on the first
 * paint of every venue the day the renderer flipped. The decision retires the
 * argument rather than settling it: the opening frames the truth bounds, which
 * is a box and so picks no centre at all, and then flies to the guest's own
 * GPS position. Neither old centre is used by anything, so the distance
 * between them no longer means anything either.
 *
 * The whole-park view holds the camera against Follow while it is up, and that
 * hold is bounded: a guest whose GPS is refused gets the camera back when the
 * hold expires rather than a map they cannot move. `lib/openingView.js` states
 * why that bound is the load-bearing half.
 *
 * ## What the shipped map no longer carries
 *
 * These were gaps in a path nobody drew through while the SVG renderer
 * shipped. They are gaps in the shipped map now, and that is the cost of the
 * retirement, named here rather than discovered. Each is a Truth-side or
 * style-side job the SVG renderer did inline and the ported path has nowhere
 * to put yet: Eligibility colouring on Place markers, the selected Place's
 * highlight and its coaster track, alternative routes and their tap targets,
 * the walked / remaining split of a running route, the heading cone and Kit
 * badges, land labels along their district, the scale bar, and a Skin's Custom
 * map layer (which ADR-0013 compiles into the display pack rather than drawing
 * in React). The perf HUD has no reporter at all now — `onMapStats` was the
 * SVG renderer's own.
 *
 * page.js still passes every prop those features were driven by. They are
 * accepted and unread rather than removed from the call, so the slice that
 * ports each one back has the wiring already in place and page.js does not
 * churn twice.
 *
 * And the baked bands themselves. `worldFor()` answers `{id, bounds,
 * geometry}` with no `bands` key, because nothing in the app has a display
 * pack to hand it — `components/BandedWorldMap.jsx`, the #527 dev spike, is
 * the only place a `bands` map is built at all. So `bandedWorldStyle` makes
 * zero `band-*` layers here and the shipped map draws the vector tier alone:
 * ADR-0019's never-fails fallback, drawing on its own rather than standing in
 * for art that has not arrived. Wiring a World's display pack into `worldFor`
 * is the slice that turns the band machinery on; until then every band test in
 * `test/app/map-view.test.mjs` drives a World the shipped map never builds.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import MapLegend from './MapLegend';
import { identityOf } from '@/lib/venue/ids';
import { mapThemePack } from '@/lib/mapThemeTokens';
import { overlayGeoJson } from '@/lib/overlayGeo';
import { parkMapRenderer } from '@/lib/mapLibreConfigured';
import {
  OPENING_HOLD_MS,
  OPENING_START,
  advanceOpening,
  openingConsumed,
  openingHoldsCamera,
  openingRunning,
} from '@/lib/openingView';
import { boundsOfPoints, cameraRequest, overlayModel, worldFor } from '@/lib/parkMapView';

/* MapLibre is a large dependency and a map is not the first thing on screen —
   the intro gate and the venue fade come first — so the engine loads for the
   render that actually draws through it. `ssr: false` for the ordinary reason:
   it needs a canvas. */
const ParkMapGl = dynamic(() => import('./ParkMapGl'), { ssr: false });

/** Renderer name to the component that draws it. Twin of
 *  `PARK_MAP_RENDERERS`: a name that resolves there must have a component
 *  here. One entry today; ADR-0013 item 4's real-time PBR tier is the next. */
const RENDERERS = { gl: ParkMapGl };

/** Which renderer this phone is drawing through.
 *
 *  One ships, so what this is still doing is resolving a *stale* answer: a
 *  deployment env or a reviewer's bookmark still naming the retired `svg`
 *  renderer has to draw the shipped map rather than nothing.
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

/**
 * The opening view (slice h18): the whole park, then the guest.
 *
 * All the deciding is in `lib/openingView.js`, which is pure and takes its own
 * clock. What is here is the two things only a component can do: notice that
 * time has passed, and hand the move over exactly once.
 */
function useOpeningView(world, anchor, cameraTaken) {
  const [opening, setOpening] = useState(OPENING_START);
  const openedAt = useRef(0);

  useEffect(() => {
    // The hold starts when there is a park to hold, not when this mounts —
    // `data` can arrive a second after the screen does.
    if (!world || !openingRunning(opening)) return undefined;
    if (!openedAt.current) openedAt.current = Date.now();
    const step = () => setOpening((prev) => advanceOpening(prev, {
      bounds: world.bounds,
      anchor,
      cameraTaken,
      elapsedMs: Date.now() - openedAt.current,
    }));
    step();
    /* A fix landing during the hold wakes this effect and is turned away by
       `advanceOpening`. If none lands, nothing else would ever ask again — and
       the hold is what is holding the camera, so it has to be its own wake-up
       or a guest with no GPS could never move their own map. */
    const left = OPENING_HOLD_MS - (Date.now() - openedAt.current);
    if (left <= 0) return undefined;
    const timer = setTimeout(step, left);
    return () => clearTimeout(timer);
  }, [world, anchor, cameraTaken, opening]);

  /* Handed over once. A camera request is applied when it arrives, and held
     any longer this one would outrank every later Follow, focus and route
     framing — the guest would be unable to look anywhere for the rest of the
     session. `ParkMapGl` is a child, so its own camera effect has already run
     by the time this one does. */
  useEffect(() => {
    if (opening.camera) setOpening(openingConsumed);
  }, [opening]);

  return opening;
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
     drawn yet, which is a World arriving without the bounds every band and
     every camera is placed against. */
  const world = useMemo(() => worldFor(data), [data]);

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
    const now = Date.now();
    return overlayGeoJson(
      overlayModel(
        { members, me, puck, route, progress: routeProgress, marks, pois: shownPois, meet, spot, car, overlayPins },
        { now },
      ),
      { now },
    );
  }, [members, me, puck, route, routeProgress, marks, shownPois, meet, spot, car, overlayPins]);

  /* A hand on the glass ends the opening without the flight — the guest is
     already looking at something. The parent still hears every pan; this only
     needs to know that a first one happened. */
  const [userMoved, setUserMoved] = useState(false);
  const handleUserPan = useCallback(() => {
    setUserMoved(true);
    onUserPan?.();
  }, [onUserPan]);

  const anchor = puck ?? me ?? null;
  const fit = useMemo(() => (fitKey ? boundsOfPoints(fitPoints) : null), [fitKey, fitPoints]);

  /* Somebody other than the opening is already answering where the camera
     should be: a Place the guest tapped, a route being previewed, Go's walking
     zoom. Follow is deliberately not on that list — it chases the very point
     the flight is going to, so it is not a competing answer. */
  const cameraTaken = userMoved || Boolean(focusPoint) || Boolean(fit) || navZoom != null;
  const opening = useOpeningView(world, anchor, cameraTaken);

  /* One camera request, from every prop that has an opinion about where the
     camera should be — unless the opening is still holding it through the
     whole-park view, and then from nobody. The `center` prop is not one of
     them either way: it is where the map opens, which the opening view
     answers. Feeding it in here would re-centre the park on every fix —
     `anchor` is a fresh object each time one lands — and undo the guest's pan. */
  const camera = useMemo(
    () => opening.camera ?? (openingHoldsCamera(opening) ? null : cameraRequest({
      follow,
      anchor,
      focusPoint,
      fit,
      scale: navZoom,
      bearing: rotation,
      lift: liftCentre,
    })),
    [opening, follow, anchor, focusPoint, fit, navZoom, rotation, liftCentre],
  );

  /* A World that arrived without bounds has no camera to open on and no
     coordinates to hang a band from. There is no second renderer to fall back
     to since h18, so the map area stays empty until Truth arrives rather than
     being opened on a guess — page.js keeps `VenueLoadFade` over it meanwhile. */
  if (!world) return <div className="mapWrap" data-renderer="none" />;

  const Renderer = RENDERERS[renderer];

  // The category key, over the canvas. Drawn here so the map is not one a
  // guest cannot filter.
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
    <Renderer
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
      onUserPan={handleUserPan}
      style={
        fogFilter
          ? { filter: `saturate(${fogFilter.saturate}) brightness(${fogFilter.brightness})` }
          : null
      }
    >
      {legend}
    </Renderer>
  );
}

/* The same memo boundary this file has always had. The map re-renders only
   when a prop actually changed — page.js re-renders on every fix, every roster
   message and every sheet drag. */
export default memo(ParkMap);
