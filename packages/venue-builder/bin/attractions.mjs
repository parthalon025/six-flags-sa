#!/usr/bin/env node
/* The ride inventory: every attraction, every way into it, and who says so.
 *
 *   node scripts/attractions.mjs kings-island            # build/refresh the list
 *   node scripts/attractions.mjs kings-island --report   # what it knows, as markdown
 *   node scripts/attractions.mjs kings-island --geojson data/ki.entrances.geojson
 *   node scripts/attractions.mjs --all
 *
 * A place in the venue bundle is one point and a ride is not one point: it has a
 * queue that starts on the midway, a station, and an exit that puts you out
 * somewhere else. For getting a family across a park, the queue entrance and the
 * exit are the two coordinates that matter, and neither has ever been in the
 * bundle. This assembles them.
 *
 * What it does, in order:
 *
 *   1. Takes every ride in the built venue as the master list.
 *   2. Reads OpenStreetMap's own `entrance=*` tagging where a park has it.
 *   3. Proposes candidates from the shape of the park — a way named for its
 *      ride, a gate standing near one, where the walkable network comes closest.
 *   4. Folds in anything traced off the park's own map by trace-venue.mjs.
 *   5. Fuses the evidence per feature into a coordinate and a confidence.
 *   6. Publishes only what clears the bar, into the bundle the app reads.
 *
 * The evidence accumulates in data/venues/<id>.attractions.json, which is beside
 * the bundle rather than in it, because the bundle is overwritten by every
 * rebuild and the evidence is the expensive part.
 *
 * What this does not do, and does not pretend to: it does not look at aerial
 * imagery, run computer vision over it, watch a ride walkthrough on YouTube or
 * fetch a park's PDF. Those are real sources and each one is a project. What is
 * here is the part that can be done from data already on disk, plus the door for
 * the rest — every one of those sources has a weight in scripts/lib/evidence.mjs
 * and lands through the same `addEvidence` call the automatic ones use.
 */

import process from 'node:process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addEvidence, attractionFor, claimFromSrc, FEATURES, publishable, SCHEMA_VERSION, SRC_BY,
  toGeoJson, tracedSrc, trim, unresolved,
} from '../lib/attractions.mjs';
import { candidates, needEntranceMost } from '../lib/candidates.mjs';
import { PUBLISH_AT } from '../lib/evidence.mjs';
import { OVERRIDE_DIR, readJson, VENUE_DIR, venueSidecar } from '../lib/venue-io.mjs';
// The app's own reading of "these two strings are the same ride", so the join
// here and the builder's cannot drift apart.
import { purgeRetiredEvidence } from '../lib/retired-sources.mjs';
import { isRideable } from '@party-tracker/shared/ontology.js';
import { normaliseRideName } from '@party-tracker/shared/mapSymbols.js';
import { renderEvidenceHtml } from '../lib/venue-validate-html.mjs';
import { exportTileGeoJson } from '../lib/tiles-export.mjs';
import { collectExternalClaims } from '../lib/external-claims.mjs';

const USAGE = `
The ride inventory: every attraction, every way into it, and who says so.

  node scripts/attractions.mjs <venue id> [options]
  node scripts/attractions.mjs --all

  --trace <file>      fold in a traced GeoJSON from trace-venue.mjs, without
                      waiting for a rebuild to carry it in
  --report            print what the list knows, as markdown
  --geojson <file>    write every located feature as GeoJSON
  --html <file>       write maintainer evidence review map (Leaflet HTML)
  --tiles <dir>       export GeoJSON layers + tippecanoe.sh recipe for vector tiles
  --publish-at <b>    confidence needed to reach the app
                      (unknown | low | moderate | high | very_high; default: ${PUBLISH_AT})
  --dry-run           work it out, write nothing
`;

const listFile = (id) => venueSidecar(id, 'attractions.json');
const today = () => new Date().toISOString().slice(0, 10);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Write a file, unless what is already there is what would be written.
 *
 * This step runs inside the build now, and the build's most valuable property
 * is that a run which learns nothing changes nothing on disk. Rewriting a
 * file with its own bytes is invisible to git but not to everything else — a
 * mtime moves, a watcher fires, and the habit is how a pipeline ends up
 * touching two hundred records to record that none of them moved. The bytes
 * are exactly what `writeJson(file, value, true)` in lib/venue-io.mjs writes,
 * so the two cannot disagree about what a file looks like.
 *
 * @returns whether anything was actually written
 */
function writeSettled(file, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  let now = null;
  try {
    now = readFileSync(file, 'utf8');
  } catch {
    // Not there yet, which is a difference like any other.
  }
  if (now === next) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next);
  return true;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const next = argv[i + 1];
    if (eq !== -1) out[key] = a.slice(eq + 1);
    else if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else out[key] = true;
  }
  return out;
}

