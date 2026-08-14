#!/usr/bin/env node
/* Build a venue bundle from OpenStreetMap.
 *
 * This is the half of the pipeline that used to be missing. The renderer was
 * always generic — it draws whatever layers it is handed — but the geometry for
 * Kings Island had been pulled by hand, so "somewhere else" meant "do that by
 * hand again". This script turns a place name, a bounding box or a point and a
 * radius into the two files the app loads, and rewrites the manifest so the app
 * offers the new venue the next time it boots.
 *
 *   node scripts/build-venue.mjs --place "Six Flags Fiesta Texas"
 *   node scripts/build-venue.mjs --bbox 39.3365,-84.2775,39.348,-84.2595 --name "Kings Island"
 *   node scripts/build-venue.mjs --around 39.3434,-84.267,900 --name "Kings Island"
 *   node scripts/build-venue.mjs --reindex
 *
 * Nothing about it is amusement-park specific. A zoo, a campus, a state fair or
 * a town centre all come out the other end as a drawn map with a POI list; the
 * layers a place has no examples of simply come back empty.
 *
 * Data is © OpenStreetMap contributors, ODbL. Ride height requirements are not
 * in OSM and never will be — those come from an overrides file, which is also
 * how a wrong name or a missing entrance gets corrected without hand-editing a
 * generated file that the next rebuild would overwrite.
 */

import process from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  areaOf,
  centroidOf,
  clipToBounds,
  distanceMetres,
  pointInRing,
  round,
  simplify,
} from '../lib/geometry.mjs';
import {
  LAYERS, LINE_LAYERS, POI_RULES, LAYER_RULES, ROUTED_LAYERS, UNNAMED_AREA_CATEGORIES, UNNAMED_LABELS,
  campDetailsFromTags, classify, isCampground, isCampPitch, isLand, isVenueOutline, wayAttributes,
} from '../lib/osm-tags.mjs';
import { OVERRIDE_DIR, gapsDocumentFor, readJson, readOverrides, reindex, serializeVenue, slugify, VENUE_DIR, writeVenue, venueSidecar } from '../lib/venue-io.mjs';
import {
  argsFromRecipe, listRecipes, readRecipe, recipeFile, recipeFrom, writeRecipe,
} from '../lib/venue-recipe.mjs';
import { briefJson, renderBrief, requests } from '../lib/venue-requests.mjs';
import {
  addressBook, assignKeys, keyAudit, osmRef, readLedger, resolveOverride, seedLedger,
  serializeLedger, writeLedger,
} from '../lib/venue-ids.mjs';
import { SRC_BY, SCHEMA_VERSION, trim } from '../lib/attractions.mjs';
import { inventory, publish, listFile, writeSettled } from './attractions.mjs';
import { PUBLISH_AT } from '../lib/evidence.mjs';
import { applyHeightsSidecar } from '../lib/heights-sidecar.mjs';
import { tagCoverageFromMap } from '../lib/tag-coverage.mjs';
import { isRideable } from '@party-tracker/shared/ontology.js';
import { scrubFalseRides } from '../lib/non-ride-names.mjs';
import { applyTrace } from '../lib/venue-trace.mjs';
import { wireSources, osmGaps, resolveCredits } from '../lib/venue-sources.mjs';
import { judgements } from '../lib/venue-judge.mjs';
import { applyImagery } from '../lib/venue-imagery.mjs';
// The app's own reading of "these two strings are the same ride", reused so the
// builder and the renderer cannot disagree about it.
import { normaliseRideName } from '@party-tracker/shared/mapSymbols.js';
import path from 'node:path';
import {
  runVenuePipeline,
  runVenueBatch,
  parseCatalogArgs,
  pipelineOptsFromCatalogArgs,
} from '../lib/build-pipeline.mjs';
import { loadCatalog, selectParks, withIds } from '../lib/top-parks-catalog.mjs';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'parkbound-venue-builder/1.0 (+https://github.com/parthalon025/six-flags-sa)';

/* ------------------------------------------------------------------ args - */

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
    const inline = eq === -1 ? null : a.slice(eq + 1);
    const next = argv[i + 1];
    let value;
    if (inline != null) value = inline;
    else if (next && !next.startsWith('--')) {
      value = next;
      i += 1;
    } else value = true;
    /* A flag given twice collects rather than overwrites, so `--merge a
       --merge b` folds in both datasets instead of quietly using the last one.
       Only on repeat: a flag given once stays the scalar every reader expects. */
    if (key in out) out[key] = [].concat(out[key], value);
    else out[key] = value;
  }
  return out;
}

const USAGE = `
Build a venue bundle from OpenStreetMap.

  --place "<name>"          resolve the place and its extent with Nominatim
  --bbox s,w,n,e            explicit bounding box in degrees
  --around lat,lng,metres   a centre point and a radius

  --center lat,lng          where the map opens (default: kept from the last
                            build, else the middle of the bounding box)

  --name "<name>"           display name       (default: the resolved place)
  --id <slug>               venue id           (default: slugified name)
  --locality "<where>"      the line under the name, e.g. "Mason, Ohio"
  --kind <kind>             theme-park | park | campus | fair | place
  --credits "<line>"        a data credit shown in the app, e.g. where heights came from
  --overrides <file>        heights and corrections (default: data/venues/<id>.overrides.json)
  --pad <metres>            grow the bounding box (default: 120)
  --tolerance <metres>      geometry simplification (default: 1.2)
  --decorativeTolerance <m> coarser simplify for grass/wood/park fills (default: max(tolerance*2.5, 3))
  --default                 make this the venue the app opens on
  --dry-run                 print what would be written, write nothing
  --dump <file>             save the raw Overpass response for inspection
  --from-dump <file>        build from a saved response instead of querying
  --keep-offsite            keep places standing in named areas outside the venue
  --reindex                 only rebuild the manifest from files already on disk
  --reapply [<id>]          re-apply the overrides file to venues already on disk,
                            without going near the network. No id: every venue.
  --allow-no-heights        build a rides venue that publishes no height rules
  --merge <file>            fold a GeoJSON or CSV dataset onto the places, matched
                            by name and then by position. Repeatable.
  --merge-metres <n>        how near a merge point has to land (default: 25)
  --sources <file>          source catalogue (default: data/venues/<id>.sources.json)
  --imagery <file>          fold in paths and places surveyed from aerial imagery.
                            Repeatable. Also wired from the source catalogue.
  --imagery-metres <n>      how near an imagery ride has to be to count as a duplicate (default: 15)
  --trace <file>            fold in what was traced off a park's own map with
                            scripts/trace-venue.mjs: ride entrances and exits,
                            walking routes, and places OSM has not got.
                            Repeatable.

Building the same venue again:

  --rebuild <id|all>        build again exactly as it was built before, from
                            data/venues/<id>.recipe.json. Any flag given
                            alongside overrides the recipe for this run — and is
                            written back, so the change sticks.
  --recipe <file>           build from a recipe file kept somewhere else
  --refresh-place           ask the geocoder again instead of reusing the box a
                            --place resolved to. Only with a recipe that has one.
  --no-recipe               do not write a recipe for this build

Asking for what OpenStreetMap does not have:

  --ask [<id>]              print a research brief for everything this venue
                            still needs from an outside source — height rules
                            most of all. No id: every venue that needs one.
                            Nothing to ask for prints nothing and exits 0.
  --json                    with --ask, the brief as data rather than markdown

Full factory pipeline (sources → geometry → research → aliases → heights →
rebuild → attractions → agent → certify):

  --pipeline                run the full pipeline for one park (requires --place)
  --catalog [id ...]        run the pipeline for catalog parks; ids filter the list
  --from <rank>             catalog rank start (with --catalog)
  --to <rank>               catalog rank end (with --catalog)
  --skip-existing           skip parks that already have a recipe (default with --catalog)
  --no-skip-existing        build even when a recipe exists
  --delay <seconds>         pause between catalog parks (default: 5)
  --retries <n>             attempts per build step (default: 3)
  --no-browser              skip Playwright for JS-rendered park sites
  --no-attractions          skip attractions inventory
  --no-agent                skip build-agent (QA, GIS, vision, validation)
  --no-certify              skip certification gate
  --no-aliases              skip auto-alias resolution
  --pr                      open a draft PR per built park (requires gh; with --catalog)
`;

/* ------------------------------------------------------------- resolving - */

