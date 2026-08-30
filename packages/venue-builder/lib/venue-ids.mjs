/**
 * The primary key of a place, and the ledger that remembers it.
 *
 * Every join in this app used to be a lowercased display string. A ride report
 * on the wire, a favourite, a nav target and every line of every overrides file
 * all addressed a place by `slug(name)` plus a numeric suffix counted off in
 * file order — so renaming a ride or rebuilding a venue in a different order
 * silently reassigned identity, and an edit keyed to the old key was not moved,
 * it was *lost*. That is the failure this module exists to stop.
 *
 * ## The key
 *
 * `i` on each place: `slug(name)` where the name is unique in the venue, and
 * `slug(name)-N` where it is not. Two things make that different from what came
 * before, and they are the whole design:
 *
 *   1. **`N` is data, not a computation over array order.** It is issued once,
 *      written into the bundle, and recorded in a committed ledger beside the
 *      overrides file. A later build reads the ledger and reuses the number; it
 *      never recounts.
 *   2. **`i` is not derived from `n` after the first issue.** Rename the ride
 *      and `n` changes while `i` stays. The key is identity; the name is a
 *      title. They are different properties on purpose.
 *
 * Why keep the slug shape at all, rather than an opaque id or the OpenStreetMap
 * element id? Because the ids that are on phones *today* are slugs, and seeding
 * the ledger from the venue already on disk reproduces every one of them
 * exactly — so this lands without moving a single live ride report. An opaque
 * scheme would move all of them, which is the same data loss in a nicer font.
 *
 * ## Why not the OpenStreetMap id
 *
 * It was the obvious candidate and it does not survive contact with the data.
 * `buildPois` has no 1:1 relationship with OSM elements: the dedupe deliberately
 * collapses a track way, a station building and a name node into one place, and
 * pitches, track-derived rides, traced features and `overrides.add` entries have
 * no element at all. An OSM-keyed scheme covers roughly six rows in ten and
 * needs a second scheme for the rest, which means two schemes, which means
 * none. It is also less stable than it sounds: a mapper who deletes and redraws
 * a way produces a new `way/id` for the same physical coaster.
 *
 * So the OSM element is kept as **provenance and as a matching tiebreaker**,
 * not as identity — and it is kept *here*, in the ledger, rather than in the
 * bundle. No phone reads it, and four hundred and twenty-nine of them is eleven
 * kilobytes on a file the service worker precaches on park wifi.
 *
 * ## What gets a key, and what deliberately does not
 *
 *   **A place from OpenStreetMap.** Keyed, with its element recorded as
 *   provenance. Note that one place is routinely three elements — the dedupe
 *   collapses a track, a station building and a name node — so the element on
 *   the record is the one that survived the collapse, not a claim of identity.
 *
 *   **A place from `overrides.add`, from a track, from a campground ring or
 *   from a trace.** Keyed exactly the same way, and this is the reason the
 *   scheme cannot be element-based: none of them has an element. They match on
 *   position, which for a hand-written place is a hand-written number that does
 *   not move on its own.
 *
 *   **An entrance, an exit, a route.** Not keyed, on purpose. An entrance is
 *   not a thing you can address — it is a *claim about a ride*, carried on that
 *   ride's `e` or `out`, and its identity is the ride's key plus the source
 *   that asserted it. Giving it a key of its own would invent a second entity
 *   for something the app never looks up, and would need retiring rules for an
 *   object that legitimately appears and disappears as the evidence changes.
 *   What it carries instead is provenance: `src.by` for the kind of source and,
 *   where the claim came off a way, `src.osm` for which way — so two detectors
 *   reading the same queue are one source however they are labelled.
 *
 * ## Matching, on a rebuild
 *
 * In order, each pass only seeing what the ones before it left:
 *
 *   0. a place that already carries `i` keeps it. Duplicates are not silently
 *      merged here — {@link keyAudit} reports them and the build refuses.
 *   1. exact OpenStreetMap element match against the ledger. This is what makes
 *      a rename free: the element did not change, so neither does the key.
 *   2. within one name group, nearest surviving position, globally greedy so
 *      the answer does not depend on which end of the list you start from.
 *      No distance cap: the group is already same-name inside one venue, so the
 *      nearest survivor is the best answer available and a cap would only
 *      manufacture new numbers for places that had merely moved.
 *   3. anything still unmatched takes the lowest number never yet issued for
 *      its name — issued in position order, never insertion order.
 *
 * Anything in the ledger nothing claimed is retired rather than deleted, so its
 * number is never handed to a different place. A retired key can be reclaimed,
 * but only by an exact OpenStreetMap match: the same object coming back should
 * get its edits back, and a *different* object standing where it used to should
 * not.
 */

