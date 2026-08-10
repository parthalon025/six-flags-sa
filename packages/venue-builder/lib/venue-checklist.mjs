/**
 * What a location has to carry before it is finished.
 *
 * Every venue here is the same data about a different place, which is the whole
 * design — and the failure mode that comes with it is a park that is *almost*
 * built. Nothing crashes. The map draws, the list fills, and some whole feature
 * of the app is simply not there, silently, because the one file that feeds it
 * was never written. That is not hypothetical: two of the three parks shipped
 * with no height rules, so the Rides tab, the slider, the tally and the
 * struck-through markers did not exist at either of them and nothing said so.
 * The campground at a third was dropped in its entirety by a tag rule.
 *
 * So this is the list, in one place, for a human reviewing a venue and for the
 * suite that will not let one ship half-built. Each item knows three things:
 * whether it applies to this venue at all, whether it passed, and what to type
 * if it did not.
 *
 * `required` marks the ones the test suite holds to. The rest are advice — a
 * town centre has no ride heights and a campus has no campground, and an item
 * that does not apply is never a failure.
 */

import { keyAudit } from './venue-ids.mjs';

const ok = (key, label, detail) => ({ key, label, status: 'ok', detail });
const na = (key, label, detail) => ({ key, label, status: 'n/a', detail });
const miss = (key, label, detail, fix, required = false) => ({
  key,
  label,
  status: 'missing',
  detail,
  fix,
  required,
});

/** Roughly how big a venue's map file may be before a phone on park wifi suffers. */
export const MAP_KB_CEILING = 1200;

/**
 * @param venue the manifest row
 * @param map   the drawn geometry, including its `meta`
 * @param pois  the places
 * @param sizes {{ mapKb, poisKb }}, since the caller is the one holding the files
 */
