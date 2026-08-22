#!/usr/bin/env node
/**
 * The imagery extraction lanes and the claims/Gap wall — ADR-0020 clause 3
 * (three lanes by certainty; only a deterministic, CI-proven pass may write
 * truth) and clause 5 (OSM stays canonical; imagery adds and flags, never a
 * silent geometry move), under ADR-0021's open item **c** as the owner decided
 * it: imagery disagreements stay builder-side and are never shown to guests.
 *
 * No network, and no fixtures on disk except the four shipped `*.gaps.json`
 * this suite reads to hold the wall against the real tree. The ledger every
 * claim is checked against is a literal in this file, so a licence result here
 * is about this lane's plumbing rather than about whatever
 * data/imagery-ledger.json happens to say today.
 *
 *   node test/builder/imagery-claims.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
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

console.log('\nimagery-claims\n');

const {
  EXTRACTION_LANES,
  RNG_TAINTED_PRIMITIVES,
  CLAIM_KINDS,
  DISPUTE_KINDS,
  FROZEN_GAP_TYPES,
  AGREE_METRES,
  MATCH_METRES,
  OWNER_DECISION_C,
  determinismProof,
  passVerdict,
  claimFromFinding,
  claimsFromPass,
  disputesAgainstTruth,
  imageryDisputeRecord,
  disputeRecordFile,
  writeDisputeRecord,
  gapWallProblems,
} = await import('../../packages/venue-builder/lib/imagery-claims.mjs');

const { WEIGHTS } = await import('../../packages/venue-builder/lib/evidence.mjs');
const { SHIPPED_GAP_TYPES } = await import('../../packages/venue-builder/lib/ship-gaps.mjs');
const { IMAGERY_EVIDENCE_CLASSES, claimCoverage, imagerySignedFeatures } = await import(
  '../../packages/venue-builder/lib/imagery-ledger.mjs'
);
const { OVERRIDE_DIR, VENUE_DIR } = await import('../../packages/venue-builder/src/paths.mjs');
const { normalizeGapsDocument } = await import('../../apps/party-tracker/lib/venue/store.js');

/* ---------------------------------------------------------------- fixtures */

/** A two-row ledger: one admissible NAIP frame, one Esri-served row clause 2 rejects. */
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

const GOOD_PROV = {
  by: 'aerial',
  tile: 'naip-oh-2024',
  source: 'planetary-computer:naip',
  captured: '2024-05-11',
};

const AT = { lat: 39.344, lng: -84.268 };
const M_PER_DEG_LAT = 110540;
/** Move a point due north by `m` metres. Longitude is untouched, so no
 *  cos(latitude) term is needed and the fixture cannot drift with it. */
const north = (at, m) => ({ lat: at.lat + m / M_PER_DEG_LAT, lng: at.lng });

/* Built fresh per call rather than shared. A dispute detector that quietly
   edited the truth handed to it would otherwise do so once, early, and every
   later assertion — including the one about not editing truth — would compare
   the damage against itself and pass. */
const somePois = () => [
  { i: 'vortex', n: 'Vortex', c: 'coaster', ...AT },
  { i: 'diamondback', n: 'Diamondback', c: 'coaster', ...north(AT, 300) },
  { i: 'twins-a', n: 'The Twins', c: 'ride', ...north(AT, 500) },
  { i: 'twins-b', n: 'The Twins', c: 'ride', ...north(AT, 520) },
];

/** One east-west footpath through AT's latitude. */
const someMap = () => ({
  path: [{ n: 'Coney Mall', r: [[AT.lng - 0.002, AT.lat], [AT.lng + 0.002, AT.lat]] }],
});

const laneAPass = (over = {}) => ({
  id: 'canny-path-edges',
  lane: 'A',
  source: 'cv_segmentation',
  primitives: ['cv2.Canny', 'cv2.findContours'],
  confidenceBar: 0.8,
  determinism: { digests: ['deadbeef'.repeat(8), 'deadbeef'.repeat(8)] },
  ...over,
});

