#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CI_PROVEN_PASSES,
  CLAIM_KINDS,
  RNG_TAINTED_PRIMITIVES,
  claimFromFinding,
  claimsFromPass,
  compareToOsm,
  determinismProof,
  osmPathMap,
  routeImageryExtractions,
  runImageryClaims,
  truthEligibility,
  unmitigatedPrimitives,
} from '../../packages/venue-builder/lib/imagery-claims.mjs';
import { imagerySignedFeatures } from '../../packages/venue-builder/lib/imagery-ledger.mjs';
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
// Those three are worth nothing unless a pass that has done *everything else*
// right is still refused. `unproven` above records no digests, so it would sit
// at zero under a gate widened to read the proof off the extraction record —
// which on this path is `extractions.json`, a builder sidecar a hand can edit.
// This pass agrees with itself byte-for-byte across two runs and must still
// write nothing: agreeing with yourself is not an attestation, and ADR-0020
// clause 3 admits truth only "when that exact invocation is CI-proven".
const selfAttested = {
  lane: 'deterministic',
  passId: 'not-enrolled-anywhere',
  determinism: { digests: ['e'.repeat(64), 'e'.repeat(64)] },
};
assert.equal(
  routeImageryExtractions(
    [{ ...selfAttested, kind: 'path', at: far, label: 'self-attested-walk' }],
    { map: factoryMap },
  ).truth.length,
  0,
  'digests a hand-editable sidecar wrote about itself are not CI attestation',
);
assert.equal(
  truthEligibility(selfAttested).reasons.length,
  1,
  'the missing CI proof is the whole of what stands between this pass and truth',
);
assert.match(
  truthEligibility(selfAttested).reasons[0],
  /pass "not-enrolled-anywhere" is not CI-proven/,
  'and the refusal names the pass and the attestation it lacks',
);
assert.equal(
  truthEligibility(selfAttested).proof.proven,
  true,
  'guard: its determinism really is proven, so the refusal above is the CI gate and nothing else',
);
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

