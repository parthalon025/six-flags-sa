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
import { areaOf, centroidOf, distanceMetres, pointInRing, round, simplify } from './lib/geometry.mjs';
import { LAYERS, LINE_LAYERS, POI_RULES, LAYER_RULES, UNNAMED_LABELS, classify, isLand } from './lib/osm-tags.mjs';
import { readJson, readOverrides, reindex, slugify, VENUE_DIR, writeVenue } from './lib/venue-io.mjs';
import path from 'node:path';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'party-tracker-venue-builder/1.0 (+https://github.com/parthalon025/six-flags-sa)';

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
    if (inline != null) out[key] = inline;
    else if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else out[key] = true;
  }
  return out;
}

const USAGE = `
Build a venue bundle from OpenStreetMap.

  --place "<name>"          resolve the place and its extent with Nominatim
  --bbox s,w,n,e            explicit bounding box in degrees
  --around lat,lng,metres   a centre point and a radius

  --name "<name>"           display name       (default: the resolved place)
  --id <slug>               venue id           (default: slugified name)
  --locality "<where>"      the line under the name, e.g. "Mason, Ohio"
  --kind <kind>             theme-park | park | campus | fair | place
  --credits "<line>"        a data credit shown in the app, e.g. where heights came from
  --overrides <file>        heights and corrections (default: data/venues/<id>.overrides.json)
  --pad <metres>            grow the bounding box (default: 120)
  --tolerance <metres>      geometry simplification (default: 1.2)
  --default                 make this the venue the app opens on
  --dry-run                 print what would be written, write nothing
  --dump <file>             save the raw Overpass response for inspection
  --from-dump <file>        build from a saved response instead of querying
  --reindex                 only rebuild the manifest from files already on disk
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

function buildLayers(elements, opts) {
  const layers = Object.fromEntries(LAYERS.map((k) => [k, []]));
  const lands = [];
  const areaCandidates = []; // closed rings that might also be a POI

  for (const el of elements) {
    if (el.type === 'node') continue;
    const tags = el.tags || {};
    const rings = el.type === 'relation' ? ringsOfRelation(el) : [ringOf(el)];
    for (const raw of rings) {
      if (raw.length < 2) continue;
      const closed = isClosed(raw) || el.tags?.area === 'yes';
      const ring = round(simplify(raw, opts.tolerance));
      if (ring.length < 2) continue;

      if (isLand(tags) && closed) {
        const size = areaOf(ring);
        // The venue's own outline is the ground everything else sits on, not a
        // district within it — and it is recognised by carrying the venue's own
        // name, since a park mapped tightly can cover well under half its box.
        if (tags.name && tags.name.toLowerCase() === opts.venueName.toLowerCase()) {
          layers.park.push({ r: ring, n: tags.name });
          continue;
        }
        // Big enough to be a district, small enough not to be the venue itself.
        if (size > 1500 && size < opts.venueArea * 0.7) {
          lands.push({ n: tags.name, r: ring, size });
          continue;
        }
        // Anything covering most of the box is the venue outline, and becomes
        // the ground the rest of the map is drawn on.
        if (size >= opts.venueArea * 0.7) {
          layers.park.push({ r: ring, n: tags.name });
          continue;
        }
      }

      const layer = classify(LAYER_RULES, tags);
      if (!layer) continue;
      if (!LINE_LAYERS.has(layer) && !closed) continue;
      if (!LINE_LAYERS.has(layer) && areaOf(ring) < opts.minArea) continue;
      layers[layer].push(tags.name ? { r: ring, n: tags.name } : { r: ring });
      if (closed && tags.name) areaCandidates.push({ tags, ring });
    }
  }

  // Overlapping lands are common — a park section mapped twice, or a sub-area
  // inside a bigger one. Keep the largest ring per name for the label anchor,
  // but draw all of them so the tint covers the whole district.
  const anchors = {};
  for (const land of lands.sort((a, b) => b.size - a.size)) {
    if (!anchors[land.n]) {
      const [lng, lat] = centroidOf(land.r);
      anchors[land.n] = [Number(lat.toFixed(5)), Number(lng.toFixed(5))];
    }
  }
  layers.lands = lands.map(({ n, r }) => ({ n, r }));

  return { layers, anchors, areaCandidates };
}

function buildPois(elements, areaCandidates, opts) {
  const out = [];
  const push = (tags, lat, lng) => {
    const c = classify(POI_RULES, tags);
    if (!c) return;
    const name = tags.name || tags.operator || UNNAMED_LABELS[c];
    if (!name) return; // an unnamed bench is noise on a map you read at a glance
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    out.push({ n: name, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), c });
  };

  for (const el of elements) {
    if (el.type !== 'node') continue;
    push(el.tags || {}, el.lat, el.lon);
  }
  for (const { tags, ring } of areaCandidates) {
    const [lng, lat] = centroidOf(ring);
    push(tags, lat, lng);
  }

  // A ride is routinely mapped three times: the track, the station building and
  // a node for the name. Collapse anything sharing a name and a category within
  // a stone's throw, keeping the first — nodes come first above, and a mapper
  // placing a node has usually put it at the entrance rather than the centroid.
  const kept = [];
  for (const poi of out) {
    const dupe = kept.find(
      (k) => k.c === poi.c && k.n === poi.n && distanceMetres(k.lat, k.lng, poi.lat, poi.lng) < opts.dedupeMetres,
    );
    if (!dupe) kept.push(poi);
  }
  return kept;
}

/** Every POI gets the district it stands in, which is what the header line reads out. */
function assignLands(pois, lands, venueName) {
  const ordered = lands
    .map((l) => ({ n: l.n, r: l.r, size: areaOf(l.r) }))
    .sort((a, b) => a.size - b.size); // smallest first: the most specific district wins
  for (const poi of pois) {
    const hit = ordered.find((l) => pointInRing([poi.lng, poi.lat], l.r));
    poi.a = hit?.n || venueName;
  }
}

/**
 * Heights, corrections and hand-added places.
 *
 * OSM will never carry "48 inches to ride alone", and a generated file cannot
 * be hand-edited without the next rebuild eating the edit — so both live here,
 * keyed by name, and are re-applied on every build.
 */
function applyOverrides(pois, overrides) {
  if (!overrides) return { pois, applied: 0, unmatched: [] };
  const byName = new Map(pois.map((p) => [p.n.toLowerCase(), p]));
  let applied = 0;
  const unmatched = [];

  for (const [name, patch] of Object.entries(overrides.pois || {})) {
    // Parks rename rides faster than OSM follows, so an override may be filed
    // under the name on the sign while the map still carries the old one. The
    // alias is what bridges the two, in whichever direction the drift went.
    const target = byName.get(name.toLowerCase()) || (patch.alias ? byName.get(String(patch.alias).toLowerCase()) : null);
    if (!target) {
      unmatched.push(name);
      continue;
    }
    Object.assign(target, patch);
    applied += 1;
  }

  const dropped = new Set((overrides.drop || []).map((n) => n.toLowerCase()));
  let next = pois.filter((p) => !dropped.has(p.n.toLowerCase()));

  for (const extra of overrides.add || []) {
    const existing = byName.get(String(extra.n).toLowerCase());
    if (existing) Object.assign(existing, extra);
    else next.push({ ...extra });
  }

  return { pois: next, applied, unmatched };
}

/* ------------------------------------------------------------------ main - */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(USAGE);
    return;
  }

  if (args.reindex) {
    const manifest = reindex({ preferredDefault: typeof args.default === 'string' ? args.default : undefined });
    console.log(`Manifest rebuilt: ${manifest.venues.length} venue(s), default "${manifest.default}".`);
    return;
  }

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

  bounds = padBounds(bounds, Number(args.pad ?? 120));
  const km2 = bboxArea(bounds);
  if (km2 > 60) {
    throw new Error(
      `That box is ${km2.toFixed(0)} km². This draws every building and path it finds, so anything much over 60 km² makes a file no phone wants to load. Narrow it down.`,
    );
  }

  const name = String(args.name || place?.name || 'Venue');
  const id = slugify(String(args.id || name));
  const kind = String(args.kind || place?.kind || 'place');
  const tolerance = Number(args.tolerance ?? 1.2);

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

  const { layers, anchors, areaCandidates } = buildLayers(elements, {
    tolerance,
    minArea: 12,
    venueArea,
    venueName: name,
  });

  let pois = buildPois(elements, areaCandidates, { dedupeMetres: Number(args.dedupe ?? 35) });
  assignLands(pois, layers.lands, name);

  const { file: overrideFile, data: overrides } = readOverrides(id, args.overrides ? String(args.overrides) : null);
  const merged = applyOverrides(pois, overrides);
  pois = merged.pois;
  if (overrideFile) {
    console.error(
      `  · overrides from ${overrideFile.replace(process.cwd() + '/', '')}: ${merged.applied} applied` +
        (merged.unmatched.length ? `, ${merged.unmatched.length} unmatched` : ''),
    );
    for (const miss of merged.unmatched.slice(0, 8)) console.error(`    ? no POI named "${miss}"`);
    if (merged.unmatched.length > 8) console.error(`    … and ${merged.unmatched.length - 8} more`);
  }

  pois.sort((a, b) => a.n.localeCompare(b.n));

  // A rebuild must not silently drop the hand-written parts of the last one.
  const existingMeta = readJson(path.join(VENUE_DIR, `${id}.map.json`))?.meta || null;

  const centre = place?.center || {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };

  const drawn = Object.values(layers).reduce((n, l) => n + l.length, 0);
  if (!drawn) throw new Error('OpenStreetMap has nothing mapped in that box — check the coordinates.');

  const meta = {
    id,
    name,
    locality: args.locality ? String(args.locality) : place?.display?.split(', ').slice(-3).join(', ') || null,
    kind,
    center: { lat: Number(centre.lat.toFixed(6)), lng: Number(centre.lng.toFixed(6)) },
    bounds: {
      north: Number(bounds.north.toFixed(5)),
      south: Number(bounds.south.toFixed(5)),
      east: Number(bounds.east.toFixed(5)),
      west: Number(bounds.west.toFixed(5)),
    },
    source: 'OpenStreetMap contributors, ODbL',
    // Anything the venue's data owes to a source that is not OSM — height
    // requirements, most often — is credited in the app from here.
    credits: args.credits ? String(args.credits) : existingMeta?.credits || null,
    generated: new Date().toISOString().slice(0, 10),
  };

  const summary = LAYERS.map((k) => `${k}=${layers[k].length}`).join(' ');
  console.error(`  · geometry: ${summary}`);
  console.error(`  · pois: ${pois.length} (${pois.filter((p) => p.h).length} with heights)`);

  if (args['dry-run']) {
    console.error('\nDry run — nothing written.');
    return;
  }

  const written = writeVenue({
    meta,
    map: { ...layers, landAnchors: anchors },
    pois,
  });
  const manifest = reindex({
    preferredDefault: args.default === true ? id : typeof args.default === 'string' ? args.default : undefined,
  });

  console.error(`\nWrote ${written.map.replace(process.cwd() + '/', '')}`);
  console.error(`Wrote ${written.pois.replace(process.cwd() + '/', '')}`);
  console.error(`Manifest now lists ${manifest.venues.length}: ${manifest.venues.map((v) => v.id).join(', ')}`);
  console.error(`Default venue: ${manifest.default}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
