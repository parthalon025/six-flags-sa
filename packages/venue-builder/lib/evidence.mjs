/**
 * How much a claim about a place is worth, and how stale it has got.
 *
 * Everything this pipeline produces about a ride's entrance is a claim from a
 * source, and the sources are not equal. "The park's own map says the queue
 * starts here" and "a way in OpenStreetMap is called Maverick Standby Queue"
 * and "there is a footpath that dead-ends at the station, so probably" are three
 * different kinds of statement, and the failure mode of a pipeline like this is
 * that they all end up as the same six decimal places in the same JSON file and
 * nobody can tell afterwards which was which.
 *
 * So a coordinate here is never stored bare. It carries the sources it came
 * from, a score fused from them, and the date each source was read — because a
 * park moves a queue, adds an accessible entrance, reroutes a path or demolishes
 * the ride, and a coordinate that was right in 2024 is not wrong so much as
 * *expired*. The two failures look identical in a file that only stores numbers.
 *
 * The weights are deliberately coarse. They are not a probability and pretending
 * otherwise would be the same error one level up: this is a way of sorting
 * "somebody should look at this" from "this is settled", and no fusion rule
 * turns a forum post into a survey.
 */

/**
 * What each kind of source is worth.
 *
 * `geometry` sits at the bottom on purpose. It is this repo's own inference from
 * the shape of the path network — the cheapest evidence there is and the only
 * kind that scales to every ride in every park, which is exactly why it must
 * never on its own be enough to publish.
 */
export const WEIGHTS = {
  official_map: 5,
  official_site: 5,
  osm_entrance: 4,
  osm_named_queue: 4,
  osm_queue_name: 2,
  aerial: 4,
  mapillary: 4,
  parks_api: 3,
  cv_detection: 2,
  cv_segmentation: 3,
  guest_photo: 3,
  video: 3,
  traced: 3,
  historical_map: 2,
  wikidata: 3,
  queue_times: 2,
  ropedrop: 2,
  rcdb: 2,
  accessibility_cloud: 3,
  sidewalk_labels: 2,
  guest_trace: 2,
  open_meteo: 1,
  openhistoricalmap: 2,
  forum: 1,
  /** LLM extraction from official pages — proposals only; never alone enough to publish. */
  llm_extract: 1,
  geometry: 1,
};

/** Score to band. The names are what a person reads; the numbers are internal. */
export const BANDS = [
  { at: 13, band: 'very_high' },
  { at: 10, band: 'high' },
  { at: 7, band: 'moderate' },
  { at: 4, band: 'low' },
  { at: 0, band: 'unknown' },
];

/** The confidence at or above which this app will publish a coordinate. */
export const PUBLISH_AT = 'moderate';

const RANK = { unknown: 0, low: 1, moderate: 2, high: 3, very_high: 4 };

export const atLeast = (band, floor) => (RANK[band] ?? 0) >= (RANK[floor] ?? 0);

export const bandOf = (score) => BANDS.find((b) => score >= b.at)?.band ?? 'unknown';

/**
 * Fuse a feature's evidence into one score and band.
 *
 * Two rules that are not obvious and both matter:
 *
 * **Agreement is worth more than repetition.** Two sources that put a queue
 * entrance in the same spot are strong; the same source cited twice is not.
 * Sources are counted once per kind, so quoting three forum threads is worth one
 * forum thread — which is the honest reading of three people repeating each
 * other.
 *
 * **Disagreement is not averaged away.** Sources that put the feature in
 * materially different places do not quietly blend into a point between them,
 * which would be a coordinate no source supports and is how a pin ends up in a
 * flowerbed. The spread is reported and the fused score is capped at whatever
 * the best single source is worth, because that is all anybody has actually
 * established.
 *
 * @param evidence  `[{ source, at?: {lat,lng}, date?, note? }]`
 * @param spreadM   how far apart two claims may be and still be the same claim
 */
