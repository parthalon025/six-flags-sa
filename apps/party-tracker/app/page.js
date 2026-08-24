'use client';

import dynamic from 'next/dynamic';
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ParkMap from '@/components/ParkMap';
import MapAttribution from '@/components/MapAttribution';
import VenueLoadFade from '@/components/VenueLoadFade';
import { DISPLAY_SPIKE_VENUE, mapLibreDisplayEnabled } from '@/lib/mapLibreConfigured';
import Icon from '@/components/Icon';
import GpsGate from '@/components/GpsGate';
import ParkPrompt from '@/components/ParkPrompt';
import SpotCapsule from '@/components/SpotCapsule';
import SelectionCapsule from '@/components/SelectionCapsule';
import NavBanner from '@/components/NavBanner';
import NavBar from '@/components/NavBar';
import TabBar from '@/components/TabBar';
import WeatherBanner from '@/components/WeatherBanner';
import IntroSplash from '@/components/IntroSplash';
import BrandLockup from '@/components/BrandLockup';
import BrandMark from '@/components/BrandMark';
import useSheetDrag from '@/components/useSheetDrag';
import useGeolocation from '@/components/useGeolocation';
import useVoiceGuidance from '@/components/useVoiceGuidance';
import useWeather from '@/components/useWeather';
import useAppUpdate from '@/components/useAppUpdate';
import useMovementLog from '@/components/useMovementLog';
import { BRAND, GLYPHS, WORDS } from '@/lib/brand';
import { INTRO_KEY, firstRunOverlay } from '@/lib/introGate';
import { haptic, listenInviteUrls, pushWatchCompass, registerPush, shouldRegisterPush } from '@/lib/native';
import { loadWatchSettings, mapRotationDegrees, watchCompassPushState } from '@/lib/compass';
import {
  SHEET_GAP,
  SHEET_LIST_AT_PX,
  SHEET_PEEK_PX,
  sheetPlacePx,
  nextSheetStop,
  sheetCrowdsMap,
  sheetForm,
  sheetPlan,
  sheetStops,
} from '@/lib/sheet';
import { CATEGORIES, hasHeights, isRideable } from '@/lib/park';
import { fromFacts, peopleFor } from '@/lib/eligibility';
import { clearDraft, loadDraft, promote, saveDraft, star, view as planView } from '@/lib/plan';
import { statusSummary } from '@/lib/rideStatus';
import { profilesForCoverage, profileOpts } from '@/lib/routingProfiles';
import {
  bootVenue,
  confirmVenue,
  retargetForPosition,
  selectVenue,
  setOverlay,
  unpinVenue,
  intakeChoiceFor,
  venuesByDistance,
  withinBounds,
} from '@/lib/venue/store';
import { usePlacesAsShippedForResearchOnly, useVenue } from '@/lib/venue/useVenue';
import { syncVenueBundle } from '@/lib/venue/download';
import { findPlace, identityOf, placeNav } from '@/lib/venue/ids';
import {
  capture,
  locationReadyToJoin,
  locationRevokedInParty,
  PRECISE_MAX_MS,
  view as locationView,
} from '@/lib/location';
import { newMemberId } from '@/lib/core/ids';
import { clearPendingInvite } from '@/lib/party/inviteStash';
import { mapDisplayPosition } from '@/lib/gps/display';
import { FOLLOW_RESUME_MS, followShouldResume } from '@/lib/parkMapView';
import { resolveSession } from '@/lib/auth/session';
import { listManagedGuests, upsertManagedGuest } from '@/lib/auth/profileCache';
import { useAuth } from '@clerk/nextjs';
import AuthBridge from '@/components/AuthBridge';
import ClerkSetupRequired from '@/components/ClerkSetupRequired';
import { clearGuestChoice } from '@/lib/auth/guestChoice';
import { clerkBrowserConfigured, clerkCiKeylessOk } from '@/lib/clerkConfigured';
import { seedFromManagedGuest } from '@party-tracker/shared/schemas.js';
// Namespaced: `push` on its own is already the navigation stack's push.
import * as notifier from '@/lib/push/client';
import { bearing, cardinal, distance, formatDistance, formatWalk } from '@/lib/geo';
import { bestEntrance, entranceMeta, entranceLine } from '@/lib/entrance';
import { placeContext } from '@/lib/venue/placeContext';
import { navKeyOf } from '@/lib/navKey';
import {
  applyMapSkin,
  applyThanksToProgress,
  createProgress,
  emptyWorld,
  grantGodmodeProgress,
  grantShipSkins,
  mergeWorlds,
  recordSideQuest,
  syncRankPrizes,
  visibleMarks,
  wearMap,
} from '@/lib/world';
import { loadWorld, saveWorld } from '@/lib/worldStore';
import {
  applyContribution as applyOverlayFact,
  completionLine,
  completionsForPlace,
  createHttpUploadAdapter,
  emptyOverlay,
  loadOverlay,
  saveOverlay,
  unionOverlays,
} from '@/lib/overlay';
import {
  categoriesForGate,
  cyclePaletteMode,
  fogMapStyle,
  paletteToggleAria,
  resolvePalette,
} from '@/lib/mapVisual';
import { spotAt } from '@/lib/spot';
import { liveFor, membersAt } from '@/lib/live';
import { paletteFor } from '@/lib/theme';
import { defaultQuestQueue } from '@/lib/adventure/questQueue';
import { flushQuestQueue } from '@/lib/adventure/questSync';
import { flushThanksQueue } from '@/lib/adventure/thanks';

const PartyPanel = dynamic(() => import('@/components/PartyPanel'), { ssr: false });
const PlaceList = dynamic(() => import('@/components/PlaceList'), { ssr: false });
const PlanPanel = dynamic(() => import('@/components/PlanPanel'), { ssr: false });
const MePanel = dynamic(() => import('@/components/MePanel'), { ssr: false });
const SettingsPanel = dynamic(() => import('@/components/SettingsPanel'), { ssr: false });
const WorldCloset = dynamic(() => import('@/components/WorldCloset'), { ssr: false });
const WorldMarks = dynamic(() => import('@/components/WorldMarks'), { ssr: false });
const PushSettings = dynamic(() => import('@/components/PushSettings'), { ssr: false });
const HiddenCards = dynamic(() => import('@/components/HiddenCards'), { ssr: false });
const SideQuestsPanel = dynamic(() => import('@/components/SideQuestsPanel'), { ssr: false });
const MovementHistoryPanel = dynamic(() => import('@/components/MovementHistoryPanel'), { ssr: false });
const Diagnostics = dynamic(() => import('@/components/Diagnostics'), { ssr: false });
const DirectionsPanel = dynamic(() => import('@/components/DirectionsPanel'), { ssr: false });
const PlaceDetail = dynamic(() => import('@/components/PlaceDetail'), { ssr: false });
const RoutePreview = dynamic(() => import('@/components/RoutePreview'), { ssr: false });
const IntelligencePanel = dynamic(() => import('@/components/IntelligencePanel'), { ssr: false });
const CompassTape = dynamic(() => import('@/components/CompassTape'), { ssr: false });
const WatchCompassSettings = dynamic(() => import('@/components/WatchCompassSettings'), { ssr: false });
const DisplayMap = dynamic(() => import('@/components/DisplayMap'), { ssr: false });

const PALETTE = ['#66B56A', '#27B8B0', '#9B6BFF', '#FF5C8A', '#5B7CFF', '#B8956A', '#FFC857', '#FF6B35'];
const colourFor = (id) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const initialsFor = (n) => (n || '?').trim().slice(0, 2).toUpperCase();

/* The titles a pushed screen wears in its nav bar. Party, Plan and Day are not
   in here: they are tabs now, and a tab's root screen carries a large title
   rather than a back button. */
const VIEW_TITLES = {
  route: 'Trail',
  place: 'Place',
  categories: 'On the map',
  venues: 'Explore Worlds',
  diagnostics: 'Diagnostics',
  movement: 'Walk history',
  'watch-compass': 'Watch Compass',
  /* Me is a root now (MePanel): the journey and the ladder are what the tab
     opens on, and everything that used to be stacked inside Settings is a
     screen under it. Collection sits between Me and Marks so backing out of a
     Mark lands on the Skins and Kits it belongs with, not on the tab root. */
  settings: 'Settings',
  closet: 'Collection',
  marks: 'Marks',
  notifications: 'Notifications',
  'hidden-cards': 'What the panel shows',
};

/* The tab bar, left to right. Parkbound's primary areas: Explore, Party,
   Side Quests, Plan, Me. The map itself is the canvas underneath — shut the
   sheet to live in it. The order is the whole of the animation's direction
   logic: moving right along the bar slides the next screen in from the right,
   and moving left slides it back. */
const TAB_ORDER = ['explore', 'party', 'quests', 'rides', 'settings'];

const EMPTY_STACK = [];
/** The navigation state the app opens on, and the one back returns it to. */
const HOME_STACKS = { explore: [], party: [], quests: [], rides: [], settings: [] };

/* What draws before anybody touches the key. Shops and car parks are off
   because they are the two categories a park has most of and a visitor asks
   about least.
   `campsite` is on, and is the one entry here that is not about a preference:
   at the three parks in two of them there is nothing under it, so it costs
   nothing — and at the one where there is, the person it matters to is asleep
   in it. Somebody looking for pitch 247 at eleven at night should not first
   have to discover that there is a key and that it has a switch in it. */
const DEFAULT_CATEGORIES = new Set([
  'coaster', 'ride', 'gate', 'landmark', 'service', 'food', 'restroom', 'campsite',
]);

/* Identity used to be filed under a key named after the one park this ran at.
   Read the old key once so nobody who already typed their name has to again. */
const IDENTITY_KEY = 'tracker-identity';
const LEGACY_IDENTITY_KEY = 'ki-identity';
const PUSH_PREFS_KEY = 'tracker-push-prefs';
/* Standing rail cards this visitor has got rid of, per venue — the parks do
   not have the same places, and hiding food at one should not hide it at the
   other. */
const HIDDEN_CARDS_KEY = 'tracker-hidden-cards';
/* Whether this phone has been told what the app is lives in INTRO_KEY
   (`lib/introGate.js`) so the before-paint boot script cannot drift. */
/* Where the car is, per venue. Per venue because the car parks are not the
   same one and a stale pin two states away is worse than no pin: it would put
   a card on the rail confidently pointing at Ohio. */
const CAR_KEY = 'tracker-car';
/** The standing cards, by the name the visitor saw on them. */
const CARD_LABELS = {
  restroom: 'Nearest restroom',
  food: 'Nearest food',
  firstaid: 'First aid',
  gonow: 'GO NOW',
};

/* How long a phone has to say nothing before the others are told it has gone
   quiet. Deliberately longer than the five minutes at which the roster row
   greys out: a queue building eats signal for that long routinely, and an alert
   that cries wolf is one that gets turned off. */
const QUIET_AFTER_MS = 12 * 60 * 1000;

/* What the sheet is standing on, as pixels. The CSS publishes it as --sheetH
   for the chrome that rides above it; the map needs the number itself, to lay
   its labels out above the furniture rather than behind it. The sheet floats
   clear of the bottom edge at its partial forms, so what the map is standing on
   is the height plus that gap; pulled to the top it is anchored and there is no
   gap. Both the height and the gap come out of lib/sheet.js — see that file for
   why the height is a number the visitor chooses rather than one of four. */
const STOWED_PX = 96;

/* Where the visitor last left the sheet. The split between map and list is a
   judgement they made about their own screen, and it should not be undone by
   the app being closed. */
const SHEET_KEY = 'party.sheet.height';

/** How often the broadcast gate is asked whether the current fix is worth sending. */
const GATE_TICK_MS = 4000;

/**
 * How far you, or whoever you are walking to, has to move before the route is
 * worked out again. A route costs well under a millisecond, but recomputing on
 * every GPS jitter makes the line twitch and the instruction flicker.
 */
const REROUTE_M = 12;

/** How far off the line counts as off-route — kept local so render does not pull in routing. */
const OFF_ROUTE_M = 32;

export default function Page() {
  // Clerk is mandatory — missing keys show setup instructions, not a keyless map.
  if (!clerkBrowserConfigured()) {
    if (clerkCiKeylessOk()) {
      return <ParkApp isSignedIn={false} />;
    }
    return <ClerkSetupRequired />;
  }
  return <PageWithClerk />;
}

function PageWithClerk() {
  const { isSignedIn } = useAuth();
  return <ParkApp isSignedIn={Boolean(isSignedIn)} />;
}

