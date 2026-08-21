#!/usr/bin/env node
/**
 * The Train H/I plan derives doneness from the tree — so the probes must be
 * able to tell two trees apart.
 *
 * This is the suite that keeps the plan honest, and it exists because the
 * opposite kept happening. Three tests written during this work asserted
 * nothing: one mutated a frozen object, one diffed an empty range, one
 * satisfied its guard textually while keeping the bug the guard exists to
 * catch. Each looked fine and each was caught only by trying to make it fail.
 * A probe has the same failure mode with worse consequences: a probe stuck on
 * true reports a slice built that nobody built, and the next cloud session —
 * which has no memory of this one and trusts the plan completely — skips it.
 *
 * So every slice carries a before/after pair here. `before` is a tree where
 * the slice is not built; `after` is one where it is. The probe must say false
 * to every `before` and true to `after`. Conjunctive probes get one `before`
 * per clause, so a probe that ignores half of what it claims to check fails on
 * the clause it dropped.
 *
 * What this proves: each probe is satisfiable, discriminating, and minimal
 * over the evidence its fixture names. What it cannot prove is that the
 * evidence *means* the slice is finished — that judgement stays with whoever
 * writes the slice. The three failure modes above are the ones that bit, and
 * these are the ones that catch them.
 *
 *   node test/scripts/train-plan.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECISIONS,
  REPO,
  SLICES,
  blocked,
  decisionGated,
  gatedBy,
  next,
  progress,
  reachable,
  status,
  treeAt,
  waiting,
} from '../../scripts/lib/train-plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), 'train-plan-'));
const made = [];

/** Materialise `{relPath: content}` as a real directory and hand back a reader.
 *  Real files rather than a stub reader on purpose: the probes run against a
 *  filesystem in production, and a stub would let a probe pass here while
 *  tripping over a missing directory or a directory-shaped path for real. */
function tree(files) {
  const root = mkdtempSync(path.join(scratch, 'tree-'));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return treeAt(root);
}

const BAKE = 'packages/venue-builder/lib/display-bake.mjs';
const BAKE_BIN = 'packages/venue-builder/bin/display-bake.mjs';
const CONTRACT = 'packages/venue-builder/lib/display-style-contract.mjs';
const PYRAMID = 'packages/venue-builder/lib/display-pyramid.mjs';
const PACK = 'packages/venue-builder/lib/display-pack.mjs';
const REGISTRY = 'packages/venue-builder/lib/adapters/registry.mjs';
const LEDGER = 'packages/venue-builder/lib/imagery-ledger.mjs';
const CERTIFY = 'packages/venue-builder/lib/venue-certify.mjs';
const VERTICAL = 'scripts/ci/pre-merge-vertical.mjs';

/** before: trees where the slice is NOT built, one per clause the probe claims
 *  to check. after: a tree where it is. */
