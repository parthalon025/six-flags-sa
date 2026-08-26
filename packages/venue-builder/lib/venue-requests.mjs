import { addressBook, resolveOverride } from './venue-ids.mjs';
import { questSeedsForVenue } from './quest-seeds.mjs';

/**
 * The questions a build cannot answer, written so somebody — or something — can.
 *
 * Most of a venue comes out of OpenStreetMap and the rest cannot. "You must be
 * forty-eight inches to ride this" is not in OSM, is not going to be in OSM, and
 * is the single fact the Rides tab, the height slider, the running tally and the
 * struck-through markers are all built on. Whose 2026 attraction pages the
 * numbers were read off is not in OSM either, and the app prints that under the
 * slider. Neither is what a campground's pitches actually have laid on.
 *
 * The checklist in venue-checklist.mjs already knows every one of these gaps and
 * says so in a `fix` line, and that line is written for a person sitting at a
 * terminal in this repo: "write data/venues/<id>/overrides.json". Which is the
 * right sentence for the person who just ran the build and the wrong one for the
 * work that actually has to happen next — reading a park's own pages, one
 * attraction at a time, and turning prose into a keyed JSON file that obeys half
 * a dozen conventions nobody has written down in one place.
 *
 * So this turns those gaps into a brief. Every convention this repo learned the
 * hard way is in it, because every one of them has already been got wrong once:
 *
 *   · An override keyed to a name nothing answers to is a correction that
 *     silently did not happen. There is a test that fails on it, and Big
 *     Kahuna's carries thirteen published height rules under `_unmapped` for
 *     exactly this reason — OSM has the geometry, unnamed.
 *   · `min: 0` is a park saying out loud that there is no floor, and the app
 *     reads it back as "No minimum". `null` means nobody has looked. A lazy
 *     river deserves the first answer and gets the second by default.
 *   · A park routinely carries a ride under two names, one on the sign and one
 *     in OSM. That is what `alias` is for, and guessing which is current is how
 *     an override lands on nothing.
 *   · Weight limits and life-jacket exceptions are real rules with no field in
 *     this model. They go in `note` rather than being rounded off into a height.
 *   · A pin nobody surveyed is worse than a missing pin. Big Kahuna's illustrated
 *     park map georeferenced to 33 m RMS against eleven control points, in a park
 *     400 m across; nothing was placed from it, and nothing should be.
 *
 * Only gaps get a request. A venue that is finished produces none, a town centre
 * is never asked for its ride heights, and a park with no campground is never
 * asked what its pitches have — an item that does not apply to a venue has
 * never been a failure here and is not a question either.
 */

const RIDE = (p) => p.c === 'coaster' || p.c === 'ride';

/**
 * What this venue still needs from outside OpenStreetMap.
 *
 * @param venue     the manifest row, or the `meta` block of a built map
 * @param map       the drawn geometry
 * @param pois      the places
 * @param overrides the venue's overrides file, where one exists
 * @returns {Array} requests, blocking ones first
 */