import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { slug } from '../../../apps/party-tracker/lib/venue/ids.js';
import { OVERRIDE_DIR, readJson, venueSidecar } from './venue-io.mjs';

/** The name group a place belongs to. Also the stem every key is built from. */
export const baseKeyFor = (name) => slug(name) || 'poi';

/** `w12345` — the Overpass type letter and the id, and nothing else. */
export const osmRef = (el) =>
  el && el.type && el.id != null ? `${String(el.type)[0]}${el.id}` : null;

const ledgerFile = (id) => venueSidecar(id, 'ids.json');

/* Codepoint order, not locale order: this file is committed and diffed, and a
   build on a different machine must produce the same bytes. */
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const sortedKeys = (keys) =>
  Object.fromEntries(Object.keys(keys).sort(byCodepoint).map((k) => [k, keys[k]]));

/** What the ledger remembers about one place. Enough to match it again.
 *  `at` is one string rather than two numbers so that a record is one line. */
const record = (poi, extra = {}) => ({
  n: poi.n,
  ...(poi.c ? { c: poi.c } : {}),
  at: `${poi.lat},${poi.lng}`,
  ...(poi.osm ? { osm: poi.osm } : {}),
  ...extra,
});

const atOf = (rec) => {
  const [lat, lng] = String(rec?.at ?? '').split(',').map(Number);
  return [Number.isFinite(lat) ? lat : 0, Number.isFinite(lng) ? lng : 0];
};

export const readLedger = (id) => readJson(ledgerFile(id), null);

/**
 * The exact bytes a ledger is written as, so a caller can ask "would this
 * change?" before touching the file.
 *
 * One line per key, which is the whole reason this is not `JSON.stringify(…, 2)`:
 * the question a human asks of this file is "which places moved, and where did
 * that number come from", and the answer is only readable if a rename is one
 * changed line rather than eight.
 */
export function serializeLedger(ledger) {
  const keys = sortedKeys(ledger?.keys || {});
  const rows = Object.entries(keys).map(
    ([key, rec]) => `    ${JSON.stringify(key)}: ${JSON.stringify(rec)}`,
  );
  return [
    '{',
    `  "version": ${JSON.stringify(ledger?.version ?? 1)},`,
    `  "venue": ${JSON.stringify(ledger?.venue ?? null)},`,
    rows.length ? `  "keys": {\n${rows.join(',\n')}\n  }` : '  "keys": {}',
    '}',
    '',
  ].join('\n');
}

export function writeLedger(id, ledger) {
  const file = ledgerFile(id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serializeLedger(ledger));
  return file;
}

/**
 * A ledger for a venue built before any of this existed.
 *
 * Deliberately reproduces the *old* numbering — `slug(n)`, then file order — so
 * the ledger is born agreeing with whatever is already on phones. Migration is
 * therefore free and offline: seed from the bundle on disk and no live id moves.
 */
export function seedLedger(id, pois) {
  const keys = {};
  const seen = new Map();
  for (const poi of pois || []) {
    const base = baseKeyFor(poi.n);
    let n = (seen.get(base) ?? 0) + 1;
    let key = n === 1 ? base : `${base}-${n}`;
    /* The old rule could collide a repeat of "Restrooms" with a place actually
       named "Restrooms 2". No shipped venue does, but the seed must not be the
       one place that writes a duplicate. */
    while (keys[key]) {
      n += 1;
      key = `${base}-${n}`;
    }
    seen.set(base, n);
    keys[key] = record(poi);
  }
  return { version: 1, venue: id, keys: sortedKeys(keys) };
}

