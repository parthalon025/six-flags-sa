// Two palettes for PARKBOUND — Park Midnight (night) and Trail (day).
// Category pins use bright attraction colours as signals against a restrained
// base map, the way a printed park map marks rides without painting the whole
// page.

export const CATEGORY_LABELS = {
  coaster: 'Coasters',
  ride: 'Rides',
  food: 'Food',
  restroom: 'Restrooms',
  service: 'Services',
  gate: 'Gates',
  landmark: 'Landmarks',
  show: 'Shows',
  shop: 'Shops',
  campsite: 'Camping',
  parking: 'Parking',
};

/* Park Midnight category signals — adventure markers on dark ground. */
const NIGHT_CATEGORIES = {
  coaster: '#FF6B35', // Adventure
  ride: '#9B6BFF',
  food: '#FFC857', // Sun
  restroom: '#27B8B0', // Aqua
  service: '#66B56A', // Meadow
  gate: '#8A9BB0',
  landmark: '#FF5C8A',
  show: '#5B7CFF',
  shop: '#B8956A',
  campsite: '#FFC857',
  parking: '#27B8B0',
};

/* The ink a ride wears when today's height rule rules it out.
 *
 * It is deliberately not the category's own colour. The first version drew a
 * barred ride hollow in its category ink and dimmed the glyph, which put an
 * eliminated coaster in the same red as a coaster you can walk onto, an
 * eliminated flat ride in the same purple as one you can — and made the whole
 * group quieter than everything around it, when the entire point of setting a
 * height is to see at a glance what is out. So everything ruled out goes to one
 * colour, and that colour is Signal Red — louder than the map around it.
 */
const NIGHT_BARRED = '#FF6B6B';
const DAY_BARRED = '#D64545';

/* Trail / daylight — deeper so a 4 mm dot still reads against paper in sun. */
const DAY_CATEGORIES = {
  coaster: '#E85D2C',
  ride: '#8B5CF0',
  food: '#D4A017',
  restroom: '#1FA59E',
  service: '#4FA854',
  gate: '#6B7C90',
  landmark: '#E84B78',
  show: '#4A68E8',
  shop: '#9A7A55',
  campsite: '#C4922A',
  parking: '#1FA59E',
};

export const THEMES = {
  night: { categories: NIGHT_CATEGORIES, barred: NIGHT_BARRED },
  day: { categories: DAY_CATEGORIES, barred: DAY_BARRED },
};

const DAY_TONES = new Set([
  'day',
  'postcard',
  'handbill',
  'ticket-stub',
  'frost',
  'rain-day',
  'junior',
  'sticker-book',
  'water-slick',
  'chalk-lot',
  'sunrise',
  'woodblock',
  'pixel-tycoon',
  'block-park',
  'redline',
]);

export const paletteFor = (theme) => {
  if (THEMES[theme]) return THEMES[theme];
  return DAY_TONES.has(theme) ? THEMES.day : THEMES.night;
};

/* District tints.
 *
 * A hand-picked table used to live here, holding one park's themed areas — and
 * it was wrong in two ways at once. It was a fact about Kings Island sitting in
 * the renderer, which is the module that is supposed not to know which place it
 * is drawing; and it was keyed on a bare district name, which two parks can
 * share. Cedar Point's water park was called Soak City until 2017, and so is
 * Kings Island's, so one table in shared code would have painted one park's
 * district in the other's colours.
 *
 * So a venue brings its own, in `meta.lands`, and every district it has not
 * named gets a colour derived from that name: stable between sessions and
 * between phones, distinct from its neighbours, and inside the same lightness
 * band as any curated one so the map still reads as one drawing rather than a
 * bag of highlighter pens. A venue that names none — which is every venue built
 * from OpenStreetMap alone — is generated end to end and looks it on purpose. */
function hueOf(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

const GENERATED = {
  night: (hue) => ({
    fill: `hsl(${hue} 22% 16%)`,
    stroke: `hsl(${hue} 22% 24%)`,
    label: `hsl(${hue} 35% 64%)`,
  }),
  day: (hue) => ({
    fill: `hsl(${hue} 28% 91%)`,
    stroke: `hsl(${hue} 22% 82%)`,
    label: `hsl(${hue} 28% 36%)`,
  }),
};

const REFERENCE_LAND_TONES = {
  'layered-atlas': [
    ['#A6D979', '#5D914F'],
    ['#E5D84B', '#A39A2E'],
    ['#E97A72', '#A84D4D'],
    ['#55C8C1', '#2D8F8B'],
    ['#7B94E8', '#4B5EA8'],
    ['#C98CE0', '#86539B'],
    ['#F2A24D', '#AD6E32'],
  ],
  'watercolor-quest': [
    ['#D8E5CB', '#A2B89B'],
    ['#EAD6E3', '#BCA2B6'],
    ['#D8C9E9', '#A89ABB'],
    ['#D9E0E8', '#A7B4C3'],
    ['#E9DCC5', '#BDAF93'],
  ],
};

/**
 * The fill, stroke and label colour for a named district under a theme.
 *
 * @param venue the active venue's manifest row, whose `lands` may name some of
 *   its districts. Optional: without it every district is generated, which is
 *   what a venue nobody has hand-tuned looks like and is fine.
 */
export function landTint(name, theme, venue = null) {
  const referenceTones = REFERENCE_LAND_TONES[theme];
  if (referenceTones) {
    const [fill, stroke] = referenceTones[hueOf(name || 'land') % referenceTones.length];
    return {
      fill,
      stroke,
      label: theme === 'layered-atlas' ? '#243B45' : '#57485C',
    };
  }
  const named = venue?.lands?.[theme] || venue?.lands?.night || venue?.lands?.day || null;
  if (name && named && named[name] && theme !== 'pixel-tycoon') return named[name];
  if (theme === 'pixel-tycoon') {
    const h = 95 + (hueOf(name || 'land') % 28);
    return {
      fill: `hsl(${h} 54% 40%)`,
      stroke: `hsl(${h} 42% 30%)`,
      label: '#2A2418',
    };
  }
  const band = theme === 'day' || DAY_TONES.has(theme) ? 'day' : 'night';
  const make = GENERATED[band] || GENERATED.night;
  return make(hueOf(name || 'land'));
}
