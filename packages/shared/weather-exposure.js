/**
 * Per-attraction weather exposure traits — shared between the venue twin and
 * the runtime outlook. The builder bakes `wx` onto rideable POIs; the app
 * prefers that table and falls back to the same text heuristics when absent.
 */

import { isRideable, isSheltered, isInert } from './ontology.js';

const WATERPARK = /\b(soak|splash|water\s?park|wave|lagoon|cove|reef|tide|typhoon|hurricane|harbou?r|aqua|oasis|beach|bay|island|paradise|tropic|breaker)\b/i;
const WET = /\b(water|splash|flume|rapid|river|log|plunge|falls|soak|wave|pool|slide|tube|dunk|shoot)\b/i;
const TALL = /(tower|drop|seeker|sky|flyer|flight|wheel|swing|balloon|zip|chute|gyro|orbit|scream|free\s?fall|slingshot|bungee|observation)/i;
const INDOOR = /\b(indoor|dark\s?ride|simulator|4-?d|3-?d|cinema|theat(er|re)|showplace|arcade|haunted\s?house|mansion|museum|aquarium)\b/i;
const COVERED = /\b(pavilion|carousel|carrousel|merry|festhaus|hall|barn|depot|station|dodgem|bumper)\b/i;
const OPEN_AIR = /\b(amphitheat(er|re)|bandstand|stage|plaza|lawn|field|green|grove|garden)\b/i;

const SHELTER_VALUES = new Set(['indoor', 'covered', 'open']);

/** @typedef {{ shelter: 'indoor'|'covered'|'open', tall: boolean, wet: boolean, waterpark: boolean }} WeatherTraits */

const textOf = (poi) => [poi?.n, poi?.a, poi?.alias, poi?.note].filter(Boolean).join(' ');

/**
 * Infer exposure traits from a POI's published text fields — the same rules the
 * app used before E6.1 baked them into the twin.
 *
 * @param {object} poi
 * @returns {WeatherTraits | null} null when the category carries no weather traits
 */
export function inferWeatherTraits(poi) {
  const c = poi?.c;
  const text = textOf(poi);

  if (isInert(poi) || isSheltered(poi)) return null;

  if (c === 'show') {
    const shelter = OPEN_AIR.test(text) ? 'open' : INDOOR.test(text) ? 'indoor' : 'covered';
    return { shelter, tall: false, wet: false, waterpark: false };
  }

  if (!isRideable(poi)) return null;

  const waterpark = WATERPARK.test(poi?.a || '') || (WATERPARK.test(text) && WET.test(text));
  const shelter = INDOOR.test(text) ? 'indoor' : COVERED.test(text) ? 'covered' : 'open';

  return {
    shelter,
    tall: shelter === 'open' && TALL.test(text),
    wet: waterpark || WET.test(text),
    waterpark,
  };
}

/**
 * @param {unknown} wx
 * @returns {string[]}
 */
export function validateWeatherTraits(wx) {
  const errors = [];
  if (!wx || typeof wx !== 'object') return ['wx must be an object'];
  if (!SHELTER_VALUES.has(wx.shelter)) errors.push('wx.shelter must be indoor, covered, or open');
  for (const key of ['tall', 'wet', 'waterpark']) {
    if (typeof wx[key] !== 'boolean') errors.push(`wx.${key} must be a boolean`);
  }
  return errors;
}

/**
 * Exposure kind from category — not part of the baked twin field.
 *
 * @param {object} poi
 * @returns {'ride'|'show'|'sheltered'|'inert'}
 */
export function exposureKindFor(poi) {
  const c = poi?.c;
  if (isInert(poi)) return 'inert';
  if (isSheltered(poi)) return 'sheltered';
  if (c === 'show') return 'show';
  if (isRideable(poi)) return 'ride';
  return 'inert';
}

/**
 * Full exposure record: kind from category, traits from baked wx or inference.
 *
 * @param {object} poi
 * @returns {{ kind: 'ride'|'show'|'sheltered'|'inert', shelter: 'indoor'|'covered'|'open', tall: boolean, wet: boolean, waterpark: boolean }}
 */
export function exposureFor(poi) {
  const kind = exposureKindFor(poi);

  if (kind === 'inert') {
    return { kind, shelter: 'open', tall: false, wet: false, waterpark: false };
  }
  if (kind === 'sheltered') {
    return { kind, shelter: 'indoor', tall: false, wet: false, waterpark: false };
  }

  const baked = poi?.wx;
  const traits =
    baked && validateWeatherTraits(baked).length === 0 ? baked : inferWeatherTraits(poi);

  if (!traits) {
    return { kind, shelter: 'open', tall: false, wet: false, waterpark: false };
  }

  return { kind, ...traits };
}