/**
 * OpenStreetMap's own entrance tagging, where a park has any.
 *
 * This is the source that would make the rest unnecessary, and at the parks here
 * it is nearly empty: Fiesta Texas carries one `entrance` tag against 53 rides.
 * It is read first anyway and outranks everything automatic, because where a
 * mapper has stood at a gate and tagged it, that is a survey.
 */
function fromOsmEntrances(pois) {
  return pois
    .filter((p) => p.c === 'gate' && p.entrance)
    .map((p) => ({
      ride: p.of || p.n,
      type: p.entrance === 'exit' ? 'ride_exit' : 'queue_entrance',
      at: { lat: p.lat, lng: p.lng },
      source: 'osm_entrance',
      why: `tagged entrance=${p.entrance} in OpenStreetMap`,
    }));
}

/**
 * A traced GeoJSON, read straight from disk.
 *
 * The same evidence reaches the inventory through the bundle once a venue has
 * been rebuilt with `--trace`, but a rebuild wants Overpass and a few minutes,
 * which is a silly price for "I traced four more entrances this evening". This
 * is the short way round, and it is the loop somebody doing the work will
 * actually be in: trace, look at what it now knows, trace some more.
 */
function fromTracedFile(file) {
  const gj = JSON.parse(readFileSync(file, 'utf8'));
  const stamp = gj.properties?.traced;
  const points = (gj.features || [])
    .filter((f) => f.geometry?.type === 'Point' && ['entrance', 'exit'].includes(f.properties?.kind));

  const out = [];
  let unsigned = 0;
  for (const f of points) {
    /* What this is worth, and how far out it was, come off the file — never
       off the fact that `--trace` was the flag typed. This used to write
       `source: 'traced'` at weight 3 onto every point in whatever GeoJSON it
       was handed, annotated "traced off the park's own map" whether or not
       anything in the file said so. A person types the flag, so it was a
       smaller lie than the one on `e`, but it is the same one: the label came
       from which tool was invoked rather than from the data. */
    const src = tracedSrc(f.properties, stamp);
    const claim = src && claimFromSrc({ n: f.properties.n, src });
    if (!claim) {
      unsigned += 1;
      continue;
    }
    out.push({
      ride: f.properties.of,
      type: f.properties.kind === 'entrance' ? 'queue_entrance' : 'ride_exit',
      at: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] },
      ...claim,
    });
  }
  if (unsigned) {
    console.error(`  ! ${unsigned} point(s) in ${file} say nothing about where they came from, `
      + 'so there is nothing to weigh them as. Re-run scripts/trace-venue.mjs to sign them.');
  }
  return out;
}

/**
 * Whatever is already sitting on a place about how it is entered and left.
 *
 * `e` is a list and `out` is one point, which is the whole reason this loop
 * normalises before it reads: for a long time it looked for `p.in`, which no
 * writer in the repository has ever produced, so every traced entrance was
 * invisible here while exits worked and nothing said otherwise.
 *
 * What a point is worth comes off the point. There used to be a fallback —
 * anything not stamped `trace` was read as `official_map`, the top of the
 * weight table — and since `publish()` stamped the *feature* name, this
 * pipeline's own published exit came back round as a park's own map at 5,
 * annotated "traced off the park's own map". A coordinate that will not say
 * where it came from is not evidence of anything, so it is skipped.
 */
function fromTrace(pois) {
  const out = [];
  for (const p of pois) {
    for (const [key, type] of [['e', 'queue_entrance'], ['out', 'ride_exit']]) {
      const held = p[key];
      for (const at of Array.isArray(held) ? held : [held]) {
        if (!Number.isFinite(at?.lat)) continue;
        const claim = claimFromSrc(at);
        if (!claim) continue;
        out.push({ ride: p.n, type, at, ...claim });
      }
    }
  }
  return out;
}

/**
 * Finding a ride again by name, when the name is the only key there is.
 *
 * Every join in this pipeline is a display string, and OpenStreetMap edits
 * display strings. This one used to be the strictest of them — an exact,
 * case-sensitive `Map.get` — so a mapper recapitalising "The BEAST" would have
 * orphaned every scrap of evidence accumulated against "The Beast" and started
 * the ride again from nothing, silently, on the next run.
 *
 * Two indexes, because one is not enough:
 *
 *   exact       the lowercased name. Unambiguous, and it is what publishing and
 *               the trace already join on, so they cannot disagree.
 *   normalised  `normaliseRideName`, the reading the *builder* joins on when it
 *               attaches an entrance — so this and `entrancesFromQueues` agree
 *               about which ride a claim is for. It survives recapitalisation,
 *               bracketed suffixes and a leading "The".
 *
 * The normalised index resolves only where it is unambiguous, and that
 * restriction is not theoretical: Kings Island ships "The Racer", "Racer (Red)"
 * and "Racer (Blue)" as three separate rides that all normalise to "racer".
 * Keying on the normalised name alone would have merged three records into one
 * and thrown two rides' evidence away — a fix that loses more than the bug.
 */
