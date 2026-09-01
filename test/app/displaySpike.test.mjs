#!/usr/bin/env node
/**
 * displaySpike.js — the MapLibre spike's byte-source seam (issue #527).
 *
 * The allow-list is the security boundary of /api/display-spike (nothing
 * outside it may be read off disk), and parseByteRange is what makes the
 * pmtiles archive's byte-range fetches work — both pure, both tested here
 * so a regression fails fast instead of as a blank map or an open path.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { displaySpikeFile, displaySpikeContentType, isMapLibreWorkerFile, parseByteRange } = await import(
  '../../apps/party-tracker/lib/displaySpike.js'
);
const { DISPLAY_SPIKE_SKIN, DISPLAY_SPIKE_VENUE, PARK_MAP_RENDERERS, parkMapRenderer } = await import(
  '../../apps/party-tracker/lib/mapLibreConfigured.js'
);

const PASS = [];
const FAIL = [];
const check = (name, fn) => {
  try {
    fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

/* ------------------------------------------------------------ allow-list -- */

check('pack files resolve into the spike venue display dir', () => {
  for (const name of ['base.pmtiles', `${DISPLAY_SPIKE_SKIN}.style.json`]) {
    const file = displaySpikeFile(name);
    assert.ok(file, `${name} should be allow-listed`);
    const parts = file.split(path.sep);
    assert.ok(parts.includes(DISPLAY_SPIKE_VENUE), `${name} resolves under the venue dir`);
    assert.ok(parts.includes('display'), `${name} resolves under display/`);
  }
});

check('worker bundle files resolve into maplibre-gl/dist', () => {
  for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
    const file = displaySpikeFile(name);
    assert.ok(file, `${name} should be allow-listed`);
    assert.ok(file.includes(path.join('maplibre-gl', 'dist')), `${name} comes from the bundled library`);
    assert.equal(isMapLibreWorkerFile(name), true, `${name} is served even when the spike is off`);
  }
  assert.equal(isMapLibreWorkerFile('base.pmtiles'), false);
  assert.equal(isMapLibreWorkerFile('../recipe.json'), false);
});

check('anything not allow-listed is refused, traversal included', () => {
  for (const name of [
    'hillshade.png', // on disk beside the pack, deliberately not served
    'display-certification.json',
    '../recipe.json',
    '../../cedar-point/display/base.pmtiles',
    '../../../../../../etc/passwd',
    'base.pmtiles/../theme.json',
    '',
    'style.json',
  ]) {
    assert.equal(displaySpikeFile(name), null, `"${name}" must not resolve`);
    assert.equal(displaySpikeContentType(name), null, `"${name}" must have no content type`);
  }
});

check('content types match what browsers and pmtiles expect', () => {
  assert.equal(displaySpikeContentType('base.pmtiles'), 'application/octet-stream');
  assert.equal(displaySpikeContentType(`${DISPLAY_SPIKE_SKIN}.style.json`), 'application/json');
  assert.equal(displaySpikeContentType('maplibre-gl-worker.mjs'), 'text/javascript');
});

/* --------------------------------------------------------- parseByteRange -- */