export function requests({ venue, map = {}, pois = [], overrides = null } = {}) {
  const id = venue?.id || 'venue';
  const where = venue?.locality ? `${venue.name} (${venue.locality})` : venue?.name || id;
  const file = `data/venues/${id}/overrides.json`;
  const out = [];

  const rides = pois.filter(RIDE);
  /* One name, asked once. OpenStreetMap routinely carries a ride as two
     elements — a way and a node, the ride and its entrance — and Fiesta Texas
     ships two Poltergeists for exactly that reason. Both get the rule when one
     answer arrives, so both on the list is one question asked twice. */
  const noHeight = [...new Set(rides.filter((p) => !p.h).map((p) => p.n))].sort();

  /* ---- height rules ---- */

  if (rides.length && noHeight.length) {
    const blocking = rides.every((p) => !p.h);
    out.push({
      key: 'heights',
      need: 'Ride height requirements',
      blocking,
      why: blocking
        ? `${where} has ${rides.length} rides and not one height rule, so the app ships without its `
          + 'Rides tab, its height slider, its running tally, the badge over the map and the '
          + 'struck-through markers. All of it, silently, from one missing file.'
        : `${noHeight.length} of ${rides.length} rides at ${where} carry no rule, so each of them `
          + 'reads "check at the ride" and none of them can be filtered out for a child who is too '
          + 'small.',
      targets: noHeight,
      ask: [
        `Find the published height requirement for each ride listed below at ${where}.`,
        'Work from the park\'s own current-season attraction pages first. A park\'s own words are '
          + 'the source; a fan wiki is a lead to check, not an answer.',
        'Heights are in inches, as the American parks in this app publish them.',
        'Write down where each number came from. If a ride is not on the park\'s site, leave it '
          + 'out entirely and say so — an omission is recoverable and a guess is not.',
        'Some of the list will not be rides. A midway game, an arcade, a lounge and a splash pool '
          + 'all arrive tagged as attractions and none of them has a height on a sign. Say which '
          + 'ones those are rather than inventing a rule for them — that answer is a fix to the '
          + 'category rules in lib/osm-tags.mjs, which helps every venue, not just this one.',
      ],
      schema: heightSchema(noHeight),
      rules: [
        '`min` is the floor nobody rides under. `min: 0` is the park saying there is no floor, and '
          + 'the app reads that back as "No minimum" — that is the right answer for a lazy river, '
          + 'and it is not the same as `null`, which means nobody has looked yet.',
        '`alone` is the height below which a supervising rider has to come along. `max` is a '
          + 'ceiling, which most rides have none of.',
        'Keys must match the place name in the bundle exactly, character for character. The list '
          + 'below is those names.',
        'If the park publishes a rule for an attraction whose name is *not* in that list, put it '
          + `under \`_unmapped\` in ${file} instead of under \`pois\`. An override keyed to a name `
          + 'nothing answers to is a correction that silently did not happen, and there is a test '
          + 'that fails on it. It moves up into `pois` the day OpenStreetMap gains that name.',
        'If the park\'s name for a ride differs from the name in the list, key the entry by the '
          + 'park\'s name and add `"alias": "<the name in the list>"`.',
        'Weight limits, life-jacket exceptions, "must ride with an adult", single-tube versus '
          + 'double — real rules this model has no field for — go in `note`, in the park\'s own '
          + 'terms. Never round one off into a height.',
      ],
    });
  }

  /* ---- the credit line ---- */

  const owesCredit = rides.some((p) => p.h) || Boolean(venue?.camping) || pois.some((p) => p.camp);
  if (owesCredit && !venue?.credits) {
    out.push({
      key: 'credits',
      need: 'A data credit',
      blocking: false,
      why: `${where} carries data that did not come from OpenStreetMap and says whose it is `
        + 'nowhere. The app prints this line under the height slider.',
      targets: [],
      ask: [
        'Name the source the non-OSM data was read from, and the season it applies to.',
        'One sentence, in the past tense, of the shape the other venues use: "Height requirements '
          + 'were compiled from <source> for the 2026 season."',
      ],
      schema: '{\n  "credits": "Height requirements were compiled from … for the 2026 season."\n}',
      rules: [
        `It belongs at the top level of ${file}, beside the data it credits, rather than in a `
          + 'build flag somebody typed once.',
      ],
    });
  }

  /* ---- overrides that landed on nothing ---- */

  const unmatched = unmatchedOverrides(pois, overrides);
  if (unmatched.length) {
    out.push({
      key: 'unmatched',
      need: 'Overrides that match no place',
      blocking: false,
      why: `${unmatched.length} entr${unmatched.length === 1 ? 'y' : 'ies'} in ${file} `
        + 'are keyed to a name nothing in this venue answers to, so each is a correction that '
        + 'silently did not happen.',
      targets: unmatched,
      ask: [
        'For each name below, work out which of the two it is.',
        'Either the park renamed the ride and OpenStreetMap still carries the old name — in which '
          + 'case keep the entry keyed by the park\'s name and add `"alias": "<the OSM name>"`.',
        'Or the attraction is genuinely not in the bundle, because OpenStreetMap has its geometry '
          + `unnamed or does not have it at all — in which case move the entry into \`_unmapped\` `
          + 'in the same file, where it waits without pretending to have been applied.',
      ],
      schema: '{\n  "pois": {\n    "<the park\'s name>": { "alias": "<the name in the bundle>", "h": { "min": 48 } }\n  },\n  "_unmapped": {\n    "<not in the bundle at all>": { "h": { "min": 48 } }\n  }\n}',
      rules: ['Do not delete an entry to make the warning go away. The research in it is the '
        + 'expensive part and `_unmapped` is where it keeps.'],
    });
  }

  /* ---- campground facts ---- */

  const camps = pois.filter((p) => p.c === 'campsite');
  if (camps.length && !venue?.camping && !pois.some((p) => p.camp)) {
    out.push({
      key: 'camping',
      need: 'What the campground has laid on',
      blocking: false,
      why: `${camps.length} pitches are drawn at ${where} and nothing is said about any of them. `
        + 'A pitch nobody can ask "does it have 50 amp" about is a dot with a number on it.',
      targets: [],
      ask: [
        'Find what the campground publishes about its sites: hookup level, amperage, water, sewer, '
          + 'cable, wifi, the pad surface, and whether it takes tents as well as caravans.',
        'These are facts about the campground as a whole. Anything true of only some sites belongs '
          + 'in a `rules` entry that matches those sites by name.',
      ],
      schema: '{\n  "camping": {\n    "defaults": {\n      "hookup": "full", "power": true, "amps": [30, 50],\n'
        + '      "water": true, "sewer": true, "cable": true, "wifi": true,\n'
        + '      "surface": "concrete", "caravans": true, "tents": false\n    },\n'
        + '    "rules": [{ "match": "^Site 5", "set": { "drive": "pull-through" } }]\n  }\n}',
      rules: [
        'The venue-wide block is not repeated onto every pitch: a campground is full hookup, a '
          + 'pitch is not individually full hookup. The app reads a pitch\'s own details over it.',
      ],
    });
  }

  /* ---- the three a visitor asks for within an hour ---- */

  const absent = [
    ['restroom', 'toilets', 'amenity=toilets'],
    ['food', 'anywhere to eat', 'amenity=fast_food, amenity=restaurant, amenity=cafe'],
    ['gate', 'a way in', 'barrier=gate, entrance=main, tourism=information'],
  ].filter(([c]) => !pois.some((p) => p.c === c));

  if (absent.length) {
    out.push({
      key: 'missing-poi',
      need: `No ${absent.map(([, label]) => label).join(', no ')}`,
      blocking: false,
      why: 'The glance rail keeps a standing card for each of these and it will not render. Nearly '
        + 'always a tag rule that did not match rather than a park with no toilets — but at a '
        + 'thinly-mapped park it can be the honest truth.',
      targets: absent.map(([, label, tags]) => `${label} — OSM tags the rules look for: ${tags}`),
      ask: [
        'First check how this place is actually tagged in OpenStreetMap, against the rules in '
          + 'lib/osm-tags.mjs. A rule that does not match is a fix that helps every venue.',
        'If OpenStreetMap genuinely does not have them, the park almost certainly does — on the '
          + 'map it hands out at the gate. Trace it: `node scripts/trace-venue.mjs`, which ties '
          + 'the picture to the ground against control points you can find in both, and reports '
          + 'how far out it is before it will write anything.',
        'Better still, put them into OpenStreetMap, which is where the rest of this venue comes '
          + 'from and where a fix reaches everybody rather than only this app.',
      ],
      schema: null,
      rules: [
        'Do not estimate a position by eye. A pin read off an illustrated map without '
          + 'georeferencing it lands tens of metres out in a park a few hundred metres across, and '
          + 'a confidently wrong pin is worse than an absent one — nobody checks a map that looks '
          + 'right. Either a surveyed coordinate, or a traced one whose error the tracer has '
          + 'measured and stamped on it.',
      ],
    });
  }

  /* ---- the line under the name ---- */

  if (!venue?.locality) {
    out.push({
      key: 'locality',
      need: 'A locality',
      blocking: false,
      why: 'The line under the venue name in the picker is blank.',
      targets: [],
      ask: ['Give the town and state or region this venue is in, as "Sandusky, Ohio".'],
      schema: null,
      rules: [`Passed as \`--locality\`, and recorded in data/venues/${id}/recipe.json so the next `
        + 'rebuild keeps it.'],
    });
  }

  return out.sort((a, b) => Number(b.blocking) - Number(a.blocking));
}

