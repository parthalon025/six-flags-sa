#!/usr/bin/env node
/**
 * Fleet drift watch — rebuild --dry-run across every shipped venue.
 *
 *   npm run venues:drift-watch
 *   npm run venues:drift-watch -- --json
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, VENUE_DIR } from '../lib/venue-io.mjs';

const BUILDER_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-venue.mjs');

function parseArgs(argv) {
  const out = { json: false, all: false, _: [] };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--all') out.all = true;
    else if (!a.startsWith('--')) out._.push(a);
  }
  return out;
}

function dryRunRebuild(id) {
  const res = spawnSync(process.execPath, [BUILDER_BIN, '--rebuild', id, '--dry-run'], {
    encoding: 'utf8',
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const changed = /would change|changed|differs/i.test(out) && !/nothing would change|no changes/i.test(out);
  const nothing = /nothing would change|already matches|no changes/i.test(out);
  return { id, exitCode: res.status, changed: changed && !nothing, log: out.trim().slice(-500) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const ids = args._.length ? args._ : manifest.venues.map((v) => v.id);
  const rows = ids.map(dryRunRebuild);
  const drifted = rows.filter((r) => r.changed);

  const summary = {
    checked: rows.length,
    drifted: drifted.length,
    stable: rows.length - drifted.length,
    generated: new Date().toISOString(),
    rows,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Drift watch: ${drifted.length}/${rows.length} venues would change on rebuild`);
    for (const r of drifted) {
      console.log(`  ${r.id}`);
    }
  }

  process.exit(drifted.length ? 1 : 0);
}

main();
