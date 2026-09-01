/* Where a venue lives on disk, and how the app finds out about it.
 *
 * One venue is three *published* files plus a manifest row:
 *
 *   public/venues/<id>.map.json    the drawn geometry, fetched by the browser
 *   public/venues/<id>.pois.json   the places, fetched by the browser
 *   public/venues/<id>.gaps.json   Gaps the builder invented; the phone ranks them
 *   public/venues/manifest.json    every venue's name, centre and bounds
 *
 * Reindex also stamps the App Store routing coverage MultiPolygon
 * (`fastlane/metadata/ios/routing_app_coverage.geojson`) from those bounds.
 *
 * Builder *input* for each venue lives in its own package directory:
 *
 *   packages/venue-builder/data/venues/<id>/
 *     sources.json, overrides.json, heights.json, recipe.json, ids.json, …
 *     maps/          official park map images used for georef / testing
 *     *.geojson      imagery / merge / traced datasets
 *
 * They sit under public/ rather than being imported at build time because that
 * is what makes a venue swappable without a rebuild: the client fetches the one
 * it needs, the service worker caches it, and a phone that has been to two
 * parks holds both. lib/venueIndex.js is generated alongside them so the server
 * routes — which cannot fetch their own static files on every host — still get
 * the POI lists through the bundler.
 *
 * Path resolution and generic JSON read/write are venue-fs.mjs, not this
 * file — this file is the orchestration layer above that base (assembling
 * the shipped gaps document, writing venue files, rebuilding the manifest)
 * and re-exports venue-fs.mjs's primitives so its ~70 existing importers are
 * unaffected. See venue-fs.mjs's header for why the split exists (#32: it
 * broke two import cycles that ran through this file).
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { shippedGapsForVenue } from './ship-gaps.mjs';
import { routeImageryExtractions } from './imagery-claims.mjs';
import { DISPUTE_SIDECAR, recordDisputes } from './imagery-disputes.mjs';
import { writeBundleManifest } from './venue-bundle.mjs';
import { buildGeneratedBinding } from './delivery/builder-app-contract.mjs';
import { writeRoutingCoverage } from '../src/routing-coverage.mjs';
import { readSources, adapterGapNotes, externalAdaptersFromCatalog } from './venue-sources.mjs';
import { adapterCacheFile } from './adapters/_cache.mjs';
import {
  APP_ROOT,
  BUILDER_ROOT,
  INDEX_FILE,
  MANIFEST_FILE,
  MONO_ROOT,
  OVERRIDE_DIR,
  VENUE_DIR,
  ROOT,
  venuePkgDir,
  venueSidecar,
  venueSidecarRel,
  venueMapRel,
  listVenuePackages,
  resolveBuilderPath,
  slugify,
  readJson,
  writeJson,
} from './venue-fs.mjs';

export {
  APP_ROOT,
  BUILDER_ROOT,
  INDEX_FILE,
  MANIFEST_FILE,
  MONO_ROOT,
  OVERRIDE_DIR,
  VENUE_DIR,
  ROOT,
  venuePkgDir,
  venueSidecar,
  venueSidecarRel,
  venueMapRel,
  listVenuePackages,
  resolveBuilderPath,
  slugify,
  readJson,
  writeJson,
};

/** Whatever extractions.json holds for this venue, as a flat list. */
function extractionsFor(id, extractions) {
  const loaded = extractions ?? (id ? readJson(venueSidecar(id, 'extractions.json'), []) : []);
  if (Array.isArray(loaded)) return loaded;
  return Array.isArray(loaded?.extractions) ? loaded.extractions : [];
}

/**
 * Disputes this build found, for the builder-side record. Never shipped —
 * the owner's answer of 2026-08-22 was that a disputed path position stays
 * internal, so this is a separate call from `gapsDocumentFor` rather than a
 * field inside it. See imagery-disputes.mjs.
 */
export function imageryDisputesFor({ meta, map, pois, extractions } = {}) {
  const list = extractionsFor(meta?.id, extractions);
  // `pois` is what lets a place-position dispute be found at all: without the
  // Places OSM already carries there is nothing for an imagery read of one to
  // disagree with, and the comparison silently degrades to "imagery adds".
  return routeImageryExtractions(list, { map: map || {}, pois: pois || [] }).disputes;
}

/**
 * Write this venue's dispute record into its builder package directory.
 * `packages/venue-builder/data/venues/<id>/imagery-disputes.json` — beside the
 * other maintainer sidecars, nowhere near `apps/party-tracker/public/`.
 *
 * Silent when there is nothing in dispute: an empty file per venue per build
 * would be diff noise, and no record is the same fact as an empty one.
 */
