'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ParkMap from '@/components/ParkMap';
import Icon from '@/components/Icon';
import GpsGate from '@/components/GpsGate';
import ParkPrompt from '@/components/ParkPrompt';
import CompassTape from '@/components/CompassTape';
import PartyPanel from '@/components/PartyPanel';
import GlanceRail from '@/components/GlanceRail';
import HeightPanel from '@/components/HeightPanel';
import PlaceList from '@/components/PlaceList';
import SettingsPanel from '@/components/SettingsPanel';
import Diagnostics from '@/components/Diagnostics';
import NavBanner from '@/components/NavBanner';
import NavBar from '@/components/NavBar';
import TabBar from '@/components/TabBar';
import RoutePreview from '@/components/RoutePreview';
import DirectionsPanel from '@/components/DirectionsPanel';
import useSheetDrag from '@/components/useSheetDrag';
import useGeolocation from '@/components/useGeolocation';
import useVoiceGuidance from '@/components/useVoiceGuidance';
import useWeather from '@/components/useWeather';
import WeatherBanner from '@/components/WeatherBanner';
import { CATEGORIES, eligibility, hasHeights } from '@/lib/park';
import { statusSummary } from '@/lib/rideStatus';
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
import {
  bootVenue,
  confirmVenue,
  retargetForPosition,
  selectVenue,
  unpinVenue,
  venueChoiceFor,
  venuesByDistance,
  withinBounds,
} from '@/lib/venue/store';
import { useVenue } from '@/lib/venue/useVenue';
// Namespaced: `push` on its own is already the navigation stack's push.
import * as notifier from '@/lib/push/client';
import { bearing, cardinal, distance, formatDistance, formatWalk } from '@/lib/geo';

const PALETTE = ['#30D158', '#40C8E0', '#BF5AF2', '#FF375F', '#5E5CE6', '#AC8E68', '#FFD60A', '#FF9F0A'];
const colourFor = (id) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const initialsFor = (n) => (n || '?').trim().slice(0, 2).toUpperCase();

/* The titles a pushed screen wears in its nav bar. Party, Rides and Me are not
   in here: they are tabs now, and a tab's root screen carries a large title
   rather than a back button. */
const VIEW_TITLES = {
  route: 'Directions',
  categories: 'Show on the map',
  venues: 'Which map',
  diagnostics: 'Diagnostics',
};

/* The tab bar, left to right. The order is the whole of the animation's
   direction logic: moving right along the bar slides the next screen in from
   the right, and moving left slides it back. */
const TAB_ORDER = ['explore', 'party', 'rides', 'settings'];

/* A tab root gets a large title instead of the search field. Explore is the
   exception — its title is the search field, because searching a map is the
   thing you came to that screen to do. */
const ROOT_TITLES = { party: 'Party', rides: 'Rides', settings: 'Me' };

const EMPTY_STACK = [];
/** The navigation state the app opens on, and the one back returns it to. */
const HOME_STACKS = { explore: [], party: [], rides: [], settings: [] };

const DEFAULT_CATEGORIES = new Set(['coaster', 'ride', 'gate', 'landmark', 'service', 'food', 'restroom']);

/* Identity used to be filed under a key named after the one park this ran at.
   Read the old key once so nobody who already typed their name has to again. */
const IDENTITY_KEY = 'tracker-identity';
const LEGACY_IDENTITY_KEY = 'ki-identity';
const PUSH_PREFS_KEY = 'tracker-push-prefs';

/* How long a phone has to say nothing before the others are told it has gone
   quiet. Deliberately longer than the five minutes at which the roster row
   greys out: a queue building eats signal for that long routinely, and an alert
   that cries wolf is one that gets turned off. */
const QUIET_AFTER_MS = 12 * 60 * 1000;

/* What the sheet is standing on in each of its states, as pixels. The CSS
   already publishes this as --sheetH for the chrome that rides above it; the
   map needs the number itself, to lay its labels out above the furniture
   rather than behind it.

   These have to track --peek and the sheet's insets in globals.css. The sheet
   floats clear of the bottom edge at its partial stops, so what the map is
   standing on is the height plus that gap; at the full stop it is anchored and
   there is no gap. The peek stop is what it is because it has to stand the
   search field, the glance rail and the tab bar all at once. */
/* Raised from 286 to carry the "pull up" line: the search field, where you
   are, the rail, that one line and the tab bar. The line is 22px and this is
   22px more. Still the first thing to break if anything in the collapsed sheet
   grows again. */