// The wall, exercised rather than described. Every kind on the list, not just
// the first one — a wall that only knows one spelling stops one spelling.
assert.ok(DISPUTE_KINDS.length > 0, 'guard: there is a dispute kind for the wall to stop');
for (const kind of DISPUTE_KINDS) {
  assert.throws(
    () => assertNoDisputeKinds(['height', kind], 'a re-added allowlist'),
    new RegExp(`a re-added allowlist spells dispute kind\\(s\\) ${kind}`),
    `the wall must reject an allowlist that re-adds ${kind}`,
  );
}
// `evidence_conflict` is deliberately not one of them. The owner ruled on
// 2026-08-23 that a ride whose sources disagree stays visible to guests, so it
// ships on `verify` (ship-gaps.mjs) and cannot be a member of a list whose
// every member is stamped `shipped: false`.
assert.ok(
  !DISPUTE_KINDS.includes('evidence_conflict'),
  'a kind that reaches a guest must not be enrolled as a builder-side-only dispute',
);
assert.throws(
  () => disputeRow({ kind: 'evidence_conflict' }),
  /unknown dispute kind/,
  'a ride evidence conflict cannot be written into the never-shipped dispute record',
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

// ---------------------------------------------------------------------------
// Determinism is derived from digests, never read off a flag.
//
// ADR-0020 clause 3: "determinism is proven per pass, never assumed". A
// `deterministic: true` flag is the assumption written down, so the gate reads
// the recorded output digests instead — two of them, and identical.

assert.equal(determinismProof({}).proven, false, 'no recorded run proves nothing');
assert.equal(determinismProof({}).runs, 0);
assert.match(
  determinismProof({ determinism: { digests: ['a'.repeat(64)] } }).why,
  /two consecutive runs/,
  'one run is the same number twice only if you count it twice',
);
assert.equal(
  determinismProof({ determinism: { digests: ['a'.repeat(64), 'b'.repeat(64)] } }).proven,
  false,
  'two runs that disagree are the opposite of a proof',
);
assert.match(
  determinismProof({ determinism: { digests: ['a'.repeat(64), 'b'.repeat(64)] } }).why,
  /digests differ across runs/,
);
const blank = determinismProof({ determinism: { digests: ['', ''] } });
assert.equal(
  blank.proven,
  false,
  'two empty digests are two recordings of nothing — an absent output cannot equal itself into a proof',
);
assert.equal(blank.runs, 0, 'an empty digest is not a run that happened');
assert.match(blank.why, /two consecutive runs/, 'and it is reported as no runs, not as disagreement');
assert.equal(
  determinismProof({ determinism: { digests: ['', 'a'.repeat(64)] } }).proven,
  false,
  'one real digest beside a blank is still one run',
);

const twice = determinismProof({ determinism: { digests: ['a'.repeat(64), 'a'.repeat(64)] } });
assert.equal(twice.proven, true, 'two byte-identical runs are the proof the ADR asks for');
assert.equal(twice.runs, 2);
assert.equal(twice.digest, 'a'.repeat(64), 'the proof carries the digest it rests on');

const provenPass = {
  lane: 'deterministic',
  passId: 'canny-path-edges',
  determinism: { digests: ['c'.repeat(64), 'c'.repeat(64)] },
};
assert.equal(
  routeImageryExtractions(
    [{ ...provenPass, kind: 'path', at: far, label: 'new-walk' }],
    { map: factoryMap },
  ).truth.length,
  0,
  'the shipped gate is shut: a perfect proof still needs CI to have attested the invocation',
);

// ---------------------------------------------------------------------------
// The truth write itself, against a copy of the module with one pass enrolled.
//
// `CI_PROVEN_PASSES` is empty by construction and stays that way — ADR-0020
// clause 3 admits a truth write "only when that exact invocation is CI-proven
// byte-identical across consecutive runs", so the shipped module can only ever
// be watched refusing. Enrolling one id in a copy (the technique the ship-gaps
// wall is proven with above) is what makes the *other* conjunct visible: every
// case below that still writes nothing is refused by `determinismProof` or by
// the RNG list, with the CI gate already satisfied.
const claimsSource = readFileSync(path.join(LIB_DIR, 'imagery-claims.mjs'), 'utf8');
const enrolledSource = claimsSource
  .replace(/from '\.\/([^']+)'/g, (_m, f) => `from '${pathToFileURL(path.join(LIB_DIR, f)).href}'`)
  .replace(
    'export const CI_PROVEN_PASSES = Object.freeze([]);',
    "export const CI_PROVEN_PASSES = Object.freeze(['canny-path-edges']);",
  );
assert.ok(
  enrolledSource.includes("Object.freeze(['canny-path-edges'])"),
  'guard: the fixture must actually enrol a pass in the copy',
);
const ciDir = mkdtempSync(path.join(tmpdir(), 'imagery-claims-ci-'));
let ciEnrolled;
try {
  const fixture = path.join(ciDir, 'imagery-claims-enrolled.mjs');
  writeFileSync(fixture, enrolledSource);
  ciEnrolled = await import(pathToFileURL(fixture).href);
} finally {
  rmSync(ciDir, { recursive: true, force: true });
}
assert.deepEqual(
  ciEnrolled.CI_PROVEN_PASSES,
  ['canny-path-edges'],
  'guard: the copy is the same module with one pass on the list',
);

/** Truth rows this enrolled build writes for `provenPass` with `over` applied. */
const enrolledTruth = (over = {}) => ciEnrolled.routeImageryExtractions(
  [{ ...provenPass, kind: 'path', at: far, label: 'new-walk', ...over }],
  { map: factoryMap },
).truth.length;

assert.equal(
  enrolledTruth(),
  1,
  'CI-attested, deterministic lane, digests agreeing across two runs: the case that writes truth',
);
assert.equal(
  ciEnrolled.routeImageryExtractions(
    [{ ...provenPass, kind: 'path', at: far, label: 'new-walk' }],
    { map: factoryMap },
  ).claims.length,
  0,
  'and it is a truth row instead of a claim, not as well as one',
);
assert.equal(
  enrolledTruth({ passId: 'some-other-canny' }),
  0,
  'enrolment is of one invocation by id — a sibling pass is not covered by it',
);
assert.equal(
  enrolledTruth({ at: near }),
  0,
  'truth is only ever a write of what OSM lacks; where the two agree, imagery corroborates',
);
assert.equal(
  enrolledTruth({ at: null }),
  0,
  'and an extraction that says where nothing is has nothing to add — `outside` is not `adds`',
);