const laneBPass = (over = {}) => ({
  id: 'deepforest@1.5.0',
  lane: 'B',
  source: 'cv_detection',
  confidenceBar: 0.8,
  determinism: { digests: ['feedface'.repeat(8), 'feedface'.repeat(8)] },
  ...over,
});

const laneCPass = (over = {}) => ({
  id: 'agent-brief-carousel-read',
  lane: 'C',
  source: 'llm_extract',
  ...over,
});

/* ------------------------------------------------------- lanes, write gate */

await check('the three lanes are A, B and C and each emits a real evidence weight key', () => {
  assert.deepEqual(Object.keys(EXTRACTION_LANES).sort(), ['A', 'B', 'C']);
  for (const [id, lane] of Object.entries(EXTRACTION_LANES)) {
    assert.ok(lane.sources.length > 0, `lane ${id} emits nothing`);
    for (const source of lane.sources) {
      assert.ok(source in WEIGHTS, `lane ${id} emits "${source}", which evidence.mjs does not weigh`);
    }
  }
  return true;
});

await check('a lane A pass with two byte-identical runs and a stated bar may write truth', () => {
  const v = passVerdict(laneAPass());
  assert.equal(v.route, 'truth', v.reasons.join('; '));
  assert.equal(v.lane, 'A');
  return true;
});

await check('one run is not a determinism proof', () => {
  const once = laneAPass({ determinism: { digests: ['deadbeef'.repeat(8)] } });
  const proof = determinismProof(once);
  assert.equal(proof.proven, false);
  assert.match(proof.why, /two consecutive runs/);
  const v = passVerdict(once);
  assert.equal(v.route, 'claim');
  assert.ok(v.reasons.some((r) => /determinism/i.test(r)), v.reasons.join('; '));
  return true;
});

await check('runs that disagree byte for byte are not a determinism proof', () => {
  const v = passVerdict(
    laneAPass({ determinism: { digests: ['deadbeef'.repeat(8), 'cafebabe'.repeat(8)] } }),
  );
  assert.equal(v.route, 'claim');
  assert.ok(v.reasons.some((r) => /differ/i.test(r)), v.reasons.join('; '));
  return true;
});

await check('a lane A pass that declares no confidence bar writes no truth', () => {
  const v = passVerdict(laneAPass({ confidenceBar: undefined }));
  assert.equal(v.route, 'claim');
  assert.ok(v.reasons.some((r) => /confidence bar/i.test(r)), v.reasons.join('; '));
  return true;
});

await check('GrabCut taints a lane A pass until every named mitigation is declared', () => {
  const tainted = laneAPass({ id: 'grabcut-water', primitives: ['cv2.grabCut'] });
  const v = passVerdict(tainted);
  assert.equal(v.route, 'claim', v.reasons.join('; '));
  assert.ok(v.reasons.some((r) => /grabcut/i.test(r)), v.reasons.join('; '));
  const required = RNG_TAINTED_PRIMITIVES.grabcut.mitigations;
  assert.ok(required.length > 1, 'grabcut declares too few mitigations to test a partial one');
  const partial = passVerdict({ ...tainted, mitigations: required.slice(0, -1) });
  assert.equal(partial.route, 'claim', 'a partly mitigated pass still writes no truth');
  const full = passVerdict({ ...tainted, mitigations: [...required] });
  assert.equal(full.route, 'truth', full.reasons.join('; '));
  return true;
});

await check('lane B never writes truth, however confident and however repeatable', () => {
  const v = passVerdict(laneBPass());
  assert.equal(v.route, 'claim');
  assert.ok(v.reasons.some((r) => /never writes truth/i.test(r)), v.reasons.join('; '));
  return true;
});

await check('lane C never writes truth', () => {
  const v = passVerdict(laneCPass());
  assert.equal(v.route, 'claim');
  assert.ok(v.reasons.some((r) => /never writes truth/i.test(r)), v.reasons.join('; '));
  return true;
});