async function resolvePlace(query) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&polygon_geojson=0&extratags=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Nominatim said ${res.status}. Try --bbox instead.`);
  const hits = await res.json();
  if (!hits.length) throw new Error(`Nothing called "${query}" in OpenStreetMap. Try --bbox.`);
  const hit = hits[0];
  const [south, north, west, east] = hit.boundingbox.map(Number);
  return {
    name: hit.name || query,
    display: hit.display_name,
    kind: hit.type === 'theme_park' ? 'theme-park' : hit.class === 'leisure' ? 'park' : 'place',
    bbox: { south, west, north, east },
    center: { lat: Number(hit.lat), lng: Number(hit.lon) },
  };
}

function parseLatLng(raw, flag) {
  const [lat, lng] = String(raw).split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`${flag} wants lat,lng`);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error(`${flag} is not a place on Earth`);
  return { lat, lng };
}

function padBounds(b, metres) {
  const dLat = metres / 111320;
  const midLat = (b.north + b.south) / 2;
  const dLng = metres / (111320 * Math.max(0.15, Math.cos((midLat * Math.PI) / 180)));
  return {
    north: b.north + dLat,
    south: b.south - dLat,
    east: b.east + dLng,
    west: b.west - dLng,
  };
}

const bboxArea = (b) =>
  (distanceMetres(b.south, b.west, b.north, b.west) * distanceMetres(b.south, b.west, b.south, b.east)) / 1e6;

/* -------------------------------------------------------------- overpass - */

function overpassQuery(b) {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  // One union, asking only for the tags the layer and POI rules can use. A
  // blanket nwr(bbox) is simpler and roughly ten times the download, which
  // matters on a laptop tethered to a phone in a car park.
  const wanted = [
    'building',
    'building:part',
    'highway',
    'railway',
    'natural',
    'landuse',
    'leisure',
    'waterway',
    'water',
    'amenity',
    'attraction',
    // Coaster track carries `roller_coaster=track` and nothing else — asking
    // only for `attraction` gets the station buildings and none of the ride.
    'roller_coaster',
    'sport',
    'tourism',
    'shop',
    'man_made',
    'historic',
    'barrier',
    'entrance',
    'healthcare',
    'emergency',
    'place',
    'aeroway',
  ];
  const lines = [`[out:json][timeout:180];`, '('];
  for (const key of wanted) {
    lines.push(`  way["${key}"](${box});`);
    lines.push(`  relation["${key}"](${box});`);
  }
  for (const key of wanted) lines.push(`  node["${key}"](${box});`);
  lines.push(');', 'out geom;');
  return lines.join('\n');
}

async function overpass(query, endpoints) {
  let lastError = null;
  for (const url of endpoints) {
    try {
      process.stderr.write(`  · querying ${new URL(url).host} … `);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) {
        // 429 and 504 are what a busy public mirror says; both mean "ask
        // somewhere else", not "this venue cannot be built".
        process.stderr.write(`${res.status}\n`);
        lastError = new Error(`${new URL(url).host} said ${res.status}`);
        continue;
      }
      const json = await res.json();
      process.stderr.write(`${json.elements?.length ?? 0} elements\n`);
      return json;
    } catch (err) {
      process.stderr.write('failed\n');
      lastError = err;
    }
  }
  throw new Error(`Every Overpass endpoint refused. Last: ${lastError?.message || 'unknown'}`);
}

/* ------------------------------------------------------------ conversion - */

const ringOf = (el) => (el.geometry || []).filter(Boolean).map((p) => [p.lon, p.lat]);

/**
 * A multipolygon relation arrives as a bag of member ways, and a big outline is
 * routinely split across five or six of them. Taken one at a time none of them
 * is a closed ring, so every area test fails and the venue outline vanishes —
 * which is exactly what happened the first time this ran. Stitch the members
 * back together by matching endpoints before anything else looks at them.
 */
function ringsOfRelation(el) {
  const chains = [];
  for (const m of el.members || []) {
    if (m.role === 'inner') continue; // holes are not worth the fill-rule complexity
    const chain = (m.geometry || []).filter(Boolean).map((p) => [p.lon, p.lat]);
    if (chain.length >= 2) chains.push(chain);
  }
  return stitch(chains);
}

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

function stitch(chains) {
  const pool = chains.slice();
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    let joined = true;
    while (joined && !samePoint(ring[0], ring[ring.length - 1])) {
      joined = false;
      for (let i = 0; i < pool.length; i += 1) {
        const c = pool[i];
        const end = ring[ring.length - 1];
        if (samePoint(end, c[0])) ring = ring.concat(c.slice(1));
        else if (samePoint(end, c[c.length - 1])) ring = ring.concat(c.slice(0, -1).reverse());
        else if (samePoint(ring[0], c[c.length - 1])) ring = c.slice(0, -1).concat(ring);
        else if (samePoint(ring[0], c[0])) ring = c.slice(1).reverse().concat(ring);
        else continue;
        pool.splice(i, 1);
        joined = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

const isClosed = (ring) =>
  ring.length > 3 &&
  ring[0][0] === ring[ring.length - 1][0] &&
  ring[0][1] === ring[ring.length - 1][1];

export function buildLayers(elements, opts) {
  const layers = Object.fromEntries(LAYERS.map((k) => [k, []]));
  const lands = [];
  const outlines = []; // rings that could be the venue's own boundary
  const areaCandidates = []; // closed rings that might also be a POI
  const campRings = []; // campgrounds, so the sites inside them can be found

  for (const el of elements) {
    if (el.type === 'node') continue;
    const tags = el.tags || {};
    const rings = el.type === 'relation' ? ringsOfRelation(el) : [ringOf(el)];
    for (const raw of rings) {
      if (raw.length < 2) continue;
      const closed = isClosed(raw) || el.tags?.area === 'yes';
      const layer = classify(LAYER_RULES, tags);
      // A filled shape counts only for the part of it that is here. Lines are
      // left whole: they are small, cutting one mid-span would break the route
      // graph built from it, and a closed loop of footpath is still a path
      // rather than a lake.
      const fills = closed && !LINE_LAYERS.has(layer);
      const bounded = fills ? clipToBounds(raw, opts.clip) : raw;
      if (bounded.length < 2) continue;
      const ring = round(
        simplify(bounded, fills ? opts.toleranceFor?.(layer) ?? opts.tolerance : opts.tolerance),
      );
      if (ring.length < 2) continue;

      if (isLand(tags) && closed) {
        const size = areaOf(ring);
        if (isCampground(tags)) campRings.push(ring);
        // The venue's own outline: the shape that is the place, rather than a
        // district inside it. Every ring that could be one is collected here
        // and the choice is made once, after the loop — picking by size while
        // reading is what put a census tract under Kings Island.
        const named = tags.name && tags.name.toLowerCase() === opts.venueName.toLowerCase();
        if (named || isVenueOutline(tags)) {
          outlines.push({ r: ring, n: tags.name, size, named, tagged: isVenueOutline(tags) });
          if (named) continue;
        }
        // Big enough to be a district, small enough not to be the venue itself.
        if (size > 1500 && size < opts.venueArea * 0.7) {
          lands.push({ n: tags.name, r: ring, size });
          /* A district is a tint and a label, not a row you can tap — which is
             right for a themed area and wrong for a campground. Lighthouse
             Point has an office, opening hours and a telephone number, and a
             visitor who wants any of those wants a place in the list rather
             than a word lying across the ground. So a campground is both. */
          if (isCampground(tags)) areaCandidates.push({ tags, ring, el });
          continue;
        }
        if (size >= opts.venueArea * 0.7) continue;
      }

      /* A closed way becomes a POI candidate if it is named, or if it is one of
         the few things worth having on the list without a name. This sits above
         the layer test on purpose: a toilet block mapped as an area that draws
         as nothing would otherwise be dropped here, before anything downstream
         ever saw it — which is why a park with eleven surveyed toilets shipped
         with none. */
      if (closed && (tags.name || UNNAMED_AREA_CATEGORIES.has(classify(POI_RULES, tags)))) {
        areaCandidates.push({ tags, ring, el });
      }

      if (!layer) continue;
      if (!LINE_LAYERS.has(layer) && !closed) continue;
      const size = LINE_LAYERS.has(layer) ? null : areaOf(ring);
      if (size != null && size < opts.minArea) continue;
      // Water that covers the whole box is not a pond, it is what the venue is
      // standing in — and the two have to be drawn on opposite sides of the
      // ground. The renderer paints ponds over the ground, which is right until
      // the pond is Lake Erie: Cedar Point came out as a park at the bottom of
      // it, every path and building submerged. The sea goes underneath instead,
      // and the peninsula reads as a peninsula.
      const bed = layer === 'water' && size >= opts.venueArea * 0.7 ? 'sea' : layer;
      /* Everything a walkable way says about itself that is not its shape or
         its name. Only on the two layers the router welds into the graph, and
         only when OpenStreetMap said something: a way with nothing to add is
         written exactly as it was before this existed, which is what keeps a
         rebuild that changed nothing from changing anything on disk. Keys go on
         in a fixed order for the same reason — the bundle is diffed as bytes,
         and a diff is how "does OpenStreetMap still say what we shipped?" gets
         answered. */
      const feature = { r: ring };
      if (tags.name) feature.n = tags.name;
      if (ROUTED_LAYERS.has(bed)) Object.assign(feature, wayAttributes(tags));
      layers[bed].push(feature);
    }
  }

  /* The boundary: which of the candidate rings is the park itself.
   *
   * Made once, here, with the reasons written down, because deciding it by size
   * while reading was the bug. Kings Island is mapped as a 150-point
   * `tourism=theme_park` way carrying its name — and it sits inside the census
   * area of Landen, which TIGER mapped as a named `place=locality` five times
   * the size. Biggest-wins therefore chose the census tract, drew it as the
   * park's ground, and then used it to decide which districts were "inside":
   * one place out of two hundred and nineteen was.
   *
   * So: the ring that carries this venue's name and is tagged as somewhere you
   * can visit, then the one that merely carries the name, then the largest
   * thing tagged as a venue. Size only ever breaks a tie between candidates
   * that already qualify.
   */
  const rank = (o) => (o.named && o.tagged ? 3 : o.named ? 2 : 1);
  const boundary =
    outlines.sort((a, b) => rank(b) - rank(a) || b.size - a.size)[0] || null;
  layers.park = boundary ? [{ r: boundary.r, n: boundary.n }] : [];

  // Overlapping lands are common — a park section mapped twice, or a sub-area
  // inside a bigger one. Keep the largest ring per name for the label anchor,
  // but draw all of them so the tint covers the whole district.
  /* A named area outside the venue's own outline is the retail park over the
     road, not a district of this place. It is still worth knowing about — the
     POIs standing in it are named after it, and that is how they are told apart
     from the ones inside — but it is not drawn, and it is never offered as the
     landmark a route is "via". */
  const outline = layers.park.map((p) => p.r);
  const inside = (ring) => !outline.length || outline.some((o) => pointInRing(centroidOf(ring), o));
  /* Except for the ones this venue owns but its own polygon does not cover.
   *
   * A park is routinely more than one polygon. Cedar Point's `tourism=theme_park`
   * relation is the amusement park; its water park and its campground are
   * separate rings beside it on the same peninsula, and the test above — written
   * to drop the retail park over the road — could not tell the difference. It
   * dropped Cedar Point Shores' thirty-one places, and would have dropped all
   * hundred and fifty-seven of Lighthouse Point's.
   *
   * The fix is a list rather than a cleverer test, because no test distinguishes
   * "the water park that belongs to this venue" from "the water park across the
   * road that does not". The build prints every area it dropped and how many
   * places went with it, so the list is written from what it says.
   */
  const annexed = opts.annexed || new Set();
  const drawn = lands.filter((l) => inside(l.r) || annexed.has(String(l.n).toLowerCase()));

  const anchors = {};
  for (const land of drawn.sort((a, b) => b.size - a.size)) {
    if (!anchors[land.n]) {
      const [lng, lat] = centroidOf(land.r);
      anchors[land.n] = [Number(lat.toFixed(5)), Number(lng.toFixed(5))];
    }
  }
  layers.lands = drawn.map(({ n, r }) => ({ n, r }));

  return { layers, anchors, areaCandidates, allLands: lands, boundary, campRings };
}

/**
 * A height rule OpenStreetMap already knows.
 *
 * "Height requirements are not in OpenStreetMap and never will be" is what the
 * overrides file was written to be the answer to, and it turns out to be only
 * three quarters true: `minimum_height_requirement` is a real tag and Cedar
 * Point carries it on fifty-two attractions, surveyed off the sign at the ride
 * entrance. Where it exists it is the best source there is — better than any
 * compilation, because somebody stood in front of the ride and read it — and it
 * costs nothing to take.
 *
 * So it is read here, and the overrides file is applied on top afterwards.
 * That ordering is the point: a park that tags its signs gets its Rides tab for
 * free the day it is added, and a hand-written correction still wins over a
 * stale tag.
 *
 * Formats in the wild, all of which appear at Cedar Point:
 *   "48in (122cm)"          a floor
 *   "36in  (91cm)"          the same, with a mapper's double space
 *   "36in-54in (91cm-137cm)" a floor and a ceiling
 * Only the inches are read. The centimetres in brackets are a restatement, and
 * a couple of them disagree with their own inches by a rounding error.
 */
export function heightFromTags(tags) {
  const read = (raw) => {
    if (!raw) return null;
    // Inches only, and only before the bracket: "(122cm)" contains digits too.
    const head = String(raw).split('(')[0];
    const found = [...head.matchAll(/(\d{2,3})\s*(?:in|")/gi)].map((m) => Number(m[1]));
    return found.length ? found : null;
  };
  const lo = read(tags.minimum_height_requirement);
  const hi = read(tags.maximum_height_requirement);
  if (!lo && !hi) return null;
  // A single tag written as a range — "36in-54in" — is a floor and a ceiling,
  // not two floors.
  const min = lo ? lo[0] : null;
  const max = (lo && lo.length > 1 ? lo[1] : null) ?? (hi ? hi[0] : null);
  const sane = (n) => (Number.isFinite(n) && n >= 24 && n <= 96 ? n : null);
  const h = { min: sane(min), alone: null, max: sane(max) };
  if (h.min == null && h.max == null) return null;
  return h;
}

function buildPois(elements, areaCandidates, opts) {
  const out = [];
  const push = (tags, lat, lng, el) => {
    const c = classify(POI_RULES, tags);
    if (!c) return;
    const name = tags.name || tags.operator || UNNAMED_LABELS[c];
    if (!name) return; // an unnamed bench is noise on a map you read at a glance
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const poi = { n: name, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), c };
    /* Which OpenStreetMap object this came off, as `n123` / `w123` / `r123`.
       Not identity — see scripts/lib/venue-ids.mjs for why an element id cannot
       be the primary key here — but it is the tiebreaker that lets a rebuild
       recognise a place a mapper has renamed or nudged, and it is the only
       thread back from a row in the bundle to the thing a human can go and fix.
       Carried through the build and parked in the ledger by `assignKeys`, which
       takes it off again before anything is written: no phone reads it, and
       four hundred of them is eleven kilobytes on a precached download. */
    const ref = osmRef(el);
    if (ref) poi.osm = ref;
    const h = heightFromTags(tags);
    if (h) poi.h = h;
    /* A phone number, where the place has one. Kept and nothing else from the
       contact tags: a campground office, a first-aid post and a ticket line are
       worth being one tap from dialling at eleven at night, and a website is
       worth nothing at all to somebody standing in a park with one bar. */
    const tel = tags.phone || tags['contact:phone'];
    if (tel) poi.tel = String(tel).split(';')[0].trim();
    // Hookups, pad surface, pull-through. Only where the tags say so; a venue
    // whose mapper recorded none gets them from the overrides file instead.
    const camp = c === 'campsite' ? campDetailsFromTags(tags) : null;
    if (camp) poi.camp = camp;
    out.push(poi);
  };

  for (const el of elements) {
    if (el.type !== 'node') continue;
    push(el.tags || {}, el.lat, el.lon, el);
  }
  for (const { tags, ring, el } of areaCandidates) {
    const [lng, lat] = centroidOf(ring);
    push(tags, lat, lng, el);
  }

  // A ride is routinely mapped three times: the track, the station building and
  // a node for the name. Collapse anything sharing a name and a category within
  // a stone's throw, keeping the first — nodes come first above, and a mapper
  // placing a node has usually put it at the entrance rather than the centroid.
  const kept = [];
  for (const poi of out) {
    const dupe = kept.find(
      (k) =>
        k.c === poi.c &&
        // Case-insensitively: one mapper's "Boomerang Coast to Coast" and
        // another's "Boomerang Coast To Coast" are the same ride, and shipping
        // both puts the same thing on the list twice.
        k.n.toLowerCase() === poi.n.toLowerCase() &&
        distanceMetres(k.lat, k.lng, poi.lat, poi.lng) < opts.dedupeMetres,
    );
    if (!dupe) kept.push(poi);
    // The ride is mapped twice and only one of the pair carries the sign. Keep
    // the survey rather than whichever node happened to be read first.
    else if (poi.h && !dupe.h) dupe.h = poi.h;
  }
  return kept;
}

/**
 * The individual sites inside a campground.
 *
 * They cannot come through the ordinary POI path, and that is a fact about how
 * campgrounds get mapped rather than an oversight. A pitch is a place you park
 * a caravan on, so a mapper draws it as the driveway it is: an *open* way, which
 * never reaches the closed-ring candidate list, tagged `service=parking_aisle`,
 * which the layer rules quite correctly draw as tarmac. Lighthouse Point has
 * roughly two hundred of them, each named "Site 247" — the single most useful
 * string in the whole bundle to somebody who has just come off Steel Vengeance
 * in the dark, and none of it was in the app.
 *
 * The geometric test is what keeps this honest. A named parking aisle is only
 * read as a pitch when it lies inside a ring already known to be a campground,
 * so the two hundred unnamed aisles of the main car park stay tarmac and the
 * rule cannot misfire at a venue that has no campground at all.
 *
 * Position is the middle of the pitch, which is where the caravan is.
 */
function campPitches(elements, campRings, known) {
  if (!campRings.length) return [];
  const seen = new Set(known.map((p) => p.n.toLowerCase()));
  const out = [];
  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.name || !isCampPitch(tags)) continue;
    if (isCampground(tags)) continue; // the ground itself, already a district
    const ring = el.type === 'relation' ? ringsOfRelation(el)[0] : ringOf(el);
    if (!ring?.length) continue;
    const [lng, lat] = ring.length > 2 ? centroidOf(ring) : ring[Math.floor(ring.length / 2)];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!campRings.some((r) => pointInRing([lng, lat], r))) continue;
    const key = tags.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const pitch = { n: tags.name, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), c: 'campsite' };
    const ref = osmRef(el);
    if (ref) pitch.osm = ref;
    const camp = campDetailsFromTags(tags);
    if (camp) pitch.camp = camp;
    out.push(pitch);
  }
  return out;
}

/**
 * A ride whose only trace is its track.
 *
 * Coaster track is a line, so it never reaches the area-candidate path, and a
 * mapper who has drawn and named the track does not always add a node for the
 * ride. That leaves a named piece of track lit up on the map with nothing in the
 * list to tap — so the track supplies the ride, positioned at its own midpoint.
 * The position is surveyed geometry rather than a guess; it is simply the middle
 * of the ride instead of its entrance.
 *
 * Water slides are the same shape of problem and were not covered, which only
 * showed up at a park that is nothing but slides: Big Kahuna's is mapped as
 * twenty-five `attraction=water_slide` flumes, fourteen of them named, and the
 * bundle came out with one ride in it — the wave pool, which is a pool and
 * therefore an area. Every named slide was drawn on the map and absent from the
 * list, so the Rides tab, the height slider and the whole reason the app exists
 * at a water park had nothing to work with.
 *
 * @param sources  `{ track, category }` pairs, most specific first. One shared
 *                 set of names across all of them, so a ride mapped as both a
 *                 coaster and a flume is added once, as the first thing it
 *                 matched, rather than twice.
 */
export function poisFromTrack(pois, sources) {
  const known = new Set(pois.map((p) => p.n.toLowerCase()));
  const added = [];
  for (const { track, category } of sources) {
    for (const piece of track) {
      const name = piece.n;
      if (!name || known.has(name.toLowerCase())) continue;
      const ring = piece.r;
      if (!ring?.length) continue;
      const [lng, lat] = ring[Math.floor(ring.length / 2)];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      known.add(name.toLowerCase());
      added.push({ n: name, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), c: category });
    }
  }
  return added;
}

/* A queue's name, minus the words that make it a queue. "Millennium Force
   Standby Queue" is a fact about Millennium Force. */
const QUEUE_SUFFIX = /\s*\b(fastlane|fast lane|standby|stand by|extended|single rider)?\s*\b(queue|line)\b\s*$/i;

/**
 * Where you join the queue.
 *
 * A ride's marker is where the ride is — a footprint, a track midpoint, the
 * centroid of an area — and at a big coaster that is not within sight of where
 * you start queuing. Cedar Point's markers sit 96 to 148 metres from the back
 * of the line at Millennium Force, Top Thrill 2 and Steel Vengeance, which is
 * the wrong side of the ride to be sent to.
 *
 * OpenStreetMap has no ride-entrance tag and its gates cannot supply one: they
 * are unnamed, a queue gate and a fence gate are both `barrier=gate`, and
 * picking the nearest ride to a gate lands on the wrong ride about one time in
 * five. So none of that is used here. What is used is the two things a mapper
 * did write down:
 *
 *   the name   "Millennium Force Standby Queue" says whose queue it is. That is
 *              attribution, not inference — nothing is being guessed at.
 *   `oneway`   a queue runs one way, towards the ride. Chain the ways of one
 *              queue together and the vertex that is never any way's end is
 *              where the queue begins. That is the entrance.
 *
 * Nothing is derived without both. A queue with no `oneway` (Cedar Point's
 * Maverick) and a queue naming a ride this bundle does not have are both
 * reported and skipped rather than approximated.
 *
 * Exits are not attempted, and cannot be: four parks between them contain two
 * objects naming an exit, both of them called "Attraction Exit", neither saying
 * which attraction.
 */
export function entrancesFromQueues(pois, elements) {
  const rides = pois.filter(isRideable);
  const byName = new Map();
  for (const r of rides) {
    for (const key of [r.n, r.alias].filter(Boolean)) {
      const k = normaliseRideName(key);
      if (k && !byName.has(k)) byName.set(k, r);
    }
  }

  const groups = new Map();
  for (const el of elements) {
    if (el.type !== 'way') continue;
    const name = el.tags?.name;
    if (!name || !QUEUE_SUFFIX.test(name)) continue;
    const ride = name.replace(QUEUE_SUFFIX, '').trim();
    if (!ride) continue;
    if (!groups.has(ride)) groups.set(ride, []);
    groups.get(ride).push(el);
  }

  const at = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const out = { attached: 0, rides: 0, unmatched: [], noDirection: [] };

  for (const [ride, ways] of groups) {
    const poi = byName.get(normaliseRideName(ride));
    if (!poi) {
      out.unmatched.push(ride);
      continue;
    }
    /* Only the ways that say which way they run. `oneway=-1` is drawn the other
       way round, so its last vertex is its first. */
    const starts = new Map();
    const ends = new Set();
    for (const w of ways) {
      const dir = w.tags.oneway;
      if (dir !== 'yes' && dir !== '-1') continue;
      const g = (w.geometry || []).filter(Boolean);
      if (g.length < 2) continue;
      const [head, tail] = dir === '-1' ? [g[g.length - 1], g[0]] : [g[0], g[g.length - 1]];
      starts.set(at(head), { p: head, n: w.tags.name, osm: osmRef(w) });
      ends.add(at(tail));
    }
    const sources = [...starts.entries()].filter(([k]) => !ends.has(k)).map(([, v]) => v);
    if (!sources.length) {
      out.noDirection.push(ride);
      continue;
    }

    /* A ride with a standby queue and a Fastlane queue has two ways in, and
       they are worth keeping apart — unless they start side by side, which at
       Top Thrill 2 and Snake River Falls they do, a metre and a half apart. One
       pin then, carrying both names. */
    const kept = [];
    for (const s of sources) {
      const near = kept.find((k) => distanceMetres(k.lat, k.lng, s.p.lat, s.p.lon) < 8);
      if (near) {
        if (!near.n.includes(s.n)) near.n = `${near.n} / ${s.n}`;
        continue;
      }
      /* Signed with the kind of source it is, in the one vocabulary every
         writer of a coordinate on a place uses. Three writers hang points on
         `e` — this, the tracer, and the inventory's own publish step — and a
         reader that cannot tell them apart weighs a guess as a survey.
         The queue way's own element id rides along: an entrance derived from a
         way is a claim *about that way*, and two detectors that read the same
         way are one source however they are labelled. This is the field that
         lets a dedupe say so. */
      kept.push({
        lat: Number(s.p.lat.toFixed(6)),
        lng: Number(s.p.lon.toFixed(6)),
        n: s.n,
        src: { by: SRC_BY.NAMED_QUEUE, ...(s.osm ? { osm: s.osm } : {}) },
      });
    }
    poi.e = kept;
    out.attached += kept.length;
    out.rides += 1;
  }
  return out;
}

/**
 * Every POI gets the district it stands in, which is what the header line reads
 * out. Matching runs against every named area found, including the ones outside
 * the venue — that is the point. A POI that lands in one of those is standing in
 * the shopping centre next door rather than in this park, and saying so is how
 * it gets told apart from a POI the outline simply does not cover.
 *
 * Returns the ones that did, so the caller can decide what to do with them.
 */
function assignLands(pois, lands, venueName, drawnNames) {
  const ordered = lands
    .map((l) => ({ n: l.n, r: l.r, size: areaOf(l.r) }))
    .sort((a, b) => a.size - b.size); // smallest first: the most specific district wins
  const offsite = [];
  for (const poi of pois) {
    const hit = ordered.find((l) => pointInRing([poi.lng, poi.lat], l.r));
    poi.a = hit?.n || venueName;
    if (hit && drawnNames && !drawnNames.has(hit.n)) offsite.push(poi);
  }
  return offsite;
}

/**
 * Heights, corrections and hand-added places.
 *
 * OSM will never carry "48 inches to ride alone", and a generated file cannot
 * be hand-edited without the next rebuild eating the edit — so both live here,
 * and are re-applied on every build.
 *
 * Filed under the display name, and staying that way. Converting the hundred
 * and ninety-six hand-written entries in these files to slugs would be a
 * downgrade: they are read and edited against a park's published height chart,
 * where `"BATMAN The Ride"` is checkable against the sign and `batman-the-ride`
 * is not. So the name is an alias layer over the primary key rather than a
 * rival to it — `resolveOverride` tries the key first and the name second, and
 * a key is the escape hatch for the entries a name cannot address: one of Cedar
 * Point's twenty-six "Restrooms", or one of five gates all called "Entrance".
 * Same rule for `drop`, where a name has always dropped all five of them.
 */
function applyOverrides(pois, overrides) {
  if (!overrides) return { pois, applied: 0, unmatched: [] };
  /* Every POI under a name, not the last one wearing it. OpenStreetMap
     routinely carries a ride as two nodes — a way and a point, an entrance and
     the ride itself — and Fiesta Texas ships two Poltergeists and two Gully
     Washers for exactly that reason. Patching one of each put a height rule on
     one marker and left its twin saying "check at the ride", which reads as the
     app disagreeing with itself about the same ride. */
  const book = addressBook(pois);
  const lookup = (name, patch = null) => resolveOverride(book, name, patch);
  let applied = 0;
  const unmatched = [];

  for (const [name, patch] of Object.entries(overrides.pois || {})) {
    // Parks rename rides faster than OSM follows, so an override may be filed
    // under the name on the sign while the map still carries the old one. The
    // alias is what bridges the two, in whichever direction the drift went.
    const targets = lookup(name, patch);
    if (!targets) {
      unmatched.push(name);
      continue;
    }
    for (const target of targets) Object.assign(target, patch);
    applied += 1;
  }

  const dropped = new Set();
  for (const name of overrides.drop || []) {
    for (const hit of lookup(name) || []) dropped.add(hit);
  }
  let next = pois.filter((p) => !dropped.has(p));

  for (const extra of overrides.add || []) {
    const existing = lookup(extra.i || extra.n);
    if (existing) existing.forEach((p) => Object.assign(p, extra));
    else next.push({ ...extra });
  }

  /* Height-chart headers and arcades must not ship as Rideable — drop or
     reclassify after hand overrides so a missing drop entry cannot regress. */
  const scrubbed = scrubFalseRides(next);
  return { pois: scrubbed.pois, applied, unmatched, scrubbed };
}

/**
 * Whether this venue owes the app height rules, and whether it has any.
 *
 * A venue with rides and no heights is not a venue without height rules — it is
 * a venue whose overrides file nobody wrote. The difference matters because the
 * app cannot tell them apart: `hasHeights` comes back false either way, and the
 * whole Rides tab, the slider, the running tally, the filter badge over the map
 * and the struck-through markers all quietly do not exist. Two of the three
 * parks shipped that way for a while, which is how we learned to check.
 */
export function heightAudit(pois) {
  const rides = pois.filter(isRideable);
  const withHeights = rides.filter((p) => p.h);
  return {
    rides: rides.length,
    heights: withHeights.length,
    missing: rides.filter((p) => !p.h).map((p) => p.n),
    owed: rides.length > 0,
  };
}

/**
 * Re-apply the overrides files to venues already on disk.
 *
 * A full build wants Overpass, Nominatim and a couple of minutes, which is a
 * silly price for "somebody corrected a height". The geometry is not what
 * changed — the hand-written half is — so this reads the venue bundle back,
 * runs it through {@link applyOverrides} again and writes it out. The rebuild
 * path and this one share that function, so a height fixed here survives the
 * next real rebuild and vice versa.
 *
 * @param only    a single venue id, or null for every venue on disk
 * @param strict  refuse to leave a venue with rides and no height rules
 */
function reapply(only, { strict = true } = {}) {
  const ids = readdirSync(VENUE_DIR)
    .filter((f) => f.endsWith('.pois.json'))
    .map((f) => f.slice(0, -'.pois.json'.length))
    .filter((id) => !only || id === only)
    .sort();
  if (!ids.length) throw new Error(only ? `No venue called "${only}" on disk.` : 'No venues on disk.');

  const shortfalls = [];
  for (const id of ids) {
    const poisFile = path.join(VENUE_DIR, `${id}.pois.json`);
    const mapFile = path.join(VENUE_DIR, `${id}.map.json`);
    const built = readJson(mapFile);
    const { file: overrideFile, data: overrides } = readOverrides(id, null);
    if (!overrides) {
      console.error(`· ${id}: no overrides file — left alone`);
      continue;
    }

    const onDisk = readJson(poisFile, []);
    /* The migration, and it costs nothing and touches no network: a venue built
       before keys existed has its ledger seeded from the bundle already on
       disk, under the *old* numbering. That reproduces, by definition, exactly
       the ids the phones out there are already using — so the ledger is born
       agreeing with production and no live ride report moves. */
    let ledger = readLedger(id);
    if (!ledger) {
      ledger = seedLedger(id, onDisk);
      console.error(`  · ${id}: no key ledger — seeded ${Object.keys(ledger.keys).length} from the bundle on disk`);
    }
    const merged = applyOverrides(assignKeys(onDisk, ledger, { venue: id, keepOsm: true }).pois, overrides);
    const keyed = assignKeys(merged.pois.sort((a, b) => a.n.localeCompare(b.n)), ledger, { venue: id });
    const pois = keyed.pois;
    const keyCheck = keyAudit(pois);
    if (keyCheck.duplicates.length) {
      throw new Error(
        `${id}: ${keyCheck.duplicates.length} duplicate primary key(s) — ` +
          keyCheck.duplicates.map((d) => `"${d.key}" on ${d.names.join(' and ')}`).join('; ') +
          '. A key addresses one place.',
      );
    }
    if (!readLedger(id) || serializeLedger(readLedger(id)) !== serializeLedger(keyed.ledger)) {
      writeLedger(id, keyed.ledger);
    }
    const narrowed = applyCamping(pois, overrides.camping);
    const { meta, ...map } = built || {};
    // The credit line belongs with the data it credits, so the overrides file
    // is allowed to carry it rather than it living only in a build flag
    // somebody typed once.
    let next = overrides.credits ? { ...meta, credits: overrides.credits } : meta;
    // The camping block is data about the venue, so re-applying the overrides
    // has to move it too — otherwise correcting a hookup would need a full
    // rebuild, which is the thing this mode exists to avoid.
    if (overrides.camping?.defaults) next = { ...next, camping: overrides.camping.defaults };
    const tints = landTints(overrides);
    if (tints) next = { ...next, lands: tints };
    writeVenue({ meta: next, map, pois });

    const audit = heightAudit(pois);
    console.error(
      `· ${id}: ${merged.applied} override(s) applied, ${audit.heights} of ${audit.rides} rides carry a height rule` +
        (narrowed ? `, ${narrowed} pitch(es) narrowed` : '') +
        (merged.unmatched.length ? `, ${merged.unmatched.length} unmatched` : ''),
    );
    for (const miss of merged.unmatched) console.error(`    ? no POI named "${miss}"`);
    if (audit.owed && !audit.heights) shortfalls.push(id);
  }

  const manifest = reindex();
  console.log(`Manifest rebuilt: ${manifest.venues.length} venue(s), default "${manifest.default}".`);
  if (strict && shortfalls.length) {
    throw new Error(
      `${shortfalls.join(', ')} still publish no height rules. Write data/venues/<id>.overrides.json, ` +
        'or pass --allow-no-heights if the venue genuinely has none.',
    );
  }
}

/**
 * Facts that are true of a whole campground, and rules that narrow them.
 *
 * A campground publishes "every site is full hookup, 30/50 amp, concrete pad".
 * That is one fact about the place, not a hundred and forty-five facts about
 * pitches, and writing it out per pitch would be both a lie about where it came
 * from and forty kilobytes. So it lives on the venue — `meta.camping` — and the
 * app reads a pitch's own details *over* it. A pitch that OpenStreetMap has
 * tagged, or that an imported dataset knows something specific about, overrules
 * the venue for exactly the fields it knows and inherits the rest.
 *
 * `rules` narrows by name, for the case a campground does publish per-row
 * detail: `{ "match": "^Site 5", "set": { "drive": "pull-through" } }`.
 * Nothing venue-specific here — this reads whatever the overrides file says.
 */
export function applyCamping(pois, camping) {
  if (!camping) return 0;
  const rules = (camping.rules || [])
    .map((r) => {
      try {
        return { re: new RegExp(r.match, 'i'), set: r.set || {} };
      } catch {
        console.error(`    ? "${r.match}" is not a pattern — rule skipped`);
        return null;
      }
    })
    .filter(Boolean);
  if (!rules.length) return 0;
  let touched = 0;
  for (const p of pois) {
    if (p.c !== 'campsite') continue;
    for (const rule of rules) {
      if (!rule.re.test(p.n)) continue;
      p.camp = { ...(p.camp || {}), ...rule.set };
      touched += 1;
    }
  }
  return touched;
}

/**
 * Merge an outside dataset onto the places, by position.
 *
 * The reusable answer to "OpenStreetMap does not know this and the park does".
 * Hand it a GeoJSON FeatureCollection or a CSV with lat/lng columns and every
 * feature is matched to the nearest existing place within `--merge-metres`,
 * then has its properties folded in. Nothing about it is campground-specific:
 * it is how any surveyed layer — pitch hookups, locker banks, a fresh set of
 * height signs — reaches a venue that was built from OSM alone.
 *
 * Matching is by name first and position second, because a name is exact and a
 * centroid is not: a feature carrying `name` or `ref` that matches a place is
 * merged onto it wherever it sits, and everything else falls back to the
 * nearest place inside the radius. Anything that matches nothing is reported
 * rather than added, because a point that landed nowhere near a place is far
 * more likely to be the wrong projection than a new place.
 */
export function mergeDataset(pois, features, { metres = 25 } = {}) {
  const byName = new Map();
  for (const p of pois) {
    for (const key of [p.n, p.ref].filter(Boolean)) {
      const k = String(key).toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(p);
    }
  }
  let merged = 0;
  const unmatched = [];
  for (const f of features) {
    const props = { ...(f.properties || {}) };
    const name = props.name ?? props.ref ?? props.site ?? null;
    let targets = name ? byName.get(String(name).toLowerCase()) : null;
    if (!targets && Number.isFinite(f.lat) && Number.isFinite(f.lng)) {
      let best = null;
      for (const p of pois) {
        const d = distanceMetres(f.lat, f.lng, p.lat, p.lng);
        if (!best || d < best.d) best = { p, d };
      }
      if (best && best.d <= metres) targets = [best.p];
    }
    if (!targets?.length) {
      unmatched.push(name || `${f.lat},${f.lng}`);
      continue;
    }
    // `name` is the key, not payload — merging it back would rename a place to
    // the string it was found by, which is at best a no-op and at worst a typo.
    delete props.name;
    delete props.site;
    for (const t of targets) {
      const { camp, ...rest } = props;
      Object.assign(t, rest);
      if (camp && typeof camp === 'object') t.camp = { ...(t.camp || {}), ...camp };
    }
    merged += 1;
  }
  return { merged, unmatched };
}

/**
 * Read a merge file. GeoJSON or CSV, because those are the two things a park's
 * own data actually turns up as.
 *
 * CSV wants a header row and a pair of coordinate columns under any of the
 * usual names; every other column becomes a property, and a `camp.` prefix
 * nests one — `camp.hookup` sets `camp: { hookup }`, which is what makes a
 * spreadsheet of pitch hookups a one-line import.
 */
export function readDataset(file) {
  const raw = readFileSync(file, 'utf8');
  if (raw.trim().startsWith('{')) {
    const gj = JSON.parse(raw);
    const feats = gj.type === 'FeatureCollection' ? gj.features || [] : [gj];
    return feats.map((f) => {
      const g = f.geometry || {};
      /* A line is merged at its midpoint. Anything drawn rather than pinned —
         a queue, a path, the length of a slide — has no single position, and
         the middle of it is the one place that is on it. Before this a
         LineString came back as NaN, matched nothing, and was reported as "that
         landed nowhere near a place", which is a confusing thing to be told
         about a line that is drawn straight through one. */
      const c = g.type === 'Point'
        ? g.coordinates
        : g.type === 'LineString' && g.coordinates?.length
          ? g.coordinates[Math.floor(g.coordinates.length / 2)]
          : null;
      return { lat: c ? Number(c[1]) : NaN, lng: c ? Number(c[0]) : NaN, properties: f.properties || {} };
    });
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsv(lines[0]).map((h) => h.trim());
  const latAt = head.findIndex((h) => /^(lat|latitude|y)$/i.test(h));
  const lngAt = head.findIndex((h) => /^(lng|lon|long|longitude|x)$/i.test(h));
  return lines.slice(1).map((line) => {
    const cells = splitCsv(line);
    const properties = {};
    head.forEach((key, i) => {
      if (i === latAt || i === lngAt) return;
      const value = (cells[i] ?? '').trim();
      if (value === '') return;
      const typed = value === 'true' ? true : value === 'false' ? false
        : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
      if (key.includes('.')) {
        const [outer, inner] = key.split('.');
        properties[outer] = { ...(properties[outer] || {}), [inner]: typed };
      } else {
        properties[key] = typed;
      }
    });
    return {
      lat: latAt === -1 ? NaN : Number(cells[latAt]),
      lng: lngAt === -1 ? NaN : Number(cells[lngAt]),
      properties,
    };
  });
}

/** Enough CSV to read a file somebody exported from a spreadsheet. */
function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The hand-picked district tints out of an overrides file, minus its notes. */
function landTints(overrides) {
  const lands = overrides?.lands;
  if (!lands) return null;
  const out = {};
  for (const theme of ['night', 'day']) {
    if (lands[theme] && Object.keys(lands[theme]).length) out[theme] = lands[theme];
  }
  return Object.keys(out).length ? out : null;
}

/* --------------------------------------------------------------- rebuild - */

/**
 * Build a venue again, the way it was built the first time.
 *
 * The recipe supplies the arguments and anything typed alongside overrides it,
 * because the two reasons to reach for this are "the tag rules improved, run it
 * again unchanged" and "run it again, but tighter" — and the second one has to
 * stick, or the next rebuild undoes it. So the merged arguments are what gets
 * written back.
 *
 * `--rebuild all` is the one that pays for the file existing: a rule that gains
 * a park eighteen water rides is worth nothing until every park already on disk
 * has been through it, and that used to mean reconstructing four command lines
 * out of four merged pull requests.
 */
async function rebuild(args) {
  /* Everything typed comes through, including the flags that shape the run
     rather than the result — `--dry-run` most of all, which is the flag most
     likely to be reached for here and the one it would be worst to swallow.
     Nothing has to be filtered out to keep it out of the recipe: `recipeFrom`
     writes down the shaping flags and only those, so the separation is a
     property of the writer rather than a list to keep in step here. */
  const typed = { ...args };
  delete typed.rebuild;
  delete typed.recipe;

  let ids;
  if (args.recipe) ids = [String(args.recipe)];
  else if (args.rebuild === true || args.rebuild === 'all') {
    ids = listRecipes();
    if (!ids.length) {
      throw new Error(
        'No venue on disk knows how it was built. A recipe is written by every build from now on; '
          + 'for a venue built before that, write data/venues/<id>.recipe.json by hand — '
          + 'or build it once more and it will write its own.',
      );
    }
  } else ids = [String(args.rebuild)];

  const failures = [];
  for (const [i, ref] of ids.entries()) {
    const { file, data } = readRecipe(ref);
    if (!data) {
      throw new Error(
        `No recipe at ${recipeFile(ref).replace(process.cwd() + '/', '')}. `
          + `Build "${ref}" once with the flags it needs and it will write one.`,
      );
    }
    if (ids.length > 1) console.error(`\n[${i + 1}/${ids.length}] ${data.id} — ${file.replace(process.cwd() + '/', '')}`);
    /* A place-built venue replays its resolved box rather than the name, so a
       geocoder that changed its mind cannot move a park under a rebuild that
       was asked to reproduce one. --refresh-place is how to ask for the new
       answer deliberately. */
    const fromRecipe = argsFromRecipe(data);
    if (args['refresh-place'] && data.place?.query) {
      delete fromRecipe.bbox;
      fromRecipe.place = data.place.query;
    }
    try {
      await buildOne({ ...fromRecipe, ...typed }, { previous: data });
    } catch (err) {
      // One park's rules changing under it should not stop the other three from
      // being rebuilt. What failed is said again at the end so it cannot scroll
      // past in a run of a dozen.
      if (ids.length === 1) throw err;
      console.error(`  ! ${data.id} failed: ${err.message}`);
      failures.push(data.id);
    }
  }

  if (failures.length) {
    throw new Error(`${failures.length} of ${ids.length} did not rebuild: ${failures.join(', ')}.`);
  }
}

/* ------------------------------------------------------------------- ask - */

/**
 * What a venue still needs that no build can produce, as a brief.
 *
 * Reads what is on disk — this asks nothing of the network, because everything
 * it has to say is already in the bundle: which rides carry no rule, which
 * override landed on nothing, whether anything credits the data that is not
 * OpenStreetMap's. A venue with none of those problems prints nothing, which is
 * the property that makes it safe to run at the end of every build.
 */
function ask(args) {
  const only = typeof args.ask === 'string' ? args.ask : null;
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const venues = manifest.venues.filter((v) => !only || v.id === only);
  if (!venues.length) {
    throw new Error(only ? `No venue called "${only}" in the manifest.` : 'No venues on disk.');
  }

  const briefs = [];
  for (const venue of venues) {
    const map = readJson(path.join(VENUE_DIR, `${venue.id}.map.json`), {});
    const pois = readJson(path.join(VENUE_DIR, `${venue.id}.pois.json`), []);
    const { data: overrides } = readOverrides(venue.id, null);
    const reqs = requests({ venue, map, pois, overrides });
    if (reqs.length) briefs.push({ venue, reqs });
  }

  if (args.json) {
    console.log(JSON.stringify(briefs.map(({ venue, reqs }) => briefJson(venue, reqs)), null, 2));
    return briefs.length;
  }
  if (!briefs.length) {
    console.error(
      only
        ? `${only} needs nothing that OpenStreetMap does not already have.`
        : 'No venue needs anything that OpenStreetMap does not already have.',
    );
    return 0;
  }
  console.log(briefs.map(({ venue, reqs }) => renderBrief(venue, reqs)).join('\n---\n\n'));
  return briefs.length;
}

/**
 * The drawn half of a bundle.
 *
 * The boundary is called out separately from the ground it fills. They are the
 * same ring, but they answer different questions — one is "what colour is the
 * floor here", the other is "am I still in the park" — and only the second one
 * is worth a line on the map.
 */
const mapOf = (layers, anchors, boundary) => ({
  ...layers,
  landAnchors: anchors,
  boundary: boundary?.r || null,
});

/**
 * Whether this build would change the venue already on disk, and where.
 *
 * Compared as the bytes that ship rather than as parsed objects, because the
 * file is what the browser fetches and the service worker caches. `generated`
 * is normalised to the date already on disk first: otherwise every rebuild
 * differs, and a check that always says "changed" answers nothing.
 */
function driftFrom({ id, meta, map, pois, existingMeta }) {
  const read = (file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
  const before = {
    map: read(path.join(VENUE_DIR, `${id}.map.json`)),
    pois: read(path.join(VENUE_DIR, `${id}.pois.json`)),
    gaps: read(path.join(VENUE_DIR, `${id}.gaps.json`)),
  };
  if (before.map == null || before.pois == null) {
    return { existed: false, changed: true, mapChanged: true, poisChanged: true, gapsChanged: true };
  }
  const nextMeta = existingMeta?.generated ? { ...meta, generated: existingMeta.generated } : meta;
  const candidate = serializeVenue({
    meta: nextMeta,
    map,
    pois,
    gaps: gapsDocumentFor({ meta: nextMeta, pois, map }),
  });
  const mapChanged = candidate.map !== before.map;
  const poisChanged = candidate.pois !== before.pois;
  const gapsChanged = candidate.gaps !== (before.gaps ?? '');
  return {
    existed: true,
    changed: mapChanged || poisChanged || gapsChanged,
    mapChanged,
    poisChanged,
    gapsChanged,
  };
}

async function runCatalogBatch(argv) {
  const args = parseCatalogArgs(argv);
  const catalog = loadCatalog();
  const parks = selectParks(catalog.parks, {
    skipExisting: args.skipExisting,
    from: args.from ?? undefined,
    to: args.to ?? undefined,
    only: args._.length ? args._ : undefined,
  });

  if (!parks.length) {
    console.error('Nothing to build — every selected park already has a recipe, or the filter matched nothing.');
    process.exit(0);
  }

  const mode = args.allowNoHeights ? 'geometry only' : 'full pipeline';
  console.error(`Building ${parks.length} of ${catalog.parks.length} catalog parks (${mode})…`);

  const summary = await runVenueBatch(parks, {
    ...pipelineOptsFromCatalogArgs(args),
    batchDelay: args.delay,
    openPr: args.openPr,
    catalogSize: catalog.parks.length,
  });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `\n==== ${summary.built} built, ${summary.uncertified} uncertified, `
        + `${summary.failed} failed, ${summary.skippedExisting} skipped (already on disk) ====`,
    );
    for (const row of summary.results.filter((r) => r.status === 'uncertified' || r.status === 'failed')) {
      console.log(`  ${row.id}: ${row.error || row.status}`);
    }
  }

  process.exit(summary.ok ? 0 : 1);
}

async function runSinglePipeline(argv) {
  const catalogArgs = parseCatalogArgs(argv);
  const args = parseArgs(argv);
  if (!args.place) throw new Error('--pipeline requires --place');
  const catalog = loadCatalog();
  const id = args.id || slugify(String(args.name || args.place));
  const fromCatalog = withIds(catalog.parks).find((p) => p.id === id);
  const park = fromCatalog || {
    id,
    name: args.name || id,
    place: args.place,
    locality: args.locality || '',
    kind: args.kind || 'theme-park',
  };
  const result = await runVenuePipeline(park, pipelineOptsFromCatalogArgs(catalogArgs));
  process.exit(result.status === 'built' || result.status === 'dry-run' ? 0 : 1);
}

/* ------------------------------------------------------------------ main - */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--catalog')) {
    await runCatalogBatch(argv);
    return;
  }

  if (argv.includes('--pipeline')) {
    await runSinglePipeline(argv);
    return;
  }

  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log(USAGE);
    return;
  }

  if (args.reindex) {
    const manifest = reindex({ preferredDefault: typeof args.default === 'string' ? args.default : undefined });
    console.log(`Manifest rebuilt: ${manifest.venues.length} venue(s), default "${manifest.default}".`);
    return;
  }

  if (args.reapply) {
    reapply(typeof args.reapply === 'string' ? args.reapply : null, { strict: !args['allow-no-heights'] });
    return;
  }

  if (args.ask) {
    ask(args);
    return;
  }

  if (args.rebuild || args.recipe) {
    await rebuild(args);
    return;
  }

  await buildOne(args);
}

/**
 * One venue, from a bounding box to the files the app loads.
 *
 * Takes its arguments rather than reading them, so that `--rebuild` can hand it
 * a recipe and get the identical build — the replay path and the first build
 * are the same code, which is the only arrangement where "it was built this
 * way" stays true.
 *
 * @param previous the recipe this build is a replay of, where there is one
 */
async function buildOne(args, { previous = null } = {}) {
  let place = null;
  let bounds = null;

  if (args.place) {
    process.stderr.write(`Resolving "${args.place}" … `);
    place = await resolvePlace(String(args.place));
    process.stderr.write(`${place.display}\n`);
    bounds = place.bbox;
  } else if (args.bbox) {
    const [south, west, north, east] = String(args.bbox).split(',').map(Number);
    if ([south, west, north, east].some((n) => !Number.isFinite(n))) throw new Error('--bbox wants s,w,n,e');
    bounds = { south, west, north, east };
  } else if (args.around) {
    const [lat, lng, metres] = String(args.around).split(',').map(Number);
    if ([lat, lng, metres].some((n) => !Number.isFinite(n))) throw new Error('--around wants lat,lng,metres');
    bounds = padBounds({ north: lat, south: lat, east: lng, west: lng }, metres);
  } else {
    console.log(USAGE);
    throw new Error('Give it a --place, a --bbox or an --around.');
  }

  /* The box as it stood before the pad, which is the one worth writing down: it
     is the same field whether the venue was asked for by name, by box or by a
     point and a radius, and padding it again reproduces the bounds exactly. The
     padded bounds — the ones that reach the manifest — cannot do that job,
     because there is no pad you can pass with them that gives back the build.
     Kings Island was built with a pad of 0 and Cedar Point was not. */
  const box = { ...bounds };
  bounds = padBounds(bounds, Number(args.pad ?? 120));
  const km2 = bboxArea(bounds);
  if (km2 > 60) {
    throw new Error(
      `That box is ${km2.toFixed(0)} km². This draws every building and path it finds, so anything much over 60 km² makes a file no phone wants to load. Narrow it down.`,
    );
  }

  const name = String(args.name || place?.name || 'Venue');
  const id = slugify(String(args.id || name));
  const tolerance = Number(args.tolerance ?? 1.2);
  // Decorative fills (grass/wood/…) may use a coarser tolerance than walkable
  // paths — Cedar Point grass alone was ~250KB of JSON phones parse on park wifi.
  const decorativeTolerance = Number(args.decorativeTolerance ?? Math.max(tolerance * 2.5, 3));

  /* Read before the meta is assembled, because a rebuild has to be able to fall
     back to what the last one decided. */
  const previousMeta = readJson(path.join(VENUE_DIR, `${id}.map.json`))?.meta || null;
  const kind = String(args.kind || place?.kind || previousMeta?.kind || 'place');

  console.error(`\nBuilding "${name}" (${id}) over ${km2.toFixed(2)} km²`);

  const endpoints = args.endpoint ? [String(args.endpoint)] : OVERPASS;
  // Re-running a build against a saved response costs a public mirror nothing
  // and makes tag-rule changes testable in a second rather than a minute.
  const osm = args['from-dump']
    ? JSON.parse(await readFile(String(args['from-dump']), 'utf8'))
    : await overpass(overpassQuery(bounds), endpoints);
  if (args.dump) await writeFile(String(args.dump), JSON.stringify(osm));
  const elements = osm.elements || [];

  const venueArea =
    distanceMetres(bounds.south, bounds.west, bounds.north, bounds.west) *
    distanceMetres(bounds.south, bounds.west, bounds.south, bounds.east);

  /* Read before the geometry, because one thing in it changes how the geometry
     is read: which named areas count as part of this venue. See `annexed`. */
  const { file: overrideFile, data: overrides } = readOverrides(id, args.overrides ? String(args.overrides) : null);

  const wired = wireSources(id, args);
  args = wired.args;
  const sourcesCatalog = wired.catalog;
  if (wired.file) {
    console.error(`  · sources: ${wired.file.replace(process.cwd() + '/', '')}`);
  }

  const DECORATIVE = new Set(['grass', 'wood', 'park', 'sea', 'parking', 'sand']);
  const { layers, anchors, areaCandidates, allLands, boundary, campRings } = buildLayers(elements, {
    tolerance,
    toleranceFor: (layer) => (DECORATIVE.has(layer) ? decorativeTolerance : tolerance),
    minArea: 12,
    venueArea,
    venueName: name,
    annexed: new Set((overrides?.areas || []).map((n) => String(n).toLowerCase())),
    // A little wider than the box the map draws, so the cut line itself never
    // lands anywhere a visitor can pan to.
    clip: padBounds(bounds, 60),
  });

  let pois = buildPois(elements, areaCandidates, { dedupeMetres: Number(args.dedupe ?? 35) });
  const pitches = campPitches(elements, campRings, pois);
  if (pitches.length) {
    pois = pois.concat(pitches);
    console.error(`  · campground: ${pitches.length} pitch(es) picked up from inside ${campRings.length} ring(s)`);
  }
  const fromTrack = poisFromTrack(pois, [
    { track: layers.coaster, category: 'coaster' },
    { track: layers.slide, category: 'ride' },
  ]);
  if (fromTrack.length) {
    console.error(`  · ${fromTrack.length} ride(s) taken from named track with no place of their own`);
    pois = pois.concat(fromTrack);
  }
  const gaps = osmGaps({ pois, layers });
  if (gaps.missingRides.length) {
    console.error(
      `  · ${gaps.missingRides.length} named track(s) still have no place — `
        + (sourcesCatalog?.datasets?.imagery?.length
          ? 'imagery dataset(s) in the source catalogue may supply them'
          : 'add rides to an imagery dataset or overrides'),
    );
    for (const miss of gaps.missingRides.slice(0, 8)) console.error(`    ? ${miss}`);
    if (gaps.missingRides.length > 8) console.error(`    … and ${gaps.missingRides.length - 8} more`);
  }
  const drawnNames = new Set(layers.lands.map((l) => l.n));
  const offsite = assignLands(pois, allLands, name, drawnNames);
  /* A place list is a list of what is in this venue. A bounding box drawn wide
     enough to hold a park also holds whatever is across its car park, and those
     arrive tagged with the name of the place they are in — so they can simply be
     let go. Keyed on the area rather than on a list of names, because the list
     would be 39 shop names at one park and something else at the next. */
  if (offsite.length && !args['keep-offsite']) {
    const byArea = new Map();
    for (const p of offsite) byArea.set(p.a, (byArea.get(p.a) || 0) + 1);
    console.error(`  · dropped ${offsite.length} places standing outside ${name}:`);
    for (const [area, n] of byArea) console.error(`    − ${n} in "${area}"`);
    const cut = new Set(offsite);
    pois = pois.filter((p) => !cut.has(p));
  }

  /* Where you join the queue, for the rides whose queue somebody named and
     pointed. Before the overrides, so a hand-written `e` still wins. */
  const ways = entrancesFromQueues(pois, elements);
  if (ways.rides || ways.unmatched.length || ways.noDirection.length) {
    console.error(
      `  · queue entrances: ${ways.attached} on ${ways.rides} ride(s)` +
        (ways.noDirection.length ? `, ${ways.noDirection.length} queue(s) with no oneway` : '') +
        (ways.unmatched.length ? `, ${ways.unmatched.length} naming no ride here` : ''),
    );
    for (const miss of ways.noDirection) console.error(`    ? "${miss}" queue is not tagged oneway`);
    for (const miss of ways.unmatched) console.error(`    ? "${miss}" has a queue but no ride by that name`);
  }

  /* Primary keys, from the ledger committed beside the overrides file.
     Assigned here, before the overrides are read, so an overrides entry can
     address a key as well as a name — and again after the trace, for whatever
     the overrides and the trace introduce. Both calls read the same ledger off
     disk and only the second one's output is kept, so a place the overrides go
     on to drop never spends a number. */
  const ledger = readLedger(id);
  if (!ledger) {
    console.error(`  · keys: no ledger yet — data/venues/${id}/ids.json will be written from this build`);
  }
  pois = assignKeys(pois, ledger, { venue: id, keepOsm: true }).pois;

  const merged = applyOverrides(pois, overrides);
  pois = merged.pois;
  const heightsApplied = applyHeightsSidecar(pois, id);
  if (heightsApplied.applied) {
    console.error(`  · heights sidecar: ${heightsApplied.applied} rule(s) from data/venues/${id}/heights.json`);
  }
  if (overrideFile) {
    console.error(
      `  · overrides from ${overrideFile.replace(process.cwd() + '/', '')}: ${merged.applied} applied` +
        (merged.unmatched.length ? `, ${merged.unmatched.length} unmatched` : ''),
    );
    for (const miss of merged.unmatched.slice(0, 8)) console.error(`    ? no POI named "${miss}"`);
    if (merged.unmatched.length > 8) console.error(`    … and ${merged.unmatched.length - 8} more`);
  }

  /* A hand-added place gets its district too. The pass above ran before the
     overrides did, so anything `add` introduced still carries no `a` — and `a`
     is the line the app reads out under a name and the second thing search
     matches on. No `drawnNames`, because a place somebody wrote down by hand is
     not the build guessing at what fell outside the venue. */
  const introduced = pois.filter((p) => !p.a);
  if (introduced.length) assignLands(introduced, allLands, name, null);

  /* The venue's own camping facts, and the rules that narrow them. Read from
     the overrides file so nothing about any one campground is in this script. */
  const camping = overrides?.camping || null;
  const narrowed = applyCamping(pois, camping);
  if (camping) {
    const fields = Object.keys(camping.defaults || {}).length;
    console.error(
      `  · camping: ${fields} venue-wide field(s)` +
        (narrowed ? `, ${narrowed} pitch(es) narrowed by rule` : ''),
    );
  }

  /* An outside dataset, georeferenced onto what is already here. This is the
     door for anything OpenStreetMap does not know and a park does. */
  if (args.merge) {
    const files = Array.isArray(args.merge) ? args.merge : [String(args.merge)];
    for (const file of files) {
      const feats = readDataset(file);
      const { merged, unmatched } = mergeDataset(pois, feats, {
        metres: Number(args['merge-metres'] ?? 25),
      });
      console.error(
        `  · merged ${merged} of ${feats.length} from ${file.replace(process.cwd() + '/', '')}` +
          (unmatched.length ? `, ${unmatched.length} matched nothing` : ''),
      );
      for (const miss of unmatched.slice(0, 8)) console.error(`    ? nothing near "${miss}"`);
      if (unmatched.length > 8) console.error(`    … and ${unmatched.length - 8} more`);
    }
  }

  /* What was traced off the park's own map. After the merges, because a trace
     adds places and an entrance has to find the ride it belongs to among
     everything that is going to be there. */
  if (args.trace) {
    const files = Array.isArray(args.trace) ? args.trace : [String(args.trace)];
    for (const file of files) {
      const traced = JSON.parse(readFileSync(file, 'utf8'));
      const got = applyTrace(pois, layers, traced);
      const err = traced.properties?.traced?.error_m;
      console.error(
        `  · traced from ${file.replace(process.cwd() + '/', '')}`
          + `${err != null ? ` (±${err} m)` : ''}: `
          + `${got.entrances} entrance(s), ${got.exits} exit(s), ${got.routes} route(s), `
          + `${got.places} place(s)`,
      );
      for (const miss of got.unmatched) console.error(`    ? no ride named "${miss}"`);
      for (const skip of got.skipped) console.error(`    − skipped ${skip}`);
    }
  }

  /* Paths and places surveyed from aerial imagery. After trace, because both add
     to the same layers and POI list, and imagery refuses unsigned features. */
  if (args.imagery) {
    const files = Array.isArray(args.imagery) ? args.imagery : [String(args.imagery)];
    for (const file of files) {
      const collection = JSON.parse(readFileSync(file, 'utf8'));
      const got = applyImagery(pois, layers, collection, {
        metres: Number(args['imagery-metres'] ?? 15),
      });
      const err = collection.properties?.imagery?.horizontal_accuracy_m;
      console.error(
        `  · imagery from ${file.replace(process.cwd() + '/', '')}`
          + `${err != null ? ` (±${err} m)` : ''}: `
          + `${got.paths} path(s), ${got.rides} ride(s), ${got.places} place(s)`,
      );
      for (const dup of got.duplicates.slice(0, 8)) console.error(`    = already have "${dup}"`);
      for (const skip of got.skipped.slice(0, 8)) console.error(`    − skipped ${skip}`);
    }
  }

  pois.sort((a, b) => a.n.localeCompare(b.n));

  /* The keys again, now that the overrides and the trace have had their say.
     Anything already keyed keeps its key; what they introduced gets one. */
  const keyed = assignKeys(pois, ledger, { venue: id });
  pois = keyed.pois;
  console.error(
    `  · keys: ${keyed.reused} kept, ${keyed.issued} issued` +
      (keyed.retired ? `, ${keyed.retired} retired` : ''),
  );

  /* A key on two places is the one failure this whole scheme exists to prevent,
     because an edit filed under it lands on whichever of them a reader happened
     to find first. It is not a warning. */
  const keys = keyAudit(pois);
  if (keys.duplicates.length) {
    const shown = keys.duplicates
      .slice(0, 5)
      .map((d) => `"${d.key}" on ${d.names.join(' and ')}`)
      .join('; ');
    throw new Error(
      `${name} would ship ${keys.duplicates.length} duplicate primary key(s): ${shown}` +
        (keys.duplicates.length > 5 ? ', …' : '') +
        `. A key addresses one place. Usually an "i" written by hand into ` +
        `${path.relative(process.cwd(), venueSidecar(id, 'overrides.json'))} onto a name more than one place wears.`,
    );
  }

  // A rebuild must not silently drop the hand-written parts of the last one.
  const existingMeta = previousMeta;

  /* Where the map opens. A rebuild must not move it: the centre a venue already
     has was chosen, and the midpoint of a bounding box is not the middle of a
     park — Kings Island's is out over the car park, a hundred and fifty metres
     from the fountain everyone means by "the middle". So an existing centre is
     kept as long as it is still inside the venue, and only a genuinely new
     venue falls back to the box.

     "The centre a venue already has was chosen" needed somewhere to be chosen
     from, and had none: the first build of a venue took the box and every build
     after it took that. --center is that somewhere. It is worth having because
     neither automatic answer is the middle of anywhere in particular — Big
     Kahuna's own polygon runs north over its car park, so the box midpoint and
     the boundary centroid agree to within two metres and both of them open the
     map on the parked cars rather than on the wave pool. */
  const chosenCentre = args.center ? parseLatLng(String(args.center), '--center') : null;
  const existingCentre = existingMeta?.center;
  const centreStillValid =
    existingCentre &&
    existingCentre.lat < bounds.north &&
    existingCentre.lat > bounds.south &&
    existingCentre.lng < bounds.east &&
    existingCentre.lng > bounds.west;
  const centre = chosenCentre ||
    (centreStillValid && existingCentre) ||
    place?.center || {
      lat: (bounds.north + bounds.south) / 2,
      lng: (bounds.east + bounds.west) / 2,
    };

  const drawn = Object.values(layers).reduce((n, l) => n + l.length, 0);
  if (!drawn) throw new Error('OpenStreetMap has nothing mapped in that box — check the coordinates.');

  const meta = {
    id,
    name,
    /* The line under the name. Falls back to the last build's, because a
       rebuild from a bounding box resolves no place and would otherwise blank
       it — the same way `credits` and `kind` used to be lost. A venue is
       routinely rebuilt from `--bbox` precisely because `--place` picked the
       wrong thing, so this is the common path, not the odd one. */
    locality:
      (args.locality ? String(args.locality) : null) ||
      place?.display?.split(', ').slice(-3).join(', ') ||
      existingMeta?.locality ||
      null,
    kind,
    center: { lat: Number(centre.lat.toFixed(6)), lng: Number(centre.lng.toFixed(6)) },
    bounds: {
      north: Number(bounds.north.toFixed(5)),
      south: Number(bounds.south.toFixed(5)),
      east: Number(bounds.east.toFixed(5)),
      west: Number(bounds.west.toFixed(5)),
    },
    source: 'OpenStreetMap contributors, ODbL',
    /* Anything the venue's data owes to a source that is not OSM — height
       requirements, most often — is credited in the app from here. The
       overrides file is allowed to carry the line, and is the better place for
       it: it is where the data being credited lives, and --reapply has always
       read it from there. Only the build did not, so a venue whose heights and
       whose credit were written in the same file shipped the heights
       uncredited. */
    credits: resolveCredits({ args, overrides, existingMeta, catalog: sourcesCatalog }),
    /* What is true of this venue's campground as a whole. On the venue rather
       than repeated onto every pitch, because that is where the fact lives: a
       campground is full hookup, a pitch is not individually full hookup. The
       app reads a pitch's own details over this. */
    ...(camping?.defaults ? { camping: camping.defaults } : existingMeta?.camping ? { camping: existingMeta.camping } : {}),
    /* This venue's own district tints, where somebody has hand-picked any. The
       renderer generates a colour for every district that is not named here, so
       a venue built from OpenStreetMap alone needs none of it. */
    ...(landTints(overrides) ? { lands: landTints(overrides) } : existingMeta?.lands ? { lands: existingMeta.lands } : {}),
    generated: new Date().toISOString().slice(0, 10),
  };

  /* A rebuild that changes nothing should change nothing on disk.
     `generated` was the one field that moved every time, which made the useful
     question — "does OpenStreetMap still say what we shipped?" — unanswerable
     from a diff, because the answer was always yes, one line, every venue,
     every run. So the date is kept when the rest of the bundle comes out
     identical: it is the date the venue was generated, and a run that produced
     the same venue did not generate a new one. */
  const builtMap = mapOf(layers, anchors, boundary);
  const coverage = tagCoverageFromMap(builtMap);
  meta.coverage = coverage;

  const expectLock = overrides?.expect || previous?.expect || existingMeta?.expect;
  if (expectLock?.walkable_km_min != null && coverage.walkable_km < expectLock.walkable_km_min) {
    throw new Error(
      `${id}: walkable network is ${coverage.walkable_km} km, below the locked floor of `
        + `${expectLock.walkable_km_min} km — a rebuild would shrink routing coverage.`,
    );
  }

  const drift = driftFrom({ id, meta, map: builtMap, pois, existingMeta });
  if (!drift.changed && existingMeta?.generated) meta.generated = existingMeta.generated;

  const summary = LAYERS.map((k) => `${k}=${layers[k].length}`).join(' ');
  console.error(`  · geometry: ${summary}`);
  console.error(`  · pois: ${pois.length} (${pois.filter((p) => p.h).length} with heights)`);

  /* Height rules are the one part of a venue OpenStreetMap will never supply,
     so a park that has them and a park whose overrides file nobody wrote look
     identical here — and identical to the app, which answers by removing the
     Rides tab, the slider, the tally, the badge over the map and the
     struck-through markers without saying why. That is too much of the app to
     lose to an omission, so an omission has to be said out loud. */
  const audit = heightAudit(pois);
  if (audit.owed && !audit.heights && !args['allow-no-heights']) {
    throw new Error(
      `${name} has ${audit.rides} rides and no height rules, so the app would ship without its ` +
        `Rides tab. Write ${path.relative(process.cwd(), venueSidecar(id, 'overrides.json'))} ` +
        'and build again — or pass --allow-no-heights if this venue genuinely has none.',
    );
  }
  if (audit.owed && audit.missing.length) {
    console.error(`  · ${audit.missing.length} ride(s) still without a height rule:`);
    for (const miss of audit.missing.slice(0, 8)) console.error(`    − ${miss}`);
    if (audit.missing.length > 8) console.error(`    … and ${audit.missing.length - 8} more`);
  }

  /* The boundary is the one thing here that can be confidently wrong: a plain
     ring with a plausible name, in the right place, enclosing the wrong ground.
     So it reports what it picked and how many places ended up outside it —
     which is the number that gives the game away. Kings Island's census tract
     enclosed one place out of two hundred and nineteen. */
  if (!boundary) {
    console.error('  · boundary: none found — nothing here is tagged as the venue itself');
  } else {
    /* Counted against the annexed areas too, or the check cries wolf at exactly
       the venues that needed the list: Cedar Point's own water park and
       campground are both outside its theme-park ring on purpose. */
    const annexedHere = new Set((overrides?.areas || []).map((n) => String(n).toLowerCase()));
    const within = pois.filter(
      (p) => pointInRing([p.lng, p.lat], boundary.r) || annexedHere.has(String(p.a || '').toLowerCase()),
    ).length;
    const why = boundary.named && boundary.tagged
      ? 'named and tagged as the venue'
      : boundary.named
        ? 'carries the venue name'
        : 'largest thing tagged as a venue';
    console.error(
      `  · boundary: ${boundary.r.length} points, ${why} — ${within}/${pois.length} places inside`,
    );
    if (within < pois.length * 0.5) {
      console.error('    ! most places fall outside it. That is usually the wrong ring.');
    }
  }

  /* What this run would do to the venue already on disk. The interesting answer
     is "nothing": it means OpenStreetMap still says what we shipped, which is
     the question a rebuild is usually asking and which no amount of layer
     counts answers. */
  if (drift.existed) {
    console.error(
      drift.changed
        ? `  · differs from what is on disk: ${[drift.mapChanged && 'the map', drift.poisChanged && 'the places'].filter(Boolean).join(' and ')}`
        : '  · identical to what is on disk',
    );
  }

  if (args['dry-run']) {
    console.error('\nDry run — nothing written.');
    return;
  }

  const inv = inventory(id, args, { map: builtMap, pois, existing: readJson(listFile(id)) });
  const published = publish(id, pois, inv.records, PUBLISH_AT);
  const sidecar = {
    version: SCHEMA_VERSION,
    _comment:
      'Every ride at this venue, every feature of it, and the evidence behind each coordinate. '
      + 'Beside the venue bundle rather than in it.',
    venue: id,
    generated: inv.asOf,
    publish_at: PUBLISH_AT,
    attractions: inv.records.map(trim),
  };
  if (writeSettled(listFile(id), sidecar)) {
    console.error(`  · inventory: wrote ${path.relative(process.cwd(), listFile(id))}`);
  }
  if (published) console.error(`  · inventory: published ${published} field(s) onto places`);

  const written = writeVenue({ meta, map: builtMap, pois });
  /* The ledger, beside the overrides file rather than under public/, because it
     is not a download and because the numbers in it are the thing a human
     reviews when a rebuild moves something. Written only when its bytes change,
     so a rebuild that changed nothing still changes nothing on disk. */
  if (!ledger || serializeLedger(ledger) !== serializeLedger(keyed.ledger)) {
    const file = writeLedger(id, keyed.ledger);
    console.error(`Wrote ${file.replace(process.cwd() + '/', '')}`);
  }
  const manifest = reindex({
    preferredDefault: args.default === true ? id : typeof args.default === 'string' ? args.default : undefined,
  });

  console.error(`\nWrote ${written.map.replace(process.cwd() + '/', '')}`);
  console.error(`Wrote ${written.pois.replace(process.cwd() + '/', '')}`);
  if (written.gaps) console.error(`Wrote ${written.gaps.replace(process.cwd() + '/', '')}`);

  /* How this was built, beside the file that holds everything else somebody
     decided about this venue. Written last, so a build that threw does not
     leave behind a recipe for a venue that is not on disk. */
  if (!args['no-recipe']) {
    const recipe = recipeFrom({
      args,
      id,
      name,
      box,
      place,
      expect: overrides?.expect || previous?.expect || null,
      counts: {
        pois: pois.length,
        rides: audit.rides,
        heights: audit.heights,
        shapes: drawn,
      },
      // A rebuild that changed nothing keeps the date it was first built on,
      // for the same reason `generated` does.
      built: !drift.changed && previous?.built ? previous.built : null,
    });
    const file = writeRecipe(id, recipe);
    console.error(`Wrote ${file.replace(process.cwd() + '/', '')} — rebuild with: npm run venues:rebuild -- ${id}`);
  }

  console.error(`Manifest now lists ${manifest.venues.length}: ${manifest.venues.map((v) => v.id).join(', ')}`);
  console.error(`Default venue: ${manifest.default}`);

  /* The build has done everything a build can do. Anything still missing here
     needs a source that is not OpenStreetMap, and saying so at the end — with
     the one command that spells out what to go and find — is the difference
     between a venue somebody finishes and a venue that ships half-built
     because nothing said which half. Only when there is something to ask. */
  const outstanding = requests({
    venue: { ...meta, id },
    map: mapOf(layers, anchors, boundary),
    pois,
    overrides,
  });
  if (outstanding.length) {
    const blocking = outstanding.filter((r) => r.blocking).length;
    console.error(
      `\n${outstanding.length} thing(s) here need a source outside OpenStreetMap`
        + `${blocking ? `, ${blocking} of them blocking` : ''}: ${outstanding.map((r) => r.need).join('; ')}.`,
    );
    console.error(`What to go and find: npm run venues:ask -- ${id}`);
  }

  const judge = judgements({
    pois,
    layers: { coaster: layers.coaster, slide: layers.slide },
    overrides,
  });
  if (judge.length || gaps.missingRides.length) {
    console.error(`Judgement and sourcing hints: npm run venues:research -- ${id}`);
  }
  console.error(`Cross-park weaknesses: npm run venues:audit -- ${id}`);
}

/* Only when it is the thing being run. The tag rules and the height parser are
   worth holding a test to, and a test that imports this file must not build a
   venue as a side effect of doing so. */
const runDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runDirectly) {
  main().catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