/** Override keys that no place in the bundle answers to. Mirrors applyOverrides' matching. */
function unmatchedOverrides(pois, overrides) {
  if (!overrides?.pois) return [];
  const book = addressBook(pois);
  return Object.entries(overrides.pois)
    .filter(([name, patch]) => !resolveOverride(book, name, patch))
    .map(([name]) => name)
    .sort();
}

/** A worked example in the file's own shape, using names this venue actually has. */
function heightSchema(names) {
  const sample = names.slice(0, 2);
  const body = sample
    .map((n, i) => (i === 0
      ? `    ${JSON.stringify(n)}: { "h": { "min": 48, "alone": null, "max": null }, "note": "300 lb maximum." }`
      : `    ${JSON.stringify(n)}: { "h": { "min": 0, "alone": null, "max": null } }`))
    .join(',\n');
  return `{\n  "credits": "Height requirements were compiled from … for the 2026 season.",\n`
    + `  "pois": {\n${body}\n  }\n}`;
}

/**
 * The requests as a brief somebody can act on without this repo in front of them.
 *
 * Markdown because that is what the venue report already speaks, what a pull
 * request body renders, and what a model reads without being told how.
 */
export function renderBrief(venue, reqs) {
  const id = venue?.id || 'venue';
  const name = venue?.name || id;
  const file = `data/venues/${id}/overrides.json`;

  if (!reqs.length) {
    return `# ${name}\n\nNothing here needs a source outside OpenStreetMap.\n`;
  }

  const lines = [
    `# ${name} — what the build could not answer`,
    '',
    `${name}${venue?.locality ? `, ${venue.locality}` : ''} was built from OpenStreetMap by `
      + '`scripts/build-venue.mjs`. Everything below is a fact about this place that OpenStreetMap '
      + 'does not carry and a build therefore cannot produce. Each one needs a source.',
    '',
    `Every answer lands in one file: \`${file}\`. It is keyed by place name, it is re-applied on `
      + 'every rebuild, and it is the only place a hand-written fact about this venue is allowed to '
      + 'live — a generated file that gets hand-edited loses the edit to the next rebuild.',
    '',
    '```bash',
    `npm run venues:overrides -- ${id}   # apply the file, no network, no rebuild`,
    `npm run venues:report -- ${id}      # check what is still missing`,
    '```',
    '',
    '## Ground rules',
    '',
    '- **Cite everything.** Each fact needs the page it came from. The app prints a credit line '
      + 'under the height slider and it has to be true.',
    '- **Omit rather than invent.** A missing entry reads as "check at the ride", which is honest. '
      + 'A wrong height is a family turned away at the gate of a ride they queued for, or worse, a '
      + 'child put on one they should not be on.',
    '- **Never estimate a coordinate.** A surveyed position, or one traced off the park\'s own map '
      + 'with `scripts/trace-venue.mjs`, which measures how far out it is and refuses to write a '
      + 'fit worse than ten metres. Never one placed by eye.',
    '- **Say what you could not find**, by name, at the end. That list is the next piece of work; '
      + 'silence about it is not.',
    '',
  ];

  reqs.forEach((r, i) => {
    lines.push(`## ${i + 1}. ${r.need}${r.blocking ? ' — blocking' : ''}`, '');
    lines.push(`${r.why}`, '');
    lines.push('**What to do**', '');
    r.ask.forEach((a) => lines.push(`- ${a}`));
    lines.push('');
    if (r.rules?.length) {
      lines.push('**Conventions this file has, which are not obvious**', '');
      r.rules.forEach((rule) => lines.push(`- ${rule}`));
      lines.push('');
    }
    if (r.targets.length) {
      lines.push(`**${r.targets.length} to answer for**`, '');
      r.targets.forEach((t) => lines.push(`- ${t}`));
      lines.push('');
    }
    if (r.schema) {
      lines.push(`**Shape of the answer**, to merge into \`${file}\`:`, '', '```json', r.schema, '```', '');
    }
  });

  return `${lines.join('\n')}`;
}

/** The same thing as data, for whatever is not a person. */
export const briefJson = (venue, reqs, extras = {}) => ({
  venue: {
    id: venue?.id || null,
    name: venue?.name || null,
    locality: venue?.locality || null,
    kind: venue?.kind || null,
  },
  overridesFile: `data/venues/${venue?.id}/overrides.json`,
  blocking: reqs.some((r) => r.blocking),
  requests: reqs,
  /* Gaps open sources cannot settle → Side Quests / Scout missions (E9–E10). */
  questSeeds: extras.questSeeds
    || questSeedsForVenue({
      venueId: venue?.id,
      reqs,
      attractions: extras.attractions || null,
      includeAmbient: extras.includeAmbient !== false,
    }),
});