await check('confidence is never the gate — a lane B finding at 1.0 is still a claim', () => {
  const out = claimsFromPass({
    pass: laneBPass(),
    provenance: GOOD_PROV,
    ledger: LEDGER,
    findings: [{ kind: 'tree', at: north(AT, 10), confidence: 1, label: 'oak' }],
  });
  assert.equal(out.truth.length, 0, 'lane B wrote truth');
  assert.equal(out.claims.length, 1);
  assert.ok(
    out.verdict.reasons.some((r) => /verification is the gate/i.test(r)),
    out.verdict.reasons.join('; '),
  );
  return true;
});

await check('an unknown lane, or a source the lane does not emit, is refused outright', () => {
  assert.equal(passVerdict({ id: 'x', lane: 'D', source: 'cv_detection' }).route, 'refused');
  const wrongSource = passVerdict(laneAPass({ source: 'official_map' }));
  assert.equal(wrongSource.route, 'refused');
  assert.ok(wrongSource.reasons.some((r) => /official_map/.test(r)), wrongSource.reasons.join('; '));
  return true;
});

/* ------------------------------------------------- claims against a ledger */

await check("a claim on a tile the ledger does not carry is refused in the ledger's own words", () => {
  const out = claimsFromPass({
    pass: laneBPass(),
    provenance: { ...GOOD_PROV, tile: 'not-in-the-ledger' },
    ledger: LEDGER,
    findings: [{ kind: 'tree', at: north(AT, 10), confidence: 0.9, label: 'oak' }],
  });
  assert.equal(out.claims.length, 0);
  assert.equal(out.truth.length, 0);
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0].problems.join('; '), /not in the imagery ledger/);
  return true;
});

await check('a claim on an Esri-served tile is refused by clause 2, not by this lane', () => {
  const out = claimsFromPass({
    pass: laneBPass(),
    provenance: { ...GOOD_PROV, tile: 'county-via-esri' },
    ledger: LEDGER,
    findings: [{ kind: 'tree', at: north(AT, 10), confidence: 0.9, label: 'oak' }],
  });
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0].problems.join('; '), /rejects esri for derivation/i);
  return true;
});

await check('a claim signed by a class that is not imagery is refused', () => {
  assert.ok(!IMAGERY_EVIDENCE_CLASSES.includes('traced'), 'the fixture must name a non-imagery class');
  const out = claimsFromPass({
    pass: laneBPass(),
    provenance: { ...GOOD_PROV, by: 'traced' },
    ledger: LEDGER,
    findings: [{ kind: 'tree', at: north(AT, 10), confidence: 0.9, label: 'oak' }],
  });
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0].problems.join('; '), /traced/);
  return true;
});

await check('a covered claim carries the tile, the capture date and the lane', () => {
  const out = claimsFromPass({
    pass: laneCPass(),
    provenance: GOOD_PROV,
    ledger: LEDGER,
    findings: [{ kind: 'place', at: north(AT, 3), label: 'a carousel', category: 'ride' }],
  });
  assert.equal(out.refused.length, 0, JSON.stringify(out.refused));
  const [claim] = out.claims;
  assert.equal(claim.source, 'llm_extract');
  assert.equal(claim.lane, 'C');
  assert.equal(claim.pass, 'agent-brief-carousel-read');
  assert.equal(claim.date, '2024-05-11');
  assert.equal(claim.src.tile, 'naip-oh-2024');
  assert.equal(claim.src.by, 'aerial');
  return true;
});

await check('truth rows stay visible to the imagery ledger gate that certifies them', () => {
  const out = claimsFromPass({
    pass: laneAPass(),
    provenance: GOOD_PROV,
    ledger: LEDGER,
    findings: [{ kind: 'path_edge', at: north(AT, 2), confidence: 0.95, label: 'a walkway' }],
  });
  assert.equal(out.truth.length, 1, JSON.stringify(out));
  assert.equal(claimCoverage(out.truth[0], LEDGER).ok, true);
  assert.equal(imagerySignedFeatures({}, out.truth).length, 1, 'the coverage gate cannot see this row');
  return true;
});