const metresBetween = (a, b) => {
  const kx = 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * 110540);
};

/**
 * Give every place its key, and hand back the ledger that would record it.
 *
 * The places are copied, not mutated, and the ledger passed in is left alone.
 * `osm` is consumed here — it goes into the ledger and comes off the place,
 * because it is build-time provenance and the bundle is a download. A build
 * that has to run this twice — once so the overrides can address a key, once
 * after the overrides have introduced places of their own — passes `keepOsm`
 * on the first call so the second one still has the provenance to record.
 *
 * @param pois    the venue's places, in any order
 * @param ledger  the previous ledger, or null for a venue with no memory
 * @returns {{ pois, ledger, reused, issued, retired }}
 */
export function assignKeys(pois, ledger, { venue = ledger?.venue || null, keepOsm = false } = {}) {
  const list = (pois || []).map((p) => ({ ...p }));
  const prior = { ...(ledger?.keys || {}) };
  /* Every key this venue has ever issued, live or retired, plus the ones taken
     during this run. A number leaves this set never. */
  const everIssued = new Set(Object.keys(prior));
  const takenNow = new Map(); // key -> the place holding it
  let reused = 0;
  let issued = 0;

  const take = (poi, key) => {
    poi.i = key;
    takenNow.set(key, poi);
    everIssued.add(key);
  };

  /* -- 0. a key already on the place wins, duplicates and all -------------- */
  for (const poi of list) {
    if (typeof poi.i === 'string' && poi.i) {
      /* Not `take`: a second place claiming the same key has to stay visible to
         keyAudit rather than being quietly absorbed by the Map. */
      everIssued.add(poi.i);
      if (!takenNow.has(poi.i)) takenNow.set(poi.i, poi);
      reused += 1;
    }
  }

  /* -- 1. the same OpenStreetMap element, live or retired ------------------ */
  const byOsm = new Map();
  for (const [key, rec] of Object.entries(prior)) {
    if (rec?.osm && !byOsm.has(rec.osm)) byOsm.set(rec.osm, key);
  }
  for (const poi of list) {
    if (poi.i || !poi.osm) continue;
    const key = byOsm.get(poi.osm);
    if (!key || takenNow.has(key)) continue;
    take(poi, key);
    reused += 1;
  }

  /* -- 2. the nearest survivor of the same name ---------------------------- */
  const freeByBase = new Map();
  for (const [key, rec] of Object.entries(prior)) {
    if (rec?.retired || takenNow.has(key)) continue;
    const base = baseKeyFor(rec?.n);
    if (!freeByBase.has(base)) freeByBase.set(base, []);
    freeByBase.get(base).push({ key, at: atOf(rec) });
  }
  const groups = new Map();
  for (const poi of list) {
    if (poi.i) continue;
    const base = baseKeyFor(poi.n);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(poi);
  }
  for (const [base, members] of groups) {
    const free = freeByBase.get(base) || [];
    if (!free.length) continue;
    /* Globally greedy rather than first-come: every candidate pairing is scored,
       the closest wins, and both sides drop out. Ties break on the key, so the
       result cannot depend on the order the places arrived in. */
    const pairs = [];
    for (const poi of members) {
      for (const cand of free) {
        pairs.push({ poi, key: cand.key, d: metresBetween([poi.lat, poi.lng], cand.at) });
      }
    }
    pairs.sort((a, b) => a.d - b.d || byCodepoint(a.key, b.key));
    for (const pair of pairs) {
      if (pair.poi.i || takenNow.has(pair.key)) continue;
      take(pair.poi, pair.key);
      reused += 1;
    }
  }

  /* -- 3. the lowest number this venue has never issued -------------------- */
  const unmatched = list.filter((p) => !p.i);
  /* Position order, so two runs over the same data issue the same numbers and
     neither the Overpass response's ordering nor ours can move an id. */
  unmatched.sort(
    (a, b) =>
      byCodepoint(baseKeyFor(a.n), baseKeyFor(b.n)) ||
      a.lat - b.lat ||
      a.lng - b.lng ||
      byCodepoint(String(a.osm || ''), String(b.osm || '')) ||
      byCodepoint(String(a.n || ''), String(b.n || '')),
  );
  for (const poi of unmatched) {
    const base = baseKeyFor(poi.n);
    let key = base;
    let n = 1;
    while (everIssued.has(key)) {
      n += 1;
      key = `${base}-${n}`;
    }
    take(poi, key);
    issued += 1;
  }

  /* -- the ledger this run would leave behind ------------------------------ */
  const keys = {};
  for (const poi of list) {
    if (keys[poi.i]) continue;
    /* A run with no OpenStreetMap source — `--reapply` reads the bundle, and a
       bundle carries no `osm` — must not write the field away: it would strip
       step 1 from every record and leave each place one rename away from
       rotating its key (#27). The run wins when it has an element of its own;
       otherwise the prior record's is carried forward. */
    const carried = !poi.osm && prior[poi.i]?.osm ? { osm: prior[poi.i].osm } : {};
    keys[poi.i] = record(poi, carried);
  }
  /* Rebuilt with the key first, because the key is the first thing about a
     place and a generated file that reads well is a generated file people
     check. Provenance stays in the ledger; the bundle is a download. */
  const out = list.map((poi) => {
    const { i, osm, ...rest } = poi;
    return keepOsm && osm ? { i, ...rest, osm } : { i, ...rest };
  });
  let retired = 0;
  for (const [key, rec] of Object.entries(prior)) {
    if (keys[key]) continue;
    keys[key] = { ...rec, retired: true };
    if (!rec?.retired) retired += 1;
  }

  return {
    pois: out,
    ledger: { version: 1, venue, keys: sortedKeys(keys) },
    reused,
    issued,
    retired,
  };
}