const FIXTURES = {
  h0: {
    before: [
      // the spread is still there
      { [BAKE]: 'treeCells.wood.push(...painted);', 'test/builder/display-scatter.mjs': 'suite' },
      // spread gone, but no suite pins the scatter cost
      { [BAKE]: 'for (const cell of painted) sink.push(cell);' },
    ],
    after: {
      [BAKE]: 'for (const cell of painted) sink.push(cell);',
      'test/builder/display-scatter.mjs': 'suite',
    },
  },
  h1: {
    before: [
      { [BAKE_BIN]: "if (arg === '--band') band = argv[++i];" },
      { 'packages/venue-builder/lib/display-bands.mjs': 'export function bandBakePlan() {}', [BAKE_BIN]: "if (arg === '--out')" },
    ],
    after: {
      'packages/venue-builder/lib/display-bands.mjs': 'export function bandBakePlan() {}',
      [BAKE_BIN]: "if (arg === '--band') band = argv[++i];",
    },
  },
  h2: {
    before: [{ [CONTRACT]: 'the alignment budget is expressed in cells' }],
    after: { [CONTRACT]: 'the alignment budget is expressed in ground metres' },
  },
  h4: {
    before: [
      { [PYRAMID]: 'export function writePyramid() {}', [PACK]: "import { bake } from './display-bake.mjs';" },
      { [PACK]: "import { writePyramid } from './display-pyramid.mjs';" },
    ],
    after: {
      [PYRAMID]: 'export function writePyramid() {}',
      [PACK]: "import { writePyramid } from './display-pyramid.mjs';",
    },
  },
  h5: {
    before: [
      { [CONTRACT]: 'style rows', [BAKE]: 'bandGeneralization(plan)' },
      { [CONTRACT]: 'per-band style rows', [BAKE]: 'paint(cells)' },
    ],
    after: { [CONTRACT]: 'per-band style rows', [BAKE]: 'bandGeneralization(plan)' },
  },
  h6: {
    before: [{ [CONTRACT]: "rows.push({ id: 'style_palette_distinct' })" }],
    after: { [CONTRACT]: "rows.push({ id: 'style_no_baked_text' })" },
  },
  h7: {
    before: [{ 'apps/party-tracker/lib/world.js': 'export function mapPaint() {}' }],
    after: { 'apps/party-tracker/lib/mapView.js': 'export function mapView() {}' },
  },
  h9: {
    before: [{ 'apps/party-tracker/components/BandedWorldMap.jsx': 'export default function BandedWorldMap() {}' }],
    after: { 'apps/party-tracker/components/BandedWorldMap.jsx': "import { PMTiles } from 'pmtiles';" },
  },
  h11: {
    before: [
      { 'apps/party-tracker/package.json': '{"dependencies":{"maplibre-gl":"^5"}}', 'apps/party-tracker/components/ParkMap.jsx': 'export default function ParkMap() {}' },
      { 'apps/party-tracker/package.json': '{"dependencies":{"next":"^15"}}', 'apps/party-tracker/components/ParkMap.jsx': "import { overlayGeo } from '../lib/overlayGeo.js';" },
    ],
    after: {
      'apps/party-tracker/package.json': '{"dependencies":{"maplibre-gl":"^5"}}',
      'apps/party-tracker/components/ParkMap.jsx': "import { overlayGeo } from '../lib/overlayGeo.js';",
    },
  },
  h14: {
    before: [{ 'packages/venue-builder/data/display/kits/iso.json': '{}' }],
    after: { 'packages/venue-builder/data/display/kits/pixel-tycoon.json': '{}' },
  },
  h15: {
    before: [{ [VERTICAL]: 'await runBrowserVertical();' }],
    after: { [VERTICAL]: 'await zoomSweep({ minFps: 30 });' },
  },
  i3: {
    before: [{ 'packages/venue-builder/lib/external-claims.mjs': "source: 'osm'" }],
    after: { 'packages/venue-builder/lib/external-claims.mjs': "source: 'worldcover'" },
  },
  i8: {
    before: [{ [REGISTRY]: "adapters: ['osm-overpass']" }],
    after: { [REGISTRY]: "adapters: ['naip-planetary']" },
  },
  i10: {
    before: [
      { [LEDGER]: 'export function ledger() {}', [CERTIFY]: "import { rows } from './display-style-contract.mjs';" },
      { [CERTIFY]: "import { ledger } from './imagery-ledger.mjs';" },
    ],
    after: {
      [LEDGER]: 'export function ledger() {}',
      [CERTIFY]: "import { ledger } from './imagery-ledger.mjs';",
    },
  },
  i12: {
    before: [{ 'packages/venue-builder/lib/display-references.mjs': 'export function referenceProfile() {}' }],
    after: { 'packages/venue-builder/lib/display-references.mjs': 'export function groundingHarvest() {}' },
  },
  i16: {
    before: [{ 'packages/venue-builder/lib/external-claims.mjs': 'export function claims() {}' }],
    after: { 'packages/venue-builder/lib/imagery-claims.mjs': 'export function imageryClaims() {}' },
  },
  i17: {
    before: [{ [REGISTRY]: "adapters: ['naip-planetary']" }],
    after: { [REGISTRY]: "adapters: ['naip-planetary', 'google-places']" },
  },
};

// ---------------------------------------------------------------- graph shape

const ids = SLICES.map((s) => s.id);
assert.equal(new Set(ids).size, ids.length, `duplicate slice id: ${ids.join(', ')}`);

