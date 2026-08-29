#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  CI_PROVEN_PASSES,
  compareToOsm,
  osmPathMap,
  routeImageryExtractions,
  runImageryClaims,
} from '../../packages/venue-builder/lib/imagery-claims.mjs';
import { run as runGooglePlaces } from '../../packages/venue-builder/lib/adapters/google-places.mjs';
import { getAdapter } from '../../packages/venue-builder/lib/adapters/registry.mjs';
import {
  buildOsmChangeProposal,
  writeOsmProposalFile,
} from '../../packages/venue-builder/lib/osm-writeback.mjs';
import { SHIPPED_GAP_TYPES } from '../../packages/venue-builder/lib/ship-gaps.mjs';
import {
  DISPUTE_KINDS,
  assertNoDisputeKinds,
  disputeRow,
  recordDisputes,
} from '../../packages/venue-builder/lib/imagery-disputes.mjs';

const geoMap = {
  layers: {
    path: [{
      geometry: { coordinates: [[-84.268, 39.344], [-84.267, 39.345]] },
    }],
  },
};
const factoryMap = {
  path: [{ r: [[-84.268, 39.344], [-84.267, 39.345]] }],
};

const near = { lat: 39.344, lng: -84.268 };
const far = { lat: 39.4, lng: -84.3 };
const offset = { lat: 39.344, lng: -84.26818 };

assert.equal(compareToOsm({ at: far }, { map: geoMap }).relation, 'adds');
assert.equal(compareToOsm({ at: near }, { map: geoMap }).relation, 'agrees');
assert.equal(compareToOsm({ at: offset }, { map: geoMap }).relation, 'disputes');
assert.equal(compareToOsm({ at: offset }, { map: factoryMap }).relation, 'disputes');
assert.equal(osmPathMap(factoryMap).path[0].r.length, 2);

const routed = routeImageryExtractions([
  { lane: 'model', kind: 'path', at: far, label: 'new-walk' },
  { lane: 'deterministic', deterministic: true, passId: 'unproven', kind: 'path', at: far },
  { lane: 'agent', kind: 'path', at: offset, label: 'moved-walk' },
], { map: factoryMap });

assert.equal(routed.truth.length, 0, 'Lane A without a CI-proven pass never writes truth');
assert.equal(CI_PROVEN_PASSES.length, 0, 'no pass is proven until CI says so');
assert.equal(typeof CI_PROVEN_PASSES.add, 'undefined', 'the proven-pass list cannot grow at runtime');
assert.ok(routed.claims.some((c) => c.kind === 'path' && !c.dissent));

// Owner decision (2026-08-22): a disputed path position is a maintainer
// record, not something a guest is ever asked to settle. The router keeps the
// dispute; it has no shipped-Gap channel to put it down.
assert.equal(routed.gaps, undefined, 'the router must not emit a shipped Gap for a dispute');
assert.equal(routed.disputes.length, 1, 'the dispute is still recorded builder-side');
assert.equal(routed.disputes[0].kind, 'path_disputed');
assert.equal(routed.disputes[0].target, null);
assert.equal(routed.disputes[0].shipped, false, 'a dispute row states that it never ships');
assert.ok(
  routed.claims.some((c) => c.dissent === true),
  'the dissenting claim survives alongside the dispute record',
);
assert.ok(
  !SHIPPED_GAP_TYPES.includes('path_disputed'),
  'path_disputed must not be a shipped Gap type (owner decision c, 2026-08-22)',
);

// The wall, exercised rather than described: every dispute kind is checked
// against the allowlist that is actually shipped, and the guard is shown to
// fire on a list that spells one.
assert.ok(DISPUTE_KINDS.length > 1, 'the wall covers every dispute kind, not just the first one');
for (const kind of DISPUTE_KINDS) {
  assert.ok(!SHIPPED_GAP_TYPES.includes(kind), `dispute kind ${kind} is spellable as a shipped Gap type`);
}
assert.doesNotThrow(() => assertNoDisputeKinds(SHIPPED_GAP_TYPES, 'ship-gaps.mjs SHIPPED_GAP_TYPES'));
assert.throws(
  () => assertNoDisputeKinds(['height', 'path_disputed'], 'a re-added allowlist'),
  /a re-added allowlist spells dispute kind\(s\) path_disputed/,
  'the wall must reject an allowlist that re-adds a dispute kind',
);
assert.throws(
  () => disputeRow({ kind: 'made_up_dispute' }),
  /unknown dispute kind/,
  'a dispute must be named from DISPUTE_KINDS, not invented at the call site',
);