check('explicit ranges clamp to the file and keep their bounds', () => {
  assert.deepEqual(parseByteRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=0-16383', 27742), { start: 0, end: 16383 });
  // pmtiles routinely over-asks past EOF; the reply clamps rather than 416s.
  assert.deepEqual(parseByteRange('bytes=900-1999', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange(' bytes=5-5 ', 10), { start: 5, end: 5 });
});

check('open-ended range runs to the last byte', () => {
  assert.deepEqual(parseByteRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange('bytes=0-', 1), { start: 0, end: 0 });
});

check('suffix range means the last N bytes, not a start of zero', () => {
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { start: 900, end: 999 });
  // Suffix longer than the file is the whole file (RFC 7233 §2.1).
  assert.deepEqual(parseByteRange('bytes=-5000', 1000), { start: 0, end: 999 });
});

check('malformed and unsatisfiable ranges come back null (the route 416s)', () => {
  for (const raw of ['bytes=-', 'bytes=abc-def', 'items=0-99', 'bytes=9-5', 'bytes=-0', 'bytes=0-99,200-299', '']) {
    assert.equal(parseByteRange(raw, 1000), null, `"${raw}" should be rejected`);
  }
  // Start at or past EOF cannot be satisfied.
  assert.equal(parseByteRange('bytes=1000-1999', 1000), null);
});

/* ------------------------------------------------- which renderer draws -- */
/* Slice h11 ports ParkMap behind the map view seam. ADR-0019 clause 3 makes
   MapLibre the one renderer, and slice h18 retired the SVG adapter that was
   the escape hatch, so what is left to pin is that a stale answer — a build
   env, a bookmarked query string — still resolves to the engine that ships. */

check('the shipped renderer is MapLibre', () => {
  assert.deepEqual([...PARK_MAP_RENDERERS], ['gl']);
  assert.equal(parkMapRenderer({ env: undefined, search: '' }), 'gl');
  assert.equal(parkMapRenderer(), 'gl', 'and with nothing asked at all');
});

check('a review can still ask for the shipped renderer by name', () => {
  assert.equal(parkMapRenderer({ env: 'gl', search: '' }), 'gl');
  assert.equal(parkMapRenderer({ env: undefined, search: '?parkMap=gl' }), 'gl');
  // svg is retired — asking for it falls back to the shipped engine
  assert.equal(parkMapRenderer({ env: 'gl', search: '?parkMap=svg' }), 'gl');
});

check('a renderer nobody wrote falls back rather than blanking the map', () => {
  for (const asked of ['webgpu', '1', 'true', '', null]) {
    assert.equal(parkMapRenderer({ env: asked, search: '' }), 'gl', `env ${JSON.stringify(asked)}`);
  }
  assert.equal(parkMapRenderer({ env: undefined, search: '?parkMap=webgpu' }), 'gl');
});

/* -------------------------------------------- the retired SVG renderer -- */
/* Slice h18 deleted components/ParkMapSvg.jsx and the layer only it mounted,
   components/CustomMapLayer.jsx. An import of a deleted file cannot survive a
   build, so what can still be wrong is everything that names one in prose: a
   test-estate row routing a file nobody can touch, a header comment saying the
   SVG adapter draws the World, docs/train-h-seams.md calling it the shipped
   one. Prose outlives code unless something reads it. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const RETIRED = [
  'apps/party-tracker/components/ParkMapSvg.jsx',
  'apps/party-tracker/components/CustomMapLayer.jsx',
];

/** Every app source a comment can hide in — components and lib, nesting included. */
function appSources(rel) {
  const out = [];
  for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const next = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...appSources(next));
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(next);
  }
  return out;
}

const SOURCES = [
  ...appSources('apps/party-tracker/components'),
  ...appSources('apps/party-tracker/lib'),
];

check('the retired components are gone, and no test-estate row still routes one', () => {
  const manifest = JSON.parse(read('test/app/modules.json'));
  const routed = [...manifest.fullSuitePaths, ...manifest.modules.flatMap((m) => m.paths)];
  for (const rel of RETIRED) {
    assert.equal(existsSync(path.join(ROOT, rel)), false, `${rel} is deleted`);
    assert.equal(routed.includes(rel), false, `modules.json still routes ${rel}`);
  }
});

check('nothing in the app still names CustomMapLayer', () => {
  // One importer and no story worth telling: the name should be absent rather
  // than explained.
  assert.deepEqual(SOURCES.filter((f) => read(f).includes('CustomMapLayer')), []);
});

check('ParkMapSvg is named only as the renderer that went', () => {
  // It does have a story — the seam existed so it could be retired — so the
  // name stays, in the past tense. A sentence that still has it drawing is the
  // bug this check is for.
  for (const f of [...SOURCES, 'docs/train-h-seams.md']) {
    for (const sentence of read(f).split(/(?<=[.!?])\s+/)) {
      if (!sentence.includes('ParkMapSvg')) continue;
      assert.match(
        sentence,
        /\b(retired|deleted|replaced|was)\b/,
        `${f} still speaks of ParkMapSvg in the present: ${sentence.trim().replace(/\s+/g, ' ')}`,
      );
    }
  }
});

check('docs/train-h-seams.md names the renderers the code has, and no other', () => {
  const seams = read('docs/train-h-seams.md');
  const shipped = `\`${JSON.stringify([...PARK_MAP_RENDERERS]).replace(/"/g, "'")}\``;
  assert.ok(seams.includes(shipped), `the seam note should quote PARK_MAP_RENDERERS as ${shipped}`);
  // A bare backticked engine id in the prose is a claim about what draws.
  for (const [, token] of seams.matchAll(/`([a-z]+)`/g)) {
    if (!['gl', 'svg', 'webgpu'].includes(token)) continue;
    assert.ok(PARK_MAP_RENDERERS.includes(token), `the note still names \`${token}\` as a renderer`);
  }
});

if (FAIL.length) {
  console.error(`displaySpike tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`displaySpike tests: ${PASS.length} passed`);
}
