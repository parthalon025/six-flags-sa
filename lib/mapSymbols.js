/* The map's symbol vocabulary.
 *
 * Every marker carries three redundant channels — shape, colour and glyph —
 * so a place stays identifiable when any one of them fails: colour fails for
 * the ~8% of men with a red-green deficiency (the night palette's coaster red,
 * landmark pink and ride purple collapse into one another under deuteranopia),
 * glyphs fail at the smallest sizes, and shape alone cannot separate ten
 * categories. Together they hold up.
 *
 * Glyphs are authored in a 24×24 box and painted through <symbol>/<use>, so
 * one definition serves both the map and the legend.
 */

/* `fill` paths are silhouettes; `stroke` paths are line art and are drawn with
   the width given here, in the same 24×24 units. */
export const GLYPHS = {
  coaster: [
    { d: 'M3.6 18.4C6.4 18.4 6.6 8.2 12 8.2S17.6 18.4 20.4 18.4', mode: 'stroke', w: 2.9 },
    { d: 'M8.7 2.4h6.6a1.4 1.4 0 0 1 1.4 1.4v2.4H7.3V3.8a1.4 1.4 0 0 1 1.4-1.4Z', mode: 'fill' },
  ],
  ride: [
    { d: 'M12 1.4 21.6 8.6H2.4Z', mode: 'fill' },
    { d: 'M12 8.6V21M5 21h14', mode: 'stroke', w: 2.2 },
    { d: 'M6.4 10.8h3v4.6h-3ZM14.6 10.8h3v4.6h-3Z', mode: 'fill' },
  ],
  food: [
    { d: 'M7 2.6v5.6a2.6 2.6 0 0 0 5.2 0V2.6M9.6 8.2V21.4M17.6 2.6c-2.2 2-2.2 7.4 0 9.2v9.6', mode: 'stroke', w: 2.3 },
  ],
  restroom: [
    { d: 'M7.4 1.6a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6ZM4.9 7.2h5a1.5 1.5 0 0 1 1.5 1.5v5.6H9.6v8.1H5.2v-8.1H3.4V8.7a1.5 1.5 0 0 1 1.5-1.5Z', mode: 'fill' },
    { d: 'M16.6 1.6a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6ZM14.1 7.2h5l2.4 7.4h-2.2l-.7-2.2v10h-2v-5.9h-1v5.9h-2v-10l-.7 2.2h-2.2Z', mode: 'fill' },
  ],
  service: [
    { d: 'M9.4 2.2h5.2v5.6h5.6v5.2h-5.6v5.6H9.4v-5.6H3.8V7.8h5.6Z', mode: 'fill' },
  ],
  shop: [
    { d: 'M3.4 7.4h17.2l1.1 12.9a1.5 1.5 0 0 1-1.5 1.7H3.8a1.5 1.5 0 0 1-1.5-1.7Z', mode: 'fill' },
    { d: 'M8.6 8.2V5.8a3.4 3.4 0 0 1 6.8 0v2.4', mode: 'stroke', w: 2.2 },
  ],
  /* One mask rather than two: at 11px a second face is mud. */
  show: [
    { d: 'M3.4 3.6h17.2v7c0 5.6-3.9 9.8-8.6 9.8S3.4 16.2 3.4 10.6ZM8.6 9.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2ZM15.4 9.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z', mode: 'fill', rule: 'evenodd' },
    { d: 'M8.8 15.6c1.8 1.6 4.6 1.6 6.4 0', mode: 'stroke', w: 1.9 },
  ],
  /* The park's own landmark is a scale Eiffel Tower, so the glyph is literal. */
  landmark: [
    { d: 'M12 1.4 15.6 21.8h-2.4L12 12.8l-1.2 9H8.4Z', mode: 'fill' },
    { d: 'M9.9 12.4h4.2M9.2 16.6h5.6', mode: 'stroke', w: 1.9 },
  ],
  gate: [
    { d: 'M3.8 20.6V11a8.2 8.2 0 0 1 16.4 0v9.6', mode: 'stroke', w: 2.6 },
    { d: 'M1.8 19.8h20.4v2.8H1.8Z', mode: 'fill' },
  ],
  parking: [
    { d: 'M7.2 2.4h6.5a6 6 0 0 1 0 12h-3v7.2H7.2ZM10.7 5.9v5h3a2.5 2.5 0 0 0 0-5Z', mode: 'fill', rule: 'evenodd' },
  ],
  /* Not categories — the two line features that otherwise read as mystery
     spaghetti, given a legend entry each. */
  track: [{ d: 'M1.5 18.5C4.5 18.5 5 5 12 5s7.5 13.5 10.5 13.5', mode: 'stroke', w: 3 }],
  water: [{ d: 'M1.5 8.5c3.5-4 7-4 10.5 0s7 4 10.5 0M1.5 16.5c3.5-4 7-4 10.5 0s7 4 10.5 0', mode: 'stroke', w: 2.4 }],
};