await check("a finding under the pass's own bar is a claim even from a truth-writing pass", () => {
  const out = claimsFromPass({
    pass: laneAPass(),
    provenance: GOOD_PROV,
    ledger: LEDGER,
    findings: [
      { kind: 'path_edge', at: north(AT, 2), confidence: 0.95, label: 'sure' },
      { kind: 'path_edge', at: north(AT, 3), confidence: 0.4, label: 'unsure' },
    ],
  });
  assert.equal(out.truth.length, 1);
  assert.equal(out.truth[0].label, 'sure');
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].label, 'unsure');
  return true;
});

await check('a finding of a kind this lane has no vocabulary for is refused', () => {
  assert.ok(!CLAIM_KINDS.includes('ride_wait_time'));
  const out = claimsFromPass({
    pass: laneBPass(),
    provenance: GOOD_PROV,
    ledger: LEDGER,
    findings: [{ kind: 'ride_wait_time', at: north(AT, 3), confidence: 0.9 }],
  });
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0].problems.join('; '), /ride_wait_time/);
  return true;
});

/* ----------------------------------------------------- disputes with truth */

const claimAt = (finding) => claimFromFinding(finding, laneBPass(), GOOD_PROV);

await check('an imagery read that lands on the OSM Place agrees with it', () => {
  const out = disputesAgainstTruth({
    claims: [claimAt({ kind: 'place', target: 'vortex', at: north(AT, 3) })],
    pois: somePois(),
    map: someMap(),
  });
  assert.equal(out.disputes.length, 0, JSON.stringify(out.disputes));
  assert.equal(out.agrees.length, 1);
  return true;
});

await check('an imagery read well off a named OSM Place is a dispute, not a move', () => {
  const out = disputesAgainstTruth({
    claims: [claimAt({ kind: 'place', target: 'vortex', at: north(AT, 25) })],
    pois: somePois(),
    map: someMap(),
  });
  assert.equal(out.disputes.length, 1, JSON.stringify(out));
  const [d] = out.disputes;
  assert.equal(d.kind, 'place_position');
  assert.equal(d.target, 'vortex');
  assert.equal(d.matchedBy, 'target');
  assert.equal(d.id, 'place_position:vortex', 'a maintainer has to be able to name this one');
  assert.ok(Math.abs(d.metres - 25) < 1, `metres was ${d.metres}`);
  // Against the fixture literal, not against the list that was passed in: a
  // detector that moved the Place onto its own reading would satisfy the
  // second comparison and fail this one.
  assert.deepEqual(d.truthAt, { lat: AT.lat, lng: AT.lng });
  assert.equal(d.tile, 'naip-oh-2024');
  return true;
});

await check('imagery that names nothing OSM has is adding, which is not a dispute', () => {
  const out = disputesAgainstTruth({
    claims: [claimAt({ kind: 'place', at: north(AT, 900), label: 'a new pavilion', category: 'food' })],
    pois: somePois(),
    map: someMap(),
  });
  assert.equal(out.disputes.length, 0, JSON.stringify(out.disputes));
  assert.equal(out.adds.length, 1);
  return true;
});

await check('an ambiguous name does not fork a dispute', () => {
  const out = disputesAgainstTruth({
    claims: [claimAt({ kind: 'place', label: 'The Twins', at: north(AT, 460) })],
    pois: somePois(),
    map: someMap(),
  });
  assert.equal(out.disputes.length, 0, 'two Places share that title; picking one is inventing');
  assert.equal(out.adds.length, 1);
  return true;
});

await check('a path edge off the OSM walkway is a path_position dispute with no Place key', () => {
  const out = disputesAgainstTruth({
    claims: [claimAt({ kind: 'path_edge', at: north(AT, 25), label: 'a walkway' })],
    pois: somePois(),
    map: someMap(),
  });
  assert.equal(out.disputes.length, 1, JSON.stringify(out));
  const [d] = out.disputes;
  assert.equal(d.kind, 'path_position');
  assert.equal(d.target, null);
  assert.equal(d.matchedBy, 'walkable');
  // No Place key to name it by, so the position does the naming.
  assert.equal(d.id, `path_position:${d.imageryAt.lat.toFixed(6)},${d.imageryAt.lng.toFixed(6)}`);
  assert.ok(Math.abs(d.metres - 25) < 1, `metres was ${d.metres}`);
  return true;
});