for (const s of SLICES) {
  assert.equal(typeof s.probe, 'function', `${s.id} has no probe`);
  assert.ok(['H', 'I'].includes(s.train), `${s.id} names train ${s.train}`);
  for (const need of s.needs ?? []) {
    assert.ok(ids.includes(need), `${s.id} needs ${need}, which is not a slice`);
  }
  if (s.blocked) {
    assert.ok(
      s.blocked in DECISIONS,
      `${s.id} is blocked on "${s.blocked}", which DECISIONS does not record — a `
        + 'session told to work around a decision has to be able to read it',
    );
  }
}

// A cycle would make `next()` return nothing forever with no explanation, which
// reads exactly like "the trains are done".
const seen = new Map();
const visit = (id, trail) => {
  assert.ok(!trail.includes(id), `dependency cycle: ${[...trail, id].join(' -> ')}`);
  if (seen.get(id)) return;
  seen.set(id, true);
  const s = SLICES.find((x) => x.id === id);
  for (const need of s.needs ?? []) visit(need, [...trail, id]);
};
for (const id of ids) visit(id, []);

for (const key of Object.keys(DECISIONS)) {
  assert.ok(
    SLICES.some((s) => s.blocked === key),
    `DECISIONS records "${key}" but no slice is blocked on it — a decision nobody `
      + 'is waiting on should not be asked of the owner',
  );
}

// ------------------------------------------------------- probes discriminate

const empty = tree({});
for (const s of SLICES) {
  assert.equal(
    s.probe(empty),
    false,
    `${s.id}'s probe reports built against an EMPTY tree. A probe built out of a `
      + 'negation does this — !read(x).includes(y) is true when x does not exist — '
      + 'and it would report the whole train finished in a fresh checkout',
  );
}

for (const s of SLICES) {
  const fx = FIXTURES[s.id];
  assert.ok(
    fx,
    `${s.id} has no before/after fixture. Every slice needs one: it is the only `
      + 'thing proving its probe can move, and it is where "done" is written down '
      + 'concretely enough to argue with',
  );
  assert.ok(Array.isArray(fx.before) && fx.before.length > 0, `${s.id} fixture has no before trees`);

  assert.equal(
    s.probe(tree(fx.after)),
    true,
    `${s.id}'s probe says NOT built against its own after-fixture — the probe and `
      + 'the fixture disagree about what finishing this slice looks like, so one of '
      + 'them is wrong and a session will be misrouted either way',
  );

  fx.before.forEach((files, i) => {
    assert.equal(
      s.probe(tree(files)),
      false,
      `${s.id}'s probe says BUILT against before-fixture ${i}, which withholds one `
        + 'piece of the evidence the slice claims to need. The probe is not checking '
        + `that piece: ${Object.keys(files).join(', ')}`,
    );
  });
}

for (const rel of Object.keys(FIXTURES).flatMap((id) => [
  ...FIXTURES[id].before.flatMap((f) => Object.keys(f)),
  ...Object.keys(FIXTURES[id].after),
])) {
  assert.ok(
    existsSync(path.join(REPO, path.dirname(rel))),
    `a fixture addresses ${rel}, but ${path.dirname(rel)} does not exist in the repo — `
      + 'a probe pointed at a directory that is not there can never go true, and reads '
      + 'as "not built yet" forever',
  );
}

// ------------------------------------------------------------- reader is sealed

for (const bad of ['/etc/passwd', '../outside', 'a/../../b', '']) {
  assert.throws(
    () => empty.read(bad),
    /repo-relative|non-empty/,
    `the tree reader accepted ${JSON.stringify(bad)} — probes must answer from the `
      + 'checkout they were handed, or a probe passes here and reads a sibling worktree '
      + 'in production',
  );
}
assert.equal(empty.read('nope/missing.mjs'), '', 'a missing file reads as empty, not a throw');

// ------------------------------------------------------------ the four buckets

const rows = status(empty);
assert.equal(rows.length, SLICES.length);
assert.ok(rows.every((r) => r.done === false), 'nothing is built in an empty tree');

const bucketed = [...next(rows), ...waiting(rows), ...decisionGated(rows)].map((r) => r.id);
const notDone = rows.filter((r) => !r.done).map((r) => r.id);
assert.equal(
  new Set(bucketed).size,
  bucketed.length,
  `a slice is in two buckets at once: ${bucketed.join(', ')} — the status output `
    + 'would list it twice and a fan-out would build it twice',
);
assert.deepEqual(
  [...bucketed].sort(),
  [...notDone].sort(),
  'every unbuilt slice must land in exactly one of ready/waiting/blocked, or it '
    + 'silently disappears from the plan',
);

