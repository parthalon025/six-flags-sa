/**
 * What the sky is doing, and which attractions care about it.
 *
 * Pure and park-agnostic on purpose. Nothing in this file knows the name of a
 * single ride: a park is just a list of POIs with a category, an area and maybe
 * a note, and every judgement below is derived from those three fields. Drop a
 * different park's rides.json in and the same rules apply, which is the whole
 * reason it reads traits out of text instead of carrying a table.
 *
 * The output is deliberately hedged. This module never claims a ride *is*
 * closed — only that a park operating normally would probably have stopped it.
 * The park's own app and the ride's own gate are the truth; a forecast is a
 * head start on the walk you were about to waste.
 */

/* ------------------------------------------------------------- traits ---- */

/*
 * Vocabulary, not names. Every parks-industry marketing department reaches for
 * the same nouns, so matching on them generalises far better than a per-park
 * list would — and when it misses, it misses toward "outdoor", which is the
 * safe default because it produces a warning rather than a false all-clear.
 */

/** Areas and attractions that are the water park, and shut as one unit. */
const WATERPARK = /\b(soak|splash|water\s?park|wave|lagoon|cove|reef|tide|typhoon|hurricane|harbou?r|aqua|oasis|beach|bay|island|paradise|tropic|breaker)\b/i;

/**
 * Anything that reliably gets you wet, water park or not.
 *
 * Whole-word, unlike TALL, and that is load-bearing: a POI's area is part of
 * the text being searched, and a substring `river` would mark every coaster in
 * a land called Rivertown as a water ride — which then reads rain as "already
 * a wet ride, carry on" for a wooden coaster that has just stopped loading.
 */
const WET = /\b(water|splash|flume|rapid|river|log|plunge|falls|soak|wave|pool|slide|tube|dunk|shoot)\b/i;

/**
 * Rides that stand up in the wind and stop when it blows.
 *
 * The only pattern here matched as a substring rather than on word boundaries,
 * because this is the trait the industry writes as one word: WindSeeker,
 * Skyflyer, SkyScreamer, Dropzone. `\bseeker\b` sees none of them, and missing
 * the tall rides is the one miss that matters — they are what a gale takes
 * first. Safe because a POI reaches this line only if it is a ride, so the
 * "Skyline Chili" and "Drop Off Lot" collisions have already returned above.
 *
 * Short ambiguous stems are deliberately absent: `para` would claim Paradise
 * Plunge (a water slide) and `star` would claim anything Starlight.
 */
const TALL = /(tower|drop|seeker|sky|flyer|flight|wheel|swing|balloon|zip|chute|gyro|orbit|scream|free\s?fall|slingshot|bungee|observation)/i;

/** Genuinely enclosed — a roof over the whole experience, not just the queue. */
const INDOOR = /\b(indoor|dark\s?ride|simulator|4-?d|3-?d|cinema|theat(er|re)|showplace|arcade|haunted\s?house|mansion|museum|aquarium)\b/i;

/** Roofed but open-sided: fine in rain, not in lightning. */
const COVERED = /\b(pavilion|carousel|carrousel|merry|festhaus|hall|barn|depot|station|dodgem|bumper)\b/i;

/** Seating under the sky. An amphitheatre empties the moment it thunders. */
const OPEN_AIR = /\b(amphitheat(er|re)|bandstand|stage|plaza|lawn|field|green|grove|garden)\b/i;

/** Categories that are a building by definition and never carry ride status. */
import { isRideable, isSheltered, isInert } from './ontology.js';

/** Everything a POI record can say about itself, as one searchable string. */
const textOf = (poi) =>
  [poi?.n, poi?.a, poi?.alias, poi?.note].filter(Boolean).join(' ');

/**
 * Classify one POI's exposure to weather.
 *
 * @returns {{
 *   kind: 'ride'|'show'|'sheltered'|'inert',
 *   shelter: 'indoor'|'covered'|'open',
 *   tall: boolean,     // wind stops it
 *   wet: boolean,      // you get soaked, so cold stops it
 *   waterpark: boolean // part of the water park, which closes as one
 * }}
 */
