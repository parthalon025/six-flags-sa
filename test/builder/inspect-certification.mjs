#!/usr/bin/env node
/**
 * venues:inspect certification dashboard — reads certification.json and renders
 * markdown via the certify module (#424).
 *
 *   node test/builder/inspect-certification.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

console.log('\ninspect certification dashboard\n');

const {
  certificationFilePath,
  readCertificationDoc,
  certificationVenueSummary,
  certificationDashboard,
  certificationDetail,
} = await import('../../packages/venue-builder/lib/inspect-certification.mjs');

const { createInspectHandler } = await import('../../packages/venue-builder/lib/inspect-handlers.mjs');

const root = mkdtempSync(path.join(tmpdir(), 'inspect-cert-'));
const venueId = 'demo-park';
const venueDir = path.join(root, 'data', 'venues', venueId);
mkdirSync(venueDir, { recursive: true });

const fixtureDoc = {
  version: 1,
  venue: { id: venueId, name: 'Demo Park', locality: 'Testville' },
  certified: false,
  certifiedAt: null,
  bundleFingerprint: 'abc',
  checks: [
    {
      key: 'checklist',
      claim: 'Required completeness items pass',
      pass: true,
      evidence: { numerator: 4, denominator: 4, detail: '4/4 required items ok' },
      confidence: 'high',
      falsifier: 'x',
      soWhat: 'y',
    },
    {
      key: 'park_map_research',
      claim: 'Official park map image is local or LLM park-map search recorded candidates',
      pass: false,
      evidence: { numerator: 0, denominator: 1, detail: 'local_images=0' },
      confidence: 'low',
      falsifier: 'x',
      soWhat: 'y',
    },
  ],
  ask: {
    venue: { id: venueId, name: 'Demo Park' },
    blocking: true,
    requests: [
      {
        key: 'park_map',
        need: 'Official park map image',
        blocking: true,
        why: 'No local map image for georef',
      },
    ],
  },
};

writeFileSync(path.join(venueDir, 'certification.json'), JSON.stringify(fixtureDoc, null, 2));

const overrideDir = path.join(root, 'data', 'venues');
const manifestPath = path.join(root, 'data', 'venues', 'manifest.json');
writeFileSync(
  manifestPath,
  JSON.stringify({ venues: [{ id: venueId, name: 'Demo Park', counts: {} }] }, null, 2),
);

await check('certificationFilePath resolves under overrideDir', () => {
  const p = certificationFilePath(venueId, { overrideDir });
  assert.equal(p, path.join(venueDir, 'certification.json'));
  return true;
});

await check('certificationFilePath rejects traversal', () => {
  const p = certificationFilePath('../../etc/passwd', { overrideDir });
  assert.equal(p, null);
  return true;
});

await check('readCertificationDoc returns on-disk certification.json', () => {
  const doc = readCertificationDoc(venueId, { overrideDir });
  assert.equal(doc.venue.id, venueId);
  assert.equal(doc.certified, false);
  return true;
});

await check('certificationVenueSummary lists blocking checks and asks', () => {
  const summary = certificationVenueSummary(venueId, { overrideDir });
  assert.equal(summary.available, true);
  assert.equal(summary.certified, false);
  assert.deepEqual(summary.blockingChecks, ['park_map_research']);
  assert.equal(summary.blockingAsks.length, 1);
  assert.equal(summary.blockingAsks[0].need, 'Official park map image');
  assert.equal(summary.checksPassed, 1);
  assert.equal(summary.checksTotal, 2);
  return true;
});

await check('certificationDashboard aggregates manifest venues', () => {
  const dash = certificationDashboard({ overrideDir, manifestPath });
  assert.equal(dash.total, 1);
  assert.equal(dash.uncertified, 1);
  assert.equal(dash.certified, 0);
  assert.equal(dash.venues[0].venueId, venueId);
  return true;
});

await check('certificationDetail includes markdown from renderCertificationMarkdown', () => {
  const detail = certificationDetail(venueId, { overrideDir });
  assert.equal(detail.available, true);
  assert.match(detail.markdown, /# Certification — Demo Park/);
  assert.match(detail.markdown, /park_map_research/);
  assert.match(detail.markdown, /Not certified/);
  assert.match(detail.markdown, /Official park map image/);
  return true;
});

await check('GET /api/certifications returns fleet summary JSON', async () => {
  const handler = createInspectHandler({
    overrideDir,
    manifestPath,
    uiDir: path.join(root, 'ui-missing'),
    venuesDir: path.join(root, 'public', 'venues'),
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/certifications`);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.total, 1);
    assert.equal(body.venues[0].blockingChecks[0], 'park_map_research');
  } finally {
    server.close();
  }
  return true;
});

await check('GET /api/certification/:id returns markdown detail', async () => {
  const handler = createInspectHandler({
    overrideDir,
    manifestPath,
    uiDir: path.join(root, 'ui-missing'),
    venuesDir: path.join(root, 'public', 'venues'),
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/certification/${venueId}`);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.venueId, venueId);
    assert.match(body.markdown, /Blocking requests/);
  } finally {
    server.close();
  }
  return true;
});

await check('GET /api/certification/:id escapes venue id in JSON (no traversal)', async () => {
  const handler = createInspectHandler({
    overrideDir,
    manifestPath,
    uiDir: path.join(root, 'ui-missing'),
    venuesDir: path.join(root, 'public', 'venues'),
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/certification/..%2F..%2Fetc%2Fpasswd`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