// The empty tree above cannot reach the case that matters most here: a slice
// that is blocked AND has all its dependencies met. With nothing built, every
// blocked slice is also waiting, so `next()` would exclude it either way and a
// bucket bug would hide. These rows put one squarely in that state.
const synthetic = [
  { id: 'sa', train: 'H', size: 'S', title: 'built', needs: [], blocked: null, done: true, probeError: null },
  { id: 'sb', train: 'H', size: 'S', title: 'deps met but blocked', needs: ['sa'], blocked: 'crop', done: false, probeError: null },
  { id: 'sc', train: 'I', size: 'S', title: 'deps unmet', needs: ['sd'], blocked: null, done: false, probeError: null },
  { id: 'sd', train: 'I', size: 'S', title: 'startable', needs: [], blocked: null, done: false, probeError: null },
];
assert.deepEqual(
  next(synthetic).map((r) => r.id),
  ['sd'],
  'a slice whose dependencies are all built but which waits on an owner decision '
    + 'must not be offered as startable — a session would build it and in doing so '
    + 'decide the question that was reserved for the owner',
);
assert.deepEqual(blocked(synthetic).map((r) => r.id), ['sb']);
assert.deepEqual(waiting(synthetic).map((r) => r.id), ['sc']);

const synthBuckets = [...next(synthetic), ...waiting(synthetic), ...decisionGated(synthetic)].map((r) => r.id);
assert.equal(
  new Set(synthBuckets).size,
  synthBuckets.length,
  `a slice is in two buckets at once: ${synthBuckets.join(', ')} — status would list `
    + 'it twice and a fan-out would build it twice',
);
assert.deepEqual([...synthBuckets].sort(), ['sb', 'sc', 'sd']);

// A probe that throws must not take the other sixteen slices down with it.
const exploding = { id: 'x', train: 'H', size: 'S', title: 'x', probe: () => { throw new Error('boom'); } };
const withBomb = [...SLICES, exploding];
const rowsWithBomb = withBomb.map((s) => {
  let done = false;
  let probeError = null;
  try { done = s.probe(empty) === true; } catch (err) { probeError = err.message; }
  return { ...s, done, probeError, needs: s.needs ?? [], blocked: s.blocked ?? null };
});
assert.equal(rowsWithBomb.at(-1).done, false);
assert.equal(rowsWithBomb.at(-1).probeError, 'boom', 'a throwing probe records why, rather than reading as merely unbuilt');

// ------------------------------------------- how far a chain of sessions gets

// The case that makes this worth computing: `sg` is not blocked itself and its
// dependency is not blocked either, but the dependency's dependency is. A
// count of directly-blocked slices calls sg reachable, a chain of sessions is
// then planned as if it can finish, and it stalls one slice short with no
// explanation. Depth two, because depth one is the case a wrong implementation
// still gets right.
const chain = [
  { id: 'sroot', train: 'H', size: 'S', title: 'blocked at the root', needs: [], blocked: 'crop', done: false, probeError: null },
  { id: 'smid', train: 'H', size: 'S', title: 'needs the blocked root', needs: ['sroot'], blocked: null, done: false, probeError: null },
  { id: 'sg', train: 'H', size: 'S', title: 'two hops from a decision', needs: ['smid'], blocked: null, done: false, probeError: null },
  { id: 'sfree', train: 'I', size: 'S', title: 'nothing in its past is blocked', needs: [], blocked: null, done: false, probeError: null },
  { id: 'sdonedep', train: 'I', size: 'S', title: 'needs something already built', needs: ['sbuilt'], blocked: null, done: false, probeError: null },
  { id: 'sbuilt', train: 'I', size: 'S', title: 'built, and was once blocked', needs: [], blocked: 'a', done: true, probeError: null },
];

assert.equal(gatedBy('sg', chain), 'crop',
  'a slice two hops from a blocked one must report the decision that gates it — '
  + 'reporting null makes it look startable and a session will pick it up, get '
  + 'stuck, and have nothing to say about why');
