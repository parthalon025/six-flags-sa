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

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { displaySpikeFile, displaySpikeContentType, parseByteRange } = await import(
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
  }
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
/* Slice h11 ported ParkMap behind the map view seam; slice h18 retires the SVG
   world viewer, which is ADR-0019 clause 3's convergence finished. There is one
   renderer now, and this is where that is a fact rather than a comment. */

check('the shipped renderer is the ported MapLibre one', () => {
  assert.deepEqual([...PARK_MAP_RENDERERS], ['gl']);
  assert.equal(parkMapRenderer({ env: undefined, search: '' }), 'gl');
  assert.equal(parkMapRenderer(), 'gl', 'and with nothing asked at all');
});

check('the retired renderer is not something a build or a URL can bring back', () => {
  // A build still carrying NEXT_PUBLIC_PARKMAP_RENDERER=svg, a CI lane's env,
  // and a reviewer's bookmarked ?parkMap=svg all outlive the file they name.
  // Each of them draws the shipped map rather than nothing at all.
  assert.equal(parkMapRenderer({ env: 'svg', search: '' }), 'gl');
  assert.equal(parkMapRenderer({ env: undefined, search: '?parkMap=svg' }), 'gl');
  assert.equal(parkMapRenderer({ env: 'svg', search: '?parkMap=svg' }), 'gl');
});

check('a renderer nobody wrote falls back rather than blanking the map', () => {
  for (const asked of ['webgpu', '1', 'true', '', null]) {
    assert.equal(parkMapRenderer({ env: asked, search: '' }), 'gl', `env ${JSON.stringify(asked)}`);
  }
  assert.equal(parkMapRenderer({ env: undefined, search: '?parkMap=webgpu' }), 'gl');
});

check('the switch still resolves a renderer a build names — ADR-0013 item 4 needs it', () => {
  /* The list is not a one-element formality. ADR-0013's real-time PBR tier is
     the next adapter behind the map view seam, and this is where a build or a
     review names it. Asserted against a list this test supplies rather than
     the shipped one, so it keeps meaning something while only `gl` ships. */
  const withPbr = ['gl', 'pbr'];
  assert.equal(parkMapRenderer({ env: 'pbr', search: '', renderers: withPbr }), 'pbr');
  assert.equal(parkMapRenderer({ env: undefined, search: '?parkMap=pbr', renderers: withPbr }), 'pbr');
  // The URL outranks the build in both directions, so a reviewer on a pbr
  // build can put the shipped renderer back beside it without a rebuild.
  assert.equal(parkMapRenderer({ env: 'pbr', search: '?parkMap=gl', renderers: withPbr }), 'gl');
  assert.equal(parkMapRenderer({ env: 'pbr', search: '' }), 'gl', 'but only renderers that exist');
});

if (FAIL.length) {
  console.error(`displaySpike tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`displaySpike tests: ${PASS.length} passed`);
}
