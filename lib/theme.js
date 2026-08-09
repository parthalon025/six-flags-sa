// Two palettes, matched to the two iOS appearances. `day` is Apple Maps in
// daylight — near-white land, white footpaths, pale blue water — and `night`
// is the dark map. Category pins use the iOS system colours, so a dot on this
// map means roughly what the same colour means in Maps.

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

// iOS dark-appearance system colours.
const NIGHT_CATEGORIES = {
  coaster: '#FF453A',
  ride: '#BF5AF2',
  food: '#FF9F0A',
  restroom: '#40C8E0',
  service: '#30D158',
  gate: '#98989D',
  landmark: '#FF375F',
  show: '#5E5CE6',
  shop: '#AC8E68',
  // Yellow, and the last free one in the system palette: green is services,
  // orange is food, brown is shops. A campsite chip has to survive being read
  // at night beside all three.
  campsite: '#FFD60A',
  parking: '#0A84FF',
};

// The light-appearance pair. Darker, so a 4 mm dot still reads against paper
// in direct sun.
/* The ink a ride wears when today's height rule rules it out.
 *
 * It is deliberately not the category's own colour. The first version drew a
 * barred ride hollow in its category ink and dimmed the glyph, which put an
 * eliminated coaster in the same red as a coaster you can walk onto, an
 * eliminated flat ride in the same purple as one you can — and made the whole
 * group quieter than everything around it, when the entire point of setting a
 * height is to see at a glance what is out. So everything ruled out goes to one
 * colour, and that colour is a rung brighter than the coaster red at night and a
 * rung deeper than it in daylight, which is what "louder" means in each.
 */
const NIGHT_BARRED = '#FF5E54';
const DAY_BARRED = '#D70015';

const DAY_CATEGORIES = {
  coaster: '#FF3B30',
  ride: '#AF52DE',
  food: '#FF9500',
  restroom: '#30B0C7',
  service: '#34C759',
  gate: '#8E8E93',
  landmark: '#FF2D55',
  show: '#5856D6',
  shop: '#A2845E',
  campsite: '#FFCC00',
  parking: '#007AFF',
};

export const THEMES = {
  night: { categories: NIGHT_CATEGORIES, barred: NIGHT_BARRED },
  day: { categories: DAY_CATEGORIES, barred: DAY_BARRED },
};

export const paletteFor = (theme) => THEMES[theme] || THEMES.night;

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
    fill: `hsl(${hue} 18% 14%)`,
    stroke: `hsl(${hue} 18% 20%)`,
    label: `hsl(${hue} 30% 62%)`,
  }),
  day: (hue) => ({
    fill: `hsl(${hue} 30% 92%)`,
    stroke: `hsl(${hue} 25% 84%)`,
    label: `hsl(${hue} 30% 38%)`,
  }),
};

/**
 * The fill, stroke and label colour for a named district under a theme.
 *
 * @param venue the active venue's manifest row, whose `lands` may name some of
 *   its districts. Optional: without it every district is generated, which is
 *   what a venue nobody has hand-tuned looks like and is fine.
 */
export function landTint(name, theme, venue = null) {
  const named = venue?.lands?.[theme] || venue?.lands?.night || null;
  if (name && named && named[name]) return named[name];
  const make = GENERATED[theme] || GENERATED.night;
  return make(hueOf(name || 'land'));
}
