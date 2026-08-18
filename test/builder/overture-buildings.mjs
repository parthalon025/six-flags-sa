#!/usr/bin/env node
/** overture-buildings adapter — ODbL building footprints via the duckdb CLI. */
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import {
  latestRelease,
  listBuildingPartUrls,
  cliAvailable,
  queryBuildings,
  run,
} from '../../packages/venue-builder/lib/adapters/overture-buildings.mjs';

// gapResult() reuses a cached stub once one exists (same pattern as
// mapillary-video.mjs/esa-worldcover.mjs), so each check that writes a gap
// needs its own venue id — sharing one lets an earlier gap's cached error
// mask a later, differently-caused one.
const TEST_VENUE = '__test-overture-buildings__';
const TEST_VENUE_2 = '__test-overture-buildings-2__';
const TEST_VENUE_3 = '__test-overture-buildings-3__';

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

console.log('\novertureoverture-buildings adapter suite\n'.replace('overtureoverture', 'overture'));

const S3_LIST_XML = (prefixes) => `<?xml version="1.0"?><ListBucketResult>${prefixes
  .map((p) => `<CommonPrefixes><Prefix>release/${p}/</Prefix></CommonPrefixes>`)
  .join('')}</ListBucketResult>`;

await check('latestRelease picks the lexicographically newest release prefix', async () => {
  const fakeFetch = async () => ({ text: async () => S3_LIST_XML(['2026-05-21.0', '2026-07-22.0', '2026-01-15.1']) });
  const release = await latestRelease(fakeFetch);
  assert.equal(release, '2026-07-22.0');
});

await check('latestRelease throws when nothing is listed', async () => {
  const fakeFetch = async () => ({ text: async () => S3_LIST_XML([]) });
  await assert.rejects(() => latestRelease(fakeFetch), /no Overture release found/);
});

await check('listBuildingPartUrls follows pagination via NextContinuationToken', async () => {
  let call = 0;
  const fakeFetch = async (url) => {
    call += 1;
    assert.ok(url.includes('theme%3Dbuildings%2Ftype%3Dbuilding'));
    if (call === 1) {
      assert.ok(!url.includes('continuation-token'));
      return {
        text: async () =>
          `<ListBucketResult><Contents><Key>release/r/theme=buildings/type=building/part-00000.parquet</Key></Contents><NextContinuationToken>tok123</NextContinuationToken></ListBucketResult>`,
      };
    }
    assert.ok(url.includes('continuation-token=tok123'));
    return {
      text: async () =>
        `<ListBucketResult><Contents><Key>release/r/theme=buildings/type=building/part-00001.parquet</Key></Contents></ListBucketResult>`,
    };
  };
  const urls = await listBuildingPartUrls('r', fakeFetch);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].endsWith('part-00000.parquet'));
  assert.ok(urls[1].endsWith('part-00001.parquet'));
  assert.equal(call, 2);
});

await check('cliAvailable reports false when duckdb is not on PATH', async () => {
  const failing = async () => {
    throw new Error('ENOENT: duckdb not found');
  };
  assert.equal(await cliAvailable(failing), false);
});

await check('queryBuildings writes the SQL, invokes duckdb, and reads the JSON it wrote', async () => {
  const fakeExec = async (cmd, args) => {
    assert.equal(cmd, 'duckdb');
    assert.deepEqual(args[0], ':memory:');
    assert.equal(args[1], '-c');
    const readArg = args[2]; // ".read <sqlFile>"
    const sqlFile = readArg.replace(/^\.read /, '');
    const sql = readFileSync(sqlFile, 'utf8');
    const outMatch = sql.match(/TO '([^']+)'/);
    assert.ok(outMatch, 'sql should COPY TO an output file');
    writeFileSync(outMatch[1], JSON.stringify([{ id: 'b1', name: 'Test Building', geometry_json: { type: 'Polygon' } }]));
    return { stdout: '', stderr: '' };
  };
  const buildings = await queryBuildings(
    ['https://example.com/a.parquet'],
    { north: 1, south: 0, east: 1, west: 0 },
    { exec: fakeExec },
  );
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].name, 'Test Building');
});

await check('queryBuildings re-validates bounds itself, not just via run()', async () => {
  await assert.rejects(
    () => queryBuildings(['https://example.com/a.parquet'], { north: 'DROP TABLE x', south: 0, east: 1, west: 0 }),
    /finite bounds/,
  );
  await assert.rejects(() => queryBuildings(['https://example.com/a.parquet'], null), /finite bounds/);
});

await check('run() requires a venueId', async () => {
  const res = await run({});
  assert.equal(res.ok, false);
  assert.equal(res.error, 'venueId_required');
});

await check('run() gaps when bounds are missing, without erroring', async () => {
  const res = await run({ venueId: TEST_VENUE });
  assert.equal(res.ok, false);
  assert.equal(res.meta.gap, true);
});

await check('run() gaps when the duckdb CLI is unavailable', async () => {
  const failingExec = async () => {
    throw new Error('ENOENT');
  };
  const res = await run(
    { venueId: TEST_VENUE_2, bounds: { north: 1, south: 0, east: 1, west: 0 } },
    { exec: failingExec },
  );
  assert.equal(res.ok, false);
  assert.equal(res.meta.gap, true);
  assert.ok(res.error.includes('duckdb CLI not found'));
});

await check('run() processes real buildings end to end with fully injected dependencies', async () => {
  const fakeFetch = async (url) => {
    if (url.includes('delimiter=/')) return { text: async () => S3_LIST_XML(['2026-07-22.0']) };
    return {
      text: async () =>
        `<ListBucketResult><Contents><Key>release/2026-07-22.0/theme=buildings/type=building/part-00000.parquet</Key></Contents></ListBucketResult>`,
    };
  };
  const fakeExec = async (cmd, args) => {
    if (args[0] === '-c') return { stdout: '', stderr: '' }; // cliAvailable check
    const sqlFile = args[2].replace(/^\.read /, '');
    const sql = readFileSync(sqlFile, 'utf8');
    const outFile = sql.match(/TO '([^']+)'/)[1];
    writeFileSync(outFile, JSON.stringify([{ id: 'raptor', name: 'Raptor', geometry_json: { type: 'Polygon' } }]));
    return { stdout: '', stderr: '' };
  };
  const res = await run(
    { venueId: TEST_VENUE_3, bounds: { north: 1, south: 0, east: 1, west: 0 } },
    { exec: fakeExec, fetchFn: fakeFetch },
  );
  assert.equal(res.ok, true);
  assert.equal(res.meta.count, 1);
  assert.equal(res.meta.release, '2026-07-22.0');
  assert.deepEqual(res.claims, []); // polygon evidence has no shape in evidence.mjs yet — footprint-fusion.mjs's job
});

for (const id of [TEST_VENUE, TEST_VENUE_2, TEST_VENUE_3]) {
  try {
    rmSync(new URL(`../../packages/venue-builder/data/venues/${id}`, import.meta.url), {
      recursive: true,
      force: true,
    });
  } catch {
    // best-effort cleanup
  }
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