// With the CI gate satisfied, each of these is `determinismProof` doing the
// refusing on its own — the substance of the attestation rather than the id.
assert.equal(
  enrolledTruth({ determinism: undefined }),
  0,
  'an enrolled pass that recorded no digests has published nothing to be identical about',
);
assert.equal(
  enrolledTruth({ determinism: { digests: ['c'.repeat(64)] } }),
  0,
  'one run is the same number twice only if you count it twice',
);
assert.equal(
  enrolledTruth({ determinism: { digests: ['c'.repeat(64), 'd'.repeat(64)] } }),
  0,
  'digests that disagree keep the pass in the evidence graph',
);
assert.equal(
  enrolledTruth({ determinism: { digests: ['', ''] } }),
  0,
  'and two blanks do not agree their way through the gate either',
);
assert.equal(
  enrolledTruth({ deterministic: true, determinism: undefined }),
  0,
  'a pass asserting `deterministic: true` about itself has still proven nothing (ADR-0020 clause 3)',
);
assert.equal(
  enrolledTruth({ deterministic: false }),
  0,
  'the flag is not the gate, but a pass that says out loud it is nondeterministic is believed',
);
assert.equal(
  enrolledTruth({ lane: 'model' }),
  0,
  'proof does not promote a lane — a pinned model is claims-only however identical its runs',
);
assert.equal(
  enrolledTruth({ lane: 'agent' }),
  0,
  'nor does it promote the agent lane, which the research note bars from truth outright',
);

// ---------------------------------------------------------------------------
// RNG-tainted OpenCV primitives, as data rather than as prose in the research
// note. A pass that routes through one of them cannot write truth until it
// declares the mitigations, however well its digests agree and however
// thoroughly CI watched it.

assert.deepEqual(
  Object.keys(RNG_TAINTED_PRIMITIVES).sort(),
  ['findfundamentalmat', 'findhomography', 'grabcut', 'kmeans', 'ransac'],
  'the five primitives the CV research note names as adopt-on-trigger',
);
const kmeansPass = { ...provenPass, primitives: ['cv2.kmeans', 'cv2.Canny'] };
assert.deepEqual(
  unmitigatedPrimitives(kmeansPass).map((p) => p.primitive),
  ['kmeans'],
  'a primitive is matched by its bare name, however the pass spells it',
);
assert.deepEqual(
  unmitigatedPrimitives(kmeansPass)[0].unmet,
  ['seeded', 'single-thread', 'ipp-disabled'],
);
assert.equal(
  enrolledTruth({ primitives: ['cv2.kmeans', 'cv2.Canny'] }),
  0,
  'GrabCut-grade k-means with no declared mitigation never writes truth',
);
assert.match(
  truthEligibility(kmeansPass).reasons.join(' | '),
  /cv2\.kmeans is RNG-tainted .*still undeclared: seeded, single-thread, ipp-disabled/,
  'the refusal names the primitive and what is still missing',
);
assert.equal(
  enrolledTruth({
    primitives: ['cv2.kmeans', 'cv2.Canny'],
    mitigations: ['seeded', 'single-thread', 'ipp-disabled'],
  }),
  1,
  'a fully mitigated pass with a real proof and a CI attestation behind it does write truth',
);
assert.equal(
  enrolledTruth({
    primitives: ['cv2.kmeans'],
    mitigations: ['seeded', 'single-thread'],
  }),
  0,
  'a partly mitigated pass is not a mitigated one — the unmet row is what refuses it',
);
assert.equal(
  enrolledTruth({ primitives: ['cv2.findHomography'] }),
  0,
  'a RANSAC homography fit is tainted too — its estimator ignores setRNGSeed',
);
assert.deepEqual(
  unmitigatedPrimitives({ primitives: ['cv2.findHomography'], mitigations: ['lmeds-refit'] }),
  [],
  'an LMedS refit is the declared mitigation for the homography row',
);

// ---------------------------------------------------------------------------
// Findings become `src`-signed claims, refused up front on ledger provenance.

