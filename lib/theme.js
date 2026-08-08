// Two palettes. `night` is the original high-contrast dark map. `day` is built
// for actually reading a phone outdoors in July — a printed-park-map look with
// paper-coloured ground, white midways and dark type.

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

const NIGHT_CATEGORIES = {
  coaster: '#E2503F',
  ride: '#B487E8',
  food: '#FFC24A',
  restroom: '#5AA9E6',
  service: '#4FD1A5',
  gate: '#FFFFFF',
  landmark: '#F09AC0',
  show: '#7FD4E8',
  shop: '#C9A87C',
  parking: '#8892A6',
};

// Darkened so a 4 mm dot still reads against paper in direct sun.
const DAY_CATEGORIES = {
  coaster: '#BE3226',
  ride: '#6F35AE',
  food: '#A9660A',
  restroom: '#15628F',
  service: '#0F7355',
  gate: '#2C313A',
  landmark: '#A83C6B',
  show: '#166F85',
  shop: '#7A5C2E',
  parking: '#5C646F',
};

const NIGHT_LANDS = {
  'International Street': { fill: '#3A3426', stroke: '#4E452F', label: '#C9B98A' },
  'Coney Mall': { fill: '#3B2A22', stroke: '#523528', label: '#D7A183' },
  Rivertown: { fill: '#233024', stroke: '#2F412F', label: '#8FBF95' },
  'Action Zone': { fill: '#1F2C38', stroke: '#2B3D4D', label: '#8FB6D4' },
  'Area 72': { fill: '#2B2440', stroke: '#3A3057', label: '#B49BE0' },
  'Planet Snoopy': { fill: '#3A3520', stroke: '#4E472A', label: '#DBCF7E' },
  'Camp Snoopy': { fill: '#2C331F', stroke: '#3B4429', label: '#B4C77E' },
  'Adventure Port': { fill: '#1E3230', stroke: '#294541', label: '#7FCFC4' },
  'Soak City': { fill: '#1B303B', stroke: '#254250', label: '#79C4DE' },
  'Front Gate': { fill: '#2A2E38', stroke: '#383E4C', label: '#A9B2C4' },
};

const DAY_LANDS = {
  'International Street': { fill: '#EBD9A8', stroke: '#CDB779', label: '#6E5A1E' },
  'Coney Mall': { fill: '#F4CBA9', stroke: '#D5A377', label: '#8A4718' },
  Rivertown: { fill: '#C9E2B6', stroke: '#A0C489', label: '#376029' },
  'Action Zone': { fill: '#BFDCEE', stroke: '#93BCD8', label: '#1D5178' },
  'Area 72': { fill: '#D8CCF0', stroke: '#B4A2DC', label: '#4A2E86' },
  'Planet Snoopy': { fill: '#F7E79A', stroke: '#DEC96A', label: '#75651A' },
  'Camp Snoopy': { fill: '#DDEBA9', stroke: '#BCCF7C', label: '#516323' },
  'Adventure Port': { fill: '#B9E4D8', stroke: '#8CC9B9', label: '#1C6054' },
  'Soak City': { fill: '#B8DFF0', stroke: '#8AC1D8', label: '#125475' },
  'Front Gate': { fill: '#E0E2E6', stroke: '#C2C6CD', label: '#4A515C' },
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
    fill: `hsl(${hue} 22% 17%)`,
    stroke: `hsl(${hue} 24% 25%)`,
    label: `hsl(${hue} 38% 68%)`,
  }),
  day: (hue) => ({
    fill: `hsl(${hue} 48% 85%)`,
    stroke: `hsl(${hue} 36% 71%)`,
    label: `hsl(${hue} 55% 29%)`,
  }),
};

/** The fill, stroke and label colour for a named district under a theme. */
export function landTint(name, theme) {
  const palette = paletteFor(theme);
  if (name && palette.lands[name]) return palette.lands[name];
  const make = GENERATED[theme] || GENERATED.night;
  return make(hueOf(name || 'land'));
}
