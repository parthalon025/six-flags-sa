#!/usr/bin/env node
/**
 * venues:inspect evidence review map — serves validation HTML, not a re-render.
 *
 *   node test/builder/inspect-evidence.mjs
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

console.log('\ninspect evidence review map\n');

const {
  evidenceReviewPath,
  evidenceReviewStatus,
  readEvidenceReviewHtml,
  renderEvidenceMissingPage,
  resolveEvidenceReviewPath,
} = await import('../../packages/venue-builder/lib/inspect-evidence.mjs');

const { createInspectHandler } = await import('../../packages/venue-builder/lib/inspect-handlers.mjs');

const root = mkdtempSync(path.join(tmpdir(), 'inspect-evidence-'));
const venueId = 'demo-park';
const venueDir = path.join(root, 'data', 'venues', venueId);
mkdirSync(venueDir, { recursive: true });
const htmlPath = path.join(venueDir, 'evidence.html');
const fixtureHtml = '<!DOCTYPE html><html><body>fixture evidence map</body></html>';
writeFileSync(htmlPath, fixtureHtml);

await check('evidenceReviewPath points at the validation sidecar file', () => {
  const p = evidenceReviewPath(venueId, { overrideDir: path.join(root, 'data', 'venues') });
  assert.equal(p, htmlPath);
  return true;
});

await check('evidenceReviewStatus is available when evidence.html exists on disk', () => {
  const status = evidenceReviewStatus(venueId, { overrideDir: path.join(root, 'data', 'venues') });
  assert.equal(status.available, true);
  assert.equal(status.venueId, venueId);
  return true;
});

await check('evidenceReviewStatus is unavailable when evidence.html is missing', () => {
  const status = evidenceReviewStatus('no-evidence', { overrideDir: path.join(root, 'data', 'venues') });
  assert.equal(status.available, false);
  return true;
});

await check('readEvidenceReviewHtml returns the on-disk HTML without re-rendering', () => {
  const html = readEvidenceReviewHtml(venueId, { overrideDir: path.join(root, 'data', 'venues') });
  assert.equal(html, fixtureHtml);
  return true;
});

await check('renderEvidenceMissingPage is a friendly not-generated state', () => {
  const page = renderEvidenceMissingPage('no-evidence');
  assert.match(page, /not generated/i);
  assert.match(page, /no-evidence/);
  return true;
});

await check('GET /api/evidence/:id returns JSON availability', async () => {
  const handler = createInspectHandler({
    overrideDir: path.join(root, 'data', 'venues'),
    uiDir: path.join(root, 'ui-missing'),
    venuesDir: path.join(root, 'public', 'venues'),
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const hit = await fetch(`http://127.0.0.1:${port}/api/evidence/${venueId}`);
    assert.equal(hit.status, 200);
    const body = JSON.parse(hit.body);
    assert.equal(body.available, true);
    assert.equal(body.venueId, venueId);

    const miss = await fetch(`http://127.0.0.1:${port}/api/evidence/no-evidence`);
    assert.equal(miss.status, 200);
    assert.equal(JSON.parse(miss.body).available, false);
  } finally {
    server.close();
  }
  return true;
});

await check('GET /evidence/:id serves the validation HTML file', async () => {
  const handler = createInspectHandler({
    overrideDir: path.join(root, 'data', 'venues'),
    uiDir: path.join(root, 'ui-missing'),
    venuesDir: path.join(root, 'public', 'venues'),
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/evidence/${venueId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body, fixtureHtml);
  } finally {
    server.close();
  }
  return true;
});

await check('resolveEvidenceReviewPath rejects traversal outside overrideDir', () => {
  const p = resolveEvidenceReviewPath('../../etc/passwd', { overrideDir: path.join(root, 'data', 'venues') });
  assert.equal(p, null);
  return true;
});

await check('renderEvidenceMissingPage escapes venueId in HTML', () => {
  const page = renderEvidenceMissingPage('<script>alert(1)</script>');
  assert.match(page, /&lt;script&gt;/);
  assert.doesNotMatch(page, /<script>alert/);
  return true;
});

await check('GET /evidence/:id without output returns not-generated page (not 404)', async () => {
  const handler = createInspectHandler({
    overrideDir: path.join(root, 'data', 'venues'),
    uiDir: path.join(root, 'ui-missing'),
    venuesDir: path.join(root, 'public', 'venues'),
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/evidence/no-evidence`);
    assert.equal(res.status, 200);
    assert.match(res.body, /not generated/i);
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
