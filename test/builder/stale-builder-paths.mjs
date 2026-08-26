#!/usr/bin/env node
/**
 * Issue #429 — builder modules moved from scripts/lib into packages/venue-builder.
 * Capability rows and builder docs must not point maintainers at dead paths.
 *
 *   node test/builder/stale-builder-paths.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Builder modules that left scripts/lib when venue-builder became a package. */
const MOVED_UNDER_BUILDER = [
  'evidence.mjs',
  'evidence-graph.mjs',
  'osm-tags.mjs',
  'park-capabilities.mjs',
  'venue-ids.mjs',
  'adapters/registry.mjs',
  'adapters/types.mjs',
  'adapters/index.mjs',
];

const STALE_RE = new RegExp(
  `scripts/lib/(?:${MOVED_UNDER_BUILDER.map((p) => p.replace('/', '\\/')).join('|')})`,
);

const SCAN_PATHS = [
  'packages/venue-builder',
  'docs/universal-venue-builder-architecture.md',
  'docs/universal-venue-builder-dependency-matrix.md',
  'docs/park-intelligence-review.md',
  'docs/THIRD_PARTY_LICENSES.md',
];

const PASS = [];
const FAIL = [];
const ok = (n) => { PASS.push(n); console.log('  PASS', n); };
const bad = (n, e) => { FAIL.push(`${n} :: ${e}`); console.log('  FAIL', n, '->', e); };

function collectFiles(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const st = fs.statSync(abs);
  if (st.isFile()) return [rel];
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    out.push(...collectFiles(path.join(rel, ent.name)));
  }
  return out;
}

function staleHitsInFile(rel) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const hits = [];
  for (const line of text.split('\n')) {
    if (STALE_RE.test(line) && !line.includes('used to live under')) {
      hits.push(line.trim());
    }
  }
  return hits;
}

console.log('\nbuilder stale-paths suite\n');

try {
  const { CAPABILITIES } = await import('../../packages/venue-builder/lib/park-capabilities.mjs');
  const staleCapabilityFiles = CAPABILITIES
    .map((row) => row.file)
    .filter((file) => file && STALE_RE.test(file));
  assert.deepEqual(
    staleCapabilityFiles,
    [],
    `CAPABILITIES file pointers must not cite pre-move scripts/lib paths: ${staleCapabilityFiles.join(', ')}`,
  );
  ok('park-capabilities rows point at current package layout');
} catch (e) {
  bad('park-capabilities rows point at current package layout', e.message);
}

try {
  const offenders = [];
  for (const rel of SCAN_PATHS.flatMap(collectFiles)) {
    const hits = staleHitsInFile(rel);
    if (hits.length) offenders.push({ rel, hits });
  }
  assert.deepEqual(
    offenders,
    [],
    offenders.map(({ rel, hits }) => `${rel}:\n  ${hits.join('\n  ')}`).join('\n'),
  );
  ok('builder code and architecture docs contain no stale scripts/lib builder paths');
} catch (e) {
  bad('builder code and architecture docs contain no stale scripts/lib builder paths', e.message);
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