export function checklist(venue, map, pois, sizes = {}) {
  const out = [];
  const count = (fn) => pois.filter(fn).length;
  const layers = Object.entries(map || {}).filter(([, v]) => Array.isArray(v));
  const drawn = layers.reduce((n, [, v]) => n + v.length, 0);
  const rides = count((p) => p.c === 'coaster' || p.c === 'ride');
  const heights = count((p) => p.h);
  const camps = count((p) => p.c === 'campsite');

  /* ---- the map itself ---- */

  out.push(
    drawn > 0
      ? ok('geometry', 'Drawn geometry', `${drawn} shapes across ${layers.filter(([, v]) => v.length).length} layers`)
      : miss(
          'geometry',
          'Drawn geometry',
          'nothing drawn',
          'The bounding box found no mapped features. Check --bbox, or try --place.',
          true,
        ),
  );

  const mapKb = sizes.mapKb ?? null;
  out.push(
    mapKb == null
      ? na('size', 'Download size', 'not measured')
      : mapKb <= MAP_KB_CEILING
        ? ok('size', 'Download size', `${mapKb} KB of geometry`)
        : miss(
            'size',
            'Download size',
            `${mapKb} KB — a lot for one phone on park wifi`,
            `Tighten --bbox, or raise --tolerance above 1.2 to simplify harder.`,
          ),
  );

  const boundary = map?.boundary || map?.park?.[0]?.r || null;
  out.push(
    boundary?.length
      ? ok('boundary', 'Venue boundary', `${boundary.length} points`)
      : miss(
          'boundary',
          'Venue boundary',
          'no ring is tagged as the venue itself',
          'The map still draws, but nothing knows where the venue ends. Usually means the '
            + 'place is not mapped as an area in OpenStreetMap — add it there, or accept it.',
        ),
  );

  const districts = new Set((map?.lands || []).map((l) => l.n).filter(Boolean));
  out.push(
    districts.size
      ? ok('districts', 'Named districts', `${districts.size} — ${[...districts].slice(0, 3).join(', ')}…`)
      : miss(
          'districts',
          'Named districts',
          'none',
          'Nothing to label at low zoom, so the map reads as paths until you zoom in. '
            + 'Districts come from named areas in OpenStreetMap; there may genuinely be none.',
        ),
  );

  /* ---- the places ---- */

  out.push(
    pois.length
      ? ok('places', 'Places', `${pois.length}`)
      : miss('places', 'Places', 'none', 'A map with no places has no list and no search.', true),
  );

  /* The three a visitor asks for by name within an hour of arriving. Their
     absence is nearly always a tag rule that did not match rather than a park
     with no toilets. */
  for (const [key, label, test] of [
    ['restroom', 'Toilets', (p) => p.c === 'restroom'],
    ['food', 'Food', (p) => p.c === 'food'],
    ['gate', 'A way in', (p) => p.c === 'gate'],
  ]) {
    const n = count(test);
    out.push(
      n
        ? ok(`have-${key}`, label, `${n}`)
        : miss(
            `have-${key}`,
            label,
            'none found',
            `The glance rail has a standing card for this and it will not render. Check the `
              + `POI rules in scripts/lib/osm-tags.mjs against how this place is tagged.`,
          ),
    );
  }

  /* ---- primary keys ---- */

  /* The one item here that is about the app losing work rather than about a
     feature being absent. Every edit a visitor makes — a ride reported down, a
     favourite, a nav target — is filed under a place's key, so a key on two
     places files an edit against whichever of them a reader finds first, and a
     key that moves between builds files it against nothing at all. That is not
     a gap in a venue, it is data loss, so it is required and the build refuses
     rather than warning.

     A venue with no keys at all is a different state and not a failure: it was
     built before there were any, `withIds` falls back to the old name-and-file-
     order rule, and it loads. Rebuilding it, or running npm run venues:overrides
     over it, is what issues the keys. */
  const keys = keyAudit(pois);
  out.push(
    keys.keyed === 0
      ? na('keys', 'Primary keys', 'built before keys — ids fall back to the name')
      : keys.duplicates.length
        ? miss(
            'keys',
            'Primary keys',
            `${keys.duplicates.length} key(s) on more than one place: `
              + keys.duplicates.slice(0, 3).map((d) => `"${d.key}"`).join(', '),
            `A key addresses one place. Usually an "i" written by hand into `
              + `data/venues/${venue?.id}.overrides.json under a name more than one place wears — `
              + `move it onto the key of the one you meant.`,
            true,
          )
        : keys.unkeyed
          ? miss(
              'keys',
              'Primary keys',
              `${keys.unkeyed} of ${keys.total} places carry no key`,
              `A half-keyed venue means something wrote places into the bundle without going `
                + `through the ledger. Run npm run venues:overrides -- ${venue?.id} to issue the `
                + `missing ones.`,
              true,
            )
          : ok('keys', 'Primary keys', `${keys.keyed}, all distinct`),
  );

  /* ---- height rules ---- */

  out.push(
    rides === 0
      ? na('heights', 'Height rules', 'no rides here')
      : heights > 0
        ? ok('heights', 'Height rules', `${heights} of ${rides} rides`)
        : miss(
            'heights',
            'Height rules',
            `${rides} rides and no rules`,
            `Without these the Rides tab, the slider, the tally and the struck-through markers `
              + `do not exist. The build reads OpenStreetMap's minimum_height_requirement where it `
              + `is tagged; write the rest into data/venues/${venue.id}.overrides.json.`,
            true,
          ),
  );

  /* ---- camping ---- */

  const campFacts = Boolean(venue?.camping) || pois.some((p) => p.camp);
  out.push(
    camps === 0
      ? na('camping', 'Campground detail', 'no campground here')
      : campFacts
        ? ok('camping', 'Campground detail', `${camps} campsites, with hookup facts`)
        : miss(
            'camping',
            'Campground detail',
            `${camps} campsites and nothing said about any of them`,
            `A pitch nobody can ask "does it have 50 amp" about is a dot with a number. Add a `
              + `camping block to data/venues/${venue.id}.overrides.json, or import a dataset `
              + `with --merge.`,
          ),
  );

  /* ---- provenance ---- */

  const owesCredit = heights > 0 || campFacts;
  out.push(
    !owesCredit
      ? na('credits', 'Data credit', 'nothing here is from outside OpenStreetMap')
      : venue?.credits
        ? ok('credits', 'Data credit', venue.credits)
        : miss(
            'credits',
            'Data credit',
            'carries data that is not from OpenStreetMap and says whose it is nowhere',
            `Set "credits" in data/venues/${venue.id}.overrides.json. The app prints it under `
              + `the height slider.`,
          ),
  );

  out.push(
    venue?.locality
      ? ok('locality', 'Locality', venue.locality)
      : miss(
          'locality',
          'Locality',
          'blank',
          'The line under the venue name in the picker. Pass --locality "Town, State".',
        ),
  );

  return out;
}

/** The ones a venue must pass. Everything else is advice. */
export const failures = (items) => items.filter((i) => i.status === 'missing' && i.required);

/** The checklist as a markdown table. */
export function checklistTable(items) {
  const mark = { ok: '✅', missing: '❌', 'n/a': '–' };
  const lines = ['| | Needs | Found |', '| :-: | --- | --- |'];
  for (const i of items) lines.push(`| ${mark[i.status]} | ${i.label} | ${i.detail} |`);
  return lines.join('\n');
}
