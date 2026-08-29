#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
// Loading the real module is the live half of the wall: ship-gaps.mjs runs
// assertNoDisputeKinds over its SHIPPED_GAP_TYPES at module load, so this
// import is what fails the moment a dispute kind is put back on the list.
// That is also why an `assert.ok(!SHIPPED_GAP_TYPES.includes(...))` further
// down could never go red — the file would die here instead. The load-time
// call itself is proven below, on a copy of the module.
import '../../packages/venue-builder/lib/ship-gaps.mjs';
import {
  DISPUTE_KINDS,
  DISPUTE_SIDECAR,
  assertNoDisputeKinds,
  disputeRow,
  recordDisputes,
} from '../../packages/venue-builder/lib/imagery-disputes.mjs';
import { ROUTING_COVERAGE_FILE } from '../../packages/venue-builder/src/paths.mjs';

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

// The wall, exercised rather than described.
assert.ok(DISPUTE_KINDS.length > 1, 'the wall covers every dispute kind, not just the first one');
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

// And the wall is actually *wired* — the one fact about it that nothing else
// would notice going missing. Deleting the `assertNoDisputeKinds(...)` call
// from ship-gaps.mjs breaks no other assertion in this suite, so prove it by
// importing a copy of the real module with a dispute kind put back: the
// import itself must fail.
const LIB_DIR = fileURLToPath(new URL('../../packages/venue-builder/lib/', import.meta.url));
const shipGapsSource = readFileSync(path.join(LIB_DIR, 'ship-gaps.mjs'), 'utf8');
const readded = shipGapsSource
  // Relative specifiers have to survive the move out of lib/.
  .replace(/from '\.\/([^']+)'/g, (_m, f) => `from '${pathToFileURL(path.join(LIB_DIR, f)).href}'`)
  .replace(
    /(export const SHIPPED_GAP_TYPES = Object\.freeze\(\[\n)/,
    `$1  '${DISPUTE_KINDS[0]}',\n`,
  );
assert.ok(
  readded.includes(`  '${DISPUTE_KINDS[0]}',`),
  `guard: the fixture must actually put ${DISPUTE_KINDS[0]} back on SHIPPED_GAP_TYPES`,
);
const wallDir = mkdtempSync(path.join(tmpdir(), 'ship-gaps-wall-'));
let wallError = null;
try {
  const fixture = path.join(wallDir, 'ship-gaps-readded.mjs');
  writeFileSync(fixture, readded);
  await import(pathToFileURL(fixture).href);
} catch (err) {
  wallError = err;
} finally {
  rmSync(wallDir, { recursive: true, force: true });
}
assert.ok(wallError, 'ship-gaps.mjs must refuse to load with a dispute kind on SHIPPED_GAP_TYPES');
assert.match(
  String(wallError.message),
  /spells dispute kind\(s\)/,
  'the refusal must come from assertNoDisputeKinds, not from an unrelated load error',
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

const {
  INDEX_FILE,
  VENUE_DIR,
  gapsDocumentFor,
  imageryDisputesFor,
  readJson,
  reindex,
  venuePkgDir,
  venueSidecar,
  writeImageryDisputes,
  writeJson,
  writeVenue,
} = await import('../../packages/venue-builder/lib/venue-io.mjs');

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

// That equality alone is weaker than it looks: it only catches a leak that
// produces a *new* `{ type, target }` pair. This venue already ships an
// untargeted path Gap — the exact shape an imagery dispute used to take — so a
// leaked row that collided with it would dedupe away and the two documents
// would still match.
assert.ok(
  shipped.gaps.some((g) => g.type === 'path' && g.target === null),
  'guard: the collision target the equality above can be blind to is really there',
);
// So assert the stronger fact the equality is standing in for: `gapsDocumentFor`
// never so much as *reads* `extractions`. A dispute that collides with an
// existing gap target still has to come through this property to get there.
const poisoned = { meta: { id: 'fixture-park' }, pois: [], map: factoryMap };
Object.defineProperty(poisoned, 'extractions', {
  enumerable: true,
  get() {
    throw new Error(
      'gapsDocumentFor read `extractions` — the channel from a dispute into *.gaps.json is open again',
    );
  },
});
assert.deepEqual(
  gapsDocumentFor(poisoned),
  shipped,
  'gapsDocumentFor must ignore extractions entirely, not merely dedupe what leaks',
);

// ---------------------------------------------------------------------------
// The production seam, end to end.
//
// Everything above injects a `write` sink and calls writeImageryDisputes /
// recordDisputes directly, which proves the record is *shaped* right but not
// that anything ever calls it. `writeVenue` is the one place a real build has
// to record a dispute, and the slice's own requirement — the disputes
// themselves must not be lost — lives or dies there. So publish a venue for
// real and read the sidecar back off disk.
//
// The probe venue is created and removed here; every generated file this
// touches is snapshotted first and restored in the `finally`, so a failure
// cannot leave the tree dirty.
const PROBE_ID = 'zz-dispute-probe';
const probeMap = { path: [{ r: [[-84.268, 39.344], [-84.267, 39.345]] }] };
const probeMeta = {
  id: PROBE_ID,
  name: 'Dispute Probe',
  kind: 'theme-park',
  center: { lat: 39.3445, lng: -84.2675 },
  bounds: { north: 39.345, south: 39.344, east: -84.267, west: -84.268 },
};
const probeGapsFile = path.join(VENUE_DIR, `${PROBE_ID}.gaps.json`);
const probeSidecar = venueSidecar(PROBE_ID, DISPUTE_SIDECAR);

const generatedBefore = new Map();
for (const name of readdirSync(VENUE_DIR)) {
  if (name.endsWith('.json')) generatedBefore.set(path.join(VENUE_DIR, name), readFileSync(path.join(VENUE_DIR, name)));
}
for (const file of [INDEX_FILE, ROUTING_COVERAGE_FILE]) generatedBefore.set(file, readFileSync(file));
const venueDirBefore = new Set(readdirSync(VENUE_DIR));

try {
  writeJson(
    venueSidecar(PROBE_ID, 'extractions.json'),
    [{ lane: 'agent', kind: 'path', at: offset, label: 'moved-walk' }],
    true,
  );

  writeVenue({ meta: probeMeta, map: probeMap, pois: [] });

  assert.ok(
    existsSync(probeSidecar),
    'publishing a venue must record its disputes — writeVenue is the seam where they would silently vanish',
  );
  const published = readJson(probeSidecar);
  assert.equal(published.venue, PROBE_ID);
  assert.equal(published.shipped, false);
  assert.equal(published.disputes.length, 1, 'the dispute this build found is in the record');
  assert.equal(published.disputes[0].kind, 'path_disputed');
  assert.equal(
    published.disputes[0].extraction?.label,
    'moved-walk',
    'the dissenting evidence is recorded with it, not just the fact of a dispute',
  );
  for (const gap of readJson(probeGapsFile).gaps) {
    assert.ok(!DISPUTE_KINDS.includes(gap.type), `${gap.type} reached the published gaps file`);
  }

  // And the second path through the same directory: `reindex` republishes every
  // venue's *.gaps.json but deliberately does not touch the dispute record.
  // That is a guarantee, not an accident — reindex re-derives only what
  // `gapsDocumentFor` produces, and `gapsDocumentFor` reads no extractions, so
  // a republish has nothing new to say about disputes and no business
  // overwriting what the build recorded. A steward's edit to the sidecar has to
  // survive it; the sentinel below is what would be lost if reindex started
  // regenerating the record behind the maintainer's back.
  writeJson(probeSidecar, { ...published, stewardNote: 'kept across a reindex' }, true);
  reindex();
  const afterReindex = readJson(probeSidecar);
  assert.equal(
    afterReindex.stewardNote,
    'kept across a reindex',
    'reindex must not rewrite the dispute record — it republishes gaps, it does not re-derive disputes',
  );
  assert.deepEqual(
    afterReindex.disputes,
    published.disputes,
    'the recorded disputes survive a republish unchanged',
  );
  for (const gap of readJson(probeGapsFile).gaps) {
    assert.ok(!DISPUTE_KINDS.includes(gap.type), `${gap.type} reached the gaps file reindex republished`);
  }
} finally {
  for (const [file, bytes] of generatedBefore) writeFileSync(file, bytes);
  for (const name of readdirSync(VENUE_DIR)) {
    if (!venueDirBefore.has(name)) rmSync(path.join(VENUE_DIR, name), { recursive: true, force: true });
  }
  rmSync(venuePkgDir(PROBE_ID), { recursive: true, force: true });
}

console.log('imagery-claims: ok');