const LEDGER = {
  'naip-oh-2024': {
    id: 'naip-oh-2024',
    source: 'planetary-computer:naip',
    served_via: 'Microsoft Planetary Computer STAC',
    captured: '2024-05-11',
    sha256: 'a'.repeat(64),
    license: 'public-domain',
    path: null,
  },
  'county-via-esri': {
    id: 'county-via-esri',
    source: 'some-county-gis',
    served_via: 'Esri World Imagery',
    captured: '2025-03-01',
    sha256: 'b'.repeat(64),
    license: 'public-domain',
    path: null,
  },
};
const goodProv = { by: 'aerial', tile: 'naip-oh-2024', source: 'planetary-computer:naip' };

const signed = claimFromFinding({ kind: 'path', at: far, label: 'new-walk' }, goodProv);
assert.ok(signed.src, 'a finding becomes a claim with a src block on it, or it is not a claim');
assert.equal(signed.src.by, 'aerial');
assert.equal(signed.src.tile, 'naip-oh-2024', 'the claim carries the tile it was read off');
assert.deepEqual(signed.at, far, 'a signed claim keeps its position');
assert.equal(
  imagerySignedFeatures({ path: [signed] }).length,
  1,
  'a signed claim is visible to the imagery_ledger gate — an unsigned row is invisible to it',
);
assert.equal(
  imagerySignedFeatures({ path: [{ kind: 'path', at: far }] }).length,
  0,
  'guard: it is the src block doing that work, not the row existing',
);

// The router signs conditionally, and *both* halves of that conditional are
// decisions with a forgery on the other side of them. `extractions.json` is
// hand-editable: a row that names no imagery must not come out of the router
// wearing `aerial`, because the certification gate reads exactly that block and
// would count a hand-typed line as pixel-derived evidence. And a row that does
// declare provenance must come out carrying it, or a real imagery read is
// invisible to the same gate and its coverage question is never asked.
const unprovenanced = routeImageryExtractions(
  [{ lane: 'agent', kind: 'path', at: far, label: 'hand-typed-walk' }],
  { map: factoryMap },
);
assert.equal(unprovenanced.claims.length, 1, 'guard: the unsigned row routed at all');
assert.equal(
  unprovenanced.claims[0].src,
  undefined,
  'an extraction naming no imagery must not be stamped `aerial` — that forges the ledger block',
);
assert.equal(
  imagerySignedFeatures({ path: [unprovenanced.claims[0]] }).length,
  0,
  'and the imagery_ledger gate must not count a hand-typed row as pixel-derived',
);

const provenanced = routeImageryExtractions(
  [{ lane: 'agent', kind: 'path', at: far, label: 'read-off-a-tile' }],
  { map: factoryMap, provenance: goodProv },
);
assert.equal(
  provenanced.claims[0].src?.tile,
  'naip-oh-2024',
  'a router handed provenance signs the row with the tile it was read off',
);
assert.equal(provenanced.claims[0].src.by, 'aerial', 'and with the evidence class of the pixels');
assert.equal(
  imagerySignedFeatures({ path: [provenanced.claims[0]] }).length,
  1,
  'which is the whole point: an unsigned imagery row is invisible to the certification gate',
);
// A row that arrived already signed goes through the signing path too — the
// `extraction.src ||` half of the conditional. What reaches the ledger gate is
// then one block shape rather than whatever the sidecar happened to type.
const carried = routeImageryExtractions(
  [{
    lane: 'agent',
    kind: 'path',
    at: { ...far, note: 'sidecar scribble' },
    label: 'self-signed',
    src: { by: 'aerial', tile: 'naip-oh-2024' },
  }],
  { map: factoryMap },
);
assert.equal(
  carried.claims[0].src.tile,
  'naip-oh-2024',
  'a row that arrived already signed keeps its own provenance through the router',
);
assert.deepEqual(
  carried.claims[0].src,
  { by: 'aerial', source: null, tile: 'naip-oh-2024' },
  'and comes out in the block shape the ledger reads, not the shape the sidecar typed',
);
assert.deepEqual(
  carried.claims[0].at,
  far,
  'its position is normalised on the same pass — a sidecar scribble does not ride into the graph',
);