const run = runImageryClaims('kings-island', { map: factoryMap, extractions: [] });
assert.equal(run.venue, 'kings-island');
assert.equal(run.gaps, undefined, 'runImageryClaims has no shipped-Gap channel either');
assert.deepEqual(run.disputes, []);

const places = getAdapter('google-places');
assert.ok(places);
assert.equal(places.stage, 'research');
assert.deepEqual(places.evidence_sources, []);

const prevKey = process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_MAPS_API;
const missingKey = await runGooglePlaces({ venueId: 'fixture-park' });
assert.equal(missingKey.gap, true);
assert.equal(missingKey.ok, false);
if (prevKey) process.env.GOOGLE_MAPS_API_KEY = prevKey;

process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const fetched = await runGooglePlaces(
  { venueId: 'fixture-park', placeIds: ['ChIJtest'] },
  {
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ id: 'ChIJtest', displayName: { text: 'Front Gate' } }),
    }),
  },
);
delete process.env.GOOGLE_MAPS_API_KEY;
assert.equal(fetched.ok, true);
assert.equal(fetched.claims[0].displayName, 'Front Gate');

const proposal = buildOsmChangeProposal({ venueId: 'kings-island', claim: { note: 'path position disputed' } });
assert.equal(proposal.status, 'draft');
let invoked = 0;
const refused = writeOsmProposalFile('kings-island', proposal, {
  accepted: false,
  write: () => { invoked += 1; },
});
assert.equal(refused.wrote, false);
assert.equal(invoked, 0, 'a refused write must not touch the sink');
const noSink = writeOsmProposalFile('kings-island', proposal, { accepted: true });
assert.equal(noSink.wrote, false);
const accepted = writeOsmProposalFile('kings-island', proposal, { accepted: true, write: () => { invoked += 1; } });
assert.equal(accepted.wrote, true);
assert.equal(invoked, 1);

const { gapsDocumentFor, imageryDisputesFor, writeImageryDisputes } = await import(
  '../../packages/venue-builder/lib/venue-io.mjs'
);

// The dispute is found and recorded builder-side …
const disputed = [{ lane: 'agent', kind: 'path', at: offset, label: 'moved-walk' }];
const found = imageryDisputesFor({ meta: { id: 'fixture-park' }, map: factoryMap, extractions: disputed });
assert.equal(found.length, 1, 'the build still finds the dispute');
assert.equal(found[0].kind, 'path_disputed');

let recorded = null;
const wrote = writeImageryDisputes({
  meta: { id: 'fixture-park' },
  map: factoryMap,
  extractions: disputed,
  write: (doc) => { recorded = doc; },
});
assert.equal(wrote.wrote, true, 'a dispute is persisted to the maintainer sidecar');
assert.equal(recorded.venue, 'fixture-park');
assert.equal(recorded.shipped, false, 'the record states it never ships');
assert.equal(recorded.disputes[0].kind, 'path_disputed');
assert.equal(recorded.disputes[0].extraction?.label, 'moved-walk', 'the evidence rides along');

let touched = 0;
const quiet = writeImageryDisputes({
  meta: { id: 'fixture-park' },
  map: factoryMap,
  extractions: [],
  write: () => { touched += 1; },
});
assert.equal(quiet.wrote, false, 'no dispute, no sidecar');
assert.equal(touched, 0, 'a venue with nothing in dispute must not touch the sink');

const sinkless = recordDisputes('fixture-park', found, {});
assert.equal(sinkless.wrote, false, 'without a sink the record refuses rather than writing nowhere');

// … and the document the phone fetches knows nothing about it. `extractions`
// is passed deliberately: it used to be the channel that carried a dispute
// into `*.gaps.json`, and this asserts the door is closed rather than moved.
const shipped = gapsDocumentFor({ meta: { id: 'fixture-park' }, pois: [], map: factoryMap });
assert.ok(shipped.gaps.length > 0, 'guard: fixture-park still ships Gaps at all');
assert.deepEqual(
  gapsDocumentFor({ meta: { id: 'fixture-park' }, pois: [], map: factoryMap, extractions: disputed }),
  shipped,
  'no argument to gapsDocumentFor can put a disputed extraction on the wire',
);

console.log('imagery-claims: ok');
