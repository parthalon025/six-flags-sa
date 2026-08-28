#!/usr/bin/env node
/**
 * --reapply must not strip OpenStreetMap provenance from the key ledger (#27).
 * Seam: assignKeys when incoming pois carry keys but no build-time osm field.
 */
import assert from 'node:assert/strict';
import { assignKeys } from '../../packages/venue-builder/lib/venue-ids.mjs';

const PASS = [];
const FAIL = [];
const ok = (n) => {
  PASS.push(n);
  console.log('  PASS', n);
};
const bad = (n, e) => {
  FAIL.push(`${n} :: ${e}`);
  console.log('  FAIL', n, '->', e);
};

console.log('\nreapply osm provenance\n');

try {
  const ledger = {
    venue: 'cedar-point',
    keys: {
      'twenty-one-and-colder': {
        n: "21° and Colder",
        c: 'food',
        at: '41.482185,-82.685578',
        osm: 'w841992298',
      },
    },
  };
  /* On-disk pois after a build: keyed, no osm — exactly what --reapply reads. */
  const onDisk = [
    {
      i: 'twenty-one-and-colder',
      n: "21° and Colder",
      c: 'food',
      lat: 41.482185,
      lng: -82.685578,
    },
  ];
  const keyed = assignKeys(onDisk, ledger, { venue: 'cedar-point' });
  assert.equal(
    keyed.ledger.keys['twenty-one-and-colder'].osm,
    'w841992298',
    'ledger osm must survive re-keying when the bundle no longer carries provenance',
  );
  ok('assignKeys carries prior ledger osm forward when incoming pois lack osm');
} catch (e) {
  bad('assignKeys carries prior ledger osm forward when incoming pois lack osm', e.message);
}

try {
  const ledger = {
    venue: 'cedar-point',
    keys: {
      'millennium-force': {
        n: 'Millennium Force',
        c: 'ride',
        at: '41.484917,-82.683917',
        osm: 'w12345',
      },
    },
  };
  const fromOsm = [
    {
      n: 'Millennium Force',
      c: 'ride',
      lat: 41.484917,
      lng: -82.683917,
      osm: 'w99999',
    },
  ];
  const keyed = assignKeys(fromOsm, ledger, { venue: 'cedar-point', keepOsm: true });
  assert.equal(
    keyed.ledger.keys['millennium-force'].osm,
    'w99999',
    'fresh OSM provenance from a rebuild must replace the prior element id',
  );
  ok('assignKeys records fresh osm from source when the poi carries it');
} catch (e) {
  bad('assignKeys records fresh osm from source when the poi carries it', e.message);
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====\n`);
if (FAIL.length) {
  console.error(FAIL.join('\n'));
  process.exit(1);
}