const passed = claimsFromPass({
  pass: { lane: 'agent', passId: 'agent-brief-read' },
  findings: [{ kind: 'path', at: far, label: 'new-walk' }],
  provenance: goodProv,
  ledger: LEDGER,
  map: factoryMap,
});
assert.deepEqual(passed.refused, [], 'a ledgered NAIP tile is refused nothing');
assert.equal(passed.claims.length, 1);
assert.equal(passed.claims[0].src.tile, 'naip-oh-2024');

const refusedFor = (over) => claimsFromPass({
  pass: { lane: 'agent', passId: 'agent-brief-read' },
  findings: [{ kind: 'path', at: far, label: 'new-walk', ...over.finding }],
  provenance: { ...goodProv, ...over.provenance },
  ledger: LEDGER,
  map: factoryMap,
});

const esri = refusedFor({ provenance: { tile: 'county-via-esri', source: 'some-county-gis' } });
assert.equal(esri.claims.length, 0, 'an Esri-served tile produces no claim at all');
assert.equal(esri.refused.length, 1, 'it is refused, not merely dropped');
assert.match(
  esri.refused[0].problems.join(' | '),
  /rejects esri for derivation/,
  'the refusal is the ledger\'s own words on ADR-0020 clause 2, not a re-decision here',
);
const unledgered = refusedFor({ provenance: { tile: 'naip-oh-2099', source: 'planetary-computer:naip' } });
assert.equal(unledgered.refused.length, 1, 'an unledgered tile is refused');
assert.match(
  unledgered.refused[0].problems.join(' | '),
  /is not in the imagery ledger/,
  'a tile nothing pinned has no provenance to stand on',
);
const traced = refusedFor({ provenance: { by: 'traced' } });
assert.equal(traced.refused.length, 1, 'a non-imagery evidence class is refused');
assert.match(
  traced.refused[0].problems.join(' | '),
  /is not an imagery evidence class/,
  'this lane derives from pixels or not at all',
);
const wait = refusedFor({ finding: { kind: 'queue_wait' } });
assert.equal(
  wait.refused.length,
  1,
  'a queue wait is not something imagery reads, whatever provenance is attached',
);
assert.match(wait.refused[0].problems.join(' | '), /is not something imagery reads/);
assert.equal(wait.claims.length, 0);
const nowhere = refusedFor({ finding: { at: null } });
assert.equal(nowhere.refused.length, 1, 'a finding with no position is refused');
assert.equal(nowhere.refused[0].problems.join(' | '), 'new-walk: no position');
assert.deepEqual(
  claimsFromPass({
    pass: { lane: 'agent' },
    findings: [{ kind: 'path', at: offset, label: 'moved-walk' }],
    provenance: { ...goodProv, tile: 'county-via-esri' },
    ledger: LEDGER,
    map: factoryMap,
  }).disputes,
  [],
  'a refused finding disputes nothing either — it never reached the router',
);

// The closed vocabulary is enforced on the router itself, not only on the
// provenance path: `extractions.json` is a builder sidecar a hand can edit.
const invented = routeImageryExtractions(
  [{ lane: 'agent', kind: 'height_requirement', at: offset, label: 'nope' }],
  { map: factoryMap },
);
assert.equal(invented.claims.length, 0, 'an invented kind produces no claim');
assert.equal(invented.disputes.length, 0, 'and no dispute wearing imagery\'s provenance');
assert.equal(invented.refused.length, 1);
assert.ok(CLAIM_KINDS.includes('path') && CLAIM_KINDS.includes('place'));

// ---------------------------------------------------------------------------
// Place positions: the comparison that used to be made against walkable
// geometry or not at all.

const M_PER_DEG_LAT = 110540;
const north = (at, m) => ({ lat: at.lat + m / M_PER_DEG_LAT, lng: at.lng });
const pois = [
  { i: 'vortex', n: 'Vortex', c: 'coaster', ...near },
  { i: 'twins-a', n: 'The Twins', c: 'ride', ...north(near, 500) },
  { i: 'twins-b', n: 'The Twins', c: 'ride', ...north(near, 520) },
];
const placeAt = north(near, 20);