export function fuse(evidence = [], { spreadM = 20 } = {}) {
  const used = [];
  const seen = new Set();
  for (const e of evidence) {
    if (!(e.source in WEIGHTS)) continue;
    if (seen.has(e.source)) continue;
    seen.add(e.source);
    used.push(e);
  }
  if (!used.length) {
    return { score: 0, band: 'unknown', sources: [], dissent: [], spread: null, conflict: false };
  }

  const located = used.filter((e) => Number.isFinite(e.at?.lat));
  if (!located.length) {
    const total = used.reduce((s, e) => s + WEIGHTS[e.source], 0);
    return { score: total, band: bandOf(total), sources: names(used), dissent: [], spread: null, conflict: false };
  }

  /* The heaviest source picks the spot, and the question then is which of the
     others back it up. Not "how far apart is everything", which was the first
     rule here and was wrong in a way worth recording: a coaster's nearest
     footpath is somewhere along thirteen hundred metres of track, so it lands a
     hundred metres from the queue every time. Treating that as a standoff let
     the worst source in the pipeline veto the best one, and Millennium Force,
     Steel Vengeance and Top Thrill 2 — the three rides with a mapper-named
     queue way, which is as good as automatic evidence gets — came out as
     disputed. A guess disagreeing with a survey is not a dispute. It is the
     guess being wrong. */
  const anchor = located.reduce((a, b) => (WEIGHTS[b.source] > WEIGHTS[a.source] ? b : a));
  const top = WEIGHTS[anchor.source];

  const agrees = [];
  const dissent = [];
  for (const e of used) {
    if (!Number.isFinite(e.at?.lat)) {
      // A source with something to say and no coordinate corroborates whatever
      // the located ones settled on; it cannot disagree about a place.
      agrees.push(e);
      continue;
    }
    const d = metresBetween(anchor.at, e.at);
    if (d <= spreadM) agrees.push(e);
    else dissent.push({ source: e.source, metres: Number(d.toFixed(1)) });
  }

  /* A real standoff is two sources of the same standing pointing at different
     places. That is the one a person has to settle, and it is worth stopping
     for; being outranked is not. */
  const conflict = dissent.some((d) => WEIGHTS[d.source] >= top);
  const score = agrees.reduce((s, e) => s + WEIGHTS[e.source], 0);

  return {
    score: conflict ? top : score,
    band: bandOf(conflict ? top : score),
    sources: names(agrees),
    dissent: dissent.sort((a, b) => WEIGHTS[b.source] - WEIGHTS[a.source]),
    spread: dissent.length ? dissent[0].metres : null,
    conflict,
  };
}

const names = (list) => list.map((e) => e.source).sort();

export const metresBetween = (a, b) => {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110540);
};

/**
 * Where the fused claim actually goes.
 *
 * The heaviest source wins outright rather than the points being averaged. An
 * average of a survey and a guess is a third thing that neither source supports,
 * and it is worse than the guess because it now has two citations behind it.
 */
export function pointOf(evidence = []) {
  const located = evidence.filter((e) => Number.isFinite(e.at?.lat) && e.source in WEIGHTS);
  if (!located.length) return null;
  const best = located.reduce((a, b) => (WEIGHTS[b.source] > WEIGHTS[a.source] ? b : a));
  return { lat: best.at.lat, lng: best.at.lng, from: best.source };
}

/**
 * Whether a claim has gone stale.
 *
 * A park changes constantly and a coordinate has a shelf life. This does not
 * touch the score — an old survey is still a survey, and quietly decaying it
 * would invent a decay rate nobody measured. It sets a flag, so a review can ask
 * for the oldest evidence first, which is the question worth asking.
 *
 * @param months  how long a claim about a theme park stays fresh. A season.
 */
export function staleness(evidence = [], asOf, { months = 12 } = {}) {
  const dates = evidence.map((e) => e.date).filter(Boolean).sort();
  if (!dates.length) return { newest: null, stale: true, why: 'nothing here is dated' };
  const newest = dates[dates.length - 1];
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - months);
  const stale = new Date(newest) < cutoff;
  return {
    newest,
    stale,
    why: stale ? `newest evidence is from ${newest}, over ${months} months before ${asOf}` : null,
  };
}

/**
 * One certification row — the claim/evidence/confidence/falsifier/so-what
 * contract shared by venue and display certification.
 */
export const check = ({ key, claim, pass, evidence, confidence, falsifier, soWhat }) => ({
  key, claim, pass, evidence, confidence, falsifier, soWhat,
});
