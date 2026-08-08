'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ParkMap from '@/components/ParkMap';
import Icon from '@/components/Icon';
import GpsGate from '@/components/GpsGate';
import CompassTape from '@/components/CompassTape';
import PartyPanel from '@/components/PartyPanel';
import GlanceRail from '@/components/GlanceRail';
import InstallCard from '@/components/InstallCard';
import RidesPanel from '@/components/RidesPanel';
import Diagnostics from '@/components/Diagnostics';
import NavBanner from '@/components/NavBanner';
import NavBar from '@/components/NavBar';
import RoutePreview from '@/components/RoutePreview';
import DirectionsPanel from '@/components/DirectionsPanel';
import useGeolocation from '@/components/useGeolocation';
import useVoiceGuidance from '@/components/useVoiceGuidance';
import { CATEGORIES, eligibility, hasHeights } from '@/lib/park';
import { createPartyRuntime, takePendingInvite } from '@/lib/partyRuntime';
import {
  buildRouteGraph,
  findRoute,
  findRoutes,
  navKeyOf,
  routeProgress,
  splitRouteAt,
  OFF_ROUTE_M,
} from '@/lib/routing';
import { bootVenue, retargetForPosition, selectVenue, withinBounds } from '@/lib/venue/store';
import { useVenue } from '@/lib/venue/useVenue';
import { bearing, cardinal, distance, formatDistance, formatWalk } from '@/lib/geo';

const PALETTE = ['#30D158', '#40C8E0', '#BF5AF2', '#FF375F', '#5E5CE6', '#AC8E68', '#FFD60A', '#FF9F0A'];
const colourFor = (id) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const initialsFor = (n) => (n || '?').trim().slice(0, 2).toUpperCase();

const DEFAULT_CATEGORIES = new Set(['coaster', 'ride', 'gate', 'landmark', 'service', 'food', 'restroom']);

/* Identity used to be filed under a key named after the one park this ran at.
   Read the old key once so nobody who already typed their name has to again. */
const IDENTITY_KEY = 'tracker-identity';
const LEGACY_IDENTITY_KEY = 'ki-identity';

/** How often the broadcast gate is asked whether the current fix is worth sending. */
const GATE_TICK_MS = 4000;

/**
 * How far you, or whoever you are walking to, has to move before the route is
 * worked out again. A route costs well under a millisecond, but recomputing on
 * every GPS jitter makes the line twitch and the instruction flicker.
 */
const REROUTE_M = 12;

