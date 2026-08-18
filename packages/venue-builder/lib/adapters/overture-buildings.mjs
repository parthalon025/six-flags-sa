/**
 * Overture Maps Foundation — merged, deduplicated building footprints.
 * https://docs.overturemaps.org/guides/buildings/
 *
 * ODbL (matches OSM's own license — Overture's own attribution docs state the
 * buildings theme is published under ODbL specifically "because it includes
 * OpenStreetMap data"). Wraps the `duckdb` CLI (httpfs + spatial extensions)
 * the same way mapillary-video.mjs wraps `mapillary_tools`: gaps gracefully
 * when the CLI isn't installed, never forked or vendored into this repo.
 *
 * Populates `cv_segmentation` — but this adapter does NOT emit point-shaped
 * evidence.mjs claims (`EvidenceClaim.at` is a single {lat,lng}; a building
 * footprint is a polygon). It caches real, georeferenced footprint GeoJSON
 * as the second independent polygon source `lib/footprint-fusion.mjs`
 * (proposed, not yet built — see docs/research/2026-08-18-footprint-
 * conflation-proposal.md) needs to exist before any conflation can run.
 *
 * No S3 SDK / AWS credentials anywhere: the bucket is listed and queried
 * over plain HTTPS (list via `?list-type=2`, parquet reads via `https://`
 * URLs, both unauthenticated) — duckdb's `s3://` scheme was tried first and
 * rejected: it routes through the AWS S3 API client, which failed in this
 * environment with "InvalidAccessKeyId ... proxy-injected" even for public,
 * unsigned objects. Plain HTTPS avoids that path entirely.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cachePath, readCache, writeCache, UA } from './_cache.mjs';

const execFileAsync = promisify(execFile);
const BUCKET = 'https://overturemaps-us-west-2.s3.amazonaws.com';

export const overtureCacheFile = (id) => cachePath(id, 'overture-buildings');

export async function cliAvailable(exec = execFileAsync) {
  try {
    await exec('duckdb', ['-c', 'SELECT 1']);
    return true;
  } catch {
    return false;
  }
}

/** Extract every `<Key>...</Key>` from an S3 ListBucketResult XML body. */
function extractKeys(xml) {
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
}

function nextContinuationToken(xml) {
  const m = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  return m ? m[1] : null;
}

/** The most recent `release/<date>.<n>/` prefix, discovered via plain HTTPS listing. */
export async function latestRelease(fetchFn = fetch) {
  const res = await fetchFn(`${BUCKET}/?list-type=2&prefix=release/&delimiter=/`, { headers: { 'User-Agent': UA } });
  const xml = await res.text();
  const prefixes = [...xml.matchAll(/<Prefix>release\/([^/<]+)\/<\/Prefix>/g)].map((m) => m[1]);
  if (!prefixes.length) throw new Error('no Overture release found');
  return prefixes.sort().at(-1);
}

/** Every `part-*.parquet` key for the buildings/building theme+type, paginated. */
export async function listBuildingPartUrls(release, fetchFn = fetch) {
  const prefix = `release/${release}/theme=buildings/type=building/`;
  const urls = [];
  let token = null;
  do {
    const qs = new URLSearchParams({ 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) });
    const res = await fetchFn(`${BUCKET}/?${qs}`, { headers: { 'User-Agent': UA } });
    const xml = await res.text();
    for (const key of extractKeys(xml)) urls.push(`${BUCKET}/${key}`);
    token = nextContinuationToken(xml);
  } while (token);
  return urls;
}

/**
 * Run the actual bbox query across every part file via the duckdb CLI,
 * writing the SQL to a temp file (the URL list is too large for an argv
 * entry) and reading back the JSON array it writes.
 *
 * Both interpolated inputs are raw-quoted into the SQL string below, so this
 * function re-validates `bounds` itself rather than trusting `run()`'s
 * upstream check — it's exported and independently callable/tested, so the
 * safety invariant has to live on this boundary, not on one caller of it.
 * `urls` is safe by construction: every entry is `${BUCKET}/${key}` where
 * `BUCKET` is this file's own hardcoded constant and `key` comes from
 * `extractKeys()` parsing Overture's own S3 listing — not third-party input.
 */
export async function queryBuildings(urls, bounds, { exec = execFileAsync } = {}) {
  const { north, south, east, west } = bounds || {};
  if (![north, south, east, west].every(Number.isFinite)) {
    throw new Error('queryBuildings requires finite bounds.{north,south,east,west}');
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'overture-buildings-'));
  const sqlFile = path.join(dir, 'query.sql');
  const outFile = path.join(dir, 'out.json');
  const urlList = `[${urls.map((u) => `'${u}'`).join(',')}]`;
  const sql = `
INSTALL httpfs; LOAD httpfs;
INSTALL spatial; LOAD spatial;
COPY (
  SELECT id, names.primary AS name, height, ST_AsGeoJSON(geometry) AS geometry_json
  FROM read_parquet(${urlList})
  WHERE bbox.xmin <= ${east} AND bbox.xmax >= ${west} AND bbox.ymin <= ${north} AND bbox.ymax >= ${south}
) TO '${outFile}' (FORMAT JSON, ARRAY true);
`;
  try {
    writeFileSync(sqlFile, sql);
    // `duckdb <file>.sql` tries to OPEN the argument as a database file, not
    // run it as a script — an explicit `:memory:` db plus `.read` avoids that.
    await exec('duckdb', [':memory:', '-c', `.read ${sqlFile}`]);
    return JSON.parse(readFileSync(outFile, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One shape for every "can't query yet" branch — cache it and report the gap. */
function gapResult(id, cached, error) {
  const stub = cached || { buildings: [], error, gap: true };
  writeCache(id, 'overture-buildings', stub);
  return { adapterId: 'overture-buildings', ok: false, claims: [], meta: { gap: true }, data: stub, error: stub.error };
}

export async function run(ctx = {}, { exec = execFileAsync, fetchFn = fetch } = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'overture-buildings', ok: false, error: 'venueId_required' };

  const cached = readCache(id, 'overture-buildings');
  if (ctx.offline) {
    return { adapterId: 'overture-buildings', ok: Boolean(cached?.buildings?.length), data: cached };
  }

  const bounds = ctx.bounds;
  if (!Number.isFinite(bounds?.north) || !Number.isFinite(bounds?.south) || !Number.isFinite(bounds?.east) || !Number.isFinite(bounds?.west)) {
    return gapResult(id, cached, 'bounds_required');
  }

  if (!(await cliAvailable(exec))) {
    return gapResult(id, cached, 'duckdb CLI not found on PATH (needs httpfs + spatial extensions).');
  }

  try {
    const release = await latestRelease(fetchFn);
    const urls = await listBuildingPartUrls(release, fetchFn);
    const buildings = await queryBuildings(urls, bounds, { exec });
    const out = {
      fetched: new Date().toISOString().slice(0, 10),
      source: 'overturemaps.org',
      license: 'ODbL',
      release,
      buildings,
    };
    writeCache(id, 'overture-buildings', out);
    return {
      adapterId: 'overture-buildings',
      ok: buildings.length > 0,
      claims: [],
      meta: { count: buildings.length, release },
      artifacts: [overtureCacheFile(id)],
      data: out,
    };
  } catch (err) {
    return { adapterId: 'overture-buildings', ok: false, error: err.message };
  }
}