export function writeImageryDisputes({ meta, map, pois, extractions, write } = {}) {
  const id = meta?.id;
  const disputes = imageryDisputesFor({ meta, map, pois, extractions });
  if (!id || !disputes.length) return { wrote: false, reason: 'nothing in dispute' };
  const sink = write ?? ((doc) => writeJson(venueSidecar(id, DISPUTE_SIDECAR), doc, true));
  return recordDisputes(id, disputes, { write: sink, asOf: new Date().toISOString().slice(0, 10) });
}

/**
 * Gaps this venue ships. Reads builder sidecars (attractions) and walkable
 * geometry; does not invent live ops. Phone-safe: one `{ type, target }` per fact.
 *
 * Imagery extractions are deliberately absent. They are routed by
 * `writeImageryDisputes` into a builder-side record; nothing they produce is
 * on the wire.
 */
export function gapsDocumentFor({ meta, pois, map } = {}) {
  const id = meta?.id;
  const attractions = id ? readJson(venueSidecar(id, 'attractions.json')) : null;
  const catalog = id ? readSources(id) : null;
  const gapNotes = catalog?.data ? adapterGapNotes(catalog.data) : {};
  const adapterIds = catalog?.data ? externalAdaptersFromCatalog(catalog.data) : [];
  const adapterCaches = {};
  if (id) {
    for (const adapterId of adapterIds) {
      adapterCaches[adapterId] = readJson(adapterCacheFile(id, adapterId), null);
    }
  }
  return shippedGapsForVenue({
    venueId: id,
    meta,
    pois: pois || [],
    map: map || {},
    attractions,
    adapterCaches,
    gapNotes,
  });
}

export const serializeVenue = ({ meta, map, pois, gaps }) => ({
  map: JSON.stringify({ meta, ...map }),
  pois: `${JSON.stringify(pois, null, 2)}\n`,
  gaps: `${JSON.stringify(gaps ?? { version: 1, venue: meta?.id || null, gaps: [] }, null, 2)}\n`,
});

export function writeVenue({ meta, map, pois, gaps }) {
  const id = meta.id;
  // The map file is the big one and nobody reads it by hand, so it goes out
  // minified. The POI list is small, gets edited when a name is wrong, and is
  // worth a readable diff. Gaps are the same readable shape as places. Written
  // through the same serialiser the drift check reads with, so the two can
  // never disagree about what a venue looks like.
  const shipped = gaps ?? gapsDocumentFor({ meta, pois, map });
  // The dispute record is written on the same pass that publishes the venue,
  // so a build can never ship a venue whose disputes went unrecorded. It lands
  // in the builder package, not under public/.
  writeImageryDisputes({ meta, map, pois });
  const bytes = serializeVenue({ meta, map, pois, gaps: shipped });
  mkdirSync(VENUE_DIR, { recursive: true });
  writeFileSync(path.join(VENUE_DIR, `${id}.map.json`), bytes.map);
  writeFileSync(path.join(VENUE_DIR, `${id}.pois.json`), bytes.pois);
  writeFileSync(path.join(VENUE_DIR, `${id}.gaps.json`), bytes.gaps);
  return {
    map: path.join(VENUE_DIR, `${id}.map.json`),
    pois: path.join(VENUE_DIR, `${id}.pois.json`),
    gaps: path.join(VENUE_DIR, `${id}.gaps.json`),
  };
}

/**
 * Rebuild the manifest and the generated index from whatever venue files are on
 * disk, so adding or deleting a venue is a matter of the files themselves.
 * `preferredDefault` only wins if that venue actually exists.
 */