/* shape: the silhouette the glyph sits in.
 *   disc    — a solid colour circle, white glyph. The things you came for.
 *   chip    — a light rounded square, coloured glyph. The things you need.
 *   diamond — landmarks, so they read as "a place", not "a ride".
 *   pin     — gates, the only markers that mean "in or out".
 * rank drives size, label thresholds and who loses a collision: 1 wins. */
export const SYMBOLS = {
  coaster: { shape: 'disc', rank: 1, r: 9, hint: 'Roller coasters' },
  ride: { shape: 'disc', rank: 2, r: 7.6, hint: 'Flat and family rides' },
  landmark: { shape: 'diamond', rank: 2, r: 7.4, hint: 'Fountains, towers, stations' },
  gate: { shape: 'pin', rank: 2, r: 7.8, hint: 'Park entrances and ticketing' },
  food: { shape: 'chip', rank: 3, r: 7, hint: 'Places to eat' },
  restroom: { shape: 'chip', rank: 3, r: 7, hint: 'Restrooms' },
  show: { shape: 'chip', rank: 3, r: 7, hint: 'Theatres and stages' },
  service: { shape: 'chip', rank: 4, r: 6.6, hint: 'First aid and lockers' },
  shop: { shape: 'chip', rank: 4, r: 6.6, hint: 'Shops' },
  parking: { shape: 'chip', rank: 5, r: 6.6, hint: 'Lots and drop-off' },
};

export const DEFAULT_SYMBOL = { shape: 'chip', rank: 5, r: 6.6, hint: '' };
export const symbolFor = (category) => SYMBOLS[category] || DEFAULT_SYMBOL;

/* Zoom at which a rank earns a name on the map. Markers themselves are never
   hidden by zoom — a category you switched on is a category you get — the
   decluttering pass does the thinning instead, so nothing vanishes for a
   reason the map cannot show you. */
const LABEL_ZOOM = { 1: 0.5, 2: 0.95, 3: 1.5, 4: 2.2, 5: 2.2 };
export const labelZoomFor = (rank) => LABEL_ZOOM[rank] ?? 2.3;

/* Markers grow with the map, but far more slowly than the map does: a symbol
   that scaled 1:1 would be a postage stamp at the park-wide view and cover a
   whole midway at walking zoom. */
export const sizeAtZoom = (base, z) => base * Math.min(1.25, Math.max(0.74, 0.72 + 0.15 * z));

/* Ride names on the map data and ride names in the catalogue are not written
   the same way — "Racer (Red)" is two ways of saying "The Racer", and Queen
   City Stunt Coaster still runs on track labelled Backlot. */
export function normaliseRideName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the\s+/, '');
}

/* Which ink shows up on a given marker fill. Worked out rather than declared,
   because the night palette paints gates pure white and a white glyph on a
   white disc is an empty disc. */
const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function inkOn(colour) {
  const hex = String(colour || '').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) || /^#?([0-9a-f]{3})$/i.exec(hex);
  if (!m) return '#ffffff';
  const raw = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(raw, 16);
  const lum =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * (n & 255 ? channel(n & 255) : 0);
  return lum > 0.5 ? '#0c1017' : '#ffffff';
}

/* How a party member's marker should read, given their last fix.
 *
 * Kept out of the renderer because it is the one place two meanings used to
 * collide: staleness was drawn by fading the marker, which is also how a ride
 * nobody in the party is tall enough for is drawn. Age now gets its own ink —
 * a broken ring and a clock — and a heading is only drawn while the fix behind
 * it is worth trusting.
 */
export const STALE_AFTER_MS = 300000;

export function partyMarkerState(member, now) {
  const ts = member?.ts;
  const age = Number.isFinite(ts) ? now - ts : Infinity;
  const stale = age > STALE_AFTER_MS;
  return {
    age,
    stale,
    help: member?.status === 'NEED HELP',
    facing: !stale && Number.isFinite(member?.heading) ? member.heading : null,
  };
}
