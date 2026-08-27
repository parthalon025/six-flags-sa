#!/usr/bin/env node
/**
 * Inspect server review API — POST records approve/reject to review.json;
 * GET /api/reviews reflects on-disk decisions (#422).
 *
 *   node test/builder/inspect-review.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { createInspectServer } = await import(
  join(root, 'packages/venue-builder/lib/inspect-server.mjs')
);
const { REVIEW_FILE } = await import(
  join(root, 'packages/venue-builder/lib/venue-review.mjs')
);

const TEST_VENUE = '__inspect-review-test';

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          if (res.headers['content-type']?.includes('application/json') && text) {
            try {
              json = JSON.parse(text);
            } catch {
              /* leave null */
            }
          }
          resolve({ status: res.statusCode, text, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const server = createInspectServer({ port: 0 });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

try {
  const missing = await request(port, 'POST', '/api/review', {
    venueId: TEST_VENUE,
    decision: 'maybe',
  });
  assert.equal(missing.status, 400, 'invalid decision is refused');
  assert.match(missing.json?.error || missing.text, /approve|reject/i);

  const approved = await request(port, 'POST', '/api/review', {
    venueId: TEST_VENUE,
    decision: 'approve',
    who: 'inspect-test',
  });
  assert.equal(approved.status, 200, 'approve round-trip succeeds');
  assert.equal(approved.json?.venueId, TEST_VENUE);
  assert.equal(approved.json?.decision, 'approve');

  const reviews = await request(port, 'GET', '/api/reviews');
  assert.equal(reviews.status, 200);
  assert.equal(reviews.json?.[TEST_VENUE], 'approve', 'GET reflects on-disk approve');

  const rejected = await request(port, 'POST', '/api/review', {
    venueId: TEST_VENUE,
    decision: 'reject',
    why: 'needs more heights',
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json?.decision, 'reject');

  const afterReject = await request(port, 'GET', '/api/reviews');
  assert.equal(afterReject.json?.[TEST_VENUE], 'reject', 'latest decision wins on reload');
} finally {
  server.close();
  rmSync(dirname(REVIEW_FILE(TEST_VENUE)), { recursive: true, force: true });
}

console.log('ok inspect-review API');
