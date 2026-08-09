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
  addEvidence, attractionFor, FEATURES, publishable, SCHEMA_VERSION, toGeoJson, trim, unresolved,
} from './lib/attractions.mjs';
import { candidates, needEntranceMost } from './lib/candidates.mjs';
import { PUBLISH_AT } from './lib/evidence.mjs';
import { OVERRIDE_DIR, readJson, VENUE_DIR, writeJson } from './lib/venue-io.mjs';

const USAGE = `
The ride inventory: every attraction, every way into it, and who says so.

  node scripts/attractions.mjs <venue id> [options]
  node scripts/attractions.mjs --all

  --trace <file>      fold in a traced GeoJSON from trace-venue.mjs, without
                      waiting for a rebuild to carry it in
  --report            print what the list knows, as markdown
  --geojson <file>    write every located feature as GeoJSON
  --publish-at <b>    confidence needed to reach the app
                      (unknown | low | moderate | high | very_high; default: ${PUBLISH_AT})
  --dry-run           work it out, write nothing
`;

const listFile = (id) => path.join(OVERRIDE_DIR, `${id}.attractions.json`);
const today = () => new Date().toISOString().slice(0, 10);

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
  const stamp = gj.properties?.traced || {};
  const err = stamp.error_m;
  return (gj.features || [])
    .filter((f) => f.geometry?.type === 'Point' && ['entrance', 'exit'].includes(f.properties?.kind))
    .map((f) => ({
      ride: f.properties.of,
      type: f.properties.kind === 'entrance' ? 'queue_entrance' : 'ride_exit',
      at: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] },
      source: 'traced',
      why: `traced off ${stamp.image || "the park's own map"}${err != null ? ` at \u00b1${err} m` : ''}`,
    }));
}

/** Whatever a trace off the park's own map had to say about entrances and exits. */
function fromTrace(pois) {
  const out = [];
  for (const p of pois) {
    for (const [key, type] of [['in', 'queue_entrance'], ['out', 'ride_exit']]) {
      const at = p[key];
      if (!Number.isFinite(at?.lat)) continue;
      // A traced point already carries how far out its fit was; anything the
      // tracer would not vouch for never reached the bundle in the first place.
      const err = at.src?.error_m;
      out.push({
        ride: p.n,
        type,
        at,
        source: at.src?.by === 'trace' ? 'traced' : 'official_map',
        why: `traced off ${at.src?.image || "the park's own map"}${err != null ? ` at ±${err} m` : ''}`,
      });
    }
  }
  return out;
}

/** Build or refresh one venue's inventory. */
function inventory(id, args) {
  const map = readJson(path.join(VENUE_DIR, `${id}.map.json`));
  const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
  if (!map) throw new Error(`No venue called "${id}" on disk.`);

  const asOf = today();
  const existing = readJson(listFile(id));
  const known = new Map((existing?.attractions || []).map((r) => [r.name, r]));

  const rides = pois.filter((p) => p.c === 'coaster' || p.c === 'ride');
  const records = new Map();
  for (const ride of rides) {
    /* Kept across runs, so evidence gathered in March is still on the record in
       August and can be seen to disagree with something newer. Only the ride's
       own position is refreshed from the rebuild. */
    const prior = known.get(ride.n);
    const record = prior ? { ...prior, at: { lat: ride.lat, lng: ride.lng } } : attractionFor(ride, id);
    for (const f of FEATURES) record.features[f] ||= { at: null, confidence: 'unknown', score: 0, sources: [], evidence: [] };
    records.set(ride.n, record);
  }

  const traced = args?.trace
    ? (Array.isArray(args.trace) ? args.trace : [String(args.trace)]).flatMap(fromTracedFile)
    : [];

  const claims = [
    ...fromOsmEntrances(pois),
    ...fromTrace(pois),
    ...traced,
    ...candidates(map, pois),
  ];

  let applied = 0;
  const orphans = new Set();
  for (const claim of claims) {
    const record = records.get(claim.ride);
    if (!record) {
      orphans.add(claim.ride);
      continue;
    }
    addEvidence(record, claim.type, claim, { asOf });
    applied += 1;
  }

  const all = [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { id, map, pois, records: all, applied, orphans: [...orphans], asOf };
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
  const byName = new Map();
  for (const p of pois) {
    const key = String(p.n).toLowerCase();
    if (byName.has(key)) byName.get(key).push(p);
    else byName.set(key, [p]);
  }
  for (const record of records) {
    const fields = publishable(record, floor);
    const targets = byName.get(String(record.name).toLowerCase()) || [];
    for (const t of targets) {
      for (const [key, value] of Object.entries(fields)) {
        t[key] = value;
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
    + `The rest stay proposals in \`data/venues/${id}.attractions.json\` for somebody to approve.\n`);

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
    const { records, pois, applied, orphans, asOf } = state;

    console.error(`\n${id}: ${records.length} ride(s), ${applied} claim(s) of evidence`);
    for (const orphan of orphans.slice(0, 5)) console.error(`  ? evidence for "${orphan}", which is not a ride here`);

    if (args.report) report(state, floor);

    if (args['dry-run']) {
      console.error('  Dry run — nothing written.');
      continue;
    }

    writeJson(listFile(id), {
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
    }, true);
    console.error(`  Wrote ${listFile(id).replace(process.cwd() + '/', '')}`);

    const changed = publish(id, pois, records, floor);
    if (changed) {
      writeJson(path.join(VENUE_DIR, `${id}.pois.json`), pois, true);
      console.error(`  Published ${changed} field(s) onto public/venues/${id}.pois.json`);
    } else {
      console.error('  Nothing clears the bar yet — the bundle is unchanged.');
    }

    if (args.geojson) {
      const out = String(args.geojson);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(toGeoJson(records), null, 2)}\n`);
      console.error(`  Wrote ${out}`);
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

export { fromOsmEntrances, fromTrace, inventory, publish };