await check('a path edge nowhere near any OSM walkway is adding a path, not disputing one', () => {
  const out = disputesAgainstTruth({
    claims: [claimAt({ kind: 'path_edge', at: north(AT, 400), label: 'a desire line' })],
    pois: somePois(),
    map: someMap(),
  });
  assert.equal(out.disputes.length, 0, JSON.stringify(out.disputes));
  assert.equal(out.adds.length, 1);
  return true;
});

await check('the thresholds are ordered: agree inside match, both in metres', () => {
  assert.ok(AGREE_METRES > 0 && MATCH_METRES > AGREE_METRES, `${AGREE_METRES} / ${MATCH_METRES}`);
  return true;
});

await check('adjudicating a dispute moves nothing — truth goes in and comes back unchanged', () => {
  const pois = somePois();
  const map = someMap();
  const poisBefore = JSON.stringify(pois);
  const mapBefore = JSON.stringify(map);
  const out = disputesAgainstTruth({
    claims: [
      claimAt({ kind: 'place', target: 'vortex', at: north(AT, 25) }),
      claimAt({ kind: 'path_edge', at: north(AT, 25) }),
    ],
    pois,
    map,
  });
  assert.equal(out.disputes.length, 2, 'nothing was disputed, so nothing had the chance to move');
  assert.equal(JSON.stringify(pois), poisBefore, 'the Place list was edited');
  assert.equal(JSON.stringify(map), mapBefore, 'the walk geometry was edited');
  return true;
});

/* -------------------------------------------- the maintainer-facing record */

const DISPUTED = disputesAgainstTruth({
  claims: [claimAt({ kind: 'place', target: 'vortex', at: north(AT, 25) })],
  pois: somePois(),
  map: someMap(),
});

const RECORD = imageryDisputeRecord({
  venueId: 'kings-island',
  verdicts: [passVerdict(laneAPass()), passVerdict(laneBPass())],
  claims: [claimAt({ kind: 'place', target: 'vortex', at: north(AT, 25) })],
  disputes: DISPUTED.disputes,
});

await check('the record says out loud who it is for and that it does not ship', () => {
  assert.equal(RECORD.audience, 'maintainer');
  assert.equal(RECORD.shipped, false);
  assert.equal(RECORD.venue, 'kings-island');
  assert.match(RECORD.decision, /never shown to guests/i);
  assert.equal(RECORD.decision, OWNER_DECISION_C);
  assert.equal(RECORD.disputes.length, 1);
  assert.equal(RECORD.summary.disputes, 1);
  assert.equal(RECORD.lanes.length, 2);
  assert.ok(!('gaps' in RECORD), 'a dispute record must not carry Gap rows');
  return true;
});

await check('the record is written builder-side, never into the shipped venue directory', () => {
  const file = disputeRecordFile('kings-island');
  const insideBuilder = path.relative(OVERRIDE_DIR, file);
  assert.ok(
    insideBuilder && !insideBuilder.startsWith('..') && !path.isAbsolute(insideBuilder),
    `${file} is not under ${OVERRIDE_DIR}`,
  );
  const insideShipped = path.relative(VENUE_DIR, file);
  assert.ok(
    insideShipped.startsWith('..') || path.isAbsolute(insideShipped),
    `${file} is inside the shipped venue directory`,
  );
  return true;
});

await check('writing the record round-trips it, and lands at the sidecar path', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'imagery-claims-'));
  const file = writeDisputeRecord(RECORD, { dir });
  assert.equal(file, path.join(dir, 'kings-island', 'imagery-disputes.json'));
  assert.ok(existsSync(file), 'nothing was written');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), RECORD);
  return true;
});

/* --------------------------------------------------- the claims / Gap wall */

await check('the seven shipped Gap types are still exactly the frozen seven', () => {
  assert.deepEqual([...SHIPPED_GAP_TYPES], [...FROZEN_GAP_TYPES]);
  assert.equal(FROZEN_GAP_TYPES.length, 7);
  return true;
});