function nameIndex(rows, nameOf) {
  const exact = new Map();
  const normal = new Map();
  for (const row of rows) {
    const name = nameOf(row);
    exact.set(String(name).toLowerCase(), row);
    const key = normaliseRideName(name);
    if (!key) continue;
    // Seen twice under one normalised name: it identifies nothing on its own.
    normal.set(key, normal.has(key) ? null : row);
  }
  return (name) => exact.get(String(name).toLowerCase())
    || normal.get(normaliseRideName(name))
    || null;
}

/** Build or refresh one venue's inventory. */
function inventory(id, args, { map: mapIn, pois: poisIn, existing } = {}) {
  const map = mapIn || readJson(path.join(VENUE_DIR, `${id}.map.json`));
  const pois = poisIn || readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
  if (!map) throw new Error(`No venue called "${id}" on disk.`);

  const asOf = today();
  const onDisk = existing ?? readJson(listFile(id));
  const knownByPlace = new Map((onDisk?.attractions || []).filter((r) => r.place).map((r) => [r.place, r]));
  const known = nameIndex(onDisk?.attractions || [], (r) => r.name);

  const rides = pois.filter(isRideable);
  const records = new Map();
  for (const ride of rides) {
    const place = ride.i;
    const prior = (place && knownByPlace.get(place)) || known(ride.n);
    const record = prior
      ? { ...prior, place: place || prior.place, name: ride.n, at: { lat: ride.lat, lng: ride.lng } }
      : attractionFor(ride, id);
    if (place) record.place = place;
    if (place) record.id = place;
    purgeRetiredEvidence(record);
    for (const f of FEATURES) record.features[f] ||= { at: null, confidence: 'unknown', score: 0, sources: [], evidence: [] };
    const key = record.place || String(ride.n).toLowerCase();
    records.set(key, record);
  }
  const recordFor = (rideName) => {
    const ride = pois.find((p) => p.n === rideName || normaliseRideName(p.n) === normaliseRideName(rideName));
    if (ride?.i && records.has(ride.i)) return records.get(ride.i);
    return nameIndex(records.values(), (r) => r.name)(rideName);
  };

  const traced = args?.trace
    ? (Array.isArray(args.trace) ? args.trace : [String(args.trace)]).flatMap(fromTracedFile)
    : [];

  const claims = [
    ...fromOsmEntrances(pois),
    ...fromTrace(pois),
    ...traced,
    ...candidates(map, pois),
  ];

  const external = collectExternalClaims(id, pois);
  const externalEntrance = external.entrance || [];

  /* One source gets one say per feature, per run, and it is settled here rather
     than by letting `addEvidence` supersede the same source over and over.
     Several detectors sign their work `geometry` — a gate standing near the
     ride and the nearest point on the walkable network are both this repo
     inferring from shape — and the later of them has always won. Folding first
     is what makes the dates hold still: a claim overwritten inside the run that
     produced it was never an observation, and dating the survivor "today"
     because an intermediate stood somewhere else would re-date the whole file
     on every run for no change at all. The last claim wins, in the order the
     detectors ran, which is exactly what repeated supersession did. */
  let applied = 0;
  const orphans = new Set();
  const folded = new Map();
  for (const claim of [...claims, ...externalEntrance]) {
    const record = recordFor(claim.ride);
    if (!record) {
      orphans.add(claim.ride);
      continue;
    }
    if (!folded.has(record)) folded.set(record, new Map());
    folded.get(record).set(`${claim.type}\u0000${claim.source}`, claim);
    applied += 1;
  }
  for (const [record, perSource] of folded) {
    for (const claim of perSource.values()) addEvidence(record, claim.type, claim, { asOf });
  }

  const all = [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    id,
    map,
    pois,
    records: all,
    applied,
    orphans: [...orphans],
    asOf,
    externalStats: external.stats,
    externalMetadata: external.metadata,
  };
}

/**
 * Copy what has earned it into the bundle the app reads.
 *
 * Only the features clearing the bar, and only onto the place they belong to.
 * Everything below it stays in the inventory as a proposal, which is the whole
 * point of there being two files.
 */