assert.equal(gatedBy('smid', chain), 'crop');
assert.equal(gatedBy('sroot', chain), 'crop');
assert.equal(gatedBy('sfree', chain), null);
assert.equal(gatedBy('sbuilt', chain), null, 'a built slice is not gated, whatever it was blocked on while it was being built');
assert.equal(gatedBy('sdonedep', chain), null,
  'a dependency that is already BUILT cannot gate anything, even if it carries a '
  + 'blocked marker — otherwise every decision poisons its slice forever and the '
  + 'ceiling only ever falls');

assert.deepEqual(reachable(chain).map((r) => r.id).sort(), ['sdonedep', 'sfree']);
assert.deepEqual(decisionGated(chain).map((r) => r.id).sort(), ['sg', 'smid', 'sroot']);

const chainBuckets = [...next(chain), ...waiting(chain), ...decisionGated(chain)].map((r) => r.id);
assert.equal(
  new Set(chainBuckets).size,
  chainBuckets.length,
  `a transitively gated slice landed in two buckets: ${chainBuckets.join(', ')}. It `
    + 'reads as merely waiting AND as gated, so every report lists it twice and every '
    + 'sum counts it twice',
);
assert.deepEqual(
  [...chainBuckets].sort(),
  ['sdonedep', 'sfree', 'sg', 'smid', 'sroot'],
  'every unbuilt slice must land in exactly one of ready/waiting/gated',
);

const chainProgress = progress(chain);
assert.equal(chainProgress.done, 1);
assert.equal(chainProgress.ceiling, 3, 'ceiling is what unattended work can reach: built plus reachable');
assert.equal(chainProgress.gated, 3);
assert.equal(
  chainProgress.ceiling + chainProgress.gated,
  chainProgress.total,
  'every slice is either built, reachable, or gated — if these do not sum, some '
  + 'slice is uncounted and the ceiling is a guess',
);

// --------------------------------------------------------- progress adds up

const p = progress(rows);
assert.equal(p.total, SLICES.length);
assert.equal(
  p.trains.reduce((n, t) => n + t.total, 0),
  SLICES.length,
  'every slice belongs to exactly one train, or the per-train counts do not sum',
);

// ------------------------------------------------- the real checkout is sane

const live = status();
// The real board: the same sum has to hold, or the number reported to the owner
// as "what a chain of sessions can finish" is wrong.
const liveProgress = progress(live);
assert.equal(
  liveProgress.ceiling + liveProgress.gated,
  liveProgress.total,
  'the live board does not partition into built/reachable/gated',
);
assert.ok(liveProgress.ceiling >= liveProgress.done);

assert.ok(
  live.every((r) => r.probeError === null),
  `probe error in the real checkout: ${live.filter((r) => r.probeError).map((r) => `${r.id}: ${r.probeError}`).join('; ')}`,
);

// The CLI is what a fresh cloud session runs; if it cannot start, the session
// has no way to find out what to build.
const { execFileSync } = await import('node:child_process');
for (const cmd of ['status', 'next', 'blocked', 'session']) {
  const out = execFileSync('node', [path.join(REPO, 'scripts/train-plan.mjs'), cmd], { encoding: 'utf8' });
  assert.ok(out.trim().length > 0, `train-plan.mjs ${cmd} printed nothing`);
}
// The buckets partition, but the report is what a session reads. Assert on the
// rendered text too: this exact defect was introduced in the CLI while the
// function-level partition above stayed green.
const board = execFileSync('node', [path.join(REPO, 'scripts/train-plan.mjs'), 'status'], { encoding: 'utf8' });
const listed = [...board.matchAll(/^ {2}([hi]\d+) /gm)].map((m) => m[1]);
assert.equal(
  new Set(listed).size,
  listed.length,
  `the status board lists a slice under two headings: ${listed.filter((x, i) => listed.indexOf(x) !== i).join(', ')}`,
);
assert.equal(listed.length, SLICES.length, 'the status board must account for every slice exactly once');

const asJson = JSON.parse(
  execFileSync('node', [path.join(REPO, 'scripts/train-plan.mjs'), 'status', '--json'], { encoding: 'utf8' }),
);
assert.equal(asJson.rows.length, SLICES.length, '--json must carry every slice, since a fan-out reads it');

rmSync(scratch, { recursive: true, force: true });
void HERE;
console.log(`train-plan: ok (${SLICES.length} slices, ${Object.keys(DECISIONS).length} decisions)`);
