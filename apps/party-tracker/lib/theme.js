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

/* Zone tints.
 *
 * A hand-picked table used to live here, holding one park's themed areas, and
 * a second table held per-Skin district washes for the reference Skins. Both
 * were wrong the same way: they were treatment — a Skin's job — decided in the
 * renderer, which is the module that is supposed not to know which place it is
 * drawing or which Skin is worn. A third copy lived in `map.meta.lands`, so a
 * park's tints were facts in map truth, which the Visual factory then had to
 * obey; every Skin ended up emitting the same tones and no Skin could restyle
 * a Zone.
 *
 * The Visual factory owns it now. It compiles one `<skin>.visual.json` per
 * World × Skin, re-expressing that World's relationships — its land cover and
 * its grounding harvest — inside that Skin's own declared palette, and
 * certifies that every colour in it is one that palette can make. The phone
 * reads the answer (`lib/zoneTones.js`) and paints it.
 *
 * A Zone the factory says nothing about — every Zone of a World nobody has
 * harvested, and every World whose pack is not published — gets a colour
 * derived from its own name: stable between sessions and between phones,
 * distinct from its neighbours, and inside the same lightness band as any
 * derived one so the map still reads as one drawing rather than a bag of
 * highlighter pens. */
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

/**
 * The fill, stroke and label colour for a named Zone under a theme.
 *
 * @param {string} name the Zone's name in truth geometry
 * @param {string} theme the worn Skin or Palette id
 * @param {object|null} zoneTones the active World × Skin tone table from that
 *   World's display pack (`lib/zoneTones.js`). Optional: without it every Zone
 *   is generated, which is what an unharvested World looks like and is fine.
 */
export function landTint(name, theme, zoneTones = null) {
  const derived = name ? zoneTones?.[name] : null;
  if (derived?.fill) return derived;
  /* pixel-tycoon has no skins.json row yet, so the factory compiles no spec
     for it and there is nothing to read — its hue stays here until its design
     request is expanded into the three ledger artifacts ADR-0017 clause 2
     requires. It is the last Skin whose treatment lives in app code. */
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