export function reindex({ preferredDefault } = {}) {
  mkdirSync(VENUE_DIR, { recursive: true });
  const ids = readdirSync(VENUE_DIR)
    .filter((f) => f.endsWith('.map.json'))
    .map((f) => f.slice(0, -'.map.json'.length))
    .sort();

  const venues = [];
  for (const id of ids) {
    const map = readJson(path.join(VENUE_DIR, `${id}.map.json`));
    const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
    if (!map?.meta) {
      console.warn(`  ! ${id}.map.json has no meta block — skipped`);
      continue;
    }
    // No `writeImageryDisputes` here, on purpose. A reindex re-derives only
    // what `gapsDocumentFor` produces, and that reads no extractions — the
    // dispute record's one input — so a republish has nothing new to say about
    // disputes and no business overwriting what the build recorded. Disputes
    // are written by `writeVenue`, the pass that has the extractions in hand;
    // this pass must leave a maintainer's sidecar exactly as it found it.
    const shipped = gapsDocumentFor({ meta: map.meta, pois, map });
    writeJson(path.join(VENUE_DIR, `${id}.gaps.json`), shipped, true);
    // The bundle manifest is written after the gaps file so it hashes the
    // bytes this reindex just shipped. It lists the truth trio plus whatever
    // display files have been published under public/venues/<id>/display/ —
    // the download manager's one trusted entry point per venue (ADR-0018).
    // `basedOn.revisionId` is PostDB's to mint (ADR-0024) and reindex reads
    // only file truth, so it cannot recompute the cursor — carry forward
    // whatever the last `venues:export` pinned rather than dropping a field
    // this pass does not own. Dropping it is what silently un-stamped every
    // shipped bundle: `publishBundle` exports the revision-pinned manifest and
    // then reindexes, and reindexing one venue rewrote all of them.
    const bundleFile = path.join(VENUE_DIR, `${id}.bundle.json`);
    writeBundleManifest(id, {
      venueDir: VENUE_DIR,
      displayDir: path.join(VENUE_DIR, id, 'display'),
      outFile: bundleFile,
      generated: map.meta?.generated ?? null,
      revisionId: readJson(bundleFile)?.basedOn?.revisionId ?? null,
    });
    venues.push({
      ...map.meta,
      map: `/venues/${id}.map.json`,
      pois: `/venues/${id}.pois.json`,
      gaps: `/venues/${id}.gaps.json`,
      bundle: `/venues/${id}.bundle.json`,
      counts: {
        pois: pois.length,
        rides: pois.filter((p) => p.c === 'coaster' || p.c === 'ride').length,
        heights: pois.filter((p) => p.h).length,
        gaps: shipped.gaps.length,
      },
    });
  }

  const existing = readJson(MANIFEST_FILE, {});
  const wanted = preferredDefault || existing.default;
  const fallback = venues[0]?.id ?? null;
  const manifest = {
    version: 1,
    default: venues.some((v) => v.id === wanted) ? wanted : fallback,
    venues,
  };
  writeIndex(manifest);
  writeRoutingCoverage(venues);
  // Stamp after venueIndex.js exists so the binding covers every generated file
  // the app reads — hand edits to public/venues/*.json or venueIndex.js fail CI.
  writeJson(MANIFEST_FILE, manifest, true);
  manifest.generatedBinding = buildGeneratedBinding();
  writeJson(MANIFEST_FILE, manifest, true);
  return manifest;
}

/**
 * A generated module, because the API routes need the POI lists inside the
 * bundle: reading public/ from a route handler works locally and quietly does
 * not on several hosts. Static imports are the one form every host agrees on.
 */
function writeIndex(manifest) {
  const lines = [
    '/* Generated by scripts/build-venue.mjs — do not edit by hand.',
    ' *',
    ' * Static imports of every venue\'s POI list, for the server-side routes.',
    ' * The browser does not use this: it fetches /venues/<id>.pois.json so that',
    ' * a new venue is a new file rather than a new deployment.',
    ' *',
    ` * Rebuild with: npm run venues:reindex`,
    ' */',
    '',
    "import manifest from '@/public/venues/manifest.json';",
  ];
  const varOf = (id) => `pois_${id.replace(/[^a-zA-Z0-9]/g, '_')}`;
  for (const v of manifest.venues) {
    lines.push(`import ${varOf(v.id)} from '@/public/venues/${v.id}.pois.json';`);
  }
  lines.push('');
  lines.push('export const MANIFEST = manifest;');
  lines.push('export const VENUES = manifest.venues;');
  lines.push(`export const DEFAULT_VENUE_ID = ${JSON.stringify(manifest.default)};`);
  lines.push('');
  lines.push('export const POIS_BY_VENUE = {');
  for (const v of manifest.venues) lines.push(`  ${JSON.stringify(v.id)}: ${varOf(v.id)},`);
  lines.push('};');
  lines.push('');
  lines.push('export const venueById = (id) => VENUES.find((v) => v.id === id) || null;');
  lines.push('');
  mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  writeFileSync(INDEX_FILE, lines.join('\n'));
}

export function readOverrides(id, explicit) {
  const file = explicit || venueSidecar(id, 'overrides.json');
  const data = readJson(file);
  return data ? { file, data } : { file: null, data: null };
}
