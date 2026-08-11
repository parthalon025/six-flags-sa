#!/usr/bin/env node
/**
 * Geocode preflight for the top-100 catalog — flag ambiguous or missing bboxes.
 *
 *   npm run venues:geocode-catalog
 *   npm run venues:geocode-catalog -- --json
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadCatalog } from '../lib/top-parks-catalog.mjs';
import { recipeFile } from '../lib/venue-recipe.mjs';
import { OVERRIDE_DIR, writeJson } from '../lib/venue-io.mjs';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'six-flags-sa-venue-research/1.0 (+https://github.com/parthalon025/six-flags-sa)';

async function resolvePlace(query) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&polygon_geojson=0`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const hits = await res.json();
  if (!hits.length) return { ok: false, error: 'no hit' };
  const hit = hits[0];
  const [south, north, west, east] = hit.boundingbox.map(Number);
  const areaKm2 = Math.abs(north - south) * Math.abs(east - west) * 111 * 111 * Math.cos(((north + south) / 2) * Math.PI / 180);
  return {
    ok: true,
    display: hit.display_name,
    bbox: { south, west, north, east },
    center: { lat: Number(hit.lat), lng: Number(hit.lon) },
    areaKm2,
    suspicious: areaKm2 > 25 || areaKm2 < 0.02,
  };
}

function parseArgs(argv) {
  const out = { json: false, writeRecipe: false, delay: 1100 };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--write-recipe') out.writeRecipe = true;
    else if (a.startsWith('--delay=')) out.delay = Number(a.split('=')[1]);
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  const results = [];

  for (const park of catalog.parks) {
    const hasRecipe = existsSync(recipeFile(park.id));
    let row = { id: park.id, rank: park.rank, name: park.name, hasRecipe, ok: false };
    try {
      const hit = await resolvePlace(park.place);
      row = { ...row, ...hit };
      if (args.writeRecipe && hit.ok && !hasRecipe) {
        const recipe = {
          version: 1,
          id: park.id,
          name: park.name,
          place: park.place,
          box: hit.bbox,
          options: { name: park.name, locality: park.locality, kind: 'theme-park', pad: 120 },
        };
        writeJson(recipeFile(park.id), recipe, true);
        row.recipeWritten = true;
      }
    } catch (err) {
      row.error = err.message;
    }
    results.push(row);
    await sleep(args.delay);
  }

  const ok = results.filter((r) => r.ok && !r.suspicious);
  const failed = results.filter((r) => !r.ok || r.suspicious);
  const summary = {
    total: results.length,
    resolved: ok.length,
    failed: failed.length,
    withRecipe: results.filter((r) => r.hasRecipe).length,
    results,
  };

  const reportFile = path.join(OVERRIDE_DIR, 'geocode-catalog-report.json');
  writeJson(reportFile, summary, true);

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Geocode catalog: ${ok.length}/${results.length} ok, ${failed.length} need attention`);
    for (const f of failed.slice(0, 25)) {
      console.log(`  ${f.rank}. ${f.id}: ${f.error || (f.suspicious ? `suspicious area ${f.areaKm2?.toFixed(2)} km²` : '—')}`);
    }
    console.log(`\nReport: ${reportFile}`);
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