export function exposureFor(poi) {
  const c = poi?.c;
  const text = textOf(poi);

  if (isInert(poi)) {
    return { kind: 'inert', shelter: 'open', tall: false, wet: false, waterpark: false };
  }

  if (isSheltered(poi)) {
    // A food stand with a serving window is not a building, but from the
    // visitor's point of view it is still there in the rain, which is the only
    // question this answers.
    return { kind: 'sheltered', shelter: 'indoor', tall: false, wet: false, waterpark: false };
  }

  if (c === 'show') {
    const shelter = OPEN_AIR.test(text) ? 'open' : INDOOR.test(text) ? 'indoor' : 'covered';
    return { kind: 'show', shelter, tall: false, wet: false, waterpark: false };
  }

  if (!isRideable(poi)) {
    return { kind: 'inert', shelter: 'open', tall: false, wet: false, waterpark: false };
  }

  const waterpark = WATERPARK.test(poi?.a || '') || (WATERPARK.test(text) && WET.test(text));
  const shelter = INDOOR.test(text) ? 'indoor' : COVERED.test(text) ? 'covered' : 'open';

  return {
    kind: 'ride',
    shelter,
    // An enclosed ride cannot be wind-exposed however its name reads.
    tall: shelter === 'open' && TALL.test(text),
    wet: waterpark || WET.test(text),
    waterpark,
  };
}

/* ------------------------------------------------------------ weather ---- */

/**
 * WMO codes, which is what every free forecast API speaks. Grouped rather than
 * enumerated: the difference between "moderate" and "heavy" drizzle changes
 * nothing a park does.
 */
const THUNDER = new Set([95, 96, 99]);
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const FREEZING = new Set([56, 57, 66, 67]);
const RAIN = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82]);

/** Severity ladder. Everything downstream compares on `rank`. */
export const CONDITIONS = {
  clear: { key: 'clear', rank: 0, label: 'Clear' },
  heat: { key: 'heat', rank: 1, label: 'Extreme heat' },
  cold: { key: 'cold', rank: 1, label: 'Too cold for water' },
  rain: { key: 'rain', rank: 2, label: 'Rain' },
  wind: { key: 'wind', rank: 3, label: 'High wind' },
  storm: { key: 'storm', rank: 4, label: 'Thunderstorm' },
};

/**
 * Gusts at which a park stops the tall stuff. Operators publish their own
 * limits per ride and they vary, but the mid-30s (mph) is where the towers,
 * wheels and skyflyers reliably go down, and the mid-40s takes the rest.
 */
export const WIND_HOLD_MPH = 35;
export const WIND_HARD_MPH = 45;

/** Below this the water park is either shut or empty. Degrees Fahrenheit. */
export const COLD_WATER_F = 68;
/** Heat advisory territory — nothing closes, but the day changes shape. */
export const HEAT_F = 100;

/**
 * Reduce a raw observation to the handful of facts that change a decision.
 *
 * Every field is optional: a partial reading still classifies on what it has,
 * because a forecast that half-arrived is worth more than none. Missing
 * everything reads as `clear`, which shows no banner rather than a false alarm.
 *
 * @param obs {{ code, gustMph, windMph, tempF, precipIn, precipChance, lightning }}
 */
export function classifyWeather(obs) {
  if (!obs || typeof obs !== 'object') return { ...CONDITIONS.clear, reasons: [], obs: null };

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const code = num(obs.code);
  const gust = num(obs.gustMph) ?? num(obs.windMph);
  const temp = num(obs.tempF);
  const precip = num(obs.precipIn);
  const chance = num(obs.precipChance);
  const reasons = [];

  // Lightning is the only condition that empties a park outright, so it wins
  // over everything below it regardless of how mild the rest of the reading is.
  const storming =
    (code != null && THUNDER.has(code)) ||
    obs.lightning === true ||
    (num(obs.cape) != null && num(obs.cape) >= 2500 && (chance ?? 0) >= 50);

  if (storming) reasons.push('Lightning in the area');

  const windy = gust != null && gust >= WIND_HOLD_MPH;
  if (windy) reasons.push(`Gusts to ${Math.round(gust)} mph`);

  const wetNow =
    (code != null && (RAIN.has(code) || SNOW.has(code) || FREEZING.has(code))) ||
    (precip != null && precip >= 0.02);
  if (wetNow) reasons.push(code != null && SNOW.has(code) ? 'Snow falling' : 'Rain falling');
  else if (chance != null && chance >= 60) reasons.push(`${Math.round(chance)}% chance of rain`);

  const cold = temp != null && temp < COLD_WATER_F;
  if (cold) reasons.push(`${Math.round(temp)}°F — cold for the water park`);
  const hot = temp != null && temp >= HEAT_F;
  if (hot) reasons.push(`${Math.round(temp)}°F — heat advisory territory`);

  const condition = storming
    ? CONDITIONS.storm
    : windy
      ? CONDITIONS.wind
      : wetNow || (chance != null && chance >= 60)
        ? CONDITIONS.rain
        : cold
          ? CONDITIONS.cold
          : hot
            ? CONDITIONS.heat
            : CONDITIONS.clear;

  return {
    ...condition,
    reasons,
    // Kept alongside the verdict so the outlook rules can ask follow-up
    // questions the ladder flattened away — a storm is also cold and windy.
    // isDay comes through for Parkbound GO NOW / LATER recommendations.
    obs: {
      code,
      gust,
      temp,
      precip,
      chance,
      storming,
      windy,
      wetNow,
      cold,
      hot,
      isDay: obs.isDay !== false && obs.isDay !== 0,
    },
  };
}

