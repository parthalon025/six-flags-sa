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
 *    destination / meet-up pin, onboarding trail language, Your Day path.
 */

export const BRAND = {
  name: 'Parkbound',
  nameUpper: 'PARKBOUND',
  slogan: 'Explore more. Stress less.',
  promise: 'Parkbound turns a complicated park day into an adventure you can actually enjoy.',
  shortDescription:
    'Find toilets, food and rides on a drawn park map — walk there on guest paths. Start a party when the family wants to stick together.',
  /** Public production host — invites, OG, and metadataBase use this. */
  canonicalHost: 'parkbound.kurat0r.ai',
  canonicalUrl: 'https://parkbound.kurat0r.ai',
};

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
  group: 'Party',
  route: 'Trail',
  destination: 'Next Stop',
  history: 'Settings',
  directions: 'Trail',
  whichMap: 'Which park',
  showOnMap: 'On the map',
  settingsTab: 'Me',
  ridesTab: 'Plan',
  exploreTab: 'Explore',
  partyTab: 'Party',
  meetup: 'Set meet-up',
  addToPlan: 'Add to Plan',
};

/**
 * Glyphs the chrome shares, so a button never invents its own icon. Meet-up
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
  meetup: 'MEET UP',
};

/** Party expedition states. */
export const PARTY_STATE = {
  together: { label: 'Together', tone: 'ok' },
  onTheWay: { label: 'On the way', tone: 'warn' },
  separated: { label: 'Separated', tone: 'warn' },
  meetHere: { label: 'Meet here', tone: 'info' },
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