const moved = routeImageryExtractions(
  [{ lane: 'agent', kind: 'place', target: 'vortex', at: placeAt, label: 'Vortex' }],
  { map: factoryMap, pois },
);
assert.equal(moved.disputes.length, 1, 'imagery reading a Place twenty metres off is a dispute');
assert.equal(
  moved.disputes[0].kind,
  'place_disputed',
  'a Place in the wrong spot is its own kind of disagreement, not a path one',
);
assert.equal(moved.disputes[0].target, 'vortex', 'the dispute names the Place it is about');
assert.equal(moved.disputes[0].shipped, false, 'a place dispute never ships either');
assert.equal(
  moved.disputes[0].extraction.comparison.matchedBy,
  'target',
  'and records how the two were matched, for the steward weighing it',
);
assert.ok(moved.claims.some((c) => c.dissent === true), 'the dissenting claim survives');
assert.equal(
  routeImageryExtractions(
    [{ lane: 'agent', kind: 'place', at: placeAt, label: 'Vortex' }],
    { map: factoryMap, pois },
  ).disputes[0].target,
  'vortex',
  'a Place is identified by its title too, through ship-gaps own resolver',
);
// Forty metres off twins-a and sixty off twins-b: near enough to either that a
// resolver willing to pick one would raise a dispute against it.
assert.equal(
  routeImageryExtractions(
    [{ lane: 'agent', kind: 'place', at: north(near, 460), label: 'The Twins' }],
    { map: factoryMap, pois },
  ).disputes.length,
  0,
  'an ambiguous title is skipped rather than forked across two same-named rides',
);
assert.equal(
  routeImageryExtractions(
    [{ lane: 'agent', kind: 'place', category: 'coaster', at: north(near, 20) }],
    { map: factoryMap, pois },
  ).disputes[0].extraction.comparison.matchedBy,
  'nearest',
  'a categorised read matches the nearest Place of that category',
);
assert.equal(
  compareToOsm({ kind: 'place', category: 'coaster', at: north(near, 300) }, { pois }).relation,
  'adds',
  'far enough out it is a different Place, so imagery is adding rather than arguing',
);
assert.equal(
  compareToOsm({ kind: 'place', target: 'vortex', at: near }, { pois }).relation,
  'agrees',
  'and on top of OSM the two agree',
);
assert.equal(
  compareToOsm({ kind: 'place', target: 'vortex', at: placeAt }, { map: factoryMap }).relation,
  'adds',
  'with no Places to compare against there is nothing to dispute',
);
assert.equal(
  compareToOsm({ kind: 'tree', at: offset }, { map: factoryMap }).relation,
  'adds',
  'a tree is not a walkway: OSM carries none, so imagery can only add one',
);
assert.deepEqual(
  pois.map((p) => `${p.i}:${p.lat},${p.lng}`),
  [`vortex:${near.lat},${near.lng}`, `twins-a:${north(near, 500).lat},${near.lng}`, `twins-b:${north(near, 520).lat},${near.lng}`],
  'the dispute detector reads truth and writes none — the Places handed in are untouched',
);

const placeRun = runImageryClaims('kings-island', {
  map: factoryMap,
  pois,
  extractions: [{ lane: 'agent', kind: 'place', target: 'vortex', at: placeAt, label: 'Vortex' }],
});
assert.equal(
  placeRun.disputes.length,
  1,
  'a run given Places compares against them — dropping them loses the dispute silently',
);
assert.equal(placeRun.disputes[0].kind, 'place_disputed');

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
assert.equal(
  missingKey.claims[0]?.displayName,
  'Front Gate',
  'without a key the adapter serves the venue cache sidecar it read from disk',
);
if (prevKey) process.env.GOOGLE_MAPS_API_KEY = prevKey;

// The cache sink is stubbed, so this exercises the real fetch path without
// rewriting `fixture-park/google-places-cache.json` — a suite that mutates
// tracked builder input makes its own second run start from other inputs, and
// trains everyone to discard a dirty tree unread (#34).
const wrote = [];
const sink = (venueId, suffix, data) => {
  wrote.push({ venueId, suffix, data });
  return `memory://${venueId}/${suffix}`;
};
const okFetch = async () => ({
  ok: true,
  json: async () => ({ id: 'ChIJtest', displayName: { text: 'Front Gate' } }),
});

process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const before = Date.now();
const fetched = await runGooglePlaces(
  { venueId: 'fixture-park', placeIds: ['ChIJtest'] },
  { fetchFn: okFetch, writeCacheFn: sink },
);
const after = Date.now();

