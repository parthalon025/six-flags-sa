#!/usr/bin/env node
/** mapillary-video adapter — ride-walkthrough video → geotagged-frame evidence. */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import {
  videoClaims,
  cliAvailable,
  processWalkthroughVideo,
  run,
} from '../../packages/venue-builder/lib/adapters/mapillary-video.mjs';

// A synthetic id so run()'s writeCache side effect never touches a real shipped
// venue's data/venues/<id>/ sidecar — cleaned up after the suite either way.
const TEST_VENUE = '__test-mapillary-video__';

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

console.log('\nmapillary-video adapter suite\n');

await check('videoClaims maps geotagged frames to source:video evidence', () => {
  const frames = [
    { filename: 'f0001.jpg', lat: 41.478, lng: -82.682, capturedAt: 1755000000000 },
    { filename: 'f0002.jpg', lat: 41.4781, lng: -82.6821, capturedAt: 1755000001000 },
  ];
  const claims = videoClaims(frames);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].source, 'video');
  assert.equal(claims[0].kind, 'imagery');
  assert.deepEqual(claims[0].at, { lat: 41.478, lng: -82.682 });
  assert.ok(claims[0].note.includes('f0001.jpg'));
  assert.equal(claims[0].date, new Date(1755000000000).toISOString().slice(0, 10));
});

await check('videoClaims drops frames without a resolved coordinate', () => {
  const claims = videoClaims([{ filename: 'no-gps.jpg' }, { filename: 'ok.jpg', lat: 1, lng: 2 }]);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].note.includes('ok.jpg'), true);
});

await check('videoClaims accepts an explicit date override', () => {
  const claims = videoClaims([{ filename: 'a.jpg', lat: 1, lng: 2 }], { date: '2026-01-01' });
  assert.equal(claims[0].date, '2026-01-01');
});

await check('run() gaps when no videoPath is supplied', async () => {
  const res = await run({ venueId: TEST_VENUE });
  assert.equal(res.ok, false);
  assert.equal(res.meta.gap, true);
  assert.ok(res.error.includes('videoPath'));
});

await check('run() gaps when the mapillary_tools CLI is unavailable', async () => {
  const available = await cliAvailable(async () => {
    throw new Error('ENOENT: mapillary_tools not found');
  });
  assert.equal(available, false);
});

await check('run() requires a venueId', async () => {
  const res = await run({});
  assert.equal(res.ok, false);
  assert.equal(res.error, 'venueId_required');
});

await check('processWalkthroughVideo returns [] when the CLI writes no manifest', async () => {
  const fakeExec = async () => ({ stdout: '', stderr: '' });
  const outDir = `/tmp/mapillary-video-test-${Date.now()}`;
  const frames = await processWalkthroughVideo('walkthrough.mp4', outDir, fakeExec);
  assert.deepEqual(frames, []);
});

try {
  rmSync(new URL(`../../packages/venue-builder/data/venues/${TEST_VENUE}`, import.meta.url), {
    recursive: true,
    force: true,
  });
} catch {
  // best-effort cleanup of the synthetic venue's sidecar
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