export default function Page() {
  const geo = useGeolocation();
  const { position, heading, shouldBroadcast } = geo;
  const { venue, map: mapData, pois: POIS, manifest, status: venueStatus } = useVenue();
  const [gateOpen, setGateOpen] = useState(true);

  const [identity, setIdentity] = useState(null); // {id, name}
  const [party, setParty] = useState(null); // the runtime's snapshot
  const [localMeet, setLocalMeet] = useState(null); // a meet-up marked before joining anything
  const [status, setStatus] = useState('On the move');
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('party');
  const [sheet, setSheet] = useState('peek');
  const [follow, setFollow] = useState(true);
  const [armMeet, setArmMeet] = useState(false);
  const [tapeOn, setTapeOn] = useState(false);
  const [toast, setToast] = useState(null);
  const [height, setHeight] = useState(null);
  const [withAdult, setWithAdult] = useState(true);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [focusPoint, setFocusPoint] = useState(null);
  const [theme, setTheme] = useState('night');
  const [nav, setNav] = useState(null); // where we are walking to, by reference
  const [navPhase, setNavPhase] = useState('idle'); // idle -> preview -> go
  const [routesList, setRoutes] = useState([]); // the choice, best first
  const [pick, setPick] = useState(0);
  const [graph, setGraph] = useState(null);
  const [northUp, setNorthUp] = useState(false);
  const [voice, setVoice] = useState(false);
  const [rerouted, setRerouted] = useState(0);

  const runtime = useRef(null);
  const lastRoute = useRef(null);
  const arrived = useRef(null);
  // The reroute path reads the current choice without taking a dependency on
  // it — recomputing a route must not itself be a reason to recompute it.
  const routesRef = useRef([]);
  const pickRef = useRef(0);
  const progressRef = useRef(null);
  // Also in state, because the diagnostics panel is a render-time consumer and
  // a ref assigned inside an effect never triggers the render that reads it.
  const [runtimeApi, setRuntimeApi] = useState(null);
  const identityRef = useRef(null);
  const positionRef = useRef(null);
  const helpSeen = useRef(new Set());

  /* ---------- boot ---------- */
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // The venue is the map, the places and the bounds. Which one loads is the
  // visitor's last choice, or the deployment's default; the first GPS fix gets
  // to correct that if it lands inside a different one.
  useEffect(() => {
    bootVenue().catch((err) => setToast(err?.message || 'Could not load the map.'));
  }, []);

  useEffect(() => {
    if (!position || position.manual) return;
    retargetForPosition(position.lat, position.lng)
      .then((moved) => {
        if (moved) showToast(`Switched to ${moved.name}`);
      })
      .catch(() => {});
    // Only the first fix matters here: after that the visitor is inside a venue
    // and re-checking on every GPS tick would fight a deliberate choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(position)]);

  useEffect(() => {
    let saved = null;
    try {
      saved = JSON.parse(
        localStorage.getItem(IDENTITY_KEY) || localStorage.getItem(LEGACY_IDENTITY_KEY) || 'null',
      );
    } catch {
      saved = null;
    }
    const next = saved?.id
      ? saved
      : { id: Math.random().toString(36).slice(2, 10), name: 'Guest' };
    identityRef.current = next;
    setIdentity(next);
    if (saved?.height != null) setHeight(saved.height);
    // Follow the phone's own appearance setting until the visitor overrides it.
    if (saved?.theme) setTheme(saved.theme);
    else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) setTheme('day');
  }, []);

  useEffect(() => {
    if (!identity) return;
    identityRef.current = identity;
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ ...identity, height, theme }));
  }, [identity, height, theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Close the gate when the fix actually lands. Checking this inside the
  // "Allow location" handler cannot work: the permission prompt and the first
  // fix are both async, so status is still 'asking' when the click returns and
  // nothing looks again. The gate then sits over the whole UI intercepting
  // taps, and the only way out reads "Just show me the park map" — which is the
  // opposite of what someone who just granted location wants.
  useEffect(() => {
    if (geo.status === 'live') setGateOpen(false);
  }, [geo.status]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  /* ---------- the party runtime ---------- */

  // One runtime for the life of the page. It owns the session, the transports
  // and whichever half of the protocol this device is running; everything below
  // reads its snapshot and calls its verbs.
  useEffect(() => {
    const rt = createPartyRuntime({ onState: setParty, onToast: showToast });
    runtime.current = rt;
    setRuntimeApi(rt);
    const memberName = identityRef.current?.name || 'Guest';
    // A link opened at /join parks its invite here rather than connecting on a
    // route it is about to navigate away from.
    const invite = takePendingInvite();
    Promise.resolve(invite ? rt.joinParty(invite, { memberName }) : rt.resume({ memberName })).catch(
      (err) => showToast(err?.message || 'Could not open that invite.'),
    );
    return () => {
      runtime.current = null;
      setRuntimeApi(null);
      rt.destroy();
    };
  }, [showToast]);

  const active = Boolean(party?.active);
  const code = party?.code ?? null;

  /**
   * The roster, flattened for the map, the rail and the tape — all of which
   * predate the party layer and read a member as a point with a name on it.
   */
  const roster = useMemo(
    () =>
      (party?.members || []).map((m) => ({
        ...m,
        lat: m.location?.lat,
        lng: m.location?.lng,
        acc: m.location?.acc ?? null,
        ts: m.location?.ts ?? m.lastSeen,
        colour: colourFor(m.id),
        initials: initialsFor(m.name),
      })),
    [party],
  );

  const others = useMemo(
    () => roster.filter((m) => m.id !== party?.selfId && Number.isFinite(m.lat)),
    [roster, party?.selfId],
  );

  const meet = party?.meet ?? localMeet;

  /**
   * Where the party is, according to the phone hosting it.
   *
   * This is the better answer to "which map" than this phone's own fix. Someone
   * joining from the car park, from the hotel the night before, or from a phone
   * that has not got a fix yet still wants the map everyone else is looking at
   * — and a meet-up pin means nothing if two phones are drawing different
   * places. The host is the phone that decides what is true about the party, so
   * it decides this too.
   */
  const hostLocation = useMemo(() => {
    const host = roster.find((m) => m.id === party?.hostId);
    if (!host || !Number.isFinite(host.lat) || !Number.isFinite(host.lng)) return null;
    return { lat: host.lat, lng: host.lng, name: host.name };
  }, [roster, party?.hostId]);

  // The host's position outranks this phone's own, and keeps outranking it: if
  // the host turns out to be somewhere else, follow. Picking a venue by hand
  // still wins over both — the store stops retargeting once a choice is pinned.
  useEffect(() => {
    if (!hostLocation) return;
    retargetForPosition(hostLocation.lat, hostLocation.lng)
      .then((moved) => {
        if (moved) showToast(`Switched to ${moved.name} — where your party is`);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostLocation?.lat, hostLocation?.lng]);

  /**
   * The battery lever. Every fix goes through the adaptive gate before it goes
   * anywhere near a radio, and the gate — not this component — decides whether
   * it moved far enough, turned far enough, or has simply been quiet too long.
   */
  useEffect(() => {
    if (!active || !position) return undefined;
    const tick = () => {
      const fix = positionRef.current;
      if (!fix) return;
      // `now` is passed explicitly because the gate falls back to the fix's own
      // timestamp as its clock, and a phone that is standing still keeps being
      // handed the same cached fix — so that clock stops, every later tick is
      // rate-limited against it, and the heartbeat that exists to re-offer a
      // position which never landed can never come round.
      const decision = shouldBroadcast({ heading, now: Date.now() });
      if (!decision.send) return;
      runtime.current?.pushLocation({
        lat: fix.lat,
        lng: fix.lng,
        acc: fix.acc ?? null,
        heading: Number.isFinite(fix.heading) ? fix.heading : heading ?? null,
        speed: Number.isFinite(fix.speed) ? fix.speed : null,
        ts: fix.ts,
      });
    };
    tick();
    const id = setInterval(tick, GATE_TICK_MS);
    return () => clearInterval(id);
  }, [active, position, heading, shouldBroadcast]);

  // NEED HELP has to interrupt, once per person per episode.
  useEffect(() => {
    roster.forEach((m) => {
      if (m.id === party?.selfId) return;
      if (m.status === 'NEED HELP' && !helpSeen.current.has(m.id)) {
        helpSeen.current.add(m.id);
        const me = positionRef.current;
        const d = me && Number.isFinite(m.lat) ? distance(me.lat, me.lng, m.lat, m.lng) : null;
        showToast(`${m.name} needs help - ${formatDistance(d)}`);
        navigator.vibrate?.([120, 70, 120]);
      }
      if (m.status !== 'NEED HELP') helpSeen.current.delete(m.id);
    });
  }, [roster, party?.selfId, showToast]);

  /* ---------- party actions ---------- */
  const createParty = async () => {
    setBusy(true);
    try {
      const snap = await runtime.current.createParty({
        memberName: identity?.name || 'Guest',
        name: 'Party',
      });
      showToast(`Party ${snap.code} started`);
    } catch (err) {
      showToast(err?.message || 'Could not start a party.');
    }
    setBusy(false);
  };

  const joinParty = async (raw) => {
    setBusy(true);
    try {
      const snap = await runtime.current.joinParty(raw, { memberName: identity?.name || 'Guest' });
      showToast(`Joined ${snap.code}`);
    } catch (err) {
      showToast(err?.message || 'Could not join that party.');
    }
    setBusy(false);
  };

  const leaveParty = async () => {
    helpSeen.current.clear();
    await runtime.current?.leave();
  };

  const setMeetPoint = (lat, lng, label) => {
    setArmMeet(false);
    const record = { lat, lng, label: label || 'Meet-up' };
    if (active) {
      runtime.current?.setMeet(record);
      showToast('Meet-up shared with your party');
    } else {
      setLocalMeet({ ...record, by: identity?.name || 'Someone', ts: Date.now() });
      showToast('Meet-up marked (join a party to share it)');
    }
  };

  const clearMeet = () => {
    setLocalMeet(null);
    if (active) runtime.current?.setMeet(null);
  };

  /* ---------- derived ---------- */
  const dimmedNames = useMemo(() => {
    if (height == null) return null;
    const out = new Set();
    POIS.forEach((p) => {
      if (p.c !== 'coaster' && p.c !== 'ride') return;
      const v = eligibility(p, height, withAdult);
      if (v === 'no' || v === 'toobig') out.add(p.n);
    });
    return out;
  }, [POIS, height, withAdult]);

  const totalRides = useMemo(
    () => POIS.filter((p) => p.c === 'coaster' || p.c === 'ride').length,
    [POIS],
  );

  /* Height rules only exist at amusement parks, and only where somebody has
     filled them in. Everywhere else the filter, its badge and the tab that
     leads to it are simply not part of the app. */
  const heights = useMemo(() => hasHeights(POIS), [POIS]);

  const rideableCount = useMemo(() => {
    if (height == null) return null;
    return POIS.filter((p) => {
      if (p.c !== 'coaster' && p.c !== 'ride') return false;
      const v = eligibility(p, height, withAdult);
      return v === 'yes' || v === 'companion';
    }).length;
  }, [POIS, height, withAdult]);

  const nearest = useMemo(() => {
    if (!position) return null;
    let best = null;
    POIS.forEach((p) => {
      const d = distance(position.lat, position.lng, p.lat, p.lng);
      if (!best || d < best.d) best = { p, d };
    });
    return best;
  }, [POIS, position]);

  /* ---------- walking routes ---------- */

  // Welding every polyline in the loaded venue's file into a routing graph is a few
  // hundred milliseconds of work, and nothing needs it until someone asks for
  // directions. So it waits for the browser to be idle rather than holding up
  // the first paint of the map, and until it lands routes fall back to a
  // straight line — which is exactly what the app drew before any of this.
  useEffect(() => {
    if (!mapData) return undefined;
    let live = true;
    const build = () => {
      if (live) setGraph(buildRouteGraph(mapData));
    };
    const idle = typeof window !== 'undefined' ? window.requestIdleCallback : null;
    const handle = idle ? idle(build, { timeout: 3000 }) : setTimeout(build, 400);
    return () => {
      live = false;
      if (idle) window.cancelIdleCallback?.(handle);
      else clearTimeout(handle);
    };
  }, [mapData]);

  // A destination is held by reference, not by coordinates: a party member
  // walks around while you are walking to them, and a meet-up can be moved or
  // cleared out from under the route.
  const navTarget = useMemo(() => {
    if (!nav) return null;
    if (nav.kind === 'member') {
      const m = roster.find((x) => x.id === nav.id);
      if (!m || !Number.isFinite(m.lat)) return null;
      return { ...nav, label: m.name, lat: m.lat, lng: m.lng };
    }
    if (nav.kind === 'meet') {
      if (!meet) return null;
      return { ...nav, label: meet.label || 'Meet-up', lat: meet.lat, lng: meet.lng };
    }
    return nav;
  }, [nav, roster, meet]);

  const stopNav = useCallback(() => {
    setNav(null);
    setNavPhase('idle');
    setRoutes([]);
    setPick(0);
    lastRoute.current = null;
    setTab((t) => (t === 'route' ? 'party' : t));
    setSheet('peek');
  }, []);

  // A walk belongs to the map it was worked out on. When the venue changes —
  // picked by hand, or followed to where the party is — the destination is a
  // place on the old map and its route is a line across geometry that is no
  // longer on screen, so the walk ends with it rather than quietly becoming a
  // straight line to somewhere a thousand miles away.
  useEffect(() => {
    if (!venue?.id) return;
    stopNav();
    setSelected(null);
    // Only a change of venue, not the first one to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id]);

  /**
   * Asking for directions does not set you walking — it offers you the route,
   * the way both phone maps do. You get a line on the map, the alternatives
   * beside it and a Start button; nothing takes over the screen until you say
   * so, and Cancel leaves you exactly where you were.
   */
  const startNav = useCallback(
    (target) => {
      if (!target) {
        stopNav();
        return;
      }
      if (!position) {
        setGateOpen(true);
        showToast('Turn location on to get walking directions.');
        return;
      }
      arrived.current = null;
      lastRoute.current = null;
      setPick(0);
      setNav(target);
      setNavPhase('preview');
      setFollow(false);
      setSheet('peek');
      setTab('route');
    },
    [position, showToast, stopNav],
  );

  const beginWalking = useCallback(() => {
    setNavPhase('go');
    setFollow(true);
    setSheet('peek');
    navigator.vibrate?.(30);
  }, []);

  // The person or pin we were walking to is gone. Say so once instead of
  // leaving a banner counting down to nothing.
  useEffect(() => {
    if (nav && !navTarget) {
      stopNav();
      showToast('That destination is gone — stopped walking there.');
    }
  }, [nav, navTarget, stopNav, showToast]);

  useEffect(() => {
    if (!navTarget || !position || navPhase === 'idle') {
      setRoutes([]);
      lastRoute.current = null;
      return;
    }
    const prev = lastRoute.current;
    const key = navKeyOf(navTarget);
    // Recompute on a new destination, on the graph finally landing, on setting
    // off, or once either end has moved far enough that the old line is a lie.
    const stale =
      !prev ||
      prev.key !== key ||
      prev.graph !== graph ||
      prev.phase !== navPhase ||
      distance(prev.from.lat, prev.from.lng, position.lat, position.lng) > REROUTE_M ||
      distance(prev.to.lat, prev.to.lng, navTarget.lat, navTarget.lng) > REROUTE_M;
    if (!stale) return;
    // A recompute that happens while the walker is off the line is a reroute,
    // not a refresh — worth saying so, briefly and only when it is true.
    if (navPhase === 'go' && prev && progressRef.current?.offset > OFF_ROUTE_M) {
      setRerouted(Date.now());
    }
    lastRoute.current = {
      key,
      graph,
      phase: navPhase,
      from: { lat: position.lat, lng: position.lng },
      to: { lat: navTarget.lat, lng: navTarget.lng },
    };
    const opts = {
      landmarks: POIS,
      destination: navTarget.label,
      areas: mapData?.landAnchors,
    };
    // Alternatives are a choice you make once, before setting off. Recomputing
    // them on every step of the walk would keep changing the answer under a
    // person who has already decided.
    if (navPhase === 'preview') {
      setRoutes(findRoutes(graph, position, navTarget, opts));
      setPick(0);
    } else {
      const chosen = routesRef.current[pickRef.current];
      // Rerouting keeps you on the road you chose where it still makes sense:
      // the penalty pass is what made the alternative different in the first
      // place, so replaying it is what keeps a reroute from silently moving
      // you onto the fastest line you already turned down.
      const penalty = chosen?.avoid ?? null;
      setRoutes([findRoute(graph, position, navTarget, { ...opts, penalty })]);
      setPick(0);
    }
    // POIS is in here because the landmarks a turn is named after belong to the
    // loaded venue now, not to a module constant.
  }, [navTarget, position, graph, navPhase, mapData, POIS]);

  const routes = routesList;
  const route = routesList[pick] ?? routesList[0] ?? null;
  useEffect(() => {
    routesRef.current = routesList;
    pickRef.current = pick;
  }, [routesList, pick]);
  // The notice clears itself; without this it would sit there until the next
  // render happened to come along.
  useEffect(() => {
    if (!rerouted) return undefined;
    const id = setTimeout(() => setRerouted(0), 2600);
    return () => clearTimeout(id);
  }, [rerouted]);

  const progress = useMemo(
    () => (route && position ? routeProgress(route, position.lat, position.lng) : null),
    [route, position],
  );

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const walking = navPhase === 'go' && Boolean(navTarget);
  const previewing = navPhase === 'preview' && Boolean(navTarget);
  const offRoute = Boolean(walking && progress && progress.offset > OFF_ROUTE_M);

  /* Course-up, the way a phone map turns while you walk. The compass is the
     better source when it is there — it knows which way you are facing while
     standing still — and the route's own bearing is the fallback, which is
     what a phone with no magnetometer gets. Quantised, because a map that
     redraws on every tenth of a degree burns battery to no visible end. */
  const rotation = useMemo(() => {
    if (!walking || northUp) return 0;
    const source = heading ?? progress?.course ?? null;
    if (source == null) return 0;
    return Math.round(source / 3) * 3;
  }, [walking, northUp, heading, progress?.course]);

  const puck = useMemo(() => {
    if (!walking || !progress?.snapped) return null;
    return { lat: progress.snapped[0], lng: progress.snapped[1], course: progress.course };
  }, [walking, progress]);

  const { done: routeDone, ahead: routeAhead } = useMemo(
    () => (walking ? splitRouteAt(route, progress) : { done: [], ahead: route?.points ?? [] }),
    [walking, route, progress],
  );

  // The routes not taken, drawn behind the chosen one while you are choosing.
  const shownAlternatives = useMemo(
    () =>
      previewing
        ? routes.map((r, i) => ({ ...r, index: i })).filter((r) => r.index !== pick)
        : null,
    [previewing, routes, pick],
  );

  useVoiceGuidance(voice, { route, progress, target: navTarget, phase: navPhase });

  // Arriving ends the walk by itself. Once per destination — a phone sitting
  // at the meet-up point must not re-announce it on every fix.
  useEffect(() => {
    if (!walking || !navTarget || !progress?.arrived) return;
    const key = navKeyOf(navTarget);
    if (arrived.current === key) return;
    arrived.current = key;
    showToast(`You're at ${navTarget.label}`);
    navigator.vibrate?.(90);
    stopNav();
  }, [walking, progress?.arrived, navTarget, showToast, stopNav]);

  const focusOn = (target) => {
    setFollow(false);
    setFocusPoint({ lat: target.lat, lng: target.lng });
    setSheet('peek');
  };

  const handleMapTap = (lat, lng) => {
    if (armMeet) {
      setMeetPoint(lat, lng);
      return;
    }
    if (geo.status === 'manual' || geo.status === 'idle') geo.setManual(lat, lng);
  };

  const handleSelect = (poi) => {
    setSelected(poi);
    setFollow(false);
    setFocusPoint({ lat: poi.lat, lng: poi.lng });
    if (position) {
      const d = distance(position.lat, position.lng, poi.lat, poi.lng);
      const b = bearing(position.lat, position.lng, poi.lat, poi.lng);
      showToast(`${poi.n} · ${formatDistance(d)} ${cardinal(b)} · ${formatWalk(d)} walk`);
    }
  };

  const headerLine = () => {
    if (venueStatus === 'loading') return 'Loading the map…';
    if (!position) return `${venue?.locality || 'Waiting'} · no fix yet`;
    const inside = withinBounds(venue?.bounds, position.lat, position.lng);
    const where = inside ? nearest?.p.a || 'On site' : 'Off site';
    const acc = position.manual
      ? 'placed by hand'
      : `±${Math.round((position.acc || 0) * 3.28084)} ft`;
    return `${where} · ${nearest ? `near ${nearest.p.n}` : ''} · ${acc}`;
  };

  // While a route is running the sheet is out of the way unless it is asked
  // for: the map and the two HUD strips are the whole interface, and the sheet
  // comes back over them only when you open the steps.
  const sheetClass = `sheet ${sheet} ${walking && sheet === 'peek' ? 'stowed' : ''} ${
    previewing ? 'stowed' : ''
  }`;

  return (
    // data-sheet publishes the sheet's stop as a CSS custom property, so the
    // FABs, the toast, the zoom pad and the scale bar all ride up and down with
    // it on one shared easing instead of each keeping its own copy of the stops.
    <main className="app" data-sheet={sheet}>
      <ParkMap
        data={mapData}
        center={venue?.center}
        pois={POIS}
        me={position}
        members={others}
        meet={meet}
        selected={selected}
        onSelectPoi={handleSelect}
        onMapTap={handleMapTap}
        armMeet={armMeet}
        follow={follow}
        onUserPan={() => setFollow(false)}
        heading={heading}
        dimmedNames={dimmedNames}
        visibleCategories={categories}
        focusPoint={focusPoint}
        theme={theme}
        route={navTarget ? route : null}
        routeStep={walking ? progress?.step ?? null : null}
        routeAhead={routeAhead}
        routeDone={routeDone}
        alternatives={shownAlternatives}
        onPickAlternative={setPick}
        puck={puck}
        rotation={rotation}
        liftCentre={walking ? 0.2 : previewing ? -0.12 : 0}
        navZoom={walking ? 3 : null}
        fitPoints={previewing ? route?.points : null}
        fitKey={previewing ? `${navKeyOf(navTarget)}:${pick}:${Math.round(route?.metres ?? 0)}` : null}
      />

      <header className="topbar">
        <div className="brand">
          <b>{venue?.name || 'Party tracker'}</b>
          <span>{headerLine()}</span>
        </div>
        <button
          type="button"
          className="iconBtn"
          onClick={() => setTheme((t) => (t === 'day' ? 'night' : 'day'))}
          aria-label={theme === 'day' ? 'Switch to night map' : 'Switch to daylight map'}
        >
          <Icon name={theme === 'day' ? 'moon.fill' : 'sun.max.fill'} />
        </button>
        <button
          type="button"
          className={`iconBtn ${tapeOn ? 'on' : ''}`}
          onClick={() => {
            setTapeOn((v) => !v);
            geo.enableCompass();
          }}
          aria-label="Bearing tape"
        >
          <Icon name="safari" />
        </button>
      </header>

      {heights && height != null && (
        <button
          type="button"
          className="filterBadge"
          onClick={() => {
            setTab('rides');
            setSheet('half');
          }}
        >
          <b>{height}&quot;</b>
          {rideableCount != null ? `${rideableCount} of ${totalRides} rides` : 'filter on'}
        </button>
      )}

      {walking && (
        <NavBanner
          target={navTarget}
          route={route}
          progress={progress}
          offRoute={offRoute}
          rerouted={Boolean(rerouted)}
        />
      )}

      {tapeOn && (
        <CompassTape
          me={position}
          members={others}
          meet={meet}
          selected={selected}
          heading={heading}
          theme={theme}
          lowered={Boolean(navTarget)}
        />
      )}

      <div className={`fabs ${walking ? 'go' : sheet} ${previewing ? 'preview' : ''}`}>
        {!walking && (
          <button
            type="button"
            className={`fab ${armMeet ? 'armed' : ''}`}
            onClick={() => {
              setArmMeet((v) => !v);
              if (!armMeet) {
                setSheet('peek');
                showToast('Tap the map to drop the meet-up point');
              }
            }}
            aria-label="Set meet-up"
          >
            <Icon name="mappin.and.ellipse" />
          </button>
        )}
        {/* Panning away during a walk parks the camera where you left it, and
            this is the way back — the same button, saying something else. */}
        <button
          type="button"
          className={`fab ${follow ? 'active' : ''} ${walking && !follow ? 'resume' : ''}`}
          onClick={() => {
            if (position) {
              setFollow(true);
              setFocusPoint({ lat: puck?.lat ?? position.lat, lng: puck?.lng ?? position.lng });
            } else {
              setGateOpen(true);
            }
          }}
          aria-label={walking && !follow ? 'Follow me again' : 'Centre on me'}
        >
          <Icon name="location.fill" />
        </button>
      </div>

      {previewing && (
        <RoutePreview
          target={navTarget}
          routes={routes}
          index={pick}
          onPick={setPick}
          onStart={beginWalking}
          onCancel={stopNav}
          onSteps={() => {
            setTab('route');
            setSheet('half');
          }}
        />
      )}

      {walking && sheet === 'peek' && (
        <NavBar
          target={navTarget}
          route={route}
          progress={progress}
          voice={voice}
          onVoice={() => setVoice((v) => !v)}
          northUp={northUp}
          onCompass={() => setNorthUp((v) => !v)}
          onSteps={() => {
            setTab('route');
            setSheet('half');
          }}
          onStop={stopNav}
        />
      )}

      <section className={sheetClass}>
        <button
          type="button"
          className="grab"
          onClick={() => setSheet(sheet === 'full' ? 'peek' : sheet === 'half' ? 'full' : 'half')}
          aria-label="Resize panel"
        >
          <i />
        </button>
        <GlanceRail
          me={position}
          members={others}
          meet={meet}
          selected={selected}
          heading={heading}
          theme={theme}
          onFocus={focusOn}
          onNavigate={startNav}
          navKey={navKeyOf(navTarget)}
          navMetres={progress?.remaining ?? route?.metres ?? null}
          onOpenParty={() => {
            setTab('party');
            setSheet('half');
          }}
        />
        <nav className="tabs" role="tablist">
          {[
            ...(navTarget ? [['route', 'Directions']] : []),
            ['party', `Party${others.length ? ` · ${roster.length}` : ''}`],
            ['rides', heights ? 'Rides & heights' : 'Places'],
            ['me', 'Me'],
          ].map(([key, labelText]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`tab ${tab === key ? 'on' : ''}`}
              onClick={() => {
                setTab(key);
                if (sheet === 'peek') setSheet('half');
              }}
            >
              {labelText}
            </button>
          ))}
        </nav>
        <div className="sheetBody">
          {tab === 'route' && (
            <DirectionsPanel
              target={navTarget}
              route={route}
              progress={walking ? progress : null}
              walking={walking}
              onStart={beginWalking}
              onStop={stopNav}
              onFocus={focusOn}
              onClose={() => setSheet('peek')}
            />
          )}
          {tab === 'party' && (
            <PartyPanel
              code={code}
              invite={party?.invite ?? null}
              members={roster}
              meet={meet}
              me={position}
              myId={party?.selfId ?? null}
              hostId={party?.hostId ?? null}
              hosting={Boolean(party?.hosting)}
              status={status}
              onStatus={(s) => {
                setStatus(s);
                runtime.current?.setStatus(s);
                showToast(`Status: ${s}`);
              }}
              onCreate={createParty}
              onJoin={joinParty}
              onLeave={leaveParty}
              onClearMeet={clearMeet}
              onNavigateMeet={() => startNav({ kind: 'meet', label: meet?.label || 'Meet-up' })}
              onFocus={(m) => {
                setFollow(false);
                setFocusPoint({ lat: m.lat, lng: m.lng });
                setSheet('peek');
              }}
              busy={busy || party?.phase === 'connecting'}
              transport={party?.transport ?? null}
              version={party?.version ?? 0}
              queued={party?.queued ?? 0}
            />
          )}
          {tab === 'rides' && (
            <RidesPanel
              me={position}
              height={height}
              withAdult={withAdult}
              onHeight={setHeight}
              onWithAdult={setWithAdult}
              selected={selected}
              onSelect={handleSelect}
              onSetMeet={(p) => setMeetPoint(p.lat, p.lng, p.n)}
              onNavigate={startNav}
              theme={theme}
              venue={venue}
            />
          )}
          {tab === 'me' && (
            <div>
              <div className="label">Your name in the roster</div>
              <input
                className="field"
                maxLength={14}
                value={identity?.name === 'Guest' ? '' : identity?.name || ''}
                placeholder="Name"
                onChange={(e) =>
                  setIdentity((i) => ({ ...i, name: e.target.value.trim() || 'Guest' }))
                }
                onBlur={(e) => runtime.current?.setMemberName(e.target.value.trim() || 'Guest')}
              />
              <div className="label">Location</div>
              <p className="fine">
                {position
                  ? `${position.manual ? 'Placed by hand' : 'Phone GPS'} · ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`
                  : 'No fix yet.'}
              </p>
              <button type="button" className="btn" onClick={() => setGateOpen(true)}>
                Location settings
              </button>
              <div className="label">Install on this phone</div>
              <InstallCard />

              <div className="label">Map appearance</div>
              <div className="chips">
                {[
                  ['day', 'Light'],
                  ['night', 'Dark'],
                ].map(([key, labelText]) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${theme === key ? 'on' : ''}`}
                    onClick={() => setTheme(key)}
                  >
                    {labelText}
                  </button>
                ))}
              </div>
              <p className="fine">
Light is the one to use outdoors — white midways on pale ground, dark type, and
                deeper marker colours that survive direct sun. Dark is easier on the eyes once
                the park lights come on.
              </p>

              <div className="label">Show on the map</div>
              <div className="chips wrap">
                {Object.entries(CATEGORIES).map(([key, cat]) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${categories.has(key) ? 'on' : ''}`}
                    onClick={() =>
                      setCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="label">Advanced diagnostics</div>
              <Diagnostics runtime={runtimeApi} geo={geo} />

              <div className="label">Which map</div>
              <div className="venueList">
                {(manifest?.venues || []).map((v) => {
                  // Measured from whatever is deciding the map: the host's
                  // position while a party is running, this phone's otherwise.
                  const from = hostLocation || position;
                  const inside = from && withinBounds(v.bounds, from.lat, from.lng);
                  const away =
                    from && !inside ? distance(from.lat, from.lng, v.center.lat, v.center.lng) : null;
                  const here = hostLocation ? 'your party is here' : 'you are here';
                  const off = hostLocation ? 'from your party' : 'away';
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className={`venueRow ${v.id === venue?.id ? 'on' : ''}`}
                      onClick={() => {
                        selectVenue(v.id, { pin: true })
                          .then(() => {
                            setSelected(null);
                            setFollow(false);
                            showToast(`Showing ${v.name}`);
                          })
                          .catch((err) => showToast(err?.message || 'Could not load that map.'));
                      }}
                      aria-pressed={v.id === venue?.id}
                    >
                      <b>{v.name}</b>
                      {v.id === venue?.id && <Icon name="checkmark" size={17} className="icn rowCheck" />}
                      <span>
                        {[
                          v.locality,
                          from == null
                            ? null
                            : inside
                              ? here
                              : `${formatDistance(away)} ${off}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="fine">
                Picking one here keeps it, and stops the app moving you again. Left alone,
                it opens the map you used last, then follows the phone hosting your party —
                or your own first fix, if there is no party running.
              </p>

              <div className="label">Where the data comes from</div>
              <p className="fine">
                The map is drawn from OpenStreetMap geometry — real paths, buildings, water
                and ride track, painted as vectors rather than copied from anyone&apos;s
                printed map. {venue?.credits || ''} Every map here was built by
                <code> npm run venues:build</code>, so anywhere OpenStreetMap covers can
                become one.
              </p>
            </div>
          )}
        </div>
      </section>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {gateOpen && (
        <GpsGate
          venueName={venue?.name}
          status={geo.status}
          error={geo.error}
          onRequest={() => {
            geo.request();
            geo.enableCompass();
          }}
          onManual={() => {
            setGateOpen(false);
            showToast('Tap the map to place yourself');
          }}
          onDismiss={() => setGateOpen(false)}
        />
      )}
    </main>
  );
}