/* ------------------------------------------------------------ outlook ---- */

/**
 * How likely this attraction is to be running, given the sky.
 *
 * `open` and `closed` are never returned — those are claims of fact and this
 * module has none. The four values are degrees of expectation, and the UI is
 * expected to word them as expectations.
 */
export const OUTLOOK = {
  running: { key: 'running', rank: 0, label: 'Should be running' },
  watch: { key: 'watch', rank: 1, label: 'Watch the sky' },
  hold: { key: 'hold', rank: 2, label: 'Likely on hold' },
  closed: { key: 'closed', rank: 3, label: 'Likely closed' },
};

/**
 * @param poi     a POI record
 * @param weather the result of classifyWeather
 * @returns {{ key, rank, label, why: string|null }}
 */
export function outlookFor(poi, weather) {
  const e = exposureFor(poi);
  const w = weather?.obs;
  const verdict = (o, why = null) => ({ ...o, why });

  // Geography has no opening hours, and neither does the forecast for it.
  if (e.kind === 'inert' || !w) return verdict(OUTLOOK.running);

  if (w.storming) {
    // A lightning hold clears every outdoor queue and empties the pools first —
    // standing water is the one place a park will not let you wait it out.
    if (e.waterpark) return verdict(OUTLOOK.closed, 'Pools clear first in a lightning hold');
    if (e.shelter === 'indoor') {
      return verdict(
        e.kind === 'ride' ? OUTLOOK.watch : OUTLOOK.running,
        'Indoors — usually keeps going, and it is where everyone heads',
      );
    }
    if (e.shelter === 'covered') return verdict(OUTLOOK.hold, 'Roofed but open-sided');
    return verdict(OUTLOOK.closed, 'Outdoor rides stop for lightning');
  }

  if (e.kind === 'sheltered') return verdict(OUTLOOK.running);

  if (w.windy) {
    const hard = w.gust != null && w.gust >= WIND_HARD_MPH;
    if (e.tall) {
      return verdict(hard ? OUTLOOK.closed : OUTLOOK.hold, 'Wind stops the tall rides first');
    }
    if (hard && e.shelter === 'open' && e.kind === 'ride') {
      return verdict(OUTLOOK.hold, 'Gusts high enough to stop most outdoor rides');
    }
  }

  if (e.waterpark && w.cold) {
    return verdict(OUTLOOK.closed, `Water park usually shuts below ${COLD_WATER_F}°F`);
  }

  if (w.wetNow) {
    if (e.shelter === 'indoor') return verdict(OUTLOOK.running, 'Indoors — a good place to wait it out');
    if (e.shelter === 'covered') return verdict(OUTLOOK.running, 'Under a roof');
    // Getting rained on is the entire point of a flume, so rain alone is not
    // news for a wet ride — only lightning and cold are.
    if (e.wet) return verdict(OUTLOOK.running, 'Already a wet ride');
    if (e.kind === 'show') return verdict(OUTLOOK.hold, 'Open-air seating');
    return verdict(OUTLOOK.watch, 'Rain slows outdoor loading');
  }

  // Rain that has not started yet. Keyed on the rain signal itself and not on
  // the severity ladder: wind outranks rain on that ladder, so ranking here put
  // every outdoor ride in the park on a rain watch during a dry gale.
  if (w.chance != null && w.chance >= 60 && e.shelter === 'open' && e.kind === 'ride' && !e.wet) {
    return verdict(OUTLOOK.watch, 'Rain in the forecast');
  }

  return verdict(OUTLOOK.running);
}

/**
 * The park-wide headline: what a visitor needs to know before they read any
 * individual ride. Counts are over rides only — nobody plans a day around
 * whether the gift shop is dry.
 */
export function parkOutlook(pois, weather) {
  const tally = { running: 0, watch: 0, hold: 0, closed: 0 };
  let worst = OUTLOOK.running;

  for (const poi of pois || []) {
    const e = exposureFor(poi);
    if (e.kind !== 'ride') continue;
    const o = outlookFor(poi, weather);
    tally[o.key] += 1;
    if (o.rank > worst.rank) worst = OUTLOOK[o.key];
  }

  const affected = tally.watch + tally.hold + tally.closed;
  return { tally, worst, affected, total: Object.values(tally).reduce((a, b) => a + b, 0) };
}