await check('no dispute kind is spellable as a shipped Gap type', () => {
  assert.ok(DISPUTE_KINDS.length > 0, 'there are no dispute kinds to check');
  for (const kind of DISPUTE_KINDS) {
    assert.ok(
      !SHIPPED_GAP_TYPES.includes(kind),
      `dispute kind "${kind}" would ship as a Gap — decision (c) forbids routing disputes through path/queue`,
    );
  }
  return true;
});

await check('the wall is quiet over the real shipped Gap documents', () => {
  const ids = ['big-kahunas', 'cedar-point', 'kings-island', 'six-flags-fiesta-texas'];
  let seen = 0;
  for (const id of ids) {
    const file = path.join(VENUE_DIR, `${id}.gaps.json`);
    if (!existsSync(file)) continue;
    seen += 1;
    const gaps = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(gaps.gaps.length > 0, `${id} ships no Gaps at all`);
    assert.deepEqual(gapWallProblems({ gaps, record: RECORD }), [], `${id}`);
  }
  assert.ok(seen >= 3, `only ${seen} shipped Gap documents were read`);
  return true;
});

await check('the wall fires when an eighth Gap type appears', () => {
  const problems = gapWallProblems({
    gaps: { venue: 'x', gaps: [{ type: 'height', target: 'a' }] },
    gapTypes: [...FROZEN_GAP_TYPES, 'imagery_dispute'],
  });
  assert.ok(problems.some((p) => /frozen seven/i.test(p)), problems.join('; '));
  return true;
});

await check('the wall fires on a Gap row typed outside the seven', () => {
  const problems = gapWallProblems({
    gaps: { venue: 'x', gaps: [{ type: 'path_position', target: 'vortex' }] },
  });
  assert.ok(problems.some((p) => /path_position/.test(p)), problems.join('; '));
  return true;
});

await check('the wall fires on a dispute riding inside a legitimate Gap row', () => {
  const problems = gapWallProblems({
    gaps: {
      venue: 'x',
      gaps: [{ type: 'path', target: 'vortex', metres: 25, lane: 'B', tile: 'naip-oh-2024' }],
    },
  });
  assert.ok(problems.some((p) => /beyond \{type, ?target\}/.test(p)), problems.join('; '));
  return true;
});

await check('the wall fires when a dispute kind collides with a shipped Gap type', () => {
  const problems = gapWallProblems({
    gaps: { venue: 'x', gaps: [] },
    disputeKinds: ['path'],
  });
  assert.ok(problems.some((p) => /also a shipped Gap type/i.test(p)), problems.join('; '));
  return true;
});

await check('the wall fires when the record grows Gap rows or claims to ship', () => {
  const withGaps = gapWallProblems({ gaps: { gaps: [] }, record: { ...RECORD, gaps: [] } });
  assert.ok(withGaps.some((p) => /"gaps"/.test(p)), withGaps.join('; '));
  const shipped = gapWallProblems({ gaps: { gaps: [] }, record: { ...RECORD, shipped: true } });
  assert.ok(shipped.some((p) => /ship/i.test(p)), shipped.join('; '));
  const guestFacing = gapWallProblems({ gaps: { gaps: [] }, record: { ...RECORD, audience: 'guest' } });
  assert.ok(guestFacing.some((p) => /guest/.test(p)), guestFacing.join('; '));
  return true;
});

await check('the wall fires if the record is aimed at the shipped venue directory', () => {
  const problems = gapWallProblems({
    gaps: { gaps: [] },
    record: RECORD,
    shippedDir: OVERRIDE_DIR,
  });
  assert.ok(problems.some((p) => /shipped venue directory/i.test(p)), problems.join('; '));
  return true;
});

await check('and if one ever leaked, the phone still drops it', () => {
  assert.ok(DISPUTE_KINDS.length > 0, 'there are no dispute kinds to leak');
  const leaked = normalizeGapsDocument({
    gaps: [
      { type: 'path', target: 'vortex' },
      ...DISPUTE_KINDS.map((kind) => ({ type: kind, target: 'vortex' })),
    ],
  });
  assert.deepEqual(leaked, [{ type: 'path', target: 'vortex' }]);
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