function publish(id, pois, records, floor) {
  let changed = 0;
  const byPlace = new Map();
  const byName = new Map();
  for (const p of pois) {
    if (p.i) byPlace.set(p.i, p);
    const key = String(p.n).toLowerCase();
    if (byName.has(key)) byName.get(key).push(p);
    else byName.set(key, [p]);
  }
  for (const record of records) {
    const fields = publishable(record, floor);
    const targets = (record.place && byPlace.has(record.place) ? [byPlace.get(record.place)] : null)
      || byName.get(String(record.name).toLowerCase())
      || [];
    for (const t of targets) {
      for (const [key, value] of Object.entries(fields)) {
        if (key !== 'e') {
          t[key] = value;
          changed += 1;
          continue;
        }
        /* `e` is a list — a ride with a standby and a Fastlane queue has two
           ways in and both are real. The fused one goes first, since that is
           the one the app walks to, and *everything* another writer put there
           is kept beside it. Only a previous run's own entry — the one stamped
           `fused` — is replaced, which is what makes running this twice
           produce one conclusion rather than two.

           The pins that produced the fused point are kept above all. They used
           to have to stand more than 20 m away to survive, which is exactly
           backwards: a fused point sits on its heaviest source, so the
           builder's own `osm_named_queue` pin is normally a few metres from
           the conclusion it argued for, and publishing deleted it. That is the
           input to the next run's evidence — `fromTrace` reads these entries
           back — so deleting it meant the bundle could no longer re-derive
           what it was already asserting. A conclusion that eats its premises
           is not re-derivable, it is self-perpetuating.

           The test is on the `fused` stamp and not on the absence of one: once
           every writer signs its work, "unsigned" stops meaning "the
           builder's" and starts meaning nothing at all. An unsigned entry is
           still somebody's and is not this step's to delete — it is simply
           worth nothing as evidence, which `claimFromSrc` already says. */
        const kept = (t.e || []).filter((x) => x.src?.by !== SRC_BY.FUSED);
        t.e = [value, ...kept];
        changed += 1;
      }
    }
  }
  return changed;
}

