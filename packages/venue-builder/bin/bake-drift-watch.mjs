#!/usr/bin/env node
/**
 * Bake-certification drift watch — does a fresh bake still match the
 * signature shipped in every venue's display-certification.json?
 *
 * Same shape as `venues:drift-watch` (fleet dry-run rebuild for OSM
 * geometry), aimed at the display pipeline's bake tier instead: for every
 * committed `bakes.<kit>` row, re-bake that kit into a scratch directory
 * (bin/display-bake.mjs, the same Chromium render `venues:bake` pays for)
 * and diff the fresh signature against the committed one
 * (src/bake-drift.mjs). A change to a kit definition, a reference profile,
 * or the compositor that alters a single sampled pixel shows up here even
 * when nothing touched the venue itself (#509).
 *
 *   npm run venues:bake-drift-watch
 *   npm run venues:bake-drift-watch -- --json
 *   npm run venues:bake-drift-watch -- big-kahunas
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILE, readJson } from '../lib/venue-io.mjs';
import { readCommittedBakes, driftedBakes } from '../src/bake-drift.mjs';

const BAKE_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'display-bake.mjs');

function printUsage() {
  console.log(
    [
      'Bake-certification drift watch — does a fresh bake still match the',
      'signature shipped in every venue\'s display-certification.json?',
      '',
      '  npm run venues:bake-drift-watch',
      '  npm run venues:bake-drift-watch -- --json',
      '  npm run venues:bake-drift-watch -- big-kahunas',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const out = { json: false, help: false, _: [] };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out._.push(a);
  }
  return out;
}

/** Re-bake every committed kit for one venue into a scratch dir; read the fresh signatures back. */
function rebakeVenue(id, kitIds) {
  const outRoot = mkdtempSync(path.join(tmpdir(), `bake-drift-${id}-`));
  try {
    const args = [BAKE_BIN, id, ...kitIds.flatMap((k) => ['--kit', k]), '--out', outRoot];
    const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const fresh = {};
    for (const kitId of kitIds) {
      const cert = readJson(path.join(outRoot, `${id}--${kitId}.style-cert.json`), null);
      if (cert) fresh[kitId] = { signature: cert.signature, certified: cert.certified };
    }
    return {
      fresh,
      exitCode: res.status,
      log: `${res.stdout || ''}${res.stderr || ''}`.trim().slice(-800),
    };
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
}

function checkVenue(id) {
  const committed = readCommittedBakes(id);
  const kitIds = Object.keys(committed);
  if (!kitIds.length) {
    return { venue: id, checked: 0, drifted: [], note: 'no committed bake certifications for this venue' };
  }
  const { fresh, exitCode, log } = rebakeVenue(id, kitIds);
  const drifted = driftedBakes(id, committed, fresh);
  const missing = kitIds.filter((k) => !fresh[k]);
  return {
    venue: id,
    checked: kitIds.length,
    drifted,
    ...(missing.length ? { missing } : {}),
    ...(exitCode ? { bakeExitCode: exitCode } : {}),
    ...(drifted.length || missing.length || exitCode ? { log } : {}),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  const manifest = readJson(MANIFEST_FILE, { venues: [] });
  const ids = args._.length ? args._ : manifest.venues.map((v) => v.id);
  const rows = ids.map(checkVenue);
  const drifted = rows.flatMap((r) => r.drifted);
  const failed = rows.filter((r) => r.missing?.length || r.bakeExitCode);

  const summary = {
    checked: rows.reduce((n, r) => n + r.checked, 0),
    drifted: drifted.length,
    failed: failed.length,
    generated: new Date().toISOString(),
    rows,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Bake drift watch: ${drifted.length} kit(s) drifted, ${failed.length} venue(s) failed to re-bake, across ${rows.length} venue(s)`);
    for (const d of drifted) {
      console.log(`  ${d.venue} × ${d.kit}: committed ${d.committedSignature ?? '(none)'} vs fresh ${d.freshSignature}`);
    }
    for (const r of failed) {
      console.log(`  ${r.venue}: re-bake did not produce every certification (exit ${r.bakeExitCode ?? 'ok'}, missing ${r.missing?.join(', ') || 'none'})`);
    }
  }

  process.exit(drifted.length || failed.length ? 1 : 0);
}

main();