function ParkApp({ isSignedIn }) {
  const geo = useGeolocation();
  const { position, heading, shouldBroadcast } = geo;
    const {
      venue,
      map: mapData,
      /* The World's Places, Overlay already painted on by the store. This
         screen is not a privileged reader of them: HeightPanel asks the store
         for the same array and gets the same answer. */
      pois: POIS,
      overlayPins,
      gaps: venueGaps,
      manifest,
      status: venueStatus,
      error: venueError,
      confirmed: venueConfirmed,
      pinned: venuePinned,
    } = useVenue();
  /* Not POIS. This lane measures how far a guest stood from the pin the
     *builder* shipped and uploads that delta for builder research; hand it this
     phone's Overlay and a guest who has just contributed a queue pin is
     measured against their own Contribution, so the map-improvement loop reads
     its own output back as independent confirmation. The only reader on this
     phone that wants unpainted Places — see lib/venue/store.js. */
  const placesAsShipped = usePlacesAsShippedForResearchOnly();
  const movement = useMovementLog({ position, venue, pois: placesAsShipped });
  /* Parity-harness escape (issue #527 Testing Decisions): `?displayMap=svg`
     renders ParkMap even with the display flag on, so one flag-on build serves
     both renderers to test/app/display-parity.mjs. Post-mount state flip —
     server render and first client render must stay identical. */
  const [svgParityView, setSvgParityView] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('displayMap') === 'svg') setSvgParityView(true);
  }, []);
  const [gateOpen, setGateOpen] = useState(true);
  /** Waved the park question away for this session — do not put it back up. */
  const [parkAsked, setParkAsked] = useState(false);
  /* The location card has had its turn — allow the explore park question even when
     there is no fix yet. */
  const [locationSettled, setLocationSettled] = useState(false);
  /** First-run "Go to nearest World" — auto-confirms on fix instead of a second card. */
  const [nearestIntent, setNearestIntent] = useState(false);
  /* Has this phone been told what the app is? null until localStorage has been
     read, which cannot happen on the server: rendering a card before the answer
     is known would show a first-time visitor the location question for a frame
     and a returning one the introduction. Nothing in the intake draws until
     this is a boolean. */
  const [introSeen, setIntroSeen] = useState(null);
  /** Session-only — the logo splash yields to the welcome gate without marking intro seen. */
  const [logoSplashDismissed, setLogoSplashDismissed] = useState(false);
  const introOverlay = firstRunOverlay({ introSeen, logoSplashDismissed });
  /** Stay opaque for the whole first-run intake — flipping this when they tap
   *  nearest-park would re-attach fadeIn and flash the map through the gate. */
  const [firstRunSession, setFirstRunSession] = useState(false);
  useEffect(() => {
    if (introSeen === false) setFirstRunSession(true);
  }, [introSeen]);
  useLayoutEffect(() => {
    if (introSeen === true) document.documentElement.setAttribute('data-intro', 'seen');
    else if (introSeen === false) document.documentElement.setAttribute('data-intro', 'new');
  }, [introSeen]);

  const [identity, setIdentity] = useState(null); // {id, name}
  /** Soft-gate profile (EP.3–EP.4) — null while anonymous; map still works. */
  const [authSession, setAuthSession] = useState(null);
  const [managedGuests, setManagedGuests] = useState([]);

  const handleBindProfile = useCallback((userId) => {
    if (!userId) return;
    setIdentity((i) => (i ? { ...i, userId } : i));
    if (identityRef.current) identityRef.current = { ...identityRef.current, userId };
    runtime.current?.bindUserId?.(userId);
  }, []);
  const [party, setParty] = useState(null); // the runtime's snapshot
  // The snapshot as a ref, for callbacks that must not be rebuilt on every
  // roster tick just to read the party they are sending to.
  const partyRef = useRef(null);
  const [localOverlay, setLocalOverlay] = useState(emptyOverlay);
  const overlayRef = useRef(emptyOverlay());
  useEffect(() => {
    const loaded = loadOverlay();
    overlayRef.current = loaded;
    setLocalOverlay(loaded);
  }, []);
  const displayOverlay = useMemo(
    () =>
      unionOverlays(
        localOverlay,
        party?.active ? party.overlay || emptyOverlay() : emptyOverlay(),
      ),
    [localOverlay, party?.active, party?.overlay],
  );
  overlayRef.current = localOverlay;
  /* Push the composed Overlay down to the venue store, which owns painting it
     onto Places. An effect rather than a render-time call because `setOverlay`
     notifies every other subscriber, and a store that emits mid-render tears
     the tree. The cost is that the first frame after a Contribution lands is
     still the old Places; the alternative was every screen painting its own,
     which is the bug this replaced.

     This fires on mount too, with an empty Overlay on a phone that has never
     contributed. `setOverlay` drops that one rather than republishing Places —
     the emit would otherwise land mid-hydration and cost the whole page. See
     lib/venue/store.js. */
  useEffect(() => {
    setOverlay(displayOverlay);
  }, [displayOverlay]);
  const [localMeet, setLocalMeet] = useState(null); // a meet-up marked before joining anything
  const [planDraft, setPlanDraft] = useState([]);
  useEffect(() => {
    setPlanDraft(loadDraft());
  }, []);
  const adoptDraft = useCallback(() => {
    const shared = runtime.current?.getSnapshot()?.plan || [];
    const items = promote(loadDraft(), shared);
    if (items) runtime.current?.setPlan(items);
    clearDraft();
    setPlanDraft([]);
  }, []);
  const shareOverlay = useCallback(() => {
    const authored = overlayRef.current || emptyOverlay();
    for (const c of authored.completions || []) {
      runtime.current?.applyContribution?.(c);
    }
  }, []);
  const handleContribution = useCallback((contribution) => {
    setLocalOverlay((prev) => {
      const next = applyOverlayFact(prev, contribution);
      overlayRef.current = next;
      return saveOverlay(next);
    });
    if (partyRef.current?.active) runtime.current?.applyContribution?.(contribution);
    createHttpUploadAdapter().enqueue(contribution).catch(() => {});
  }, []);
  /** E9.1: retries Side Quests' local outbox against the same upload seam
   *  `handleContribution` uses. Bumping this after a flush is the signal
   *  SideQuestsPanel's "N pending" label re-reads pendingCount on. */
  const [questFlushTick, setQuestFlushTick] = useState(0);
  const flushQuests = useCallback(() => {
    flushQuestQueue(defaultQuestQueue(), createHttpUploadAdapter())
      .then(({ flushed }) => {
        if (flushed > 0) setQuestFlushTick((n) => n + 1);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    flushQuests();
  }, [authSession?.userId, flushQuests]);
  useEffect(() => {
    const onOnline = () => {
      flushQuests();
      flushThanksQueue().catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flushQuests]);
  const overlayCompletionsFor = useCallback(
    // Objects, not lines: PlaceDetail needs the id + author to offer the
    // Thanks tap on facts somebody else settled.
    (place) =>
      completionsForPlace(displayOverlay, identityOf(place)).map((c) => ({
        id: c.id,
        authorId: c.authorId || null,
        line: completionLine(c),
      })),
    [displayOverlay],
  );
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
  // The sheet's height in pixels, and the only thing that decides either how it
  // looks or what is on it. Starts at the resting stop; the effect below hands it
  // whatever the visitor last left it at.
  const [sheetPx, setSheetPx] = useState(SHEET_PEEK_PX);
  const [follow, setFollow] = useState(true);
  /* When the guest last moved the camera themselves. Null means they have
     not — an explicit look-at (a Place, a Member, the car) is not a gesture,
     so the resume clock must not steal it. */
  const gesturedAtRef = useRef(null);
  const [armMeet, setArmMeet] = useState(false);
  /* A patch of ground the visitor tapped and named — see lib/spot.js. Three
     pieces of state, not one, because they answer three different questions and
     die at three different times. `spot` is the pin and its capsule, and lasts
     until the next tap. `questSpot` and `markSpot` are what the tap was *for*:
     they are handed to the screen the visitor chose and outlive the capsule,
     so Side Quests and Marks can say what they are anchored to. Clearing them
     belongs to those screens, which know when the report is filed. */
  const [spot, setSpot] = useState(null);
  const [questSpot, setQuestSpot] = useState(null);
  const [markSpot, setMarkSpot] = useState(null);
  const [tapeOn, setTapeOn] = useState(false);
  const [toast, setToast] = useState(null);
  const [height, setHeight] = useState(null);
  /* The rider-height slider fires on every inch. Recomputing eligibility and
     relaying out the map on each tick is what made the vertical slider feel
     stuck; the panel reads `height` live, and the expensive consumers follow
     a frame or two behind. */
  const mapHeight = useDeferredValue(height);
  const [withAdult, setWithAdult] = useState(true);
  /* The Plan draft is not the only thing this phone knows before there is a
     Party to tell. A rider height set while exploring alone is a fact about the
     person holding the phone, and Eligibility switches to Party facts the
     instant a Party exists — so without this the seat joins with no height, the
     map quietly stops filtering on it, and the roster card offers "Set a
     height" to someone whose height is right there in the filter badge.
     Never clears: an unset height on this phone is not a claim that the seat
     has none. */
  const adoptHeight = useCallback(() => {
    if (height == null) return;
    runtime.current?.setMemberFacts({ height, withAdult });
  }, [height, withAdult]);
  const [categories, setCategories] = useState(() => categoriesForGate());
  const [paletteMode, setPaletteMode] = useState('auto');
  // Tapping the on-map OSM notice opens Settings straight to Credits. `nonce`
  // changes on every tap so SettingsPanel re-syncs even when it is already
  // mounted on that topic — see SettingsPanel's `openTopic` prop.
  const [settingsOpenTopic, setSettingsOpenTopic] = useState(null);
  /* A roster card's "Set a height" jumps to Plan → Heights with that Member
     already picked. Same shape as settingsOpenTopic and for the same reason:
     the nonce changes on every tap, so tapping the same card twice re-picks it
     even when the panel is already mounted on that Member. */
  const [heightFocus, setHeightFocus] = useState(null);
  // The sheet's open stops are fractions of the viewport, so their height in
  // pixels is only knowable once there is a window to ask.
  const [viewportH, setViewportH] = useState(844);
  const [viewportW, setViewportW] = useState(390);
  const stops = useMemo(() => sheetStops(viewportH), [viewportH]);

  /* The two things the app itself ever does to the sheet, and both of them are
     one-way. Nothing in here overrules the visitor: a screen that wants to be
     read can only grow the sheet, and a map that wants to be looked at can only
     shrink it, so a sheet deliberately left shut is not reopened by tapping a
     card and one deliberately pulled up is not collapsed by asking for a
     route. */
  const growSheet = useCallback(
    (px) => setSheetPx((h) => Math.max(h, Math.min(stops.full, px))),
    [stops],
  );
  const shrinkSheet = useCallback((px) => setSheetPx((h) => Math.min(h, px)), []);
  /* A map-tapped place is a collapsed Maps card, not half the screen. Set
     rather than grow: a sheet already at peek would otherwise stay tall. */
  const fitPlaceSheet = useCallback(
    () => setSheetPx(Math.min(stops.full, sheetPlacePx(viewportW))),
    [stops.full, viewportW],
  );

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
  const resumeFollow = useCallback(() => {
    gesturedAtRef.current = null;
    setFocusPoint(null);
    setFollow(true);
  }, []);
  const holdFollow = useCallback((lookAt = null) => {
    gesturedAtRef.current = null;
    setFollow(false);
    if (lookAt && Number.isFinite(lookAt.lat) && Number.isFinite(lookAt.lng)) {
      setFocusPoint({ lat: lookAt.lat, lng: lookAt.lng });
    }
  }, []);
  const [worldProgress, setWorldProgress] = useState(() => createProgress());
  const [acceptedOffer, setAcceptedOffer] = useState(null);
  const [parkWorld, setParkWorld] = useState(() => emptyWorld());
  const worldHydrated = useRef(false);
  /* The demo-skins grant needs the venue id, but world hydration and the venue
     fetch race — a ref reads whichever venue is loaded when hydration lands. */
  const demoVenueRef = useRef(null);
  const [nav, setNav] = useState(null); // where we are walking to, by reference
  const [navPhase, setNavPhase] = useState('idle'); // idle -> preview -> go
  const [routesList, setRoutes] = useState([]); // the choice, best first
  const [pick, setPick] = useState(0);
  const [graph, setGraph] = useState(null);
  const [northUp, setNorthUp] = useState(false);
  const [voice, setVoice] = useState(false);
  const [rerouted, setRerouted] = useState(0);
  const [routeProfile, setRouteProfile] = useState('default');
  const [reunifyBusy, setReunifyBusy] = useState(false);

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
  const appRef = useRef(null);
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
      void haptic(8);
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
      if (next === 'place') fitPlaceSheet();
      else growSheet(stops.half);
    },
    [goForward, growSheet, fitPlaceSheet, stops],
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
    const leaving = onIt[onIt.length - 1];
    const next = { tab: at, stacks: { ...cur, [at]: onIt.slice(0, -1) } };
    applyNav(next, 'fromLeft');
    window.history.replaceState({ ...window.history.state, tracker: next }, '');
    // Leaving the place sheet puts the pin down too — otherwise the callout
    // and the Next Stop card stay on for a place you just backed out of.
    if (leaving === 'place') setSelected(null);
  }, [applyNav]);

  /** Climb off the place detail screen without a slide, before a route preview
   *  or an empty-map dismiss takes over the sheet. */
  const dismissPlaceView = useCallback(() => {
    const { tab: at, stacks: cur } = navRef.current;
    const onIt = cur[at] || EMPTY_STACK;
    if (onIt[onIt.length - 1] !== 'place') return;
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
      if (id !== 'explore') growSheet(stops.half);
    },
    [goForward, applyNav, growSheet, stops],
  );

  /* A spot is a coordinate in one park. Changing World leaves it pointing at a
     patch of ground the visitor is no longer standing anywhere near, and an
     anchored Side Quest or Mark filed against it would be filed against the
     wrong place entirely — so all three go with the venue. */
  useEffect(() => {
    setSpot(null);
    setQuestSpot(null);
    setMarkSpot(null);
  }, [venue?.id]);

  /** The on-map OSM notice's tap target: Settings, straight to Credits.
   *
   *  Settings is a pushed screen under Me now, so this is two moves at once —
   *  land on the Me tab AND put Settings on top of it — and they are made as
   *  one nav state rather than selectTab() followed by push(). They have to
   *  be: `navRef` is refreshed in an effect, so a push in the same tick would
   *  read the stack selectTab has not written yet and append to a stale one. */
  const openCredits = useCallback(() => {
    const { stacks: cur } = navRef.current;
    goForward({ tab: 'settings', stacks: { ...cur, settings: ['settings'] } }, 'fromRight');
    growSheet(stops.half);
    setSettingsOpenTopic({ topic: 'credits', nonce: Date.now() });
  }, [goForward, growSheet, stops.half]);
  // Leaving the Settings screen clears the request — otherwise a later,
  // ordinary visit to Settings (through Me, not the notice) would keep
  // reopening on Credits instead of SettingsPanel's own default. Keyed off the
  // screen rather than the tab: Me is the tab now, and standing on Me's root
  // is already "not in Settings".
  useEffect(() => {
    if (settingsOpenTopic && !(tab === 'settings' && view === 'settings')) {
      setSettingsOpenTopic(null);
    }
  }, [tab, view, settingsOpenTopic]);

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
  /* Whether there is a walk for `stopNav` to end. It is called on every venue
     load as well as on a real Stop, and only one of those two should be
     allowed to move the sheet. A ref rather than the `nav` state itself so that
     `stopNav` keeps a stable identity — half the effects in this file have it
     in their dependencies. */
  const walkOn = useRef(false);
  // The reroute path reads the current choice without taking a dependency on
  // it — recomputing a route must not itself be a reason to recompute it.
  const routesRef = useRef([]);
  const pickRef = useRef(0);
  const progressRef = useRef(null);
  // Also in state, because the diagnostics panel is a render-time consumer and
  // a ref assigned inside an effect never triggers the render that reads it.
  const [runtimeApi, setRuntimeApi] = useState(null);
  // Map node-budget stats (drawn vs total paths/buildings/markers) land on a
  // ref, not state — the map reports on every pan/zoom frame, and Diagnostics
  // is the only reader, so it polls the ref itself rather than costing the
  // whole page a re-render for every frame the map is being dragged.
  const mapStatsRef = useRef(null);
  const handleMapStats = useCallback((stats) => {
    mapStatsRef.current = stats;
  }, []);

  const routingRef = useRef(null);
  const getRouting = useCallback(async () => {
    if (!routingRef.current) routingRef.current = await import('@/lib/routing');
    return routingRef.current;
  }, []);

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
  const [uiReady, setUiReady] = useState(false);
  useEffect(() => {
    const idle = window.requestIdleCallback;
    const handle = idle
      ? idle(() => setUiReady(true), { timeout: 1200 })
      : setTimeout(() => setUiReady(true), 80);
    return () => {
      if (idle) window.cancelIdleCallback?.(handle);
      else clearTimeout(handle);
    };
  }, []);
  const weatherFeed = useWeather(venue?.center ?? null, uiReady);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const identityRef = useRef(null);
  const positionRef = useRef(null);
  const locationSharingRef = useRef(null);
  const meRef = useRef(null);
  const helpSeen = useRef(new Set());

  /* ---------- boot ---------- */
  useEffect(() => {
    if (!uiReady) return undefined;
    if ('serviceWorker' in navigator) {
      // Registration and update checks live in useAppUpdate / lib/appUpdate.js.
      const onMessage = (e) => {
        if (e.data?.type !== 'notification-open') return;
        if (e.data.focus) setTab('party');
      };
      navigator.serviceWorker.addEventListener('message', onMessage);
      return () => navigator.serviceWorker.removeEventListener('message', onMessage);
    }
    return undefined;
  }, [uiReady]);

  // The venue is the map, the places and the bounds. Which one loads is the
  // visitor's last choice, or the deployment's default; the first GPS fix gets
  // to correct that if it lands inside a different one.
  useEffect(() => {
    bootVenue()
      // With the map on screen, complete it for offline: re-check the venue's
      // bundle manifest and pull whatever changed (lib/venue/download.js).
      // syncVenueBundle never throws — offline is an ordinary state — so the
      // catch below is bootVenue's alone.
      .then((venue) => syncVenueBundle(venue))
      .catch((err) => setToast(err?.message || 'Could not load the map.'));
  }, []);

  // Deep-link from venue inspection: /?venue=cedar-point loads that park directly.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('venue');
    if (!id) return;
    confirmVenue(id).catch(() => {});
  }, []);

  /**
   * The park the intake still has to ask about, if any. A fix is the first
   * moment the app can say anything useful about which of the maps it ships is
   * the one you want, so that is when it asks — and it asks once, because
   * answering is what sets `venueConfirmed` and stops it.
   */
  const parkChoice = useMemo(() => {
    if (parkAsked || !manifest) return null;
    const lat = position?.lat;
    const lng = position?.lng;
    const hasFix = Number.isFinite(lat) && Number.isFinite(lng);
    if (!hasFix && !locationSettled) return null;
    return intakeChoiceFor(manifest, lat, lng, {
      confirmed: venueConfirmed,
      pinned: venuePinned,
    });
  }, [parkAsked, manifest, position, venueConfirmed, venuePinned, locationSettled]);

  /** The other parks, nearest first, for when the nearest one is the wrong guess. */
  const parkOptions = useMemo(() => {
    if (!parkChoice || !manifest) return [];
    return venuesByDistance(manifest, position?.lat ?? null, position?.lng ?? null).filter(
      (row) => row.venue.id !== parkChoice.venue.id,
    );
  }, [parkChoice, manifest, position]);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(INTRO_KEY) === '1';
    } catch {
      // A phone with storage walled off gets the introduction every time, which
      // is the harmless way round: the alternative is never showing it at all.
      seen = false;
    }
    setIntroSeen(seen);
  }, []);

  const markIntroSeen = useCallback(() => {
    setIntroSeen(true);
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* private mode; the session still gets it once */
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) clearGuestChoice();
  }, [isSignedIn]);

  // Live in-place OAuth is broken — do not park first-run behind it.
  // Last working boot is splash, then welcome. Sign in lives on /sign-in and Me.
  const showIntroSplash = introSeen === false && !logoSplashDismissed;
  /** Brand welcome on the gate after the logo splash, before GPS/park intake. */
  const showWelcomeGate = introSeen === false && logoSplashDismissed && !nearestIntent;

  const askingPark = Boolean(parkChoice);
  /** Inline park question on the gate (GPS path), including after "nearest park". */
  const showParkPrompt = !showIntroSplash && gateOpen && askingPark;
  const showExplorePrompt = showParkPrompt && Boolean(parkChoice?.explore) && !nearestIntent;

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
    if (saved?.paletteMode) setPaletteMode(saved.paletteMode);
    else if (saved?.theme) setPaletteMode(saved.theme === 'day' ? 'day' : 'night');
    else setPaletteMode('auto');
  }, []);

  useEffect(() => {
    let cancelled = false;
    resolveSession().then((session) => {
      if (!cancelled) setAuthSession(session);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authSession?.userId) {
      setManagedGuests([]);
      return undefined;
    }
    let cancelled = false;
    listManagedGuests().then((list) => {
      if (!cancelled) setManagedGuests(list);
    });
    return () => {
      cancelled = true;
    };
  }, [authSession]);

  useEffect(() => {
    if (!identity) return;
    identityRef.current = identity;
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ ...identity, height: mapHeight, paletteMode }));
  }, [identity, mapHeight, paletteMode]);

  useEffect(() => {
    partyRef.current = party;
  }, [party]);

  const theme = useMemo(
    () => resolvePalette({ paletteMode, manualTheme: paletteMode, now: clock }),
    [paletteMode, clock],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    if (worldHydrated.current) {
      setWorldProgress((p) => ({ ...p, userId: authSession?.userId || p.userId }));
      return undefined;
    }
    loadWorld({ userId: authSession?.userId || null }).then((saved) => {
      if (cancelled) return;
      worldHydrated.current = true;
      let prog = saved.progress;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('parkbound-demo-skins') === '1') {
        prog = grantShipSkins(prog, { venueId: demoVenueRef.current });
      }
      setWorldProgress(prog);
      setAcceptedOffer(saved.acceptedOffer);
    });
    return () => {
      cancelled = true;
    };
  }, [authSession?.userId]);

  useEffect(() => {
    if (!authSession) return;
    if (authSession.godmode) {
      setWorldProgress((p) => (p.godmode ? p : grantGodmodeProgress(p)));
      return;
    }
    setWorldProgress((p) => (p.godmode ? { ...p, godmode: false } : p));
  }, [authSession, authSession?.godmode]);

  useEffect(() => {
    if (!worldHydrated.current) return;
    saveWorld({ progress: worldProgress, acceptedOffer });
  }, [worldProgress, acceptedOffer]);

  useEffect(() => {
    if (party?.active && authSession?.userId) runtime.current?.bindUserId?.(authSession.userId);
  }, [party?.active, authSession?.userId]);

  useEffect(() => {
    if (!party?.active) return;
    if (worldProgress.kit) runtime.current?.setKit?.(worldProgress.kit);
    if (worldProgress.wearSkin) runtime.current?.setWearSkin?.(worldProgress.wearSkin);
  }, [party?.active, worldProgress.kit, worldProgress.wearSkin]);

  useEffect(() => {
    let stop = () => {};
    void listenInviteUrls((url) => {
      try {
        const parsed = new URL(url);
        if (!parsed.pathname.startsWith('/join')) return;
        if (window.location.href === url) return;
        window.location.assign(url);
      } catch {
        /* ignore malformed shell URLs */
      }
    }).then((unsub) => {
      if (typeof unsub === 'function') stop = unsub;
    });
    return () => stop();
  }, []);

  useEffect(() => {
    if (shouldRegisterPush(party)) void registerPush();
  }, [party?.active]);

  useEffect(() => {
    const measure = () => {
      const h = window.innerHeight;
      setViewportH(h);
      setViewportW(window.innerWidth);
      // A sheet taller than the screen it is on is not a sheet. The clamp runs
      // on every measure rather than only at boot, because the software
      // keyboard coming up is a resize too, and a sheet left at 88% of a tall
      // phone would otherwise be pinned off the top of the short one.
      const ceiling = sheetStops(h).full;
      setSheetPx((px) => Math.min(px, ceiling));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Where the sheet was left last time, clamped to this screen. Read once, on
  // the client, so the server and the first paint agree on the default.
  useEffect(() => {
    const saved = Number(localStorage.getItem(SHEET_KEY));
    if (!Number.isFinite(saved) || saved <= 0) return;
    const { shut, full } = sheetStops(window.innerHeight);
    setSheetPx(Math.min(full, Math.max(shut, Math.round(saved))));
  }, []);

  useEffect(() => {
    localStorage.setItem(SHEET_KEY, String(sheetPx));
  }, [sheetPx]);

  // Close the gate when the fix actually lands — unless the fix has just earned
  // the intake its second question, in which case the gate stays up and shows
  // that instead. Checking this inside the "Allow location" handler cannot
  // work: the permission prompt and the first fix are both async, so status is
  // still 'asking' when the click returns and nothing looks again. The gate
  // then sits over the whole UI intercepting taps, and the only way out reads
  // "Just show me the park map" — which is the opposite of what someone who
  // just granted location wants.
  useEffect(() => {
    if (geo.status !== 'idle' && geo.status !== 'asking') setLocationSettled(true);
  }, [geo.status]);

  useEffect(() => {
    if (!askingPark && (geo.status === 'live' || parkAsked)) {
      setGateOpen(false);
    }
  }, [geo.status, askingPark, parkAsked]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  meRef.current = (party?.members || []).find((m) => m.id === party?.selfId) || null;

  const showToast = useCallback((msg) => {
    setToast(msg);
    // Long messages need longer than short ones. 3.2s was measured against
    // "Status: In line" and is not enough for a sentence.
    setTimeout(() => setToast((t) => (t === msg ? null : t)), msg.length > 40 ? 6000 : 4000);
  }, []);

  // The welcome landing's one button: grant location, then ask to confirm the
  // nearest park before downloading (never auto-confirm — wrong park is costly).
  const confirmPark = useCallback(
    (id) => {
      setNearestIntent(false);
      return confirmVenue(id)
        .then((v) => {
          setSelected(null);
          /* A missing fix is not "not Follow" — that race is how the camera
             opened on the park and never recentred on the first GPS reading.
             Off-site still follows: the puck the map draws is already the
             entrance, and chasing that is seeing yourself. */
          resumeFollow();
          setParkAsked(true);
          setGateOpen(false);
          showToast(`${v.name} is loaded — you are good to go!`);
          return v;
        })
        .catch((err) => {
          showToast(err?.message || 'Could not build that map.');
          throw err;
        });
    },
    [showToast, resumeFollow],
  );

  const appUpdate = useAppUpdate();

  /* ---------- the party runtime ---------- */

  // One runtime for the life of the page. It owns the session, the transports
  // and whichever half of the protocol this device is running; everything below
  // reads its snapshot and calls its verbs.
  const pendingInviteRef = useRef(null);
  const [pendingInvite, setPendingInvite] = useState(null);
  const showToastRef = useRef(showToast);
  const selectTabRef = useRef(selectTab);
  const adoptDraftRef = useRef(adoptDraft);
  const adoptHeightRef = useRef(adoptHeight);
  const shareOverlayRef = useRef(shareOverlay);
  showToastRef.current = showToast;
  selectTabRef.current = selectTab;
  adoptDraftRef.current = adoptDraft;
  adoptHeightRef.current = adoptHeight;
  shareOverlayRef.current = shareOverlay;

  // One PartyRuntime for the page lifetime. Do not recreate when callback
  // identities change — that destroyed mid-join invites and stuck the gate.
  useEffect(() => {
    let destroyed = false;
    let rt = null;
    (async () => {
      const partyRuntime = await import('@/lib/partyRuntime');
      if (destroyed) return;
      rt = partyRuntime.createPartyRuntime({
        onState: setParty,
        onToast: (msg) => showToastRef.current(msg),
      });
      runtime.current = rt;
      setRuntimeApi(rt);
      const pending = partyRuntime.takePendingInvite();
      if (pending?.payload) {
        pendingInviteRef.current = pending;
        setPendingInvite(pending);
        const named = (pending.name || '').trim();
        if (named) {
          identityRef.current = { ...identityRef.current, name: named };
          setIdentity((i) => ({ ...i, name: named }));
        }
        selectTabRef.current('party');
        return;
      }
      if (rt.hasLiveParty?.()) {
        const memberName = identityRef.current?.name || 'Guest';
        Promise.resolve(rt.resume({ memberName }))
          .then(() => {
            adoptDraftRef.current();
            adoptHeightRef.current();
            shareOverlayRef.current();
          })
          .catch((err) =>
            showToastRef.current(err?.message || 'Could not reopen the party.'),
          );
      }
    })();
    return () => {
      destroyed = true;
      runtime.current = null;
      setRuntimeApi(null);
      rt?.destroy();
    };
  }, []);

  /* Join is name-first. Finish /join once location is live so the invite
     cannot land a Member with no fix. Retry when GPS arrives. */
  const inviteJoinInFlight = useRef(false);
  useEffect(() => {
    const pending = pendingInviteRef.current || pendingInvite;
    if (!pending?.payload || !runtimeApi) return undefined;
    if (!locationReadyToJoin(geo.status)) return undefined;
    if (inviteJoinInFlight.current) return undefined;
    inviteJoinInFlight.current = true;
    let cancelled = false;
    const named = (pending.name || '').trim();
    const memberName = named || identityRef.current?.name || 'Guest';
    Promise.resolve(runtimeApi.joinParty(pending.payload, { memberName }))
      .then((snap) => {
        if (cancelled) return;
        pendingInviteRef.current = null;
        setPendingInvite(null);
        // Clear stash only after success — remounts must be able to re-read it.
        clearPendingInvite();
        selectTabRef.current('party');
        showToastRef.current(
          snap?.code
            ? `You’re in party ${snap.code}${named ? '' : ' — rename under Me'}`
            : 'You’re in the party',
        );
        adoptDraftRef.current();
        adoptHeightRef.current();
        shareOverlayRef.current();
      })
      .catch((err) => {
        if (cancelled) return;
        showToastRef.current(err?.message || 'Could not open that invite.');
      })
      .finally(() => {
        inviteJoinInFlight.current = false;
      });
    return () => {
      cancelled = true;
      inviteJoinInFlight.current = false;
    };
  }, [pendingInvite, runtimeApi, geo.status]);

  /* Reopen a saved but dormant session when Party is opened. Live sessions
     resume on mount above and keep syncing on every tab. */
  const resumeInFlight = useRef(false);

  useEffect(() => {
    if (tab !== 'party') return undefined;
    if (!runtimeApi || party?.active || party?.phase === 'connecting') return undefined;
    if (!runtime.current?.hasSavedParty?.()) return undefined;
    if (resumeInFlight.current) return undefined;
    resumeInFlight.current = true;
    const memberName = identityRef.current?.name || 'Guest';
    Promise.resolve(runtime.current.resume({ memberName }))
      .then(() => {
        adoptDraft();
        shareOverlay();
      })
      .catch((err) => showToast(err?.message || 'Could not reopen the party.'))
      .finally(() => {
        resumeInFlight.current = false;
      });
    return undefined;
  }, [tab, runtimeApi, party?.active, party?.phase, showToast, adoptDraft, shareOverlay]);

  const active = Boolean(party?.active);
  const code = party?.code ?? null;
  const locationLocked = active && locationRevokedInParty(geo.status);
  /* Whether the two-step intake is the screen. Named once here because two
     places need the same answer: the gate itself, and the `.app` element, which
     has to let the park paint behind it — the design draws both intake steps
     over the map, not over a flat page. */
  const showIntakeGate =
    gateOpen &&
    introSeen !== null &&
    !showExplorePrompt &&
    !showIntroSplash &&
    !locationLocked;
  const planItems = useMemo(
    () => planView({ party: active ? party : null, draft: planDraft }),
    [active, party, planDraft],
  );

  /** Next Plan Place with coordinates for the Compass primary (when not in Go). */
  const planNextPlace = useMemo(() => {
    const first = planItems[0];
    if (!first?.placeId) return null;
    const poi = POIS.find((p) => p.i === first.placeId || p.id === first.placeId);
    if (!poi || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return null;
    return {
      lat: poi.lat,
      lng: poi.lng,
      label: first.label || poi.n,
      placeId: first.placeId,
    };
  }, [planItems, POIS]);

  /* The Zone and the walk time under each Plan stop, worked out here rather
     than carried on the stop.

     A Plan item's wire shape is `{id, placeId, label}` — lib/plan.js normalize
     keeps it to that on purpose, because the list rides inside every Party
     snapshot and a Zone name plus a walk time per stop would be sent to every
     Member, over and over, to say something each phone can work out for itself
     from the venue file and its own fix.

     Keyed on the *deferred* position for the same reason mapHeight is deferred:
     a fix lands every second or two, and re-walking the Plan against every POI
     on each one is work done between frames for a number that changes by a
     couple of feet. The stops stay responsive to reordering; the walk times
     follow a beat behind. */
  const planPosition = useDeferredValue(position);
  const planContext = useMemo(() => {
    if (!planItems.length) return null;
    const out = {};
    for (const step of planItems) {
      const poi = POIS.find((p) => p.i === step.placeId || p.id === step.placeId);
      if (!poi) continue;
      const zone = placeContext(poi, venue, mapData)?.name || null;
      const walk =
        planPosition && Number.isFinite(poi.lat) && Number.isFinite(poi.lng)
          ? formatWalk(distance(planPosition.lat, planPosition.lng, poi.lat, poi.lng))
          : null;
      out[step.placeId] = { zone, walk };
    }
    return out;
  }, [planItems, POIS, venue, mapData, planPosition]);

  const commitPlan = useCallback(
    (next) => {
      if (active) {
        runtime.current?.setPlan(next);
        return;
      }
      setPlanDraft(saveDraft(next));
    },
    [active],
  );

  const addToPlan = useCallback(
    (p) => {
      const current = planView({ party: active ? partyRef.current : null, draft: planDraft });
      const next = star(current, p);
      if (next.length === current.length) {
        showToast(
          current.some((s) => s.placeId === (p.i || p.id))
            ? `${p.n} is already on the Plan`
            : 'Plan is full',
        );
        return;
      }
      commitPlan(next);
      showToast(`Added ${p.n} to plan`);
    },
    [active, planDraft, commitPlan, showToast],
  );

  /**
   * The roster, flattened for the map, the rail and the tape — all of which
   * predate the party layer and read a member as a point with a name on it.
   */
  const roster = useMemo(
    () =>
      (party?.members || []).map((m) => {
        const seen = locationView(m, venue?.bounds);
        return {
          ...m,
          lat: seen.lat,
          lng: seen.lng,
          acc: m.location?.acc ?? null,
          heading: Number.isFinite(m.location?.heading) ? m.location.heading : null,
          ts: m.location?.ts ?? m.lastSeen,
          colour: colourFor(m.id),
          initials: initialsFor(m.name),
          visible: seen.visible,
          live: seen.live,
          place: seen.place,
          kit: m.kit || null,
        };
      }),
    [party, venue?.bounds],
  );

  const selfMember = useMemo(
    () => roster.find((m) => m.id === party?.selfId),
    [roster, party?.selfId],
  );

  const routeProfiles = useMemo(
    () => profilesForCoverage(mapData?.meta?.coverage || {}),
    [mapData?.meta?.coverage],
  );

  const profileNote = useMemo(() => {
    const cov = mapData?.meta?.coverage;
    if (!cov) return 'Path tags not measured for this venue yet.';
    if (routeProfile === 'no_steps' && !cov.steps) return 'No stairs recorded in OpenStreetMap here.';
    if (routeProfile === 'allow_restricted') return 'May cut through service roads marked restricted.';
    return null;
  }, [mapData?.meta?.coverage, routeProfile]);

  const others = useMemo(
    () => roster.filter((m) => m.id !== party?.selfId && m.visible),
    [roster, party?.selfId],
  );

  const visibleOnMap = useMemo(() => roster.filter((m) => m.visible).length, [roster]);

  const meet = party?.meet ?? localMeet;

  const partyMembersById = useMemo(
    () => Object.fromEntries((party?.members || []).map((m) => [m.id, m])),
    [party?.members],
  );
  const partyWorld = party?.world || null;
  const mergedWorld = useMemo(() => mergeWorlds(partyWorld, parkWorld), [partyWorld, parkWorld]);
  const mapWear = useMemo(
    () =>
      wearMap({
        progress: worldProgress,
        partyMembers: partyMembersById,
        selfId: party?.selfId || null,
        acceptedOffer,
        world: partyWorld,
        venue,
        palette: theme,
      }),
    [worldProgress, partyMembersById, party?.selfId, acceptedOffer, partyWorld, venue, theme],
  );
  const worldMarksOnMap = useMemo(
    () => visibleMarks({ world: mergedWorld, viewerPartyId: party?.partyId || null }),
    [mergedWorld, party?.partyId],
  );

  const mapFogFilter = useMemo(
    () => fogMapStyle(worldProgress, venue?.id),
    [worldProgress, venue?.id],
  );

  useEffect(() => {
    applyMapSkin(document.documentElement, mapWear);
  }, [mapWear]);

  useEffect(() => {
    if (!venue?.id) {
      setParkWorld(emptyWorld());
      return undefined;
    }
    const partyId = party?.partyId || '';
    let cancelled = false;
    fetch(`/api/world/${encodeURIComponent(venue.id)}?partyId=${encodeURIComponent(partyId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.world) {
          setParkWorld(data.world);
          setWorldProgress((p) => applyThanksToProgress(p, data.world, p.userId));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [venue?.id, party?.partyId, party?.version]);

  /* Signing in hands back a display name. It fills the park-day name only when
     there is not one already — somebody who typed "Nan" on the roster is not
     renamed to their Google account by signing in later. Shared by Me and by
     Settings, which are two screens onto the same Profile. */
  const onAuthSession = useCallback((next) => {
    setAuthSession(next);
    if (next?.displayName) {
      setIdentity((i) => {
        const cur = (i?.name || '').trim();
        if (cur && cur !== 'Guest') return i;
        return { ...i, name: next.displayName };
      });
    }
  }, []);

  const publishMark = useCallback(
    (mark) => {
      if (!mark?.type) return;
      runtime.current?.dropWorldMark?.({
        id: mark.id,
        type: mark.type,
        placeId: mark.placeId,
        lat: mark.lat,
        lng: mark.lng,
        venueId: mark.venueId || venue?.id,
        phrase: mark.phrase,
      });
      const profileId = authSession?.userId;
      if (!profileId || !venue?.id) return;
      fetch(`/api/world/${encodeURIComponent(venue.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark',
          profileId,
          partyId: party?.partyId || null,
          id: mark.id,
          type: mark.type,
          placeId: mark.placeId,
          lat: mark.lat,
          lng: mark.lng,
          phrase: mark.phrase,
          now: mark.createdAt,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data?.world) setParkWorld(data.world);
        })
        .catch(() => {});
    },
    [authSession?.userId, venue?.id, party?.partyId],
  );

  const thankAMark = useCallback(
    (mark) => {
      if (!mark?.id || !authSession?.userId) return;
      runtime.current?.thankWorldMark?.(mark.id);
      if (!venue?.id) return;
      fetch(`/api/world/${encodeURIComponent(venue.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'thanks',
          profileId: authSession.userId,
          partyId: party?.partyId || null,
          targetId: mark.id,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data?.world) {
            setParkWorld(data.world);
            setWorldProgress((p) => applyThanksToProgress(p, data.world, p.userId));
          }
        })
        .catch(() => {});
    },
    [authSession?.userId, venue?.id, party?.partyId],
  );

  const recordWorldQuest = useCallback(
    ({ quest, report, rankUp = null }) => {
      const { progress: next, marks } = recordSideQuest(
        { ...worldProgress, userId: authSession?.userId || worldProgress.userId },
        {
          questId: quest?.id || report?.questId,
          kind: quest?.type || report?.kind,
          venueId: report?.venueId || venue?.id,
          placeId: report?.placeId || quest?.targets?.[0] || null,
          lat: report?.lat,
          lng: report?.lng,
          partyId: party?.partyId || null,
          venueKind: venue?.kind,
          venuePlaceCount: POIS?.length || null,
        },
      );
      // Rank prizes ride the same seam: syncing through the new rank also
      // backfills any earlier rank whose grant this phone never saw.
      setWorldProgress(rankUp ? syncRankPrizes(next, rankUp) : next);
      for (const mark of marks) publishMark(mark);
    },
    [worldProgress, authSession?.userId, venue?.id, venue?.kind, party?.partyId, POIS, publishMark],
  );

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
    const host = (party?.members || []).find((m) => m.id === party?.hostId);
    const lat = host?.location?.lat;
    const lng = host?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, name: host.name };
  }, [party?.members, party?.hostId]);

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
   * Location.capture decides live vs stale, Place, and coarsening.
   */
  useEffect(() => {
    if (!active || !position) return undefined;
    if (locationRevokedInParty(geo.status)) return undefined;
    const tick = () => {
      const fix = positionRef.current;
      if (!fix) return;
      const headingFix = {
        ...fix,
        heading: Number.isFinite(fix.heading) ? fix.heading : heading ?? null,
      };
      // `now` is passed explicitly because the gate falls back to the fix's own
      // timestamp as its clock, and a phone that is standing still keeps being
      // handed the same cached fix — so that clock stops, every later tick is
      // rate-limited against it, and the heartbeat that exists to re-offer a
      // position which never landed can never come round.
      const now = Date.now();
      const result = capture({
        fix: headingFix,
        bounds: venue?.bounds,
        places: POIS,
        member: meRef.current,
        last: locationSharingRef.current,
        now,
      });
      if (!result) return;
      if (result.location.live !== false) {
        const decision = shouldBroadcast({ heading, now });
        if (!decision.send) return;
      }
      locationSharingRef.current = result.location;
      runtime.current?.pushLocation(result.location);
    };
    tick();
    const id = setInterval(tick, GATE_TICK_MS);
    return () => clearInterval(id);
  }, [active, position, heading, shouldBroadcast, venue?.bounds, geo.status, POIS]);

  useEffect(() => {
    if (!active || !geo.battery) return;
    runtime.current?.pushBattery(geo.battery);
  }, [active, geo.battery]);

  useEffect(() => {
    if (!active) locationSharingRef.current = null;
  }, [active]);

  useEffect(() => {
    if (!active || !locationRevokedInParty(geo.status)) return;
    const result = capture({
      last: locationSharingRef.current,
      places: POIS,
      now: Date.now(),
      revoked: true,
    });
    if (result) runtime.current?.pushLocation(result.location);
    if (result) locationSharingRef.current = result.location;
  }, [active, geo.status, POIS]);

  // NEED HELP has to interrupt, once per person per episode.
  useEffect(() => {
    roster.forEach((m) => {
      if (m.id === party?.selfId) return;
      if (m.status === 'NEED HELP' && !helpSeen.current.has(m.id)) {
        helpSeen.current.add(m.id);
        const me = positionRef.current;
        const d = me && Number.isFinite(m.lat) ? distance(me.lat, me.lng, m.lat, m.lng) : null;
        showToast(`${m.name} needs help - ${formatDistance(d)}`);
        void haptic([120, 70, 120]);
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
  /* Which standing cards have been dismissed, keyed by venue. Same shape as the
     push preferences below: one load on mount, one save on change. */
  const [hiddenCards, setHiddenCards] = useState({});
  const hiddenHere = hiddenCards[venue?.id] || [];

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HIDDEN_CARDS_KEY) || 'null');
      if (saved && typeof saved === 'object') setHiddenCards(saved);
    } catch {
      /* nothing saved */
    }
  }, []);

  /* ---------- where the car is ---------- */

  /* The one thing on this map that is not in OpenStreetMap and not in the
     party: a spot only this phone knows, remembered for as long as it takes to
     walk back to it. It is deliberately not part of the party — nobody else's
     roster wants your parking space, and a family that arrived in two cars
     wants two different answers to the same question.

     Same shape as the hidden cards: a dictionary keyed by venue, one load on
     mount, one save on change. */
  const [cars, setCars] = useState({});
  const car = cars[venue?.id] || null;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CAR_KEY) || 'null');
      if (saved && typeof saved === 'object') setCars(saved);
    } catch {
      /* nothing parked */
    }
  }, []);

  const putCar = useCallback(
    (lat, lng) => {
      if (!venue?.id || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setCars((prev) => {
        const next = { ...prev, [venue.id]: { lat, lng, at: Date.now() } };
        localStorage.setItem(CAR_KEY, JSON.stringify(next));
        return next;
      });
    },
    [venue?.id],
  );

  const clearCar = useCallback(() => {
    if (!venue?.id) return;
    setCars((prev) => {
      const next = { ...prev };
      delete next[venue.id];
      localStorage.setItem(CAR_KEY, JSON.stringify(next));
      return next;
    });
  }, [venue?.id]);

  /* `shedCard` stood here: the ✕ on a glance card, which wrote the category
     into `hiddenCards`. The rail is no longer mounted on Explore, so nothing
     can put a card into that list any more — see the note on `unhideCard`. */

  /* Settings → Phone → "What the panel shows" reads `hiddenCards` and calls
     this to put one back. With the rail unmounted the list can only ever
     shrink: it still holds whatever a phone hid before this change, so the way
     to undo that has to stay, but nothing new will ever join it. Left standing
     rather than stripped so that a phone carrying hidden cards can still clear
     them, and so removing the surface is a decision somebody makes on purpose
     rather than a side effect of removing the rail. */
  const unhideCard = useCallback(
    (category) => {
      if (!venue?.id) return;
      setHiddenCards((prev) => {
        const next = { ...prev, [venue.id]: (prev[venue.id] || []).filter((c) => c !== category) };
        localStorage.setItem(HIDDEN_CARDS_KEY, JSON.stringify(next));
        return next;
      });
    },
    [venue?.id],
  );

  const [pushPrefs, setPushPrefs] = useState(notifier.defaultPrefs);
  const [pushState, setPushState] = useState('idle');
  const seenIds = useRef(null);
  const quietSeen = useRef(new Set());

  useEffect(() => {
    if (!uiReady) return;
    try {
      const saved = JSON.parse(localStorage.getItem(PUSH_PREFS_KEY) || 'null');
      if (saved) setPushPrefs((p) => ({ ...p, ...saved }));
    } catch {
      /* nothing saved */
    }
    setPushState(notifier.permission());
  }, [uiReady]);

  useEffect(() => {
    if (!uiReady) return;
    localStorage.setItem(PUSH_PREFS_KEY, JSON.stringify(pushPrefs));
  }, [uiReady, pushPrefs]);

  // The worker reads this off disk when a push wakes it, so it has to be
  // written before one can arrive — and cleared on leaving, which is what makes
  // a push from a party you have left unreadable on this phone.
  useEffect(() => {
    if (!uiReady) return;
    notifier.rememberParty(
      party?.active && party?.partyId && party?.keyString
        ? { partyId: party.partyId, keyString: party.keyString, selfId: party.selfId }
        : null,
      pushPrefs,
    );
  }, [uiReady, party?.active, party?.partyId, party?.keyString, party?.selfId, pushPrefs]);

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
    if (!locationReadyToJoin(geo.status)) {
      showToast('Turn on Location to join a party.');
      setGateOpen(true);
      return;
    }
    setBusy(true);
    try {
      const snap = await runtime.current.createParty({
        memberName: identity?.name || 'Guest',
        name: 'Party',
        userId: identity?.userId || null,
      });
      selectTab('party');
      showToast(
        `Party ${snap.code} started — code works ~10 min while Party is open; link and QR always work`,
      );
      adoptDraft();
      adoptHeight();
      shareOverlay();
    } catch (err) {
      showToast(err?.message || 'Could not start a party.');
    }
    setBusy(false);
  };

  const joinParty = async (raw, asName = null) => {
    if (!locationReadyToJoin(geo.status)) {
      showToast('Turn on Location to join a party.');
      setGateOpen(true);
      return;
    }
    setBusy(true);
    try {
      // A name typed on the join screen is the freshest thing we know, and it
      // has not necessarily been committed to identity yet.
      const memberName = (asName || '').trim() || identity?.name || 'Guest';
      if ((asName || '').trim()) {
        setIdentity((i) => ({ ...i, name: memberName }));
        identityRef.current = { ...identityRef.current, name: memberName };
      }
      const snap = await runtime.current.joinParty(raw, {
        memberName,
        userId: identityRef.current?.userId || null,
      });
      selectTab('party');
      showToast(`Joined ${snap.code}`);
      adoptDraft();
      adoptHeight();
      shareOverlay();
    } catch (err) {
      const msg = err?.message || 'Could not join that party.';
      showToast(
        /not answer|timed out|window/i.test(msg)
          ? `${msg} Ask them to open Party → Let someone join, or send the invite link / QR.`
          : msg,
      );
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

  const setMeetPoint = useCallback((lat, lng, label) => {
    setArmMeet(false);
    const record = { lat, lng, label: label || 'Rally Point' };
    if (active) {
      runtime.current?.setMeet(record);
      runtime.current?.logAction?.('meet-set', { label: record.label });
      showToast('Rally set — your Party has a shared destination');
      pushNote({
        kind: 'meet',
        title: `${identity?.name || 'Someone'} set a Rally Point`,
        body: record.label,
        focus: { kind: 'meet', label: record.label },
      });
    } else {
      setLocalMeet({ ...record, by: identity?.name || 'Someone', ts: Date.now() });
      showToast('Rally Point marked — join a Party to share it');
    }
  }, [active, identity?.name, showToast, pushNote]);

  const suggestReunification = useCallback(async () => {
    if (!graph || !position) {
      showToast('Need a map and your position first');
      return;
    }
    setReunifyBusy(true);
    try {
      const { pickReunification } = await import('@/lib/reunification');
      const located = roster.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
      const candidate = pickReunification(
        graph,
        located.map((m) => ({ location: { lat: m.lat, lng: m.lng } })),
        POIS,
      );
      if (!candidate) {
        showToast('No fair Rally Point here — try another Place');
        return;
      }
      setMeetPoint(candidate.lat, candidate.lng, candidate.n);
      holdFollow(candidate);
      shrinkSheet(stops.peek);
    } finally {
      setReunifyBusy(false);
    }
  }, [graph, position, roster, POIS, showToast, shrinkSheet, stops.peek, setMeetPoint, holdFollow]);

  const clearMeet = () => {
    setLocalMeet(null);
    if (!active) return;
    runtime.current?.setMeet(null);
    runtime.current?.logAction?.('meet-clear', {});
    // On everyone else's phone a cleared meet-up simply vanishes, which is the
    // one change to it nobody is told about.
    pushNote({
      kind: 'meet',
      title: `${identity?.name || 'Someone'} cleared the Rally Point`,
      body: 'Your Party has no Rally Point right now.',
    });
  };

  /* ---------- derived ---------- */
  /* Map, list and Place detail share one Eligibility view. Callers pass Party or
     solo facts only — Subgroup set selection and With adult live in the
     module. Empty people → silent cells, no marks. */
  const eligibilityFacts = useMemo(() => {
    if (party?.active && roster.length) {
      return {
        party: {
          selfId: party.selfId,
          members: roster.map((m) => ({
            id: m.id,
            name: m.name,
            height: Number.isFinite(m.height) ? m.height : null,
            withAdult: m.withAdult,
            groupId: m.groupId || null,
          })),
        },
      };
    }
    return {
      solo: {
        height: mapHeight,
        withAdult,
        name: identity?.name || 'You',
      },
    };
  }, [party?.active, party?.selfId, roster, mapHeight, withAdult, identity?.name]);

  const eligibilityPeople = useMemo(
    () => peopleFor(eligibilityFacts),
    [eligibilityFacts],
  );

  const eligibilityView = useMemo(
    () => fromFacts(eligibilityFacts, POIS),
    [eligibilityFacts, POIS],
  );

  const totalRides = useMemo(
    () => POIS.filter(isRideable).length,
    [POIS],
  );

  /* Height rules only exist at amusement parks, and only where somebody has
     filled them in. Everywhere else the filter, its badge and the tab that
     leads to it are simply not part of the app. */
  const heights = useMemo(() => hasHeights(POIS), [POIS]);

  /* Which categories this venue has any of. The key on the map, the chips
     behind "Show on the map" and the count beside them are all statements
     about what is out there, so all three are answered from the venue rather
     than from the vocabulary. */
  const presentCategories = useMemo(() => new Set(POIS.map((p) => p.c)), [POIS]);

  useEffect(() => {
    if (!venue?.id) return;
    setCategories(categoriesForGate({ roster, presentCategories }));
  }, [venue?.id, roster, presentCategories]);

  useEffect(() => {
    demoVenueRef.current = venue?.id || null;
    if (typeof localStorage === 'undefined' || localStorage.getItem('parkbound-demo-skins') !== '1') return;
    if (!venue?.id) return;
    setWorldProgress((p) => grantShipSkins(p, { venueId: venue.id }));
  }, [venue?.id]);

  const rideableCount = useMemo(() => {
    if (!eligibilityPeople.length) return null;
    return POIS.filter((p) => {
      if (!isRideable(p)) return false;
      const k = eligibilityView.at(identityOf(p)).kind;
      return k === 'eligible' || k === 'companion';
    }).length;
  }, [POIS, eligibilityPeople.length, eligibilityView]);

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
    const build = async () => {
      const routing = await getRouting();
      if (live) setGraph(routing.buildRouteGraphCached(venue?.id, mapData, POIS));
    };
    const idle = typeof window !== 'undefined' ? window.requestIdleCallback : null;
    const handle = idle ? idle(() => { build(); }, { timeout: 3000 }) : setTimeout(build, 400);
    return () => {
      live = false;
      if (idle) window.cancelIdleCallback?.(handle);
      else clearTimeout(handle);
    };
  }, [mapData, venue?.id, POIS, getRouting]);

  // A destination is held by reference, not by coordinates: a party member
  // walks around while you are walking to them, and a Rally Point can be moved or
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
      return { ...nav, label: meet.label || 'Rally Point', lat: meet.lat, lng: meet.lng };
    }
    // The car can be moved or forgotten out from under a route the same way a
  // Rally Point can, so it is resolved live rather than copied into `nav`.
    if (nav.kind === 'car') {
      if (!car) return null;
      return { ...nav, label: 'Where I parked', lat: car.lat, lng: car.lng };
    }
    /* Walking to a ride means walking to its queue. A place here is one point,
       and for a ride the builder took from its track that point is the middle
       of the track — so "walk me to Diamondback" aimed at the top of the lift
       hill, over a fence, and told you it was forty seconds away.

       The builder already works these out, from a queue way that carries its
       ride's name and says which way it runs, and hangs them on the ride as
       `e`. Nothing read them until now: six rides at Cedar Point had a surveyed
       queue entrance sitting in the bundle and every route still aimed at the
       middle of the track.

       The first entrance rather than the nearest one. A ride with a standby and
       a Fastlane queue has two, they are kept apart only when they start more
       than eight metres apart, and picking by live position would move the
       destination under somebody already walking to it — which is the one thing
       the reroute logic below exists to avoid. The ride keeps its own position
       for the marker and the callout; only the destination moves. */
    if (nav.kind === 'poi') {
      const poi = findPlace(POIS, nav);
      const gate = bestEntrance(poi);
      const meta = poi ? entranceMeta(poi) : null;
      if (gate && Number.isFinite(gate.lat)) {
        return { ...nav, lat: gate.lat, lng: gate.lng, entranceMeta: meta };
      }
      if (meta) return { ...nav, entranceMeta: meta };
    }
    return nav;
  }, [nav, roster, meet, car, POIS]);

  // Kept in step with `nav` rather than written at each call site, so no future
  // way of setting a destination can forget to arm it.
  useEffect(() => {
    walkOn.current = nav != null;
  }, [nav]);

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
    // Only if there was a walk to end. This runs on every venue load as well as
    // on a real Stop, and a sheet the visitor deliberately left open has no
    // business being collapsed by the map underneath it finishing loading.
    if (walkOn.current) shrinkSheet(stops.peek);
    walkOn.current = false;
  }, [applyNav, shrinkSheet, stops]);

  // A walk belongs to the map it was worked out on. When the venue changes —
  // picked by hand, or followed to where the party is — the destination is a
  // place on the old map and its route is a line across geometry that is no
  // longer on screen, so the walk ends with it rather than quietly becoming a
  // straight line to somewhere a thousand miles away.
  useEffect(() => {
    if (!venue?.id) return;
    stopNav();
    setSelected(null);
    dismissPlaceView();
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
        if (geo.status === 'denied' || geo.status === 'unsupported' || geo.status === 'insecure') {
          showToast('Tap the map to set your starting point first.');
        } else {
          setGateOpen(true);
          showToast('Turn location on to get walking directions.');
        }
        return;
      }
      arrived.current = null;
      lastRoute.current = null;
      setPick(0);
      setSelected(null);
      // A walk is a different question than "what is here" — the capsule that
      // asked it goes with the selection it sat beside.
      setSpot(null);
      dismissPlaceView();
      setToast(null);
      setNav(target);
      setNavPhase('preview');
      holdFollow();
      shrinkSheet(stops.peek);
    },
    [position, showToast, stopNav, shrinkSheet, stops, dismissPlaceView, holdFollow],
  );

  const beginWalking = useCallback(() => {
    setNavPhase('go');
    resumeFollow();
    shrinkSheet(stops.peek);
    void haptic(30);
  }, [shrinkSheet, stops, resumeFollow]);

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
      return undefined;
    }
    const prev = lastRoute.current;
    const key = navKeyOf(navTarget);
    const stale =
      !prev ||
      prev.key !== key ||
      prev.graph !== graph ||
      prev.phase !== navPhase ||
      distance(prev.from.lat, prev.from.lng, position.lat, position.lng) > REROUTE_M ||
      distance(prev.to.lat, prev.to.lng, navTarget.lat, navTarget.lng) > REROUTE_M;
    if (!stale) return undefined;

    let cancelled = false;
    (async () => {
      const routing = await getRouting();
      if (cancelled) return;
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
        // Always apply the active profile — default is guest paths (skips service roads).
        ...(graph ? profileOpts(routeProfile, graph) : {}),
      };
      if (navPhase === 'preview') {
        setRoutes(routing.findRoutes(graph, position, navTarget, opts));
        setPick(0);
      } else {
        const chosen = routesRef.current[pickRef.current];
        const penalty = chosen?.avoid ?? null;
        setRoutes([routing.findRoute(graph, position, navTarget, { ...opts, penalty })]);
        setPick(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navTarget, position, graph, navPhase, mapData, POIS, routeProfile, pick, getRouting]);

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

  const progress = useMemo(() => {
    if (!route || !position || !routingRef.current) return null;
    return routingRef.current.routeProgress(route, position.lat, position.lng);
  }, [route, position, graph]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const walking = navPhase === 'go' && Boolean(navTarget);
  const previewing = navPhase === 'preview' && Boolean(navTarget);
  const offRoute = Boolean(walking && progress && progress.offset > OFF_ROUTE_M);

  /* Course-up only while Go is active — browse stays north-up (ADR-0011). */
  const rotation = useMemo(
    () =>
      mapRotationDegrees({
        walking,
        northUp,
        heading,
        course: progress?.course,
      }),
    [walking, northUp, heading, progress?.course],
  );

  /* Live facing Compass → paired Watch (ADR-0011). No-op on web. */
  const [watchSettingsEpoch, setWatchSettingsEpoch] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onSettings = () => setWatchSettingsEpoch((n) => n + 1);
    window.addEventListener('parkbound-watch-compass-settings', onSettings);
    return () => window.removeEventListener('parkbound-watch-compass-settings', onSettings);
  }, []);
  useEffect(() => {
    const selectedPlace =
      selected && Number.isFinite(selected.lat)
        ? {
            lat: selected.lat,
            lng: selected.lng,
            label: selected.n || selected.label,
            placeId: selected.i || selected.id,
          }
        : null;
    let nextTurn = null;
    if (walking && progress?.step) {
      const step = progress.step;
      nextTurn =
        typeof step.instruction === 'string'
          ? step.instruction
          : typeof step.text === 'string'
            ? step.text
            : null;
    }
    void pushWatchCompass(
      watchCompassPushState({
        me: position,
        heading,
        members: others,
        meet,
        go: walking ? navTarget : null,
        selection: selectedPlace,
        planNext: walking ? null : planNextPlace,
        settings: loadWatchSettings(),
        nextTurn,
        raised: true,
      }),
    );
  }, [
    position,
    heading,
    others,
    meet,
    walking,
    navTarget,
    selected,
    planNextPlace,
    progress,
    watchSettingsEpoch,
  ]);

  const puck = useMemo(() => {
    if (!walking || !progress?.snapped) return null;
    return { lat: progress.snapped[0], lng: progress.snapped[1], course: progress.course };
  }, [walking, progress]);

  const mapMe = useMemo(
    () =>
      mapDisplayPosition({
        position,
        pois: POIS,
        graph,
        bounds: venue?.bounds,
        walking,
      }),
    [position, graph, venue?.bounds, walking, POIS],
  );

  const { done: routeDone, ahead: routeAhead } = useMemo(() => {
    if (!walking || !routingRef.current) return { done: [], ahead: route?.points ?? [] };
    return routingRef.current.splitRouteAt(route, progress);
  }, [walking, route, progress, graph]);

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
    void haptic(90);
    stopNav();
  }, [walking, progress?.arrived, navTarget, showToast, stopNav]);

  const focusOn = useCallback(
    (target) => {
      holdFollow(target);
      shrinkSheet(stops.peek);
    },
    [shrinkSheet, stops.peek, holdFollow],
  );

  /* One tap on the map, four things it can mean, in this order. The order is
     the whole of the logic and it is not negotiable:

     1. Rally is armed — the FAB said "tap the map", so the tap sets the meet
        point and nothing else may steal it.
     2. There is no fix to trust — a manual pin is the only way to place
        yourself indoors, denied, or on a desktop, and it must stay reachable.
     3. Something is open — a selected pin, a pushed Place screen, a spot
        capsule. Tapping away from a thing is how every map on a phone says
        "never mind", so the first press closes what is open rather than
        opening something else. That includes the spot itself: one tap puts
        the capsule away, and the tap after it drops a new one.
     4. Nothing to dismiss — now the tap is about the ground itself, and it
        drops a named spot there.

     ParkMap.onPointerUp has already arbitrated pinch, fling, the marker
     hit-test, the route hit-test and double-tap zoom by the time this runs, and
     hands over a real coordinate. Nothing here reaches back into that. */
  const handleMapTap = useCallback(
    (lat, lng) => {
      if (armMeet) {
        setMeetPoint(lat, lng);
        return;
      }
      if (
        geo.status === 'manual' ||
        geo.status === 'idle' ||
        geo.status === 'denied' ||
        geo.status === 'unsupported' ||
        geo.status === 'insecure'
      ) {
        geo.setManual(lat, lng);
        return;
      }
      // Read through the ref: this callback must not be rebuilt on every push
      // and pop, and dismissPlaceView is a no-op that cannot report back.
      const { tab: at, stacks: cur } = navRef.current;
      const onIt = cur[at] || EMPTY_STACK;
      const placeOpen = onIt[onIt.length - 1] === 'place';
      if (selected || placeOpen || spot) {
        if (selected) setSelected(null);
        setSpot(null);
        dismissPlaceView();
        return;
      }
      // positionRef, not `position`: a fix arrives every second or two, and
      // rebuilding this callback on each one re-renders the memoised map for
      // nothing. The spot only needs where you were standing when you tapped.
      setSpot(spotAt({ lat, lng, pois: POIS, venue, map: mapData, me: positionRef.current }));
    },
    [
      armMeet,
      setMeetPoint,
      geo.status,
      geo.setManual,
      selected,
      spot,
      dismissPlaceView,
      POIS,
      venue,
      mapData,
    ],
  );

  /* Both carry-throughs do the same three things and differ only in where they
     land: remember the spot for the screen that is about to read it, put the
     capsule away, and open that screen far enough to work in. `selectTab` is
     the app's own move along the tab bar, so back still retraces properly. */
  const questAtSpot = useCallback(
    (at) => {
      setQuestSpot(at);
      setSpot(null);
      selectTab('quests');
      growSheet(stops.full);
    },
    [selectTab, growSheet, stops.full],
  );

  /* Marks is its own screen, under Collection, under Me. The whole path is
     laid down in one move rather than pushed a screen at a time, for the same
     reason openCredits does: `navRef` lags a tick behind, so three chained
     pushes would each read the stack the one before it had not written yet.
     Landing with Collection underneath means Back walks Marks → Collection →
     Me, which is where those three things actually live. */
  const markAtSpot = useCallback(
    (at) => {
      setMarkSpot(at);
      setSpot(null);
      const { stacks: cur } = navRef.current;
      goForward({ tab: 'settings', stacks: { ...cur, settings: ['closet', 'marks'] } }, 'fromRight');
      growSheet(stops.full);
    },
    [goForward, growSheet, stops.full],
  );

  /** List row: select / toggle in place. The expanded row already carries
   *  details and a navigate control; no need to push another screen. */
  const handleSelect = useCallback(
    (poi) => {
      // The same pin twice is a toggle. Nobody taps the thing that is already
      // open expecting it to open harder.
      if (selected && selected.lat === poi.lat && selected.lng === poi.lng) {
        setSelected(null);
        return;
      }
      setSelected(poi);
      holdFollow(poi);
      if (position) {
        const d = distance(position.lat, position.lng, poi.lat, poi.lng);
        const b = bearing(position.lat, position.lng, poi.lat, poi.lng);
        showToast(`${poi.n} · ${formatDistance(d)} ${cardinal(b)} · ${formatWalk(d)} walk`);
      }
    },
    [selected, position, showToast, holdFollow],
  );

  useEffect(() => {
    if (!selected) return;
    const next = findPlace(POIS, selected);
    if (!next) return;
    const heightChanged = JSON.stringify(next.h) !== JSON.stringify(selected.h);
    if (next.overlay !== selected.overlay || heightChanged) setSelected(next);
  }, [POIS, selected]);

  /**
   * Map icon: open the place sheet so the visitor can read what it is and
   * start a walk — the list's expand is not on screen when they are looking
   * at the map, and a toast alone is not a place page.
   */
  const handleSelectFromMap = useCallback(
    (poi) => {
      if (selected && selected.lat === poi.lat && selected.lng === poi.lng) {
        const { stacks: cur } = navRef.current;
        const exploreStack = cur.explore || EMPTY_STACK;
        const placeOpen = exploreStack[exploreStack.length - 1] === 'place';
        // Re-tapping the selected pin opens place detail when the sheet is not
        // already there (list/rail selection alone is not enough for the map
        // vertical check). Only clear when the place view is already open.
        if (placeOpen) {
          setSelected(null);
          dismissPlaceView();
          return;
        }
        push('place', 'explore');
        return;
      }
      setSelected(poi);
      holdFollow(poi);
      // A Place answers the same question the spot capsule was asking, and
      // better, so the capsule stands down rather than stacking under it.
      setSpot(null);

      const { stacks: cur } = navRef.current;
      const exploreStack = cur.explore || EMPTY_STACK;
      const placeOpen = exploreStack[exploreStack.length - 1] === 'place';
      const nextStacks = {
        ...cur,
        explore: placeOpen ? exploreStack : [...exploreStack, 'place'],
      };
      if (tabRef.current !== 'explore') {
        goForward({ tab: 'explore', stacks: nextStacks }, 'fromLeft');
        fitPlaceSheet();
      } else if (!placeOpen) {
        push('place', 'explore');
        return;
      } else {
        fitPlaceSheet();
      }
    },
    [selected, dismissPlaceView, goForward, push, fitPlaceSheet, holdFollow],
  );

  const onUserPan = useCallback(() => {
    gesturedAtRef.current = Date.now();
    setFollow(false);
    /* A leftover focus point (Locate used to write one) would ease the
       camera back to a stale coordinate and fight the pan. Free look
       leaves the camera where the finger put it. */
    setFocusPoint(null);
  }, []);

  /* Free look is a pause. Once the guest has been still long enough, Follow
     snaps back to this phone so the next fix recentres them. Previewing a
     route is not free look — framing the walk must not be undone. */
  useEffect(() => {
    if (follow || previewing) return undefined;
    const gesturedAt = gesturedAtRef.current;
    if (gesturedAt == null) return undefined;
    const due = (at, clock) => followShouldResume({ gesturedAt: at, now: clock, previewing });
    if (due(gesturedAt, Date.now())) {
      resumeFollow();
      return undefined;
    }
    const wait = Math.max(0, FOLLOW_RESUME_MS - (Date.now() - gesturedAt));
    const timer = setTimeout(() => {
      if (due(gesturedAtRef.current, Date.now())) resumeFollow();
    }, wait);
    return () => clearTimeout(timer);
  }, [follow, previewing, resumeFollow]);

  const headerLine = () => {
    if (venueStatus === 'loading') return 'Loading the map…';
    if (!position) return `${venue?.locality || 'Waiting'} · no fix yet`;
    const inside = withinBounds(venue?.bounds, position.lat, position.lng);
    /* `a` falls back to the venue's own name for a place that stands in no
       named district, and printing that here puts the park's name twice in a
       row — once in bold as the heading, once as the district. "On site" is
       what that fallback actually means. */
    const district = nearest?.p.a && nearest.p.a !== venue?.name ? nearest.p.a : null;
    const where = inside
      ? district || 'On site'
      : mapMe?.arrival
        ? `Near ${mapMe.arrivalLabel || 'entrance'}`
        : 'Off site';
    /* "±0 ft" is worse than saying nothing — it reads as a precision claim
       nobody made. A fix is either good enough not to mention or loose enough
       to be worth a warning, and the number only helps in the second case. */
    const feet = Math.round((position.acc || 0) * 3.28084);
    const acc = position.manual
      ? 'placed by hand'
      : feet > 60
        ? `roughly within ${feet} ft`
        : null;
    return [where, nearest ? `near ${nearest.p.n}` : null, acc].filter(Boolean).join(' · ');
  };

  /* ---------- the tab bar ---------- */

  /** Somebody in the party is in trouble — the Party tab has to say so. */
  const helpNow = useMemo(() => others.some((m) => m.status === 'NEED HELP'), [others]);

  const tabs = useMemo(() => {
    const out = [
      /* The glyph is the search field's, not a compass: this tab opens on a
         search field and the twin draws the same magnifier in both places. A
         compass rose beside the word "Explore" promised a wayfinding screen
         and delivered a text input. The id is untouched — data-tab is what the
         browser suite navigates by. */
      { id: 'explore', label: 'Explore', icon: 'magnifyingglass' },
      {
        id: 'party',
        label: 'Party',
        icon: 'person.2.fill',
        // A count while a party is running, and red the moment one of them
        // needs help — a tab bar is the only chrome always on screen, so it is
        // the right place for the one thing that must never be missed.
        badge: helpNow ? '!' : active ? visibleOnMap : null,
        badgeLabel: helpNow ? 'someone needs help' : active ? `${visibleOnMap} on the map` : null,
        alert: helpNow,
      },
      {
        id: 'quests',
        /* "Quests" on the bar, "Side Quests" everywhere else. A tab label is
           read at 10px in a five-column strip: the long form wrapped, and the
           word that survived the wrap was the one shared with every other
           quest in the app. The full name is on the screen it names, in that
           panel's own SIDE QUESTS · NEAR YOU eyebrow. */
        label: 'Quests',
        icon: 'flag.fill',
      },
    ];
    // Plan tab: today's ordered stops, plus rider height when the venue publishes rules.
    out.push({
      id: 'rides',
      label: 'Plan',
      icon: GLYPHS.plan,
      badge: planItems.length || null,
      badgeLabel: planItems.length ? `${planItems.length} on the plan` : null,
    });
    // Once there is a name, the tab wears it. "Guest" is the placeholder
    // nobody typed, and "GU" on a tab is not a person — so that one keeps the
    // Me glyph until the visitor says who they are.
    const named = identity?.name && identity.name !== 'Guest';
    out.push({
      id: 'settings',
      label: 'Me',
      icon: 'sparkles',
      initials: named ? initialsFor(identity.name) : null,
    });
    return out;
  }, [helpNow, active, visibleOnMap, planItems.length, identity?.name]);

  useEffect(() => {
    tabsRef.current = tabs.map((t) => t.id);
  }, [tabs]);

  /* ---------- the sheet's own gestures ---------- */

  // While a route is running the sheet is out of the way unless it is asked
  // for: the map and the two HUD strips are the whole interface, and the sheet
  // comes back over them only when you open the steps. "Asked for" is anything
  // above the resting stop, which is what a visitor who has pulled the sheet up
  // during a walk has done.
  const stowed = previewing || (walking && sheetPx <= stops.peek);

  const drag = useSheetDrag({ stops, height: sheetPx, onHeight: setSheetPx, rootRef: appRef });

  /* Resting height drives the content ladder; --sheetH on the root is updated
     directly during a drag so the map chrome rides the finger without a full
     page re-render every pointermove. */
  const form = sheetForm(sheetPx, stops);
  /* The locate card's rung is only charged on a phone that has no fix, so the
     budget has to be told which phone this is. While the gate is up the answer
     is "one that is already being asked", and a second card underneath it
     saying the same thing would be the app talking over itself. */
  const plan = sheetPlan(sheetPx, { located: Boolean(position) || gateOpen });

  // `atMap` marks the screen that is read over the top of the map rather than
  // instead of it — the one the resting stop is designed around.
  const sheetClass = `sheet ${form} ${tab === 'explore' ? 'atMap' : ''} ${
    stowed ? 'stowed' : ''
  } ${drag.dragging ? 'dragging' : ''}`;

  /* What the map has to lay its labels above. The resting height, not the live
     one: relaying out every label in the park on each pointermove is the one
     thing on this path expensive enough to drop frames, and a map that holds
     still under a moving sheet is what it already did. */
  const floorPx = stowed ? STOWED_PX : sheetPx + SHEET_GAP[sheetForm(sheetPx, stops)];

  /* The capsule is about the map, so it is only up while the map is what the
     visitor is looking at. A route preview and a walk each own the bottom of
     the screen with something more urgent, and a selected Place answers the
     same question in more detail — in every one of those cases the spot is
     already cleared, and this is the guard that says so out loud. */
  const spotShown = Boolean(spot) && !walking && !previewing && !selected;

  /* The selection's own capsule, on the same edge and under the same rules.
     It stands down once the Place view is open, because that view is the same
     answer with everything in it — a pill repeating the name of the card
     directly beneath it is chrome describing chrome. */
  const selShown =
    Boolean(selected) && !walking && !previewing && !(tab === 'explore' && view === 'place');
  const selStatus = useMemo(() => {
    if (!selShown || !selected) return null;
    if (!isRideable(selected) && selected.c !== 'show') return null;
    if (!weatherFeed.weather && !partyRides && !position) return null;
    return liveFor(selected, partyRides?.[selected.id] ?? null, weatherFeed.weather, clock, {
      metres: position ? distance(position.lat, position.lng, selected.lat, selected.lng) : null,
      membersNear: membersAt(selected, others),
    });
  }, [selShown, selected, weatherFeed.weather, partyRides, position, others, clock]);

  return (
    // --sheetH is the sheet's live height, so the FABs, the toast, the zoom pad
    // and the scale bar ride with it — under the finger too, which is why the
    // dragging flag is published alongside it to take their easing off.
    <main
      ref={appRef}
      className="app"
      data-sheet={stowed ? 'stowed' : form}
      data-dragging={drag.dragging ? '1' : undefined}
      /* The map's own controls ride on --sheetH, so a tall enough sheet pushes
         them into the buttons in the top corners. They step aside instead. */
      data-crowded={!stowed && sheetCrowdsMap(sheetPx, viewportH) ? '1' : undefined}
      data-nav={walking ? 'go' : previewing ? 'preview' : undefined}
      /* The spot capsule is full width on the sheet's edge, where the FAB
         column and the scale bar already live. They step aside for it — see
         .app[data-spot] in globals.css. */
      data-spot={spotShown ? '1' : undefined}
      /* And the same for the selection's pill, which rides the same edge. */
      data-sel={selShown ? '1' : undefined}
      /* The intro is read over the painted park — see the first-run hold in
         globals.css. Only the intro lifts the hold off the map, and only for
         the map: a returning phone never mounts it, so the cover stays whole. */
      data-intro-map={showIntroSplash ? '1' : undefined}
      /* And for the intake gates, which the design also reads over the park:
         their scrim is .10 at the top precisely so the World being asked about
         is the thing behind the question. Separate from data-intro-map because
         the two want different amounts of park — the intro dims it to a wash
         under a .86 scrim, the intake shows it. */
      data-gate-map={showIntakeGate ? '1' : undefined}
      style={{ '--sheetH': `${stowed ? STOWED_PX : sheetPx}px` }}
    >
      {introOverlay === 'hold' && (
        <div className="gate gateFirstRun" data-intro-hold="1" aria-hidden="true" />
      )}
      <AuthBridge onSession={setAuthSession} onBindUserId={handleBindProfile} />
      <VenueLoadFade
        venueId={venue?.id}
        venueName={venue?.name}
        loading={venueStatus === 'loading'}
      />
      {mapLibreDisplayEnabled() && venue?.id === DISPLAY_SPIKE_VENUE && !svgParityView ? (
        // Phase 1 display-pipeline spike (issue #527): Big Kahuna's is the
        // only World with a certified display pack today, so this stays
        // scoped to it rather than swapping the renderer app-wide. Static
        // base map and Place pins only — Overlay/route/puck/Follow stay on
        // ParkMap.jsx until a later phase ports them (ADR-0013).
        <DisplayMap
          venue={venue}
          pois={POIS}
          // Parity-test seam (issue #527), live on every flag-on mount:
          // the flag is what keeps it out of the shipped SVG experience.
          onMapReady={(m) => {
            window.__parkboundDisplayMap = m;
          }}
        />
      ) : (
        <ParkMap
          key={venue?.id || 'map'}
          data={mapData}
          center={venue?.center}
          pois={POIS}
          me={mapMe}
          members={others}
          meet={meet}
          spot={spot}
          car={car}
          selected={selected}
          onSelectPoi={handleSelectFromMap}
          onMapTap={handleMapTap}
          armMeet={armMeet}
          follow={follow}
          onUserPan={onUserPan}
          heading={heading}
          eligibility={eligibilityView}
          visibleCategories={categories}
          onToggleCategory={toggleCategory}
          focusPoint={focusPoint}
          theme={mapWear}
          route={navTarget ? route : null}
          routeStep={walking ? progress?.step ?? null : null}
          routeAhead={routeAhead}
          routeDone={routeDone}
          routeTargetName={navTarget?.kind === 'poi' ? navTarget.placeId || navTarget.label : null}
          alternatives={shownAlternatives}
          onPickAlternative={setPick}
          puck={puck}
          bottomInset={floorPx}
          rotation={rotation}
          liftCentre={walking ? 0.2 : previewing ? -0.12 : 0}
          navZoom={walking ? 3 : null}
          fitPoints={previewing ? route?.points : null}
          fitKey={previewing ? `${navKeyOf(navTarget)}:${pick}` : null}
          mapKeyHidden={previewing || walking}
          onMapStats={handleMapStats}
          marks={worldMarksOnMap}
          selfKit={worldProgress.kit || selfMember?.kit || null}
          onThankMark={thankAMark}
          overlayPins={overlayPins}
          planNextPlaceId={walking ? null : planNextPlace?.placeId}
          fogFilter={mapFogFilter}
        />
      )}

      {/* The ODbL notice OSM-derived geometry requires — always mounted beside
          the map (not inside ParkMap.jsx's own furniture, which folds away
          during preview/walking/full-sheet states) so it stays up whenever
          the map itself is. Tapping it opens Settings → Credits. */}
      <MapAttribution onOpenCredits={openCredits} />

      {/* Nothing runs across the top of a phone map. The two controls float in
          the corner and the rest of the frame is map. */}
      <header className="topbar">
        {/* Desktop / wide: primary logo lockup in the top-left (brand sheet Image 1).
            Phones keep the map chrome clear — the sheet brand + splash carry the lockup. */}
        <div className="topbarBrand">
          {venue?.name ? (
            <BrandMark
              variant="glyph"
              size={22}
              aqua="var(--aqua)"
              className="topbarGlyph"
              title={BRAND.name}
            />
          ) : (
            <BrandLockup size="sm" showTagline={false} className="topbarLockup" markTitle={BRAND.name} />
          )}
        </div>
        <div className="topbarActions">
          <button
            type="button"
            className="iconBtn"
            onClick={() => setPaletteMode((m) => cyclePaletteMode(m))}
            aria-label={paletteToggleAria(paletteMode, theme)}
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
            aria-label={tapeOn ? 'Hide Compass' : 'Show Compass'}
          >
            <Icon name="safari" />
          </button>
        </div>
      </header>

      {/* In the top corner with the rest of the map's chrome, because that is
          where a phone map puts the thing you glance at rather than open. It
          is a chip until it has something to say, and its own card when it
          does — see components/WeatherBanner.jsx. */}
      <WeatherBanner
        weather={weatherFeed.weather}
        observed={weatherFeed.observed}
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
          growSheet(SHEET_LIST_AT_PX);
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
          selected={
            selected && Number.isFinite(selected.lat)
              ? {
                  lat: selected.lat,
                  lng: selected.lng,
                  label: selected.n || selected.label,
                  placeId: selected.i || selected.id,
                }
              : null
          }
          go={walking ? navTarget : null}
          planNext={walking ? null : planNextPlace}
          heading={heading}
          theme={theme}
          lowered={Boolean(walking && navTarget)}
        />
      )}

      {/* What a tap on bare ground opens: where you tapped, and the two things
          you can do with it. Both hand the spot to the screen they open, which
          is the whole reason the interaction exists — see components/SpotCapsule.jsx. */}
      {spotShown && (
        <SpotCapsule
          spot={spot}
          onClose={() => setSpot(null)}
          onQuest={questAtSpot}
          onMark={markAtSpot}
        />
      )}

      {/* The Place a pin or a list row put on the map, said over the map. Same
          edge, same lens and same z-index as the spot capsule above — the two
          never coexist, because selecting a Place clears the spot. */}
      {selShown && (
        <SelectionCapsule
          poi={selected}
          /* The one rule the list, the map and the Place head already share:
             a ruled-out ride is red rather than its category colour dimmed. */
          dot={
            eligibilityView.at(identityOf(selected))?.blocks
              ? paletteFor(theme).barred
              : paletteFor(theme).categories[selected.c]
          }
          status={selStatus}
          metres={
            position ? distance(position.lat, position.lng, selected.lat, selected.lng) : null
          }
          onOpen={() => push('place', 'explore')}
          onNavigate={(p) => startNav(placeNav(p))}
          onClose={() => setSelected(null)}
        />
      )}

      <div className={`fabs ${walking ? 'go' : form} ${previewing ? 'preview' : ''}`}>
        {/* Where the car is. Two taps, and each one does the only thing anybody
            wants at that moment: with nothing saved it saves where you are
            standing, which is where you are the second you get out of the car;
            with something saved it takes the map to it, which is the only
            reason you ever look at this again. Moving it is saving it again
            from somewhere else, and forgetting it is the ✕ on its card. */}
        {!walking && (
          <button
            type="button"
            className={`fab ${car ? 'active' : ''}`}
            onClick={() => {
              if (car) {
                holdFollow(car);
                shrinkSheet(stops.peek);
                return;
              }
              if (!position) {
                setGateOpen(true);
                return;
              }
              putCar(position.lat, position.lng);
              showToast('Saved where you parked');
            }}
            aria-label={car ? 'Go to where I parked' : 'Save where I parked'}
          >
            <Icon name="car.fill" />
          </button>
        )}
        {!walking && (
          <button
            type="button"
            className={`fab ${armMeet ? 'armed' : ''}`}
            onClick={() => {
              setArmMeet((v) => !v);
              if (!armMeet) {
                shrinkSheet(stops.peek);
                showToast('Rally ready — tap the map to set your Party’s destination');
              }
            }}
            aria-label={WORDS.meetup}
          >
            <Icon name={GLYPHS.meetup} />
          </button>
        )}
        {/* Panning away is free look; this snaps Follow back immediately. */}
        <button
          type="button"
          className={`fab ${follow ? 'active' : ''} ${walking && !follow ? 'resume' : ''}`}
          onClick={() => {
            if (position) {
              resumeFollow();
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
          profiles={routeProfiles}
          profileId={routeProfile}
          onProfile={setRouteProfile}
          profileNote={profileNote}
          entranceHint={navTarget?.kind === 'poi' ? entranceLine(findPlace(POIS, navTarget)) : null}
        />
      )}

      {walking && sheetPx <= stops.peek && (
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

      {/* The height is stated rather than left to a class, because there are
          no longer four of them to have a class each: it is whatever the
          visitor pulled it to. */}
      <section
        className={sheetClass}
        style={{ height: stowed ? 0 : 'var(--sheetH)' }}
        /* The whole sheet pulls, not just its handle — see useSheetDrag. The
           ref owns the non-passive touchmove that decides, once per gesture,
           whether a swipe belongs to the sheet or to a list inside it. */
        ref={drag.attachBody}
        {...drag.bodyHandlers}
      >
        {/* A slider, because that is now what it is: the height is a value on a
            range rather than a choice between four, and the only way to say
            that to a screen reader — or to a keyboard, which has no finger to
            drag with — is to say it. The arrows move it a card's worth at a
            time; page and home/end walk the named stops. */}
        <button
          type="button"
          className="grab"
          onClick={() => {
            // A drag that ended on this handle emits a click too. It has
            // already chosen a height; cycling on top of it would undo it.
            if (drag.swallowClick()) return;
            // Round and round: shut → peek → half → full → shut, starting from
            // whichever of them the current height is under. Dragging is the way
            // most people will move the sheet, but a tap has to be able to reach
            // every stop too, including all the way back down — somebody who has
            // collapsed it must not need a gesture to undo it.
            setSheetPx(nextSheetStop(sheetPx, stops));
          }}
          role="slider"
          aria-label="Resize panel"
          aria-orientation="vertical"
          aria-valuemin={stops.shut}
          aria-valuemax={stops.full}
          aria-valuenow={Math.round(sheetPx)}
          aria-valuetext={`Panel ${Math.round((sheetPx / stops.full) * 100)}% of full height`}
          onKeyDown={(e) => {
            const step = (by) =>
              setSheetPx((px) => Math.max(stops.shut, Math.min(stops.full, px + by)));
            if (e.key === 'ArrowUp') step(48);
            else if (e.key === 'ArrowDown') step(-48);
            else if (e.key === 'PageUp') setSheetPx(nextSheetStop(sheetPx, stops));
            else if (e.key === 'PageDown') setSheetPx(stops.shut);
            else if (e.key === 'Home') setSheetPx(stops.shut);
            else if (e.key === 'End') setSheetPx(stops.full);
            else return;
            e.preventDefault();
          }}
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
            <header className={`navHead${view === 'place' ? ' placeNav' : ''}`}>
              <button type="button" className="navBack" onClick={pop} aria-label="Back">
                <Icon name="chevron.left" size={19} />
                {view === 'place' ? null : 'Back'}
              </button>
              <h2>{view === 'place' && selected?.n ? selected.n : VIEW_TITLES[view] || ''}</h2>
              <span className="navHeadPad" aria-hidden="true" />
            </header>
          ) : tab === 'explore' ? (
            /* Everything on this screen is here because the height the visitor
               left the sheet at paid for it. `plan` is that budget, spent in
               importance order — see lib/sheet.js. Nothing below is squashed to
               fit: a row either has its measured room or it is not drawn, so
               what is on the sheet is always something you can read rather than
               a sliced-off edge of four things you cannot. */
            <>
              {/* Search is the way into a map, so it is the first thing in the
                  sheet and it never scrolls away. */}
              {plan.search && (
                <div className="searchRow">
                  <div className="searchField">
                    <span className="searchIn" aria-hidden="true">
                      <Icon name="magnifyingglass" size={17} />
                    </span>
                    <input
                      className="field"
                      placeholder={`Search ${venue?.name || 'the park'}`}
                      value={query}
                      /* Typing is asking for the list, so the sheet comes up far
                         enough to be one. */
                      onFocus={() => growSheet(SHEET_LIST_AT_PX)}
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
              )}
              {/* Where you are, on one line: the World in bold, then the
                  district and the nearest Place after it. The design sets it
                  that way and the sheet's own arithmetic agrees — SHEET_BRAND_PX
                  budgets "an 18px line over 8", which is what this is. The
                  stacked version it replaces was a 20px lockup row above the
                  same 18px line and cost 48, so the resting sheet was quietly
                  22px over the budget the peek stop is derived from. */}
              {plan.brand && (
                <div className="brand">
                  {venue?.name ? (
                    <p className="brandStatus brandWhere">
                      <b className="brandName">{venue.name}</b>
                      {` · ${headerLine()}`}
                    </p>
                  ) : (
                    <>
                      <BrandLockup size="sm" showTagline className="sheetBrandLockup" />
                      <div className="brandStatus">{headerLine()}</div>
                    </>
                  )}
                </div>
              )}
              {/* The one card left on the resting sheet, and only on a phone
                  that cannot answer anything else: without a fix the list has
                  no walking times, the venue line has no district and the Party
                  has no ranges, so the way out of that is the screen. It says
                  what is wrong and offers the one control that fixes it. */}
              {plan.locate && (
                <div className="locateCard">
                  <span className="locateText">
                    <b>Location off</b>
                    <span>Turn it on for walking times and your Party.</span>
                  </span>
                  <button
                    type="button"
                    className="btn small rect primary locateGo"
                    onClick={() => setGateOpen(true)}
                  >
                    Turn on
                  </button>
                </div>
              )}
              {/* Where the list would be, when the list will not fit: it is not
                  merely scrolled off, it is not rendered, which is the right
                  call but leaves a 36×5px grey pill as the only evidence that
                  the sheet moves. Say what is under there, in words, and make
                  the words the handle. */}
              {plan.hint && (
                <button
                  type="button"
                  className="moreHint"
                  onClick={() => growSheet(SHEET_LIST_AT_PX)}
                >
                  Pull up to explore — food, toilets and rides
                  <Icon name="chevron.up" size={13} />
                </button>
              )}
            </>
          ) : (
            /* A tab's own root opens straight on its content. The design names
               these screens with the section eyebrow at the top of the panel —
               TODAY'S STOPS, YOUR PARTY · 4, YOUR JOURNEY, SIDE QUESTS · NEAR
               YOU — and leaves the "which tab am I on" job to the tab bar,
               which is already lit. A 34px title plus a subtitle above that
               eyebrow said the same thing three times and cost the sheet its
               first 60px, on the four screens that carry the most rows.

               Nothing the subtitle said is lost: the Plan's height rides on the
               map's own filter badge, Side Quests keeps its "For <World> · N
               waiting" line, Settings opens on the slogan strip, and "N on the
               map" was a tally of what each roster card states for itself. */
            null
          )}

          <div className={`sheetBody${view === 'place' ? ' placeBody' : ''}`}>
            {view === null && tab === 'explore' && plan.list && (
              <>
                {/* The one row left on this screen. Everywhere else it used to
                    lead is a tab now; a walk in progress is not a place, so it
                    stays here, and only while there is one. */}
                {navTarget && (
                  <div className="rowList">
                    <button type="button" className="row" onClick={() => push('route')}>
                      <span className="rowText">Trail</span>
                      <span className="rowValue">{navTarget.label}</span>
                    </button>
                  </div>
                )}
                <PlaceList
                  me={position}
                  eligibility={eligibilityView}
                  height={mapHeight}
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
                  members={others}
                  // Reporting needs somewhere to send it. Outside a party the list
                  // still shows the forecast, minus the buttons.
                  onReport={party?.active ? reportRide : null}
                  onAddToPlan={addToPlan}
                  now={clock}
                  overlayCompletionsFor={overlayCompletionsFor}
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
                onClose={() => shrinkSheet(stops.peek)}
              />
            )}

            {view === 'place' && (
              <PlaceDetail
                poi={selected}
                me={position}
                eligibility={eligibilityView}
                theme={theme}
                weather={weatherFeed.weather}
                rides={partyRides}
                members={others}
                now={clock}
                onNavigate={startNav}
                onSetMeet={(p) => setMeetPoint(p.lat, p.lng, p.n)}
                onReport={party?.active ? reportRide : null}
                onAddToPlan={addToPlan}
                inPlan={
                  Boolean(selected) &&
                  planItems.some((s) => s.placeId === (selected.i || selected.id))
                }
                overlayCompletions={selected ? overlayCompletionsFor(selected) : []}
                session={authSession}
              />
            )}

            {view === null && tab === 'party' && (
              <>
              <PartyPanel
                code={code}
                invite={party?.invite ?? null}
                members={roster}
                meet={meet}
                me={position}
                myId={party?.selfId ?? null}
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
                onShareMode={(mode) =>
                  runtime.current?.setShareMode(
                    mode,
                    mode === 'precise' ? { durationMs: PRECISE_MAX_MS } : {},
                  )
                }
                onCreate={createParty}
                onJoin={joinParty}
                onLeave={leaveParty}
                onClearMeet={clearMeet}
                onNavigateMeet={() => startNav({ kind: 'meet', label: meet?.label || 'Rally Point' })}
                onFocus={(m) => {
                  holdFollow(m);
                  shrinkSheet(stops.peek);
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
                onSuggestReunification={suggestReunification}
                reunifyBusy={reunifyBusy}
                session={authSession}
                onSession={(next) => {
                  setAuthSession(next);
                  // Keep a park-day name (set under Me / /join). Only fill Guest.
                  if (next?.displayName) {
                    setIdentity((i) => {
                      const cur = (i?.name || '').trim();
                      if (cur && cur !== 'Guest') return i;
                      return { ...i, name: next.displayName };
                    });
                  }
                }}
                guests={managedGuests}
                onSeedGuest={(g) => {
                  const seeded = seedFromManagedGuest(g, { skipPrompt: true });
                  runtime.current?.addMember({
                    id: newMemberId(),
                    name: seeded.name,
                    height: seeded.height,
                    withAdult: true,
                    groupId: selfMember?.groupId || null,
                  });
                  showToast(`Added ${seeded.name}`);
                }}
                onSaveGuest={async (guest) => {
                  try {
                    await upsertManagedGuest(guest);
                    setManagedGuests(await listManagedGuests());
                  } catch {
                    /* Profile required — the roster add still happened. */
                  }
                }}
                onAddDeviceLess={({ name, height: inches }) => {
                  runtime.current?.addMember({
                    id: newMemberId(),
                    name,
                    height: inches,
                    withAdult: true,
                    groupId: selfMember?.groupId || null,
                  });
                  showToast(`Added ${name}`);
                }}
                myGroupId={selfMember?.groupId || null}
                onTagDeviceLess={(id) => {
                  const mine = selfMember?.groupId;
                  if (!mine) {
                    runtime.current?.setGroupId('us');
                    runtime.current?.setMemberFacts({ groupId: 'us' }, id);
                  } else {
                    runtime.current?.setMemberFacts({ groupId: mine }, id);
                  }
                }}
                onRemoveDeviceLess={(id) => {
                  runtime.current?.removeMember(id);
                  showToast('Removed from this party');
                }}
                car={car}
                /* Same two-state affordance as the map's car FAB, worded: the
                   first tap saves the spot, later ones walk you back to it
                   through the existing nav.kind === 'car' target. */
                onCar={() => {
                  if (car) {
                    startNav({ kind: 'car', label: 'Where I parked' });
                    return;
                  }
                  if (!position) {
                    setGateOpen(true);
                    return;
                  }
                  putCar(position.lat, position.lng);
                  showToast('Saved where you parked');
                }}
                onHeights={
                  heights
                    ? (id) => {
                        setHeightFocus({ memberId: id, nonce: Date.now() });
                        selectTab('rides');
                      }
                    : null
                }
              />
              <IntelligencePanel
                rides={partyRides || {}}
                plan={planItems}
                planContext={planContext}
                inParty={active}
                myGroupId={selfMember?.groupId}
                onGroupId={(g) => runtime.current?.setGroupId?.(g)}
                onSetPlan={commitPlan}
                onWalkStop={(s) => {
                  const poi = POIS.find((p) => p.i === s.placeId || p.id === s.placeId);
                  if (poi) startNav(poi);
                }}
                onUndoMeet={clearMeet}
              />
              </>
            )}

            {view === null && tab === 'quests' && (
              <SideQuestsPanel
                venueName={venue?.name}
                venueId={venue?.id}
                pois={POIS}
                gaps={venueGaps || []}
                map={mapData}
                bounds={venue?.bounds}
                position={position}
                onSelectPlace={(p) => {
                  handleSelect(p);
                  selectTab('explore');
                }}
                session={authSession}
                onSession={setAuthSession}
                onRideReport={party?.active ? reportRide : null}
                onWorldProgress={recordWorldQuest}
                onContribution={handleContribution}
                overlay={localOverlay}
                flushTick={questFlushTick}
                /* The ground the visitor tapped "Side Quest here" on, or null
                   when they arrived by the tab bar. The anchored-spot banner
                   that reads it belongs to the Side Quests screen's own pass;
                   this is the wire it reads from. */
                spot={questSpot}
                onClearSpot={() => setQuestSpot(null)}
              />
            )}

            {view === null && tab === 'rides' && (
              <PlanPanel
                rides={partyRides || {}}
                plan={planItems}
                planContext={planContext}
                onSetPlan={commitPlan}
                onWalkStop={(s) => {
                  const poi = POIS.find((p) => p.i === s.placeId || p.id === s.placeId);
                  if (poi) startNav(poi);
                }}
                hasHeights={heights}
                height={height}
                withAdult={withAdult}
                onHeight={(h) => {
                  setHeight(h);
                  if (party?.active) runtime.current?.setMemberFacts({ height: h });
                }}
                onWithAdult={(v) => {
                  setWithAdult(v);
                  if (party?.active) runtime.current?.setMemberFacts({ withAdult: v });
                }}
                /* Only ever a device-less seat: HeightPanel offers no editing
                   for a Member holding their own phone, because state.js drops
                   that patch in silence and the value would snap back. */
                onMemberHeight={(id, h) => runtime.current?.setMemberFacts({ height: h }, id)}
                onMemberWithAdult={(id, v) => runtime.current?.setMemberFacts({ withAdult: v }, id)}
                members={roster}
                myId={party?.selfId ?? null}
                inParty={Boolean(party?.active)}
                openHeights={heightFocus}
                venue={venue}
              />
            )}

            {/* ---- the Me tab ----
                Root is the guest's own standing (MePanel); Settings and
                Collection are screens under it, and Marks a screen under
                Collection. Each block below is one screen, and every prop a
                screen needs is handed to it here — Settings does not forward
                Collection's eleven, because Settings is no longer where
                Collection lives. */}
            {view === null && tab === 'settings' && (
              <MePanel
                session={authSession}
                onSession={onAuthSession}
                profileXp={authSession?.xp ?? 0}
                contributions={worldProgress?.meters?.contributions ?? 0}
                onOpenCloset={() => push('closet', 'settings')}
                onOpenSettings={() => push('settings', 'settings')}
              />
            )}

            {view === 'settings' && (
              <SettingsPanel
                identity={identity}
                onName={(v) => setIdentity((i) => ({ ...i, name: v.trim() || 'Guest' }))}
                onNameCommit={(v) => runtime.current?.setMemberName(v.trim() || 'Guest')}
                position={position}
                onLocationSettings={() => setGateOpen(true)}
                paletteMode={paletteMode}
                onPaletteMode={setPaletteMode}
                categoryCount={[...categories].filter((c) => presentCategories.has(c)).length}
                categoryTotal={Object.keys(CATEGORIES).filter((c) => presentCategories.has(c)).length}
                venueName={venue?.name}
                onPush={push}
                pushKinds={notifier.KINDS}
                pushPrefs={pushPrefs}
                pushState={pushState}
                pushNeedsInstall={notifier.iosNeedsInstall()}
                hiddenCards={hiddenHere}
                onOpenCloset={() => push('closet', 'settings')}
                car={car}
                onClearCar={() => {
                  clearCar();
                  showToast('Forgotten where you parked');
                }}
                appVersion={appUpdate.version}
                appBuilt={appUpdate.built}
                updateStatus={appUpdate.status}
                movementEnabled={movement.enabled}
                movementPending={movement.totals.pending}
                session={authSession}
                onSession={onAuthSession}
                onWatchCompass={() => push('watch-compass')}
                openTopic={settingsOpenTopic}
              />
            )}

            {view === 'notifications' && (
              <PushSettings
                pushKinds={notifier.KINDS}
                pushPrefs={pushPrefs}
                onPushPref={(key, on) => setPushPrefs((p) => ({ ...p, [key]: on }))}
                pushState={pushState}
                onEnablePush={enablePush}
                pushNeedsInstall={notifier.iosNeedsInstall()}
              />
            )}

            {view === 'hidden-cards' && (
              <HiddenCards
                hiddenCards={hiddenHere}
                cardLabels={CARD_LABELS}
                onUnhideCard={unhideCard}
              />
            )}

            {view === 'closet' && (
              <WorldCloset
                progress={worldProgress}
                world={mergedWorld}
                acceptedOffer={acceptedOffer}
                selfId={party?.selfId || null}
                session={authSession}
                venue={venue}
                onWearOwn={(skinId) => {
                  setAcceptedOffer(null);
                  setWorldProgress((p) => ({ ...p, wearSkin: skinId }));
                  runtime.current?.setWearSkin?.(skinId);
                }}
                onAcceptOffer={(offer) => setAcceptedOffer(offer)}
                onClearWear={() => setAcceptedOffer(null)}
                onOffer={(skinId) =>
                  runtime.current?.offerSkin?.(skinId, {
                    unrestricted: Boolean(worldProgress.godmode),
                  })
                }
                onWithdraw={(skinId) => runtime.current?.withdrawOffer?.(skinId)}
                onEquipKit={(kit) => {
                  setWorldProgress((p) => ({ ...p, kit }));
                  runtime.current?.setKit?.(kit);
                }}
                onOpenMarks={() => push('marks', 'settings')}
                /* Read for one line of copy — what the Marks row is standing
                   over. Placement itself is the next screen down. */
                spot={markSpot}
              />
            )}

            {view === 'marks' && (
              <WorldMarks
                session={authSession}
                onSession={onAuthSession}
                world={mergedWorld}
                spot={markSpot}
                onClearSpot={() => setMarkSpot(null)}
                onDropMark={(fields) => {
                  const now = Date.now();
                  publishMark({
                    ...fields,
                    /* The anchored spot wins. This used to read
                       `selected?.i || selected?.id || fields.placeId`, which
                       filed the Mark against whatever Place happened to be
                       selected on the map — a pin left open behind the sheet
                       silently stole every Mark dropped while it was. A Mark
                       stands where the visitor put it, and `fields.placeId`
                       is null on open ground by design (lib/spot.js), which
                       is the honest answer, not a gap to fill in. */
                    placeId: fields.placeId || null,
                    venueId: venue?.id,
                    createdAt: now,
                    authorId: authSession?.userId,
                    authorPartyId: party?.partyId || null,
                  });
                }}
              />
            )}

            {view === 'watch-compass' && (
              <WatchCompassSettings
                me={position}
                members={others}
                meet={meet}
                go={walking ? navTarget : null}
                planNext={walking ? null : planNextPlace}
                selected={
                  selected && Number.isFinite(selected.lat)
                    ? {
                        lat: selected.lat,
                        lng: selected.lng,
                        label: selected.n || selected.label,
                        placeId: selected.i || selected.id,
                      }
                    : null
                }
                heading={heading}
                progress={progress}
                walking={walking}
              />
            )}

            {view === 'movement' && (
              <MovementHistoryPanel movement={movement} venueName={venue?.name} />
            )}

            {view === 'categories' && (
              <div>
                <div className="chips wrap">
                  {/* Only what this venue has. A switch for a category with
                      nothing behind it is a switch that does nothing, and it
                      tells the visitor this place has campsites when it has
                      none. */}
                  {Object.entries(CATEGORIES)
                    .filter(([key]) => presentCategories.has(key))
                    .map(([key, cat]) => (
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
                              holdFollow();
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

            {view === 'diagnostics' && (
              <Diagnostics
                runtime={runtimeApi}
                geo={geo}
                appVersion={appUpdate.version}
                appBuilt={appUpdate.built}
                remoteVersion={appUpdate.remoteVersion}
                remoteBuilt={appUpdate.remoteBuilt}
                updateStatus={appUpdate.status}
                mapStats={mapStatsRef}
              />
            )}
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

      {showIntroSplash && (
        <IntroSplash
          version={appUpdate.version}
          onContinue={() => setLogoSplashDismissed(true)}
        />
      )}

      {/* Explore-without-GPS uses its own card; location intake is the GPS gate. */}
      {showExplorePrompt && (
        <ParkPrompt
          choice={parkChoice}
          options={parkOptions}
          explore
          busy={venueStatus === 'loading'}
          error={venueStatus === 'error' ? venueError : null}
          onConfirm={(id) => {
            confirmPark(id).catch(() => {});
          }}
          onSkip={() => {
            setParkAsked(true);
            setGateOpen(false);
          }}
        />
      )}

      {locationLocked && (
        <GpsGate
          partyLock
          venueName={venue?.name}
          status={geo.status}
          error={geo.error}
          onRequest={() => {
            geo.request();
            geo.enableCompass();
          }}
        />
      )}

      {/* The intake: brand welcome, install pitch, location, and park confirm on one gate. */}
      {showIntakeGate && (
        <GpsGate
          firstRun={firstRunSession}
          venueName={venue?.name}
          status={geo.status}
          error={geo.error}
          welcome={
            nearestIntent ||
            showWelcomeGate ||
            (introSeen === false && geo.status === 'idle' && !parkChoice)
          }
          nearestIntent={nearestIntent}
          /* The World pick's "Location on" badge is a claim about the phone, so
             it reads the fix rather than the fact that we asked: 'manual' is a
             pin someone dropped by hand and 'denied' never got one. */
          locationOn={geo.status === 'live'}
          parkChoice={
            showWelcomeGate
              ? null
              : askingPark && (!parkChoice?.explore || nearestIntent)
                ? parkChoice
                : null
          }
          parkOptions={parkOptions}
          setupBusy={venueStatus === 'loading'}
          setupError={venueStatus === 'error' ? venueError : null}
          onGoNearest={() => {
            markIntroSeen();
            setNearestIntent(true);
            showToast('Finding your nearest park…');
            geo.request();
            geo.enableCompass();
          }}
          onRequest={() => {
            markIntroSeen();
            setLocationSettled(true);
            geo.request();
            geo.enableCompass();
          }}
          onConfirmPark={(id) => {
            confirmPark(id).catch(() => {});
          }}
          onManual={() => {
            markIntroSeen();
            setLocationSettled(true);
            setNearestIntent(false);
            if (venueConfirmed || venuePinned) {
              setParkAsked(true);
              setGateOpen(false);
              showToast('Tap the map to drop your pin');
            }
          }}
          onDismiss={() => {
            markIntroSeen();
            setLocationSettled(true);
            setNearestIntent(false);
            if (venueConfirmed || venuePinned) {
              setParkAsked(true);
              setGateOpen(false);
              if (venue?.name) showToast(`Exploring ${venue.name}. Switch Worlds from Me → Explore Worlds.`);
            }
          }}
        />
      )}
    </main>
  );
}
