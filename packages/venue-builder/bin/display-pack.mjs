#!/usr/bin/env node
/**
 * Display packs — compile + certify per-Skin visual specs for shipped venues.
 *
 *   npm run venues:display -- <venueId> [<venueId>…]
 *   npm run venues:display -- --all [--tiles] [--json]
 *
 * Writes data/venues/<id>/display/<skin>.visual.json and
 * display-certification.json. Publishing to public/venues stays a separate,
 * human-gated step (draft PR).
 */

import path from 'node:path';
import { runDisplayStage } from '../lib/display-pack.mjs';
import { VENUE_DIR, readJson } from '../lib/venue-io.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const all = argv.includes('--all');
const tiles = argv.includes('--tiles');
const ids = argv.filter((a) => !a.startsWith('--'));

const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
const targets = all ? manifest.venues.map((v) => v.id) : ids;

if (!targets.length) {
  console.error('usage: display-pack.mjs <venueId>… | --all [--json]');
  process.exit(2);
}

const results = [];
for (const id of targets) {
  try {
    const result = runDisplayStage(id, { tiles });
    results.push(result);
    if (!json) {
      const mark = result.certified ? 'ok' : 'FAILED';
      const tileNote = result.tiles ? (result.tiles.ok ? `, tiles ${result.tiles.sizeKb} KB` : `, tiles: ${result.tiles.reason}`) : '';
      console.log(`${id}: ${Object.keys(result.packs).length} skin(s) — display-certify ${mark}${tileNote}`);
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
