#!/usr/bin/env node
/**
 * Georef trace→fit operator loop (#417) — venue id in, traced GeoJSON + report out.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\ngeoref trace loop\n');

const KX = 6371000 * (Math.PI / 180) * Math.cos(39.34 * (Math.PI / 180));
const KY = 6371000 * (Math.PI / 180);
const groundOf = (px, py) => {
  const th = 0.15;
  const s = 0.42;
  const X = s * (px * Math.cos(th) - py * Math.sin(th));
  const Y = s * (px * Math.sin(th) + py * Math.cos(th));
  return { lat: 39.34 + Y / KY, lng: -84.26 + X / KX };
};
const squareControls = () => [[100, 120], [900, 140], [880, 960], [140, 880], [500, 500], [300, 700]]
  .map(([x, y], i) => ({ n: `c${i + 1}`, px: [x, y], ...groundOf(x, y) }));

const {
  runGeorefTraceLoop,
  readGeorefReport,
  georefVenueSummary,
  georefDashboard,
  georefDetail,
  renderGeorefReportMarkdown,
} = await import('../../packages/venue-builder/lib/georef-trace-loop.mjs');

const root = mkdtempSync(path.join(tmpdir(), 'georef-loop-'));
const venueId = 'demo-park';
const venueDir = path.join(root, 'data', 'venues', venueId);
mkdirSync(venueDir, { recursive: true });

const traceDoc = {
  version: 1,
  venue: venueId,
  image: `data/venues/${venueId}/maps/park.webp`,
  source: 'Demo park map',
  map_kind: 'to_scale',
  controls: squareControls(),
  features: [
    { kind: 'place', n: 'Restrooms', c: 'restroom', px: [640, 300] },
    { kind: 'route', n: 'Midway', px: [[200, 200], [400, 400], [600, 500]] },
  ],
};

writeFileSync(path.join(venueDir, 'trace.json'), `${JSON.stringify(traceDoc, null, 2)}\n`);

await check('no trace file is a skipped no-op with notice', async () => {
  const emptyRoot = mkdtempSync(path.join(tmpdir(), 'georef-skip-'));
  const result = runGeorefTraceLoop('missing-venue', { overrideDir: path.join(emptyRoot, 'data', 'venues') });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no trace/i);
  return true;
});

await check('trace→fit→write persists traced.geojson and georef-report sidecars', async () => {
  const result = runGeorefTraceLoop(venueId, { overrideDir: path.join(root, 'data', 'venues'), wire: true });
  assert.equal(result.status, 'ok');
  const traced = path.join(venueDir, 'traced.geojson');
  const reportJson = path.join(venueDir, 'georef-report.json');
  const reportMd = path.join(venueDir, 'georef-report.md');
  assert.ok(existsSync(traced));
  assert.ok(existsSync(reportJson));
  assert.ok(existsSync(reportMd));
  const gj = JSON.parse(readFileSync(traced, 'utf8'));
  assert.equal(gj.properties.venue, venueId);
  assert.equal(gj.features.length, 2);
  const report = readGeorefReport(venueId, { overrideDir: path.join(root, 'data', 'venues') });
  assert.equal(report.accepted, true);
  assert.ok(report.accuracy.rms < 10);
  assert.equal(report.model, result.report.model);
  assert.ok(report.accuracy.residuals.length >= 2);
  const md = readFileSync(reportMd, 'utf8');
  assert.match(md, /cross-validated/i);
  assert.match(renderGeorefReportMarkdown(report), /RMS/);
  return true;
});

await check('over-error budget rejects write and records rejection in report', async () => {
  const badDir = mkdtempSync(path.join(tmpdir(), 'georef-reject-'));
  const badVenue = 'reject-park';
  const badVenueDir = path.join(badDir, 'data', 'venues', badVenue);
  mkdirSync(badVenueDir, { recursive: true });
  const warped = (n) => {
    const k = Math.ceil(Math.sqrt(n));
    const pts = [];
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k && pts.length < n; j += 1) {
        pts.push([100 + (800 * i) / (k - 1), 100 + (800 * j) / (k - 1)]);
      }
    }
    return pts.map(([x, y], i) => ({
      n: `c${i + 1}`,
      px: [x + 90 * Math.sin(y / 300), y - 70 * Math.sin(x / 280)],
      ...groundOf(x, y),
    }));
  };
  writeFileSync(
    path.join(badVenueDir, 'trace.json'),
    `${JSON.stringify({
      venue: badVenue,
      map_kind: 'to_scale',
      controls: warped(9),
      features: [{ kind: 'place', n: 'Gate', c: 'entrance', px: [400, 400] }],
    }, null, 2)}\n`,
  );
  const result = runGeorefTraceLoop(badVenue, {
    overrideDir: path.join(badDir, 'data', 'venues'),
    maxErrorM: 0.5,
  });
  assert.equal(result.status, 'rejected');
  assert.equal(existsSync(path.join(badVenueDir, 'traced.geojson')), false);
  const report = readGeorefReport(badVenue, { overrideDir: path.join(badDir, 'data', 'venues') });
  assert.equal(report.accepted, false);
  assert.ok(report.accuracy.rms > 0.5);
  return true;
});

await check('inspect summaries expose fit quality for venues with a report', async () => {
  const manifestPath = path.join(root, 'data', 'venues', 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({ venues: [{ id: venueId, name: 'Demo Park', counts: {} }] }, null, 2),
  );
  const summary = georefVenueSummary(venueId, { overrideDir: path.join(root, 'data', 'venues') });
  assert.equal(summary.available, true);
  assert.equal(summary.accepted, true);
  assert.ok(summary.rmsM < 10);
  const dash = georefDashboard({ overrideDir: path.join(root, 'data', 'venues'), manifestPath });
  assert.equal(dash.withTrace, 1);
  assert.equal(dash.venues[0].venueId, venueId);
  const detail = georefDetail(venueId, { overrideDir: path.join(root, 'data', 'venues') });
  assert.match(detail.markdown, /Demo Park|demo-park/i);
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  console.error(FAIL.join('\n'));
  process.exit(1);
}