const pinned = new Date('2020-01-02T03:04:05.000Z');
await runGooglePlaces(
  { venueId: 'fixture-park', placeIds: ['ChIJtest'] },
  { fetchFn: okFetch, writeCacheFn: sink, now: () => pinned },
);
delete process.env.GOOGLE_MAPS_API_KEY;

assert.equal(fetched.ok, true);
assert.equal(fetched.claims[0].displayName, 'Front Gate');
assert.equal(wrote.length, 2, 'a genuine run still writes its cache — through the sink it was given');
assert.equal(wrote[0].venueId, 'fixture-park');
assert.equal(wrote[0].suffix, 'google-places');
assert.deepEqual(wrote[0].data.placeIds, ['ChIJtest']);

// Only the sink is stubbed on the first run, so its stamp is the real clock.
const stamped = Date.parse(wrote[0].data.fetched);
assert.ok(
  stamped >= before && stamped <= after,
  `a genuine run records real fetch time, got ${wrote[0].data.fetched}`,
);
assert.equal(
  wrote[1].data.fetched,
  pinned.toISOString(),
  'an injected clock is what a caller uses to pin the stamp — the default is not pinned',
);

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
// Named for what it is rather than `wrote`, which this file already uses at
// module scope for the stubbed cache sink (#781). Two legitimate additions
// collided on one name when the branches merged.
const persisted = writeImageryDisputes({
  meta: { id: 'fixture-park' },
  map: factoryMap,
  extractions: disputed,
  write: (doc) => { recorded = doc; },
});
assert.equal(persisted.wrote, true, 'a dispute is persisted to the maintainer sidecar');
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
// Suffixed with the pid because cleanup is a shared-filesystem `finally` keyed
// on this string alone. test:builder chains its files sequentially today, so
// nothing races — but a parallel runner, a manual double-run or a retry would
// have two invocations sharing VENUE_DIR and clobbering each other's cleanup,
// and the tree this test writes into is the real apps/party-tracker/public one.
const PROBE_ID = `zz-dispute-probe-${process.pid}`;
const probeMap = { path: [{ r: [[-84.268, 39.344], [-84.267, 39.345]] }] };
const probeMeta = {
  id: PROBE_ID,
  name: 'Dispute Probe',
  kind: 'theme-park',
  center: { lat: 39.3445, lng: -84.2675 },
  bounds: { north: 39.345, south: 39.344, east: -84.267, west: -84.268 },
};
// A Place for imagery to disagree with, and the read that disagrees with it.
// `writeVenue` is the only caller that has both the extractions and the Places
// in hand, so a place-position dispute is found there or nowhere.
const probeRide = { i: 'probe-ride', n: 'Probe Ride', c: 'coaster', lat: 39.3445, lng: -84.2675 };
const probePois = [probeRide];
const probeRideMoved = { lat: probeRide.lat + 20 / 110540, lng: probeRide.lng };
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
    [
      { lane: 'agent', kind: 'path', at: offset, label: 'moved-walk' },
      { lane: 'agent', kind: 'place', target: 'probe-ride', at: probeRideMoved, label: 'Probe Ride' },
    ],
    true,
  );

  writeVenue({ meta: probeMeta, map: probeMap, pois: probePois });

  assert.ok(
    existsSync(probeSidecar),
    'publishing a venue must record its disputes — writeVenue is the seam where they would silently vanish',
  );
  const published = readJson(probeSidecar);
  assert.equal(published.venue, PROBE_ID);
  assert.equal(published.shipped, false);
  assert.equal(published.disputes.length, 2, 'the disputes this build found are in the record');
  assert.equal(published.disputes[0].kind, 'path_disputed');
  assert.equal(
    published.disputes[0].extraction?.label,
    'moved-walk',
    'the dissenting evidence is recorded with it, not just the fact of a dispute',
  );
  // The place dispute only exists if writeVenue handed its Places down: with no
  // POIs to compare against, an imagery read of a Place degrades silently to
  // "imagery adds a Place" and this row is simply absent.
  assert.equal(published.disputes[1].kind, 'place_disputed');
  assert.equal(published.disputes[1].target, 'probe-ride', 'and it names the Place OSM already has');
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