const PEEK_PX = 308;
const SHEET_PEEK_PX = PEEK_PX + 8;
const SHEET_OPEN = { half: 0.52, full: 0.88 };
const SHEET_INSET = { half: 5, full: 0 };
const STOWED_PX = 96;

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
  const {
    venue,
    map: mapData,
    pois: POIS,
    manifest,
    status: venueStatus,
    error: venueError,
    confirmed: venueConfirmed,
    pinned: venuePinned,
  } = useVenue();
  const [gateOpen, setGateOpen] = useState(true);
  /** Waved the park question away for this session — do not put it back up. */
  const [parkAsked, setParkAsked] = useState(false);

  const [identity, setIdentity] = useState(null); // {id, name}
  const [party, setParty] = useState(null); // the runtime's snapshot
  // The snapshot as a ref, for callbacks that must not be rebuilt on every
  // roster tick just to read the party they are sending to.
  const partyRef = useRef(null);
  const [localMeet, setLocalMeet] = useState(null); // a meet-up marked before joining anything
  const [status, setStatus] = useState('On the move');
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState(null);
  /* Four tabs, and a navigation stack per tab — the shape a phone app has had
     since tab bars existed. A tab's empty stack is its root screen; anything
     pushed on top of it arrives behind a back button, and leaving the tab and
     coming back finds it exactly where it was left. */
  const [tab, setTab] = useState('explore');
  const [stacks, setStacks] = useState(HOME_STACKS);
  /* Which way the next screen should come in from. Screens travel: forward is
     from the right, back is from the left, and that is true of a push, a pop
     and a move along the tab bar alike. Empty on the first paint — the sheet
     is already sliding up from the bottom, and its contents arriving sideways
     at the same time is one motion too many. */
  const [motion, setMotion] = useState('');
  const [query, setQuery] = useState('');
  /* 'all', not 'coaster'. A category chip narrows the search as well as the
     list, so booting on Coasters means the search field silently answers a
     different question than the one that was typed: "restroom" comes back
     "Nothing matches that." at a park with eleven of them. The list opening on
     everything is also the honest reading of a screen whose own heading is the
     name of the park. */
  const [filter, setFilter] = useState('all');
  const [onlyRideable, setOnlyRideable] = useState(false);
  const [sheet, setSheet] = useState('peek');
  const [follow, setFollow] = useState(true);
  const [armMeet, setArmMeet] = useState(false);
  const [tapeOn, setTapeOn] = useState(false);
  const [toast, setToast] = useState(null);
  const [height, setHeight] = useState(null);
  const [withAdult, setWithAdult] = useState(true);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  // The sheet's open stops are fractions of the viewport, so their height in
  // pixels is only knowable once there is a window to ask.
  const [viewportH, setViewportH] = useState(844);

  // Shared by the sheet's chips and the map's own key, which are two views of
  // the same switch.
  const toggleCategory = useCallback((key) => {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
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

  const stack = stacks[tab] ?? EMPTY_STACK;
  const view = stack[stack.length - 1] ?? null;

  /* ---------- where "back" comes from ----------
   *
   * On a phone, back is not the button in the corner of the sheet. It is the
   * hardware button on an Android, and the swipe in from the left edge on
   * both — a browser gesture, decided by the browser before any handler in
   * this page is asked, and not suppressible from a page in any reliable way.
   * Measured: a drag from the left edge navigates the browser off the app
   * whatever the sheet does about pointer events.
   *
   * So the app answers it instead of fighting it. Every forward move — a
   * screen pushed, a tab stepped to — puts a snapshot of the whole navigation
   * state into the history stack, and going back restores the snapshot the
   * browser hands over. The edge swipe and the Android back button then walk
   * back through the app one screen at a time, and only leave when there is
   * nothing left to go back to, which is what a person expects of both.
   *
   * Snapshots rather than a count of entries: there is no arithmetic to get
   * wrong, and an entry can be corrected in place when the app closes a screen
   * on its own — a walk ending takes its directions screen with it.
   */
  const navRef = useRef({ tab: 'explore', stacks: null });
  useEffect(() => {
    navRef.current = { tab, stacks };
  }, [tab, stacks]);

  /** Put a navigation state on screen, without touching history. */
  const applyNav = useCallback((next, dir) => {
    if (!next) return;
    tabRef.current = next.tab;
    setMotion(dir);
    setTab(next.tab);
    setStacks(next.stacks);
  }, []);

  // The handlers below are called from callbacks that must not be rebuilt every
  // time the tab changes, so they read the current tab through a ref rather
  // than closing over it.
  const tabRef = useRef('explore');
  // The tab ids in bar order, for the gestures that step along it.
  const tabsRef = useRef(TAB_ORDER);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  /** A forward move: on screen, and onto the history stack behind it. */
  const goForward = useCallback(
    (next, dir) => {
      applyNav(next, dir);
      // Spread whatever is already there: the router keeps its own bookkeeping
      // in history.state, and replacing the object wholesale strands it — the
      // symptom is a back that skips every intermediate entry and lands on the
      // first one.
      window.history.pushState({ ...window.history.state, tracker: next }, '');
      // A little confirmation under the thumb. The screen has already changed
      // by the time a phone this size has finished animating, and on a bright
      // midway the tap is often felt before it is seen.
      navigator.vibrate?.(8);
    },
    [applyNav],
  );

  /** Push a screen onto a tab's stack — its own tab unless told otherwise. */
  const push = useCallback(
    (next, target) => {
      const id = target || tabRef.current;
      const { stacks: cur } = navRef.current;
      const onIt = cur[id] || EMPTY_STACK;
      if (id === tabRef.current && onIt[onIt.length - 1] === next) return;
      goForward(
        { tab: id, stacks: { ...cur, [id]: [...onIt, next] } },
        'fromRight',
      );
      setSheet((h) => (h === 'peek' ? 'half' : h));
    },
    [goForward],
  );

  /**
   * Up one level — what the button in the sheet's navigation bar means.
   *
   * This is deliberately not `history.back()`, which is the *other* back and a
   * different question. The phone's back retraces: it undoes the last move you
   * made, wherever that was. This one climbs: it takes the top screen off the
   * stack you are looking at. They agree almost always and part company as
   * soon as tabs remember where they were left — leave a screen open on Me,
   * visit Rides, come back, and retracing lands on Rides while climbing goes
   * up to Me's root. Next to a title, in a navigation bar, "Back" can only
   * sensibly mean the second one.
   *
   * The entry it is standing on is corrected on the way, so a later retrace
   * through here shows what was actually on screen at the time.
   */
  const pop = useCallback(() => {
    const { tab: at, stacks: cur } = navRef.current;
    const onIt = cur[at] || EMPTY_STACK;
    if (!onIt.length) return;
    const next = { tab: at, stacks: { ...cur, [at]: onIt.slice(0, -1) } };
    applyNav(next, 'fromLeft');
    window.history.replaceState({ ...window.history.state, tracker: next }, '');
  }, [applyNav]);

  /**
   * Move along the tab bar. Tapping the tab you are already on unwinds that
   * tab's stack back to its root, which is what every phone tab bar does and
   * the only way back out of a screen without reaching for the back button.
   */
  const selectTab = useCallback(
    (id) => {
      const current = tabRef.current;
      const { stacks: cur } = navRef.current;
      if (id === current) {
        // Unwinding to the root is climbing, like the back button above, so it
        // goes the same way: straight there, correcting the entry it is on.
        if (!cur[id]?.length) return;
        const next = { tab: id, stacks: { ...cur, [id]: [] } };
        applyNav(next, 'fromLeft');
        window.history.replaceState({ ...window.history.state, tracker: next }, '');
        return;
      }
      goForward(
        { tab: id, stacks: cur },
        TAB_ORDER.indexOf(id) > TAB_ORDER.indexOf(current) ? 'fromRight' : 'fromLeft',
      );
      // Explore is read over the top of the map and keeps whatever stop the sheet
      // was left at. The other three are screens you went to read, so they come
      // up far enough to have something on them.
      if (id !== 'explore') setSheet((h) => (h === 'peek' ? 'half' : h));
    },
    [goForward, applyNav],
  );

  // The browser handing back an earlier snapshot is the only thing that ever
  // moves this app backwards, whether the visitor pressed a button, swiped the
  // edge, or held the one on the phone itself.
  useEffect(() => {
    // The entry the app opened on is home. Stamped on mount so that a reload
    // does not leave a stale snapshot on the current entry.
    window.history.replaceState(
      { ...window.history.state, tracker: { tab: 'explore', stacks: HOME_STACKS } },
      '',
    );
    const onPop = (e) => {
      applyNav(e.state?.tracker ?? { tab: 'explore', stacks: HOME_STACKS }, 'fromLeft');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyNav]);

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

  /*
   * Live status: what the sky is doing, and what the party has walked past.
   *
   * The clock is state rather than a Date.now() in the render, so every "12 min
   * ago" on screen agrees with every other one, and so a report visibly ages
   * without anything else having to change. A minute is as fine as this needs
   * to be — nothing here is measured in seconds.
   */
  // Keyed to whichever venue is loaded, not to a module constant: switching
  // parks has to move the forecast with the map, and a phone that opened on
  // Kings Island from a sofa in Texas must not read San Antonio's sky.
  const weatherFeed = useWeather(venue?.center ?? null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const identityRef = useRef(null);
  const positionRef = useRef(null);
  const helpSeen = useRef(new Set());

  /* ---------- boot ---------- */
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      // Tapping a notification while the app is already open means "show me
      // this", and the worker cannot navigate the page itself.
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type !== 'notification-open') return;
        if (e.data.focus) setTab('party');
      });
    }
  }, []);

  // The venue is the map, the places and the bounds. Which one loads is the
  // visitor's last choice, or the deployment's default; the first GPS fix gets
  // to correct that if it lands inside a different one.
  useEffect(() => {
    bootVenue().catch((err) => setToast(err?.message || 'Could not load the map.'));
  }, []);

  /**
   * The park the intake still has to ask about, if any. A fix is the first
   * moment the app can say anything useful about which of the maps it ships is
   * the one you want, so that is when it asks — and it asks once, because
   * answering is what sets `venueConfirmed` and stops it.
   */
  const parkChoice = useMemo(() => {
    if (parkAsked || !manifest || !position) return null;
    return venueChoiceFor(manifest, position.lat, position.lng, {
      confirmed: venueConfirmed,
      pinned: venuePinned,
    });
  }, [parkAsked, manifest, position, venueConfirmed, venuePinned]);

  /** The other parks, nearest first, for when the nearest one is the wrong guess. */
  const parkOptions = useMemo(() => {
    if (!parkChoice || !position) return [];
    return venuesByDistance(manifest, position.lat, position.lng).filter(
      (row) => row.venue.id !== parkChoice.venue.id,
    );
  }, [parkChoice, manifest, position]);

  const askingPark = Boolean(parkChoice);
  /** The question is only load-bearing while it is actually on screen. */
  const showParkPrompt = gateOpen && askingPark;

  useEffect(() => {
    if (!position || position.manual) return;
    // Both ends of the intake question outrank this. A fix that is about to be
    // asked about should not be acted on first — answering is what loads a
    // park, and switching underneath the question would download the map twice
    // and make the question look rhetorical. A fix that has already been asked
    // about should not reopen it: from then on the only thing allowed to move
    // the map is the phone hosting the party.
    if (showParkPrompt || venueConfirmed) return;
    retargetForPosition(position.lat, position.lng)
      .then((moved) => {
        if (moved) showToast(`Switched to ${moved.name}`);
      })
      .catch(() => {});
    // Only the first unanswered fix matters here: after that the visitor is
    // inside a venue and re-checking on every GPS tick would fight a deliberate
    // choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(position), showParkPrompt, venueConfirmed]);

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
    partyRef.current = party;
  }, [party]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const measure = () => setViewportH(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Close the gate when the fix actually lands — unless the fix has just earned
  // the intake its second question, in which case the gate stays up and shows
  // that instead. Checking this inside the "Allow location" handler cannot
  // work: the permission prompt and the first fix are both async, so status is
  // still 'asking' when the click returns and nothing looks again. The gate
  // then sits over the whole UI intercepting taps, and the only way out reads
  // "Just show me the park map" — which is the opposite of what someone who
  // just granted location wants.
  useEffect(() => {
    if (geo.status === 'live' && !askingPark) setGateOpen(false);
  }, [geo.status, askingPark]);

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
        heading: Number.isFinite(m.location?.heading) ? m.location.heading : null,
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

  /* ---------- notifications ---------- */

  /* A phone in a pocket has no in-app toast and no vibration it will feel
     through a bag. What the app knows has to reach the lock screen, which means
     the notification has to survive the page not existing — so it is sealed
     here with the party key and opened by the service worker.

     Everything below sends; nothing below decides whether to show. That is the
     receiving phone's call, and its preferences, which is the only place that
     knows what its owner asked for. */
  const [pushPrefs, setPushPrefs] = useState(notifier.defaultPrefs);
  const [pushState, setPushState] = useState('idle');
  const seenIds = useRef(null);
  const quietSeen = useRef(new Set());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PUSH_PREFS_KEY) || 'null');
      if (saved) setPushPrefs((p) => ({ ...p, ...saved }));
    } catch {
      /* nothing saved */
    }
    setPushState(notifier.permission());
  }, []);

  useEffect(() => {
    localStorage.setItem(PUSH_PREFS_KEY, JSON.stringify(pushPrefs));
  }, [pushPrefs]);

  // The worker reads this off disk when a push wakes it, so it has to be
  // written before one can arrive — and cleared on leaving, which is what makes
  // a push from a party you have left unreadable on this phone.
  useEffect(() => {
    notifier.rememberParty(
      party?.active && party?.partyId && party?.keyString
        ? { partyId: party.partyId, keyString: party.keyString, selfId: party.selfId }
        : null,
      pushPrefs,
    );
  }, [party?.active, party?.partyId, party?.keyString, party?.selfId, pushPrefs]);

  const pushNote = useCallback(
    (note, urgent = false) => {
      const p = partyRef.current;
      if (!p?.active || !p.partyId || !p.keyString) return;
      notifier.notify({ partyId: p.partyId, keyString: p.keyString, from: p.selfId, note, urgent });
    },
    [],
  );

  const enablePush = useCallback(async () => {
    const p = partyRef.current;
    const result = await notifier.enable({ partyId: p?.partyId, memberId: p?.selfId });
    setPushState(result === 'granted' ? 'granted' : result);
    showToast(
      {
        granted: 'This phone will tell you, even when it is locked',
        denied: 'Notifications are blocked for this site in your phone settings',
        unconfigured: 'This deployment has no notification keys set up',
        unsupported: 'This browser cannot show notifications',
        failed: 'Could not turn notifications on',
      }[result] || 'Could not turn notifications on',
    );
  }, [showToast]);

  /* Arrivals, departures and going quiet are all changes to the roster rather
     than actions anyone takes, so somebody has to notice them and say so. The
     host does, alone: every phone noticing would send the same news N times. */
  useEffect(() => {
    if (!party?.active || !party?.hosting) {
      seenIds.current = null;
      return;
    }
    const now = Date.now();
    const ids = new Set(roster.map((m) => m.id));
    const before = seenIds.current;
    seenIds.current = ids;
    if (!before) return; // first roster after becoming host is not news

    for (const m of roster) {
      if (m.id === party.selfId || before.has(m.id)) continue;
      pushNote({ kind: 'join', title: `${m.name} joined your party`, body: 'They are on the map now.' });
    }
    for (const id of before) {
      if (ids.has(id)) continue;
      pushNote({ kind: 'join', title: 'Someone left your party', body: 'They are off the map now.' });
    }

    for (const m of roster) {
      if (m.id === party.selfId) continue;
      const silent = now - (m.ts || 0);
      if (silent > QUIET_AFTER_MS && !quietSeen.current.has(m.id)) {
        quietSeen.current.add(m.id);
        pushNote({
          kind: 'quiet',
          title: `No word from ${m.name}`,
          body: 'Their phone has not reported in for a while.',
          focus: { kind: 'member', id: m.id, label: m.name },
        });
      }
      if (silent < QUIET_AFTER_MS) quietSeen.current.delete(m.id);
    }
  }, [roster, party?.active, party?.hosting, party?.selfId, pushNote]);

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

  const joinParty = async (raw, asName = null) => {
    setBusy(true);
    try {
      // A name typed on the join screen is the freshest thing we know, and it
      // has not necessarily been committed to identity yet.
      const memberName = (asName || '').trim() || identity?.name || 'Guest';
      const snap = await runtime.current.joinParty(raw, { memberName });
      showToast(`Joined ${snap.code}`);
    } catch (err) {
      showToast(err?.message || 'Could not join that party.');
    }
    setBusy(false);
  };

  /* A host answers key-requests for ten minutes and then stops, which is what
     keeps a guessed six-character code worthless. The window used to open once
     and never reopen, so a party started in the car park could not be joined by
     typed code by the time everyone was through the turnstiles — and nothing on
     any screen said so, because a link or a QR carries its own key and still
     worked. The host's code being on screen is exactly the condition the window
     was written for, so that is what reopens it. */
  const allowJoins = useCallback(() => runtime.current?.allowJoins(), []);

  useEffect(() => {
    if (tab !== 'party' || !party?.active || !party?.hosting) return undefined;
    allowJoins();
    const onVisible = () => {
      if (!document.hidden) allowJoins();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [tab, party?.active, party?.hosting, allowJoins]);

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
      pushNote({
        kind: 'meet',
        title: `${identity?.name || 'Someone'} set the meet-up`,
        body: record.label,
        focus: { kind: 'meet', label: record.label },
      });
    } else {
      setLocalMeet({ ...record, by: identity?.name || 'Someone', ts: Date.now() });
      showToast('Meet-up marked (join a party to share it)');
    }
  };

  const clearMeet = () => {
    setLocalMeet(null);
    if (!active) return;
    runtime.current?.setMeet(null);
    // On everyone else's phone a cleared meet-up simply vanishes, which is the
    // one change to it nobody is told about.
    pushNote({
      kind: 'meet',
      title: `${identity?.name || 'Someone'} cleared the meet-up`,
      body: 'There is no meeting point set now.',
    });
  };

  /* ---------- derived ---------- */
  /* The map is told the verdict, not just the refusals. Fading a ride out was
     ambiguous — it looked exactly like a party member we had not heard from —
     so ParkMap now draws "too short" and "needs a grown-up" as symbols, and
     that needs the whole answer rather than a set of names to dim. */
  const rideEligibility = useMemo(() => {
    if (height == null) return null;
    const out = new Map();
    POIS.forEach((p) => {
      if (p.c !== 'coaster' && p.c !== 'ride') return;
      out.set(p.n, eligibility(p, height, withAdult));
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

  /** The party's ride reports, or an empty map when there is no party. */
  const partyRides = party?.rides ?? null;

  const liveSummary = useMemo(
    () => statusSummary(POIS, partyRides, weatherFeed.weather, clock),
    // POIS belongs in here now that it changes with the venue: switching parks
    // has to recount, or the banner keeps the last park's tally.
    [POIS, partyRides, weatherFeed.weather, clock],
  );

  const reportRide = useCallback((rideId, status) => {
    const applied = runtime.current?.reportRide(rideId, status);
    if (applied === null) showToast('Join a party to report a ride');
    return applied;
  }, [showToast]);

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
    // A walk ending closes its own directions screen. If that screen is the one
    // showing, going back is what closes it; if it is buried, the entry is
    // corrected in place so that backing into it later does not resurrect a
    // walk that is over.
    const { tab: at, stacks: cur } = navRef.current;
    const explore = cur.explore || EMPTY_STACK;
    if (explore.includes('route')) {
      const next = { tab: at, stacks: { ...cur, explore: explore.filter((v) => v !== 'route') } };
      applyNav(next, 'fromLeft');
      window.history.replaceState({ ...window.history.state, tracker: next }, '');
    }
    setSheet('peek');
  }, [applyNav]);

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

  /**
   * One line under a tab's large title, saying where that tab stands right now.
   * It is the value that used to sit on the right of the row this tab replaced
   * — the same answer, in the place it now belongs.
   */
  const rootSubtitle = useMemo(() => {
    if (tab === 'party') return active ? `${roster.length} on the map` : 'Not started';
    if (tab === 'rides') {
      if (height == null) return 'No rider height set';
      return rideableCount != null
        ? `${height}" · ${rideableCount} of ${totalRides} rides`
        : `${height}"`;
    }
    if (tab === 'settings') return identity?.name || 'Guest';
    return '';
  }, [tab, active, roster.length, height, rideableCount, totalRides, identity?.name]);

  /* ---------- the tab bar ---------- */

  /** Somebody in the party is in trouble — the Party tab has to say so. */
  const helpNow = useMemo(() => others.some((m) => m.status === 'NEED HELP'), [others]);

  const tabs = useMemo(() => {
    const out = [
      { id: 'explore', label: 'Explore', icon: 'magnifyingglass' },
      {
        id: 'party',
        label: 'Party',
        icon: 'person.2.fill',
        // A count while a party is running, and red the moment one of them
        // needs help — a tab bar is the only chrome always on screen, so it is
        // the right place for the one thing that must never be missed.
        badge: helpNow ? '!' : active ? roster.length : null,
        badgeLabel: helpNow ? 'someone needs help' : active ? `${roster.length} on the map` : null,
        alert: helpNow,
      },
    ];
    // Height rules only exist where a venue publishes them, so neither does the
    // tab that reads them.
    if (heights) out.push({ id: 'rides', label: 'Rides', icon: 'figure.rollercoaster' });
    // Once there is a name, the tab wears it. "Guest" is the placeholder
    // nobody typed, and "GU" on a tab is not a person — so that one keeps the
    // generic glyph until the visitor says who they are.
    const named = identity?.name && identity.name !== 'Guest';
    out.push({
      id: 'settings',
      label: 'Me',
      icon: 'person.crop.circle.fill',
      initials: named ? initialsFor(identity.name) : null,
    });
    return out;
  }, [helpNow, active, roster.length, heights, identity?.name]);

  useEffect(() => {
    tabsRef.current = tabs.map((t) => t.id);
  }, [tabs]);

  // Switching to a venue with no height rules while standing on the Rides tab
  // would leave the sheet on a screen with no way back to it.
  useEffect(() => {
    if (!heights && tab === 'rides') selectTab('explore');
  }, [heights, tab, selectTab]);

  /* ---------- the sheet's own gestures ---------- */

  // While a route is running the sheet is out of the way unless it is asked
  // for: the map and the two HUD strips are the whole interface, and the sheet
  // comes back over them only when you open the steps.
  const stowed = previewing || (walking && sheet === 'peek');

  const stops = useMemo(
    () => ({
      peek: PEEK_PX,
      half: Math.round(SHEET_OPEN.half * viewportH),
      full: Math.round(SHEET_OPEN.full * viewportH),
    }),
    [viewportH],
  );
  const drag = useSheetDrag({ stops, stop: sheet, onStop: setSheet });

  // `atMap` marks the screen that is read over the top of the map rather than
  // instead of it — the one the peek stop is designed around.
  const sheetClass = `sheet ${sheet} ${tab === 'explore' ? 'atMap' : ''} ${
    stowed ? 'stowed' : ''
  } ${drag.dragging ? 'dragging' : ''}`;

  // The same stops, as a number of pixels, for the map's own label layout.
  const floorPx = stowed
    ? STOWED_PX
    : Math.round((SHEET_OPEN[sheet] ?? 0) * viewportH) + (SHEET_INSET[sheet] ?? 0) ||
      SHEET_PEEK_PX;

  return (
    // data-sheet publishes the sheet's stop as a CSS custom property, so the
    // FABs, the toast, the zoom pad and the scale bar all ride up and down with
    // it on one shared easing instead of each keeping its own copy of the stops.
    <main className="app" data-sheet={stowed ? 'stowed' : sheet}>
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
        rideEligibility={rideEligibility}
        visibleCategories={categories}
        onToggleCategory={toggleCategory}
        focusPoint={focusPoint}
        theme={theme}
        route={navTarget ? route : null}
        routeStep={walking ? progress?.step ?? null : null}
        routeAhead={routeAhead}
        routeDone={routeDone}
        routeTargetName={navTarget?.kind === 'poi' ? navTarget.label : null}
        alternatives={shownAlternatives}
        onPickAlternative={setPick}
        puck={puck}
        bottomInset={floorPx}
        rotation={rotation}
        liftCentre={walking ? 0.2 : previewing ? -0.12 : 0}
        navZoom={walking ? 3 : null}
        fitPoints={previewing ? route?.points : null}
        fitKey={previewing ? `${navKeyOf(navTarget)}:${pick}:${Math.round(route?.metres ?? 0)}` : null}
      />

      {/* Nothing runs across the top of a phone map. The two controls float in
          the corner and the rest of the frame is map. */}
      <header className="topbar">
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

      <WeatherBanner
        weather={weatherFeed.weather}
        summary={liveSummary}
        at={weatherFeed.at}
        stale={weatherFeed.stale}
        offline={weatherFeed.offline}
        now={clock}
        onOpen={() => {
          // It says "open the rides list", so it opens the list — the places
          // screen, filtered to the rides the headline is about.
          selectTab('explore');
          setFilter('coaster');
          setSheet('half');
        }}
      />

      {heights && height != null && (
        <button
          type="button"
          className="filterBadge"
          onClick={() => selectTab('rides')}
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
          onSteps={() => push('route', 'explore')}
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
          onSteps={() => push('route', 'explore')}
          onStop={stopNav}
        />
      )}

      <section
        className={sheetClass}
        style={drag.height != null ? { height: `${drag.height}px` } : undefined}
      >
        <button
          type="button"
          className="grab"
          onClick={() => {
            // A drag that ended on this handle emits a click too. It has
            // already chosen a stop; cycling on top of it would undo it.
            if (drag.swallowClick()) return;
            setSheet(sheet === 'full' ? 'peek' : sheet === 'half' ? 'full' : 'half');
          }}
          aria-label="Resize panel"
          {...drag.handlers}
        >
          <i />
        </button>

        {/* One key for the whole screen — header and body together — so a push,
            a pop or a move along the tab bar replays the slide as a single
            piece of paper rather than two halves arriving separately. */}
        <div
          className="sheetStage"
          key={`${tab}:${stack.length}:${view || 'root'}`}
          data-motion={motion}
        >
          {view ? (
            <header className="navHead">
              <button type="button" className="navBack" onClick={pop}>
                <Icon name="chevron.left" size={19} />
                Back
              </button>
              <h2>{VIEW_TITLES[view] || ''}</h2>
              <span className="navHeadPad" aria-hidden="true" />
            </header>
          ) : tab === 'explore' ? (
            <>
              {/* Search is the way into a map, so it is the first thing in the
                  sheet and it never scrolls away. */}
              <div className="searchRow">
                <div className="searchField">
                  <Icon name="magnifyingglass" size={17} />
                  <input
                    className="field"
                    placeholder={`Search ${venue?.name || 'the map'}`}
                    value={query}
                    onFocus={() => setSheet((h) => (h === 'peek' ? 'half' : h))}
                    onChange={(e) => {
                      // Starting to type is a new question, so it clears a
                      // category left on from browsing. Only on the first
                      // keystroke: tapping a chip part-way through a query is
                      // deliberate and has to survive the next one.
                      const next = e.target.value;
                      if (!query && next) setFilter('all');
                      setQuery(next);
                    }}
                    aria-label="Search places"
                  />
                  {query && (
                    <button
                      type="button"
                      className="searchClear"
                      onClick={() => setQuery('')}
                      aria-label="Clear the search"
                    >
                      <Icon name="xmark.circle.fill" size={18} />
                    </button>
                  )}
                </div>
              </div>
              <div className="brand">
                <b>{venue?.name || 'Party tracker'}</b>
                <span>{headerLine()}</span>
              </div>
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
                onOpenParty={() => selectTab('party')}
              />
              {/* At the peek stop the list below is not merely scrolled off,
                  it is not rendered — which is the right call, but it leaves a
                  36×5px grey pill as the only evidence that the sheet moves.
                  Say what is under there, in words, and make the words the
                  handle. */}
              {sheet === 'peek' ? (
                <button type="button" className="moreHint" onClick={() => setSheet('half')}>
                  Pull up for every place — food, toilets and rides
                  <Icon name="chevron.up" size={13} />
                </button>
              ) : null}
            </>
          ) : (
            /* A tab's own root: the large title a phone puts at the top of a
               screen you arrived at rather than drilled into, and one line
               underneath saying where that tab currently stands. */
            <header className="sheetHead">
              <h2>{ROOT_TITLES[tab]}</h2>
              <span>{rootSubtitle}</span>
            </header>
          )}

          <div className="sheetBody">
            {view === null && tab === 'explore' && (
              <>
                {/* The one row left on this screen. Everywhere else it used to
                    lead is a tab now; a walk in progress is not a place, so it
                    stays here, and only while there is one. */}
                {navTarget && (
                  <div className="rowList">
                    <button type="button" className="row" onClick={() => push('route')}>
                      <span className="rowText">Directions</span>
                      <span className="rowValue">{navTarget.label}</span>
                    </button>
                  </div>
                )}
                <PlaceList
                  me={position}
                  height={height}
                  withAdult={withAdult}
                  query={query}
                  filter={filter}
                  onFilter={setFilter}
                  onlyRideable={onlyRideable}
                  onOnlyRideable={setOnlyRideable}
                  selected={selected}
                  onSelect={handleSelect}
                  onSetMeet={(p) => setMeetPoint(p.lat, p.lng, p.n)}
                  onNavigate={startNav}
                  theme={theme}
                  weather={weatherFeed.weather}
                  rides={partyRides}
                  // Reporting needs somewhere to send it. Outside a party the list
                  // still shows the forecast, minus the buttons.
                  onReport={party?.active ? reportRide : null}
                  now={clock}
                />
              </>
            )}

            {view === 'route' && (
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

            {view === null && tab === 'party' && (
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
                  if (s === 'NEED HELP') {
                    const me = positionRef.current;
                    pushNote(
                      {
                        kind: 'help',
                        title: `${identity?.name || 'Someone'} needs help`,
                        body: me ? 'Tap to see where they are.' : 'Tap to open the map.',
                        focus: party?.selfId
                          ? { kind: 'member', id: party.selfId, label: identity?.name || 'Someone' }
                          : null,
                      },
                      true,
                    );
                  }
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
                myName={identity?.name ?? ''}
                onName={(v) => {
                  const next = v.trim() || 'Guest';
                  setIdentity((i) => ({ ...i, name: next }));
                  runtime.current?.setMemberName(next);
                }}
                onCopied={showToast}
                pushState={pushState}
                onEnablePush={enablePush}
                pushNeedsInstall={notifier.iosNeedsInstall()}
                joinsOpenUntil={party?.joinsOpenUntil ?? 0}
                onAllowJoins={() => {
                  allowJoins();
                  showToast('Anyone with the code can join for the next 10 minutes');
                }}
                transport={party?.transport ?? null}
                version={party?.version ?? 0}
                queued={party?.queued ?? 0}
              />
            )}

            {view === null && tab === 'rides' && (
              <HeightPanel
                height={height}
                withAdult={withAdult}
                onHeight={setHeight}
                onWithAdult={setWithAdult}
                venue={venue}
              />
            )}

            {view === null && tab === 'settings' && (
              <SettingsPanel
                identity={identity}
                onName={(v) => setIdentity((i) => ({ ...i, name: v.trim() || 'Guest' }))}
                onNameCommit={(v) => runtime.current?.setMemberName(v.trim() || 'Guest')}
                position={position}
                onLocationSettings={() => setGateOpen(true)}
                theme={theme}
                onTheme={setTheme}
                categoryCount={categories.size}
                categoryTotal={Object.keys(CATEGORIES).length}
                venueName={venue?.name}
                onPush={push}
                pushKinds={notifier.KINDS}
                pushPrefs={pushPrefs}
                onPushPref={(key, on) => setPushPrefs((p) => ({ ...p, [key]: on }))}
                pushState={pushState}
                onEnablePush={enablePush}
                pushNeedsInstall={notifier.iosNeedsInstall()}
              />
            )}

            {view === 'categories' && (
              <div>
                <div className="chips wrap">
                  {Object.entries(CATEGORIES).map(([key, cat]) => (
                    <button
                      key={key}
                      type="button"
                      className={`chip ${categories.has(key) ? 'on' : ''}`}
                      onClick={() => toggleCategory(key)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
                <p className="fine">
                  Anything switched off here stops drawing on the map. It stays in search.
                </p>
              </div>
            )}

            {view === 'venues' && (
              <div>
                <p className="fine">
                  Picking one here keeps it, and stops the app moving you off it.
                </p>
                <div className="venueList">
                  {(manifest?.venues || []).map((v) => {
                    // Measured from whatever is deciding the map: the host's
                    // position while a party is running, this phone's otherwise.
                    const from = hostLocation || position;
                    const inside = from && withinBounds(v.bounds, from.lat, from.lng);
                    const away =
                      from && !inside
                        ? distance(from.lat, from.lng, v.center.lat, v.center.lng)
                        : null;
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
                        {v.id === venue?.id && (
                          <Icon name="checkmark" size={17} className="icn rowCheck" />
                        )}
                        <span>
                          {[
                            v.locality,
                            from == null ? null : inside ? here : `${formatDistance(away)} ${off}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {venuePinned ? (
                  <button
                    type="button"
                    className="row"
                    onClick={() => {
                      unpinVenue();
                      showToast('Following your party again');
                    }}
                  >
                    <span>Follow my party again</span>
                    <Icon name="chevron.right" size={17} className="icn rowChevron" />
                  </button>
                ) : null}
                <p className="fine">
                  {venuePinned
                    ? 'You picked this map by hand, so the app is not moving you off it. Tap above to let it follow your party again.'
                    : 'Left alone, this opens the map you used last, then follows the phone hosting your party — or your own first fix, if there is no party running.'}
                </p>
                <p className="fine">
                  The map is drawn from OpenStreetMap geometry — real paths, buildings, water and
                  ride track, painted as vectors rather than copied from anyone&apos;s printed
                  map. {venue?.credits || ''} Every map here was built by
                  <code> npm run venues:build</code>, so anywhere OpenStreetMap covers can become
                  one.
                </p>
              </div>
            )}

            {view === 'diagnostics' && <Diagnostics runtime={runtimeApi} geo={geo} />}
          </div>
        </div>

        {/* Last in the sheet and last on screen: the one control that is always
            in the same place, whatever else is happening above it. */}
        <TabBar tabs={tabs} active={tab} onSelect={selectTab} />
      </section>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {/* The intake, in the order the answers become possible: location first,
          because nothing else can be decided without a fix, then which park —
          which is the question that actually builds a map. */}
      {showParkPrompt && (
        <ParkPrompt
          choice={parkChoice}
          options={parkOptions}
          busy={venueStatus === 'loading'}
          error={venueStatus === 'error' ? venueError : null}
          onConfirm={(id) => {
            confirmVenue(id)
              .then((v) => {
                setSelected(null);
                // Following your own dot only makes sense on a map you are
                // standing on; from the road, the park itself is the view.
                setFollow(Boolean(position) && withinBounds(v.bounds, position.lat, position.lng));
                showToast(`${v.name} is ready`);
              })
              .catch((err) => showToast(err?.message || 'Could not build that map.'));
          }}
          onSkip={() => {
            setParkAsked(true);
            setGateOpen(false);
          }}
        />
      )}

      {gateOpen && !showParkPrompt && (
        <GpsGate
          venueName={venue?.name}
          status={geo.status}
          error={geo.error}
          onRequest={() => {
            geo.request();
            geo.enableCompass();
          }}
          onManual={() => {
            // Waving the intake off waves off both of its questions: whichever
            // one you come back for, you came back deliberately, and the one
            // you get should be the one this button is under.
            setParkAsked(true);
            setGateOpen(false);
            showToast('Tap the map to place yourself');
          }}
          onDismiss={() => {
            // Waving both questions off leaves whichever park happened to boot,
            // which is the one place the app can be showing somebody a map of
            // somewhere they are not. Name it, so that is a fact rather than a
            // surprise found later.
            setParkAsked(true);
            setGateOpen(false);
            if (venue?.name) showToast(`Showing ${venue.name}. Change it under Me → Which map.`);
          }}
        />
      )}
    </main>
  );
}