/**
 * Whether this venue's keys are usable. Three answers, and the middle one is
 * not a warning: a key on two places means an edit lands on the wrong one, and
 * the whole point of a key is that it cannot.
 */
export function keyAudit(pois) {
  const list = pois || [];
  const keyed = list.filter((p) => typeof p?.i === 'string' && p.i);
  const byKey = new Map();
  for (const poi of keyed) {
    if (!byKey.has(poi.i)) byKey.set(poi.i, []);
    byKey.get(poi.i).push(poi);
  }
  const duplicates = [...byKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, names: group.map((p) => p.n) }))
    .sort((a, b) => byCodepoint(a.key, b.key));
  return {
    total: list.length,
    keyed: keyed.length,
    unkeyed: list.length - keyed.length,
    duplicates,
  };
}

/**
 * The address book an overrides file is read through.
 *
 * Overrides are filed under the display name, and they stay that way: those
 * files are edited against a park's published height chart, where
 * `"BATMAN The Ride"` is checkable against the sign and `batman-the-ride` is
 * not. So the name is an *alias layer* over the keys rather than a second
 * identity — a key resolves, a name resolves, and where a name is ambiguous it
 * resolves to every place wearing it, which is deliberate: Fiesta Texas ships
 * two Poltergeists and both take the same height rule.
 *
 * The key is the escape hatch for the cases where that is wrong — one of Cedar
 * Point's twenty-six "Restrooms", or one of five gates all called "Entrance".
 */
export function addressBook(pois) {
  const byKey = new Map();
  const byName = new Map();
  for (const poi of pois || []) {
    if (typeof poi.i === 'string' && poi.i && !byKey.has(poi.i)) byKey.set(poi.i, [poi]);
    const name = String(poi.n ?? '').toLowerCase();
    if (byName.has(name)) byName.get(name).push(poi);
    else byName.set(name, [poi]);
  }
  return { byKey, byName };
}

/**
 * Who an overrides entry is talking about: the key first, then the name, then
 * the alias the park renamed it from. Null if it lands on nothing at all —
 * which is a correction that silently did not happen, and is worth saying.
 */
export function resolveOverride(book, name, patch = null) {
  const term = String(name ?? '');
  const hit = (t) => book.byKey.get(t) || book.byName.get(t.toLowerCase()) || null;
  return hit(term) || (patch?.alias ? hit(String(patch.alias)) : null);
}
