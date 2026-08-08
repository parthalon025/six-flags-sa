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
  parking: '#0A84FF',
};

// The light-appearance pair. Darker, so a 4 mm dot still reads against paper
// in direct sun.
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
  parking: '#007AFF',
};

/* Apple Maps barely tints a neighbourhood — a district reads as a district
   because of its label and a hint of colour under the paths, not because the
   ground has been painted. These sit in one narrow lightness band per theme so
   ten of them side by side still look like one map. */
const NIGHT_LANDS = {
  'International Street': { fill: '#2A271D', stroke: '#3C382A', label: '#BBAD81' },
  'Coney Mall': { fill: '#2A231D', stroke: '#3C312A', label: '#BB9981' },
  Rivertown: { fill: '#1D2A1D', stroke: '#2A3C2A', label: '#81BB81' },
  'Action Zone': { fill: '#1D252A', stroke: '#2A353C', label: '#81A3BB' },
  'Area 72': { fill: '#231D2A', stroke: '#312A3C', label: '#9981BB' },
  'Planet Snoopy': { fill: '#2A281D', stroke: '#3C3A2A', label: '#BBB381' },
  'Camp Snoopy': { fill: '#252A1D', stroke: '#353C2A', label: '#A3BB81' },
  'Adventure Port': { fill: '#1D2A28', stroke: '#2A3C3A', label: '#81BBB3' },
  'Soak City': { fill: '#1D272A', stroke: '#2A383C', label: '#81ADBB' },
  'Front Gate': { fill: '#1D222A', stroke: '#2A303C', label: '#8194BB' },
};

const DAY_LANDS = {
  'International Street': { fill: '#F1EEE4', stroke: '#E0DBCC', label: '#7E6F44' },
  'Coney Mall': { fill: '#F1EAE4', stroke: '#E0D5CC', label: '#7E5C44' },
  Rivertown: { fill: '#E4F1E4', stroke: '#CCE0CC', label: '#447E44' },
  'Action Zone': { fill: '#E4ECF1', stroke: '#CCD8E0', label: '#44667E' },
  'Area 72': { fill: '#EAE4F1', stroke: '#D5CCE0', label: '#5C447E' },
  'Planet Snoopy': { fill: '#F1EFE4', stroke: '#E0DECC', label: '#7E7644' },
  'Camp Snoopy': { fill: '#ECF1E4', stroke: '#D8E0CC', label: '#667E44' },
  'Adventure Port': { fill: '#E4F1EF', stroke: '#CCE0DE', label: '#447E76' },
  'Soak City': { fill: '#E4EEF1', stroke: '#CCDBE0', label: '#446F7E' },
  'Front Gate': { fill: '#E4E9F1', stroke: '#CCD3E0', label: '#44577E' },
};

export const THEMES = {
  night: { lands: NIGHT_LANDS, categories: NIGHT_CATEGORIES },
  day: { lands: DAY_LANDS, categories: DAY_CATEGORIES },
};

export const paletteFor = (theme) => THEMES[theme] || THEMES.night;

/* The land tints above are hand-picked for one park's themed areas, which is no
   use at a venue nobody has hand-picked anything for. Any district the palette
   has never heard of gets a colour derived from its own name instead: stable
   between sessions and between phones, distinct from its neighbours, and inside
   the same lightness band as the curated ones so the map still reads as one
   drawing rather than a bag of highlighter pens. */
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

/** The fill, stroke and label colour for a named district under a theme. */
export function landTint(name, theme) {
  const palette = paletteFor(theme);
  if (name && palette.lands[name]) return palette.lands[name];
  const make = GENERATED[theme] || GENERATED.night;
  return make(hueOf(name || 'land'));
}
