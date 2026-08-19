#!/usr/bin/env node
/**
 * Display packs — compile + certify per-Skin visual specs for shipped venues.
 *
 *   npm run venues:display -- <venueId> [<venueId>…]
 *   npm run venues:display -- --all [--json]
 *   npm run venues:display -- --all --no-terrain --no-constrain --no-mesh
 *
 * Every capability is on by default. They used to be opt-in flags, which meant
 * a bare run silently produced *less* than the committed output: no terrain
 * block, no hillshade, an unsolved heightfield. Regenerating then looked like a
 * huge regression diff that was really just a forgotten flag. The default now
 * matches what ships.
 *
 * Each capability degrades to a declared outcome rather than a failure when its
 * input is missing — no DEM coverage compiles flat, no tippecanoe records a
 * tiles gap — so the defaults stay safe on a machine with none of the optional
 * toolchain. `--no-<capability>` opts out of any of them.
 *
 * Writes data/venues/<id>/display/<skin>.visual.json and
 * display-certification.json. Publishing to public/venues stays a separate,
 * human-gated step (draft PR).
 */

import path from 'node:path';
import { runDisplayStage } from '../lib/display-pack.mjs';
import { VENUE_DIR, readJson, venueSidecar } from '../lib/venue-io.mjs';
import { loadTruthFor } from '../lib/display-pack.mjs';
import { prepareVenueTerrain } from '../lib/terrain/venue-terrain.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const all = argv.includes('--all');
/** On unless switched off; `--<name>` still accepted so old invocations keep working. */
const on = (name) => !argv.includes(`--no-${name}`);
const tiles = on('tiles');
// `--bake` is the one capability that stays opt-in. Passing it *claims a bake
// tier*, and the repo deliberately fails a pack that claims one without a
// certified bake (test/builder/display.mjs: "no bakes = recorded gap, stage
// fails honestly"). venues:bake needs a browser and writes to artifacts/, so
// defaulting the claim on would fail every venue anywhere that has not baked.
const bake = argv.includes('--bake');
const wantTerrain = on('terrain');
const wantConstrain = on('constrain');
const wantMesh = on('mesh');
const ids = argv.filter((a) => !a.startsWith('--'));

const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
const targets = all ? manifest.venues.map((v) => v.id) : ids;

if (!targets.length) {
  console.error('usage: display-pack.mjs <venueId>… | --all [--json] [--no-terrain|--no-constrain|--no-mesh|--no-tiles|--no-bake]');
  process.exit(2);
}

const results = [];
for (const id of targets) {
  try {
    let terrain = null;
    if (wantTerrain) {
      const outDir = venueSidecar(id, 'display');
      const { map } = loadTruthFor(id);
      const prepared = await prepareVenueTerrain({
        id, map, outDir, constrain: wantConstrain, mesh: wantMesh,
      });
      terrain = prepared?.terrain || null;
      if (!json && !terrain) console.log(`${id}: no DEM coverage — compiling flat`);
    }
    const result = runDisplayStage(id, { tiles, terrain, ...(bake ? { bake: {} } : {}) });
    results.push(result);
    if (!json) {
      const mark = result.certified ? 'ok' : 'FAILED';
      const tileNote = result.tiles ? (result.tiles.ok ? `, tiles ${result.tiles.sizeKb} KB` : `, tiles: ${result.tiles.reason}`) : '';
      const bakeNote = result.bakes
        ? `, bakes: ${Object.entries(result.bakes).map(([k, b]) => `${k}:${b.certified ? 'ok' : 'FAIL'}`).join(' ') || 'none found'}`
        : '';
      console.log(`${id}: ${Object.keys(result.packs).length} skin(s) — display-certify ${mark}${tileNote}${bakeNote}`);
      for (const [skinId, pack] of Object.entries(result.packs)) {
        for (const c of pack.certification.checks.filter((x) => !x.pass)) {
          console.log(`  ! ${skinId}.${c.key}: ${c.evidence}`);
        }
      }
    }
  } catch (err) {
    results.push({ venue: id, certified: false, error: err.message });
    if (!json) console.log(`${id}: ERROR — ${err.message}`);
  }
}

if (json) {
  console.log(JSON.stringify(
    results.map(({ venue, certified, error, written }) => ({ venue, certified, error, written })),
    null,
    2,
  ));
}
process.exitCode = results.every((r) => r.certified) ? 0 : 1;
