/**
 * PARKBOUND — brand foundation.
 *
 * One place for the name, the slogan, and the explorer vocabulary the UI
 * speaks. Screens import from here so a word never drifts into "Location" or
 * "Favorites" by accident.
 */

export const BRAND = {
  name: 'Parkbound',
  nameUpper: 'PARKBOUND',
  slogan: 'Explore more. Stress less.',
  promise: 'Parkbound turns a complicated park day into an adventure you can actually enjoy.',
  shortDescription:
    'An explorer’s companion for theme-park days — live party coordination, walking trails, and a drawn park map.',
};

/** Explorer vocabulary: product words → Parkbound words. */
export const WORDS = {
  location: 'You Are Here',
  navigation: 'Go',
  favorites: 'Saved',
  recommendations: 'Explore',
  group: 'Party',
  route: 'Trail',
  destination: 'Next Stop',
  history: 'Your Day',
  directions: 'Trail',
  whichMap: 'Which park',
  showOnMap: 'On the map',
  settingsTab: 'Day',
  ridesTab: 'Plan',
  exploreTab: 'Explore',
  partyTab: 'Party',
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
