#!/usr/bin/env node
/**
 * Venue freshness gate — shipped packs pin the truth they were built on
 * (scripts/lib/venue-freshness.mjs, ADR-0018's factory coupling contract).
 *
 * Fixtures prove the decision functions; the repo assertion at the end is
 * the actual CI gate: every shipped display pack and published bundle
 * manifest must name its venue's current truth stamp, and every bundle's
 * sha256 pins must match the bytes the deployed origin will serve.
 *
 *   node test/scripts/venue-freshness.test.mjs
 */
import assert from 'node:assert/strict';
import {
  freshnessDecision,
  bundleDriftDecision,
  collectTruthStamps,
  collectShippedPacks,
  collectBundles,
  checkVenueFreshness,
} from '../../scripts/lib/venue-freshness.mjs';

/* ------------------------------------------------------ freshnessDecision */

{
  const truth = [
    { venue: 'a', generated: '2026-08-10' },
    { venue: 'b', generated: '2026-08-09' },
  ];
  const fresh = freshnessDecision({
    truth,
    packs: [
      { venue: 'a', kind: 'visual', skin: 'trail', basedOn: '2026-08-10' },
      { venue: 'a', kind: 'bundle', basedOn: '2026-08-10' },
      { venue: 'b', kind: 'visual', skin: 'trail', basedOn: '2026-08-09' },
    ],
  });
  assert.equal(fresh.fresh, true);
  assert.deepEqual(fresh.stale, []);

  const stale = freshnessDecision({
    truth,
    packs: [{ venue: 'a', kind: 'visual', skin: 'trail', basedOn: '2026-08-01' }],
  });
  assert.equal(stale.fresh, false);
  assert.deepEqual(stale.stale, [
    { venue: 'a', kind: 'visual', skin: 'trail', basedOn: '2026-08-01', current: '2026-08-10' },
  ]);

  // A shipped pack with no pin at all is a gate failure, not a shrug.
  const unstamped = freshnessDecision({
    truth,
    packs: [{ venue: 'a', kind: 'bundle', basedOn: null }],
  });
  assert.equal(unstamped.fresh, false);
  assert.equal(unstamped.unstamped.length, 1);

  // A pack for a venue the app does not ship is reported, never failing.
  const unshipped = freshnessDecision({
    truth,
    packs: [{ venue: 'not-shipped', kind: 'visual', skin: 'trail', basedOn: '2026-01-01' }],
  });
  assert.equal(unshipped.fresh, true);
  assert.deepEqual(unshipped.unshipped.map((p) => p.venue), ['not-shipped']);

  // No packs at all is fresh — the gate guards what ships, not what exists.
  assert.equal(freshnessDecision({ truth, packs: [] }).fresh, true);
}

/* ---------------------------------------------------- bundleDriftDecision */

{
  const bundle = {
    files: [
      { path: '/venues/a.map.json', sha256: 'aaa' },
      { path: '/venues/a.pois.json', sha256: 'bbb' },
    ],
  };
  const clean = bundleDriftDecision(
    bundle,
    new Map([
      ['/venues/a.map.json', 'aaa'],
      ['/venues/a.pois.json', 'bbb'],
    ]),
  );
  assert.deepEqual(clean, { clean: true, missing: [], drifted: [] });

  const bad = bundleDriftDecision(
    bundle,
    new Map([
      ['/venues/a.map.json', 'CHANGED'],
      ['/venues/a.pois.json', null],
    ]),
  );
  assert.equal(bad.clean, false);
  assert.deepEqual(bad.drifted, ['/venues/a.map.json']);
  assert.deepEqual(bad.missing, ['/venues/a.pois.json']);

  assert.equal(bundleDriftDecision(null, new Map()).clean, true, 'no manifest, no promises');
}

/* --------------------------------------------------------- the repo gate */

{
  const truth = collectTruthStamps();
  assert.ok(truth.length >= 1, 'the app ships at least one venue');
  assert.ok(truth.every((t) => t.generated), 'every shipped venue carries a generated stamp');

  const packs = collectShippedPacks();
  assert.ok(
    packs.some((p) => p.kind === 'visual') && packs.some((p) => p.kind === 'bundle'),
    'both pack kinds are collected (display visual specs + published bundles)',
  );

  const bundles = collectBundles();
  assert.equal(
    bundles.length,
    truth.length,
    'every shipped venue has a published bundle manifest',
  );

  const gate = checkVenueFreshness();
  const explain = JSON.stringify(
    { stale: gate.decision.stale, unstamped: gate.decision.unstamped, drift: gate.drift.filter((d) => !d.clean) },
    null,
    2,
  );
  assert.ok(
    gate.ok,
    `a shipped pack no longer matches its venue's current truth — rebuild it (venues:display / venues:reindex):\n${explain}`,
  );
}

console.log('venue-freshness: ok (shipped packs pin current truth; bundles match their bytes)');