function report(state, floor) {
  const { id, records, map, pois } = state;
  const say = console.log;
  const band = { very_high: '🟩', high: '🟩', moderate: '🟨', low: '🟧', unknown: '⬜' };

  say(`### ${id} — ways into ${records.length} rides\n`);

  const tally = {};
  for (const r of records) tally[r.features.queue_entrance.confidence] = (tally[r.features.queue_entrance.confidence] || 0) + 1;
  say('| Confidence in a queue entrance | Rides |');
  say('| --- | ---: |');
  for (const b of ['very_high', 'high', 'moderate', 'low', 'unknown']) {
    if (tally[b]) say(`| ${band[b]} ${b.replace('_', ' ')} | ${tally[b]} |`);
  }
  say();

  const publishing = records.filter((r) => Object.keys(publishable(r, floor)).length);
  say(`**${publishing.length}** of ${records.length} clear \`${floor}\` and reach the app. `
    + `The rest stay proposals in \`data/venues/${id}/attractions.json\` for somebody to approve.\n`);

  const conflicts = records.filter((r) => r.features.queue_entrance.conflict);
  if (conflicts.length) {
    say(`> [!WARNING]`);
    say(`> ${conflicts.length} ride(s) have sources that disagree about where the queue starts by `
      + 'more than 20 m. They are not averaged — a point between two claims is a point neither '
      + 'supports. Look at these first:');
    for (const r of conflicts.slice(0, 8)) {
      say(`> * **${r.name}** — ${r.features.queue_entrance.spread_m} m apart `
        + `(${r.features.queue_entrance.sources.join(', ')})`);
    }
    say();
  }

  /* Where an entrance is not a nicety. A ride the builder took from its track
     sits at the middle of that track — for a coaster, the top of the lift hill,
     over a fence. */
  const sprawling = needEntranceMost(map, pois).slice(0, 10);
  if (sprawling.length) {
    say('**Where the ride\'s own point is worst.** These are positioned at the middle of their own '
      + 'track, so walking "to the ride" aims at the middle of the layout rather than the queue:\n');
    say('| Ride | Track spans | Queue entrance |');
    say('| --- | ---: | --- |');
    for (const s of sprawling) {
      const r = records.find((x) => x.name === s.ride);
      const slot = r?.features.queue_entrance;
      say(`| ${s.ride} | ${s.spanM} m | ${band[slot?.confidence] || '⬜'} ${slot?.confidence || 'unknown'}`
        + `${slot?.sources?.length ? ` (${slot.sources.join(', ')})` : ''} |`);
    }
    say();
  }

  const stuck = unresolved(records, floor);
  if (stuck.length) {
    say(`> [!NOTE]`);
    say(`> ${stuck.length} ride(s) have no way in worth publishing. Geometry alone never clears the `
      + 'bar on purpose — every ride in every park can be given a plausible entrance from the path '
      + 'network, and if that were enough to publish, none of them would ever be checked.');
    say('>');
    say('> What moves one up: `entrance=*` in OpenStreetMap (+4, and it helps everybody, not just '
      + "this app), or tracing the park's own map with `npm run venues:trace` (+3, and it measures "
      + 'how far out it is before it will write anything).');
    say();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || (!args._[0] && !args.all)) {
    console.log(USAGE);
    if (!args._[0] && !args.all && !args.help && !args.h) process.exitCode = 1;
    return;
  }

  const floor = args['publish-at'] ? String(args['publish-at']) : PUBLISH_AT;
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const ids = args.all ? manifest.venues.map((v) => v.id) : [String(args._[0])];

  for (const id of ids) {
    const state = inventory(id, args);
    const { records, pois, applied, orphans, asOf, externalStats } = state;

    console.error(`\n${id}: ${records.length} ride(s), ${applied} claim(s) of evidence`);
    if (externalStats?.entranceClaims) {
      console.error(
        `  external: ${externalStats.entranceClaims} entrance claim(s)`
          + ` (ParksAPI cache ${externalStats.parksApi}, Mapillary ${externalStats.mapillary})`,
      );
    }
    for (const orphan of orphans.slice(0, 5)) console.error(`  ? evidence for "${orphan}", which is not a ride here`);

    if (args.report) report(state, floor);

    if (args['dry-run']) {
      console.error('  Dry run — nothing written.');
      continue;
    }

    const onDisk = readJson(listFile(id));
    const list = {
      version: SCHEMA_VERSION,
      _comment:
        'Every ride at this venue, every feature of it, and the evidence behind each coordinate. '
        + 'Beside the venue bundle rather than in it: the bundle is overwritten by every rebuild '
        + 'and this is the accumulated evidence, which is the expensive part. Only features that '
        + `clear "${floor}" confidence are copied into the bundle the app reads. Refresh with: `
        + `npm run venues:attractions -- ${id}`,
      venue: id,
      generated: asOf,
      publish_at: floor,
      attractions: records.map(trim),
    };
    /* `generated` is the day this file last said something different, not the
       day the script last ran. The distinction is what lets the inventory run
       inside the build at all: a nightly rebuild that learns nothing has to
       leave the tree exactly as it found it, or "does OpenStreetMap still say
       what we shipped?" stops being a question a diff can answer and every
       run opens a pull request full of new dates. `addEvidence` already keeps
       a claim's own date still for the same reason; this is that rule applied
       to the file around it. */
    if (onDisk && same({ ...onDisk, generated: null }, { ...list, generated: null })) {
      list.generated = onDisk.generated;
    }
    const short = (f) => f.replace(`${process.cwd()}/`, '');
    if (writeSettled(listFile(id), list)) console.error(`  Wrote ${short(listFile(id))}`);
    else console.error(`  ${short(listFile(id))} already says this — left alone.`);

    const changed = publish(id, pois, records, floor);
    const bundle = path.join(VENUE_DIR, `${id}.pois.json`);
    if (!changed) {
      console.error('  Nothing clears the bar yet — the bundle is unchanged.');
    } else if (writeSettled(bundle, pois)) {
      console.error(`  Published ${changed} field(s) onto ${short(bundle)}`);
    } else {
      console.error(`  ${changed} field(s) published, all of which ${short(bundle)} already carried.`);
    }

    if (args.geojson) {
      const out = String(args.geojson);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(toGeoJson(records), null, 2)}\n`);
      console.error(`  Wrote ${out}`);
    }

    if (args.html) {
      const out = String(args.html);
      const sidecar = readJson(listFile(id)) || list;
      const html = renderEvidenceHtml({
        venueId: id,
        venueName: map.meta?.name || id,
        mapMeta: map.meta || {},
        sidecar,
        geojson: toGeoJson(records),
      });
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, html);
      console.error(`  Wrote evidence review ${out}`);
    }

    if (args.tiles) {
      const outDir = path.resolve(String(args.tiles));
      const written = exportTileGeoJson(outDir, map, pois);
      console.error(`  Exported ${written.length} tile layer file(s) to ${outDir}`);
    }
  }
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }
}

export { fromOsmEntrances, fromTrace, fromTracedFile, inventory, publish, listFile, writeSettled, today };
