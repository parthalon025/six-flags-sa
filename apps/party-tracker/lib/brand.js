/**
 * PARKBOUND — brand foundation.
 *
 * One place for the name, the slogan, and the explorer vocabulary the UI
 * speaks. Screens import from here so a word never drifts into "Location" or
 * "Favorites" by accident.
 *
 * Visual assets (see components/BrandMark.jsx, BrandLockup.jsx, public/icon.svg):
 *
 * 1. Primary logo lockup (BrandLockup) — Waypoint + PARKBOUND + tagline.
 *    Use: main/desktop header, splash/welcome screen, marketing collateral.
 *
 * 2. App icon glyph (BrandMark variant="glyph", public/icon*.png) — simplified
 *    Waypoint on a Trail tile. Use: home screen, store listing, notifications.
 *    Never put the wordmark on the icon.
 *
 * 3. Active map context (BrandMark glyph + dotted trail + Sky map) — live map
 *    destination / Rally Point, onboarding trail language, Your Day path.
 */

export const BRAND = {
  name: 'Parkbound',
  nameUpper: 'PARKBOUND',
  slogan: 'Explore more. Stress less.',
  promise: 'Explore a living map built by the community. Parkbound is your guide through every World.',
  shortDescription:
    'Choose a World, discover Places, and Rally your Party on a living map built for the day you are having.',
  /*
   * Three pitches, not one, because three screens ask three different
   * questions. shortDescription is what the app is — it is also the OG and
   * metadata description in app/layout.js, so it stays put. introPitch is the
   * hero line under the wordmark on first open, where the reader has not
   * agreed to anything yet and one image does more than a feature list.
   * gatePitch is what the location gate promises in exchange for GPS, which is
   * a narrower question and gets a narrower answer.
   */
  introPitch: 'A living map, drawn by the guests who walked it.',
  gatePitch: 'Plan your trip, explore the World around you, and keep your Party together.',
  /** Public production host — invites, OG, and metadataBase use this. */
  canonicalHost: 'parkbound.kurat0r.ai',
  canonicalUrl: 'https://parkbound.kurat0r.ai',
};

/**
 * The three things the intro claims, in the order it claims them.
 *
 * Data, not markup, because the intro is a scroll story: the numbering, the
 * progress dashes in its footer and the "read enough" threshold all count the
 * same list, and a fourth claim should be one entry here rather than four
 * edits across a component.
 */
export const INTRO_CLAIMS = [
  {
    num: '01',
    title: 'Know where everyone is',
    copy: 'Explore together. Help other guests, unlock more.',
  },
  {
    num: '02',
    title: 'Only see what they can ride',
    copy: 'Set a height once. The park filters itself.',
  },
  {
    num: '03',
    title: 'The day you look back on',
    copy: 'Your trail, your finds, your Title.',
  },
];

/** Where each brand visual belongs — keep call sites honest. */
export const BRAND_ASSETS = {
  lockup: {
    component: 'BrandLockup',
    use: ['header', 'splash', 'marketing'],
  },
  appIcon: {
    files: ['/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'],
    use: ['homeScreen', 'appStore', 'notifications'],
  },
  mapWaypoint: {
    component: 'BrandMark',
    variant: 'glyph',
    use: ['liveMap', 'onboarding', 'daySummary'],
  },
};

/** Explorer vocabulary: product words → Parkbound words. */
export const WORDS = {
  location: 'You Are Here',
  navigation: 'Walk me there',
  favorites: 'Saved',
  recommendations: 'Explore',
  world: 'World',
  worlds: 'Explore Worlds',
  zone: 'Zone',
  place: 'Place',
  group: 'Party',
  route: 'Trail',
  destination: 'Next Stop',
  history: 'Settings',
  directions: 'Trail',
  whichMap: 'Explore Worlds',
  showOnMap: 'On the map',
  settingsTab: 'Me',
  ridesTab: 'Plan',
  exploreTab: 'Explore',
  partyTab: 'Party',
  meetup: 'Rally the Party',
  addToPlan: 'Add to Plan',
};

/**
 * Glyphs the chrome shares, so a button never invents its own icon. Rally
 * is the map pin already on the FAB; Plan is the coaster already on the tab.
 */
export const GLYPHS = {
  meetup: 'mappin.and.ellipse',
  plan: 'figure.rollercoaster',
  walk: 'location.fill',
};

/** Live state labels — bold, short, never buried in gray body copy. */
export const LIVE = {
  open: 'OPEN',
  busy: 'BUSY',
  goNow: 'GO NOW',
  paused: 'PAUSED',
  weather: 'WEATHER',
  later: 'LATER',
  meetup: 'RALLY',
};

/** Party expedition states. */
export const PARTY_STATE = {
  together: { label: 'Together', tone: 'ok' },
  onTheWay: { label: 'On the way', tone: 'warn' },
  separated: { label: 'Separated', tone: 'warn' },
  meetHere: { label: 'Rally here', tone: 'info' },
};

/** Core palette — mirrored as CSS custom properties in globals.css. */
export const COLORS = {
  parkMidnight: '#10233F',
  trail: '#F7F4EC',
  sky: '#E8F5F7',
  adventure: '#FF6B35',
  aqua: '#27B8B0',
  sun: '#FFC857',
  meadow: '#66B56A',
  signal: '#E55353',
};
