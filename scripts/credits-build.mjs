#!/usr/bin/env node
/**
 * Build (or check) the generated attribution/credits artifacts from
 * scripts/lib/credits-registry.json.
 *
 *   node scripts/credits-build.mjs build
 *   node scripts/credits-build.mjs check
 *   npm run credits:build
 *   npm run credits:check
 *
 * Writes:
 *   - NOTICE.md (repo root)
 *   - apps/party-tracker/data/credits.json
 *
 * `check` rebuilds to a temp dir and diffs against the committed files —
 * mirrors scripts/agent-docs.mjs's build/check split.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeVendorLedgers, buildCredits } from './lib/credits.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const NOTICE_PATH = join(root, 'NOTICE.md');
const APP_CREDITS_PATH = join(root, 'apps/party-tracker/data/credits.json');
const REGISTRY_PATH = join(root, 'scripts/lib/credits-registry.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Read the Display-factory vendor asset files the registry's ledgers point at. */
function loadVendorFiles(registry, rootDir = root) {
  const files = {};
  for (const spec of registry.vendorLedgers || []) {
    const abs = join(rootDir, spec.file);
    if (existsSync(abs)) files[spec.file] = readJson(abs);
  }
  return files;
}

export function generate({ rootDir = root } = {}) {
  const registry = readJson(REGISTRY_PATH);
  const files = loadVendorFiles(registry, rootDir);
  const ledgers = computeVendorLedgers(registry.vendorLedgers, files);
  const { notice, appCredits } = buildCredits({
    registry: registry.sources,
    ledgers,
    overarchingNote: registry.overarchingNote,
  });
  return {
    notice,
    appCreditsJson: `${JSON.stringify(appCredits, null, 2)}\n`,
  };
}

function writeAll() {
  const { notice, appCreditsJson } = generate();
  writeFileSync(NOTICE_PATH, notice, 'utf8');
  writeFileSync(APP_CREDITS_PATH, appCreditsJson, 'utf8');
  return [NOTICE_PATH, APP_CREDITS_PATH];
}

function check() {
  const { notice, appCreditsJson } = generate();
  const drift = [];
  const normalize = (s) => s.replace(/\r\n/g, '\n');
  if (!existsSync(NOTICE_PATH) || normalize(readFileSync(NOTICE_PATH, 'utf8')) !== normalize(notice)) {
    drift.push('NOTICE.md');
  }
  if (
    !existsSync(APP_CREDITS_PATH) ||
    normalize(readFileSync(APP_CREDITS_PATH, 'utf8')) !== normalize(appCreditsJson)
  ) {
    drift.push('apps/party-tracker/data/credits.json');
  }
  return drift;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || 'check';

  if (mode === 'build') {
    const written = writeAll();
    console.log(`credits: wrote ${written.length} files`);
    for (const p of written) console.log(`  ${p}`);
    process.exit(0);
  }

  if (mode === 'check') {
    const drift = check();
    if (drift.length) {
      console.error('credits: generated files are out of date. Run: npm run credits:build');
      for (const d of drift) console.error(`  ${d}`);
      process.exit(1);
    }
    console.log('credits: ok');
    process.exit(0);
  }

  console.error('Usage: node scripts/credits-build.mjs <build|check>');
  process.exit(1);
}
