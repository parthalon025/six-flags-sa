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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
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
      // no maplibre dependency: nothing shows the renderer was even added
      { 'apps/party-tracker/package.json': '{"dependencies":{"next":"^15"}}', 'apps/party-tracker/components/ParkMapGl.jsx': 'x', 'apps/party-tracker/lib/mapLibreConfigured.js': 'export function parkMapRenderer() {}', 'apps/party-tracker/lib/overlayGeo.js': 'export const OVERLAY_LAYERS = [];', 'apps/party-tracker/lib/mapViewMaplibre.js': "import { OVERLAY_LAYERS } from './overlayGeo.js';" },
      // no GL component: a dependency in package.json is not a renderer
      { 'apps/party-tracker/package.json': '{"dependencies":{"maplibre-gl":"^5"}}', 'apps/party-tracker/lib/mapLibreConfigured.js': 'export function parkMapRenderer() {}', 'apps/party-tracker/lib/overlayGeo.js': 'export const OVERLAY_LAYERS = [];', 'apps/party-tracker/lib/mapViewMaplibre.js': "import { OVERLAY_LAYERS } from './overlayGeo.js';" },
      // no renderer switch: nothing can ask for the ported path
      { 'apps/party-tracker/package.json': '{"dependencies":{"maplibre-gl":"^5"}}', 'apps/party-tracker/components/ParkMapGl.jsx': 'x', 'apps/party-tracker/lib/overlayGeo.js': 'export const OVERLAY_LAYERS = [];', 'apps/party-tracker/lib/mapViewMaplibre.js': "import { OVERLAY_LAYERS } from './overlayGeo.js';" },
      // the GL renderer exists but does not consume the overlay module — the
      // exact shape of the bug this probe used to miss (it read ParkMap.jsx,
      // where overlayGeo no longer lives, instead of the GL adapter)
      { 'apps/party-tracker/package.json': '{"dependencies":{"maplibre-gl":"^5"}}', 'apps/party-tracker/components/ParkMapGl.jsx': 'x', 'apps/party-tracker/lib/mapLibreConfigured.js': 'export function parkMapRenderer() {}', 'apps/party-tracker/lib/overlayGeo.js': 'export const OVERLAY_LAYERS = [];', 'apps/party-tracker/lib/mapViewMaplibre.js': 'export function createMapLibreRenderer() {}' },
    ],
    after: {
      'apps/party-tracker/package.json': '{"dependencies":{"maplibre-gl":"^5"}}',
      'apps/party-tracker/components/ParkMapGl.jsx': 'export default function ParkMapGl() {}',
      'apps/party-tracker/lib/mapLibreConfigured.js': 'export function parkMapRenderer() {}',
      'apps/party-tracker/lib/overlayGeo.js': 'export const OVERLAY_LAYERS = [];',
      'apps/party-tracker/lib/mapViewMaplibre.js': "import { OVERLAY_LAYERS } from './overlayGeo.js';",
    },
  },
  h18: {
    before: [
      // the port is there but the SVG still ships — the real state today
      { 'apps/party-tracker/components/ParkMapGl.jsx': 'export default function ParkMapGl() {}',
        'apps/party-tracker/components/ParkMapSvg.jsx': 'export default function ParkMapSvg() {}',
        'apps/party-tracker/lib/mapLibreConfigured.js': "const PARK_MAP_RENDERERS = ['svg', 'gl'];" },
      // SVG file gone but the switch still defaults to it
      { 'apps/party-tracker/components/ParkMapGl.jsx': 'export default function ParkMapGl() {}',
        'apps/party-tracker/lib/mapLibreConfigured.js': "const PARK_MAP_RENDERERS = ['svg', 'gl'];" },
      // switch flipped but the replacement was never built: a retirement with
      // nothing to retire into, which two bare negations would call done
      { 'apps/party-tracker/lib/mapLibreConfigured.js': "const PARK_MAP_RENDERERS = ['gl'];" },
      // the switch itself gone: no renderer choice at all is not a retirement,
      // and without this clause a file that never mentions PARK_MAP_RENDERERS
      // satisfies the "no 'svg'" negation for free
      { 'apps/party-tracker/components/ParkMapGl.jsx': 'export default function ParkMapGl() {}',
        'apps/party-tracker/lib/mapLibreConfigured.js': 'export const NOTHING = 1;' },
    ],
    after: {
      'apps/party-tracker/components/ParkMapGl.jsx': 'export default function ParkMapGl() {}',
      'apps/party-tracker/lib/mapLibreConfigured.js': "const PARK_MAP_RENDERERS = ['gl'];",
    },
  },
  h19: {
    before: [
      { 'packages/venue-builder/lib/display-bands.mjs': 'export function bandBakePlan() {}',
        'packages/venue-builder/lib/display-bake.mjs': 'const m = cropModel(model, 6);' },
      // trimming gone, but on a tree from before band plans existed: a removal
      // is true of any tree predating the thing, which is not the same as done
      { 'packages/venue-builder/lib/display-bake.mjs': 'export function bakeModel() {}' },
    ],
    after: {
      'packages/venue-builder/lib/display-bands.mjs': 'export function bandBakePlan() {}',
      // Names cropModel in a comment, as the real module does: explaining what
      // was removed is not the same as still calling it.
      'packages/venue-builder/lib/display-bake.mjs':
        '/* the old `cropModel` trimmed here; gridBounds replaces it */\nconst bounds = gridBounds(cols, rows, toGeo);',
    },
  },
  i18: {
    before: [
      { 'packages/venue-builder/lib/imagery-claims.mjs': 'export function claims() {}',
        'packages/venue-builder/lib/ship-gaps.mjs': "export const SHIPPED_GAP_TYPES = ['path', 'path_disputed'];" },
      // type gone, but the builder-side lane that replaces it never landed
      { 'packages/venue-builder/lib/ship-gaps.mjs': "export const SHIPPED_GAP_TYPES = ['path'];" },
      // lane landed, but ship-gaps declares no vocabulary at all
      { 'packages/venue-builder/lib/imagery-claims.mjs': 'export function claims() {}',
        'packages/venue-builder/lib/ship-gaps.mjs': 'export const NOTHING = 1;' },
    ],
    after: {
      'packages/venue-builder/lib/imagery-claims.mjs': 'export function claims() {}',
      'packages/venue-builder/lib/ship-gaps.mjs': "export const SHIPPED_GAP_TYPES = ['height', 'path'];",
    },
  },
  h14: {
    before: [
      // ledger binds pixel-tycoon, but the kit it points at was never authored
      { 'packages/venue-builder/data/display/skins.json': '{"skins":{"pixel-tycoon":{"bakeKit":"pixel-tycoon"}}}' },
      // the kit is on disk, but nothing in the ledger resolves it — issue #28's shape
      { 'packages/venue-builder/data/display/kits/pixel-tycoon.json': '{}', 'packages/venue-builder/data/display/skins.json': '{"skins":{"trail":{"bakeKit":"island-brochure"}}}' },
    ],
    after: {
      'packages/venue-builder/data/display/kits/pixel-tycoon.json': '{}',
      'packages/venue-builder/data/display/skins.json': '{"skins":{"pixel-tycoon":{"bakeKit":"pixel-tycoon"}}}',
    },
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
    SLICES.some((s) => s.blocked === key) || DECISIONS[key].resolved,
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

// A fixture for a slice that no longer exists is a stale claim, and it reads as
// deliberate: someone finding it later has to work out whether the slice was
// dropped on purpose or lost. The loop above catches a slice with no fixture;
// this is the same guard pointing the other way, and without it a renamed slice
// leaves its old fixture behind to be run against nothing, forever green.
const sliceIds = new Set(SLICES.map((sl) => sl.id));
assert.deepEqual(
  Object.keys(FIXTURES).filter((id) => !sliceIds.has(id)),
  [],
  'FIXTURES names slices that are not in SLICES — remove them, or restore the slice',
);

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

// has() and wiredInto() route through the same gate today. Assert it of them
// directly anyway: the seal is a property of the reader, and a later change
// that gives either its own path handling would slip past a test that only
// ever exercises read().
for (const bad of ['/etc/passwd', '../outside', 'a/../../b', '']) {
  assert.throws(() => empty.has(bad), /repo-relative|non-empty/, `has() accepted ${JSON.stringify(bad)}`);
  assert.throws(
    () => empty.wiredInto(bad, 'package.json'),
    /repo-relative|non-empty/,
    `wiredInto() accepted ${JSON.stringify(bad)} as its module`,
  );
}
assert.throws(
  () => empty.wiredInto('scripts/lib/train-plan.mjs', '/etc/passwd'),
  /repo-relative/,
  'wiredInto() accepted an absolute path as its importer — the second argument is a '
    + 'path too, and reading it from outside the tree is the same leak',
);

// Every workflow script must PARSE as the async function body it is run as.
// The guards below read these files as text, and text checks pass happily on a
// file the engine cannot load: an unescaped backtick inside a template literal
// silently ended the string and broke train-slices.mjs while every grep-based
// assertion here stayed green. A parse is the cheap check that catches it.
{
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  for (const wf of readdirSync(path.join(REPO, '.claude/workflows')).filter((f) => f.endsWith('.mjs'))) {
    const src = readFileSync(path.join(REPO, '.claude/workflows', wf), 'utf8')
      .replace(/^export const meta/m, 'const meta');
    assert.doesNotThrow(
      () => new AsyncFn('args', 'log', 'agent', 'pipeline', 'parallel', 'budget', 'workflow', src),
      `.claude/workflows/${wf} does not parse — the Workflow tool will refuse it`,
    );
  }
}

// A fan-out lane must be told to check that its base carries its dependencies.
// Lanes fetch the branch from origin, which is only as current as the last
// push — so a fan-out launched with work integrated locally but not yet pushed
// hands every lane a stale base. That does not fail loudly: h11 was started on
// a base without h7's mapView seam and quietly set about rebuilding the seam it
// existed to consume.
{
  const wf = readFileSync(path.join(REPO, '.claude/workflows/train-slices.mjs'), 'utf8');
  assert.match(
    wf,
    /train-plan\.mjs status/,
    'train-slices.mjs must tell each lane to run the status board against its own '
      + 'base — it is the only way a lane can tell a stale checkout from a fresh one',
  );
  assert.match(
    wf,
    /NEEDS/,
    'train-slices.mjs must name the slice\'s dependencies in the prompt, or a lane '
      + 'has nothing to check the status board against',
  );
}

// Parsing is not enough: `${slice.id}` inside a module-scope const parses fine
// and throws "slice is not defined" the moment the workflow runs. That is
// exactly what happened, one command after the parse guard above went green.
// So run each workflow for real against stubbed primitives and collect the
// prompts it would send. This is the guard that sees a prompt actually build.
const runWorkflow = async (wf, workflowArgs, replies) => {
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  const src = readFileSync(path.join(REPO, '.claude/workflows', wf), 'utf8')
    .replace(/^export const meta/m, 'const meta');
  const prompts = [];
  const agent = async (prompt, opts) => {
    prompts.push(prompt);
    // Answer per stage rather than handing back one canned shape. A single
    // shape leaves every verdict field undefined, so the workflow's own
    // clean/suspect categorisation cannot run and a regression in it would
    // produce byte-identical prompts — the harness would see nothing.
    const label = opts?.label ?? '';
    const id = label.split(':')[1] ?? 'h1';
    if (label.startsWith('verify:')) return (replies?.verdicts ?? {})[id] ?? { sliceId: id, probeWouldPass: true, testsAreReal: true, findings: [] };
    return (replies?.builds ?? {})[id] ?? { sliceId: id, status: 'built', committed: true, redVerified: true, worktree: `/tmp/${id}`, summary: 's', needsWiring: [] };
  };
  const pipeline = async (items, ...stages) => {
    const out = [];
    for (const [i, item] of items.entries()) {
      let acc = item;
      for (const stage of stages) acc = await stage(acc, item, i);
      out.push(acc);
    }
    return out;
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  const body = new AsyncFn('args', 'log', 'agent', 'pipeline', 'parallel', 'budget', 'workflow', src);
  const returned = await body(workflowArgs, () => {}, agent, pipeline, parallel, { total: null }, async () => {});
  return { prompts, returned };
};
const promptsFrom = async (wf, workflowArgs) => (await runWorkflow(wf, workflowArgs)).prompts;

{
  const slice = { id: 'h1', train: 'H', size: 'S', title: 'a slice', needs: ['h0'] };
  const built = await promptsFrom('train-slices.mjs', { base: 'some-branch', next: [slice] });
  assert.ok(built.length >= 1, 'train-slices.mjs sent no prompt for a startable slice');
  const joined = built.join('\n');
  assert.ok(joined.includes('h1'), 'a lane prompt must name the slice it is building');
  assert.match(
    joined,
    /checkout -[Bb] \S*h1/,
    'the branch a lane is told to create must carry the slice id once interpolated — '
      + 'asserting the template text says ${slice.id} does not prove it is in scope',
  );
  assert.ok(joined.includes('some-branch'), 'the base branch must reach the prompt');
  assert.ok(joined.includes('h0'), "the slice's NEEDS must reach the prompt so the lane can check its base");

  const verified = await promptsFrom('train-verify.mjs', {
    base: 'some-branch',
    slices: [{ id: 'h1', title: 'a slice', root: '/tmp/wt' }],
  });
  assert.ok(verified.join('\n').includes('/tmp/wt'), 'train-verify.mjs must send the worktree root');

  const fixed = await promptsFrom('train-fix.mjs', {
    slices: [{ id: 'h1', root: '/tmp/wt', fixes: ['a finding to fix'] }],
  });
  assert.ok(fixed.join('\n').includes('a finding to fix'), 'train-fix.mjs must send the findings');

  // Prompts are only half of what a workflow does; the other half is deciding
  // what came back clean. That decision is invisible to a prompt check — flip
  // the && to || in the clean filter and every prompt is byte-identical — so
  // drive it with three slices whose verdicts differ and assert where each
  // lands. `nodeps` also carries no `needs` key at all, like the real h0 does,
  // which is the shape that finds a missing `slice.needs ?? []` guard.
  const { returned } = await runWorkflow(
    'train-slices.mjs',
    {
      base: 'some-branch',
      next: [
        { id: 'good', train: 'H', size: 'S', title: 'verifies clean', needs: ['h0'] },
        { id: 'fake', train: 'H', size: 'S', title: 'probe satisfied dishonestly', needs: ['h0'] },
        { id: 'nodeps', train: 'I', size: 'S', title: 'no needs key at all' },
      ],
    },
    {
      verdicts: {
        fake: { sliceId: 'fake', probeWouldPass: false, testsAreReal: true, findings: ['a string was planted where the probe greps'] },
        nodeps: { sliceId: 'nodeps', probeWouldPass: true, testsAreReal: false, findings: ['an assertion that cannot fail'] },
      },
      builds: {
        nodeps: { sliceId: 'nodeps', status: 'built', committed: true, redVerified: false, worktree: '/tmp/nodeps', summary: 's', needsWiring: ['test/x.mjs into test:builder'] },
      },
    },
  );

  assert.deepEqual(
    returned.built.map((b) => b.id),
    ['good'],
    'only a slice whose probe is honest AND whose tests can fail may be reported built — '
      + 'a dishonest probe or a vacuous test is exactly what the verify stage exists to catch',
  );
  assert.deepEqual(
    returned.suspect.map((b) => b.id).sort(),
    ['fake', 'nodeps'],
    'a slice failing either verify check must reach the integrator, not be silently dropped',
  );
  assert.deepEqual(
    returned.needsWiring,
    ['nodeps: test/x.mjs into test:builder'],
    'wiring a lane could not do itself must survive into the result, tagged with its slice — '
      + 'losing it is how a suite lands that CI never runs',
  );
}

// A fan-out lane must branch under a name carrying its own slice id. Worktrees
// in one repository share branch refs, so two lanes told to use the same name
// share one pointer: each commits onto whatever the other last did, and each
// records the other's files as deletions. Three lanes hit this on one run and
// their commits had to be unpicked by hand. The prompt said `slice-work`, and
// a comment saying "do not" would have been just as easy to write and just as
// unenforced, so it is asserted instead.
const slicesWf = readFileSync(path.join(REPO, '.claude/workflows/train-slices.mjs'), 'utf8');
const checkouts = [...slicesWf.matchAll(/git checkout -[Bb] (\S+)/g)].map((m) => m[1]);
assert.ok(checkouts.length > 0, 'train-slices.mjs no longer tells lanes to branch — move this guard with it');
for (const name of checkouts) {
  assert.match(
    name,
    /\$\{slice\.id\}|\$\{s\.id\}/,
    `train-slices.mjs sends every lane to the branch "${name}". Two lanes on one `
      + 'branch name share a ref and overwrite each other; interpolate the slice id',
  );
}

// The two workflow prompts carry the same vacuous-test rubric because workflow
// scripts have no module resolution and cannot share a constant. That is a
// forced duplication, so it gets a guard rather than a comment asking nicely:
// a rubric that drifts between the agent writing tests and the agent auditing
// them is worse than no rubric.
const rubricOf = (rel) => {
  const m = readFileSync(path.join(REPO, rel), 'utf8').match(/const VACUOUS =([\s\S]*?);\n/);
  assert.ok(m, `${rel} no longer defines VACUOUS — if the rubric moved, move this guard with it`);
  return m[1].replace(/\s+/g, ' ').trim();
};
assert.equal(
  rubricOf('.claude/workflows/train-slices.mjs'),
  rubricOf('.claude/workflows/train-verify.mjs'),
  'the builder and verifier workflows state different vacuous-test rubrics, so an '
    + 'agent could write a test the auditor is not looking for',
);

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
  { id: 'sb', train: 'H', size: 'S', title: 'deps met but blocked', needs: ['sa'], blocked: 'hold', done: false, probeError: null },
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
// This calls the real status() with an injected slice list rather than
// re-running its loop here: a copy of the loop asserts something about the
// copy, and deleting status()'s own try/catch would leave it green.
const exploding = {
  id: 'x',
  train: 'H',
  size: 'S',
  title: 'x',
  probe: () => {
    throw new Error('boom');
  },
};
const rowsWithBomb = status(empty, [...SLICES, exploding]);
assert.equal(rowsWithBomb.length, SLICES.length + 1, 'a throwing probe must not shorten the board');
assert.equal(rowsWithBomb.at(-1).done, false);
assert.equal(
  rowsWithBomb.at(-1).probeError,
  'boom',
  'a throwing probe records why, rather than reading as merely unbuilt',
);
assert.ok(
  rowsWithBomb.slice(0, -1).every((r) => r.probeError === null),
  'one throwing probe must not mark the other slices as errored',
);

// Every probe must read NOT BUILT against a real tree from before this work.
//
// Fixtures prove a probe CAN move. They cannot prove it describes real code,
// because the fixture is written to satisfy the probe — so a probe that never
// matches anything real still passes its fixtures happily. What that catches
// is one direction: a probe reporting BUILT on a tree where nothing was built,
// which is how two bare negations ("the SVG is gone, the switch says nothing")
// read as done in an empty checkout. A real tree is the check fixtures cannot
// be. (The other direction — a probe that is false on every tree, including
// one where the slice IS built — this does not see; a baseline says nothing
// about what a probe does once the code lands.)
//
// The baseline is PINNED rather than derived. The first version of this guard
// used origin/main on the reasoning that none of the trains' work was there —
// true until PR #585 merged, at which point main carried all of it and the
// check inverted, reporting sixteen slices "built" on the baseline. A baseline
// that moves is not a baseline. This commit predates every slice; if it ever
// becomes unreachable the guard FAILS rather than skips, so re-pointing it is a
// visible decision instead of a silent loss of cover.
const PRE_TRAIN_BASELINE = '4727a110';
{
  let baselineOk = true;
  try {
    execFileSync('git', ['rev-parse', '--verify', `${PRE_TRAIN_BASELINE}^{commit}`], {
      cwd: REPO, env: scrubGitEnv(), stdio: 'ignore',
    });
  } catch (err) {
    if (err?.code === 'ENOENT' || typeof err?.status === 'number') baselineOk = false;
    else throw err;
  }
  assert.ok(
    baselineOk,
    `the pinned pre-train baseline ${PRE_TRAIN_BASELINE} is unreachable, so no probe is being `
      + 'checked against real code any more. Re-point it at a commit predating every slice '
      + 'rather than deleting this check',
  );

  // ---- the CI side of the pin -------------------------------------------
  //
  // Locally the commit is simply there. The `gate` job — the one that runs
  // this file — checks out fetch-depth: 2 and would not reach five hundred
  // commits back, so the workflow fetches this one by name. Two files naming
  // one sha drift, so the pin is asserted rather than hoped for.
  //
  // The question has to be asked of the gate JOB, not of the file. A substring
  // match over the whole workflow answers "is this sha written down anywhere",
  // which stays true when the step is commented out (the sha survives in the
  // comment) and when the step is moved to an unrelated job (the sha survives
  // in `lint`) — both of which leave the gate job fetching nothing. It also
  // says no to a gate job switched to fetch-depth: 0, which already has the
  // commit and needs no fetch at all. So: take the named job's block, drop
  // commented-out lines, read the values of `run:` keys, and accept full
  // history as an answer.
  const jobLines = (workflow, jobId) => {
    const lines = workflow.split('\n');
    const start = lines.findIndex((l) => l === `  ${jobId}:`);
    if (start === -1) return [];
    const end = lines.findIndex((l, i) => i > start && l.trim() !== '' && !l.startsWith('    '));
    return lines
      .slice(start + 1, end === -1 ? lines.length : end)
      .filter((l) => !/^\s*#/.test(l));
  };
  const liveRunLines = (workflow, jobId) => {
    const out = [];
    let scalarIndent = null;
    for (const line of jobLines(workflow, jobId)) {
      if (scalarIndent !== null) {
        if (line.trim() === '') continue;
        if (line.match(/^ */)[0].length > scalarIndent) { out.push(line.trim()); continue; }
        scalarIndent = null;
      }
      const m = line.match(/^( *)(?:- +)?run:(.*)$/);
      if (!m) continue;
      if (/^\s*[|>][-+\d]*\s*$/.test(m[2])) scalarIndent = m[1].length;
      else if (m[2].trim()) out.push(m[2].trim());
    }
    return out;
  };
  const fetchesBaseline = new RegExp(`git fetch origin ${PRE_TRAIN_BASELINE}[0-9a-f]*(\\s|$)`);
  const gatePinnedFetch = (workflow) =>
    liveRunLines(workflow, 'gate').some((l) => fetchesBaseline.test(l))
    || jobLines(workflow, 'gate').some((l) => /^\s*fetch-depth:\s*0\s*$/.test(l));

  const WORKFLOW = '.github/workflows/test-app.yml';
  const gateWorkflow = readFileSync(path.join(REPO, WORKFLOW), 'utf8');
  assert.ok(
    gatePinnedFetch(gateWorkflow),
    `${WORKFLOW}'s gate job neither fetches ${PRE_TRAIN_BASELINE} in a live \`run:\` nor checks `
      + 'out fetch-depth: 0, so this guard fails closed there. Re-point the fetch whenever the '
      + 'baseline moves',
  );

  // And gatePinnedFetch() is itself asserted the way the probes are: against
  // workflows written to break it. Not against mutations of the real file —
  // the fourth case below legitimately removes the step, and a fixture derived
  // from the file would then have nothing to mutate, which is the same
  // "reddens a legitimate change" defect one level up. This sample carries the
  // shape that matters: a gate job with a shallow checkout and a pinned fetch,
  // a comment naming the sha, a block-scalar `run:`, and a second job to move
  // the step into. The old whole-file substring match answered TRUE to all
  // four, because the sha is in the comment in every one of them.
  const SAMPLE_FETCH = `run: git fetch origin ${PRE_TRAIN_BASELINE}abcdef --depth=1 || true`;
  const SAMPLE = [
    'jobs:',
    '  gate:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 2',
    '      - name: Fetch the pinned pre-train baseline',
    `        # names ${PRE_TRAIN_BASELINE} so the sha is in the file either way`,
    `        ${SAMPLE_FETCH}`,
    '      - name: Gate checks',
    '        run: |',
    '          node scripts/ci/gate-tests.mjs',
    '  lint:',
    '    steps:',
    '      - run: npm run lint',
    '',
  ].join('\n');
  assert.deepEqual(
    liveRunLines(SAMPLE, 'gate'),
    [SAMPLE_FETCH.slice('run: '.length), 'node scripts/ci/gate-tests.mjs'],
    'liveRunLines() must return one job\'s run: values — block scalars included, the next job\'s '
      + 'steps excluded',
  );
  assert.ok(gatePinnedFetch(SAMPLE), 'a gate job that fetches the baseline must satisfy the pin');

  const commentedOut = SAMPLE.replace(`\n        ${SAMPLE_FETCH}`, `\n        # ${SAMPLE_FETCH}`);
  assert.notEqual(commentedOut, SAMPLE, 'the commented-out mutation did not change anything');
  assert.ok(
    !gatePinnedFetch(commentedOut),
    'a gate job whose fetch step is commented out fetches nothing, however many times the sha '
      + 'still appears in the file',
  );

  const movedToLint = commentedOut.replace('      - run: npm run lint', `      - ${SAMPLE_FETCH}`);
  assert.deepEqual(
    liveRunLines(movedToLint, 'lint'),
    [SAMPLE_FETCH.slice('run: '.length)],
    'the moved-to-lint mutation did not land the fetch in the lint job',
  );
  assert.ok(
    !gatePinnedFetch(movedToLint),
    'a fetch living in `lint` does nothing for the gate job, which is the job that runs this file',
  );

  const fullHistory = commentedOut.replace('fetch-depth: 2', 'fetch-depth: 0');
  assert.notEqual(fullHistory, commentedOut, 'the full-history mutation did not change anything');
  assert.ok(
    gatePinnedFetch(fullHistory),
    'a gate job checked out at fetch-depth: 0 already has the baseline commit; reddening that '
      + 'because the now-redundant fetch step went with it would be a false alarm',
  );

  // ---- the reader --------------------------------------------------------
  //
  // treeAt()'s four members over `git show`, so the probes cannot tell the
  // difference, without paying for a worktree just to answer "was this there
  // in August?". It has to match treeAt()'s CONTRACT, not merely its shape:
  // treeAt() turns exactly two errors into '' — the path is absent (ENOENT) or
  // is a directory (EISDIR) — and rethrows everything else, because a read
  // that failed for any other reason is not evidence of absence. A bare
  // `catch { return ''; }` here would answer '' to a broken git, an unreadable
  // object store, or a ref that vanished mid-run, and every probe would then
  // read NOT BUILT against what is effectively an empty tree: this guard
  // passing while checking nothing, which is the exact failure it exists to
  // catch. Same for the path validation — treeAt() validates BOTH of
  // wiredInto's paths before using either, so a typo'd importer errors instead
  // of quietly returning false forever.
  const ABSENT_IN_REF = /does not exist in|exists on disk, but not in/;
  const gitAt = (ref) => {
    const objectFor = (rel) => {
      if (typeof rel !== 'string' || rel.length === 0) {
        throw new Error('probe paths must be non-empty strings');
      }
      if (path.isAbsolute(rel) || rel.split('/').includes('..')) {
        throw new Error(`probe paths must be repo-relative and inside the tree: ${rel}`);
      }
      return `${ref}:${rel}`;
    };
    const git = (args) => execFileSync('git', args, {
      cwd: REPO,
      env: scrubGitEnv(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    /** 'blob' | 'tree' | null, where null means "not in this ref" and anything
     *  else — a bad ref, a corrupt object store, no git at all — throws. */
    const typeOf = (rel) => {
      const object = objectFor(rel);
      try {
        return git(['cat-file', '-t', object]).trim();
      } catch (err) {
        if (typeof err?.status === 'number' && ABSENT_IN_REF.test(String(err.stderr ?? ''))) return null;
        throw err;
      }
    };
    const read = (rel) => {
      const type = typeOf(rel);
      if (type === null || type === 'tree') return ''; // treeAt()'s ENOENT / EISDIR
      return git(['cat-file', 'blob', objectFor(rel)]);
    };
    const has = (rel) => typeOf(rel) !== null;
    const wiredInto = (rel, importer) => {
      objectFor(rel);
      objectFor(importer);
      return has(rel) && read(importer).includes(path.basename(rel, path.extname(rel)));
    };
    return Object.freeze({ root: ref, read, has, wiredInto });
  };

  // Sealed the same way treeAt() is, and asserted the same way — see "reader is
  // sealed" above. The last case is the one a short-circuiting wiredInto() gets
  // wrong: the module is absent from this ref, so `has(rel) && ...` never
  // reaches the importer, and a probe naming an unreadable importer would go on
  // answering false — "not built yet" — forever.
  const refReader = gitAt(PRE_TRAIN_BASELINE);
  for (const bad of ['/etc/passwd', '../outside', 'a/../../b', '']) {
    assert.throws(
      () => refReader.read(bad),
      /repo-relative|non-empty/,
      `the ref reader accepted ${JSON.stringify(bad)} for read()`,
    );
    assert.throws(
      () => refReader.has(bad),
      /repo-relative|non-empty/,
      `the ref reader accepted ${JSON.stringify(bad)} for has()`,
    );
    assert.throws(
      () => refReader.wiredInto(bad, 'package.json'),
      /repo-relative|non-empty/,
      `the ref reader accepted ${JSON.stringify(bad)} as wiredInto()'s module`,
    );
  }
  assert.throws(
    () => refReader.wiredInto('nope/missing.mjs', '/etc/passwd'),
    /repo-relative/,
    "the ref reader validated wiredInto()'s importer only when the module happened to be "
      + 'present — treeAt() checks both paths before using either, and a reader that does not '
      + 'lets a probe with an unreadable importer read as unbuilt forever',
  );

  // Nothing below proves the reader READ anything, and a reader that answered
  // '' to everything sails through both: every probe reads NOT BUILT against
  // an empty tree. So the reader is anchored on real bytes first — this is the
  // manifest h18's own first clause greps for maplibre in.
  const manifest = refReader.read('apps/party-tracker/package.json');
  assert.ok(
    manifest.includes('"name"') && manifest.length > 200,
    `the baseline reader returned ${manifest.length} bytes for apps/party-tracker/package.json at `
      + `${PRE_TRAIN_BASELINE}, which is not that file. Every probe would then read NOT BUILT `
      + 'against an empty tree and this guard would report all-clear having checked nothing',
  );
  assert.ok(
    refReader.has('apps/party-tracker/package.json'),
    `the baseline reader cannot see a file that is certainly at ${PRE_TRAIN_BASELINE}`,
  );
  assert.ok(
    !refReader.has('apps/party-tracker/lib/no-such-file-here.js'),
    'the baseline reader says yes to a path that is in no tree',
  );

  const baselineRows = status(refReader);
  assert.ok(
    baselineRows.every((r) => r.probeError === null),
    `probe error at ${PRE_TRAIN_BASELINE}: `
      + `${baselineRows.filter((r) => r.probeError).map((r) => `${r.id}: ${r.probeError}`).join('; ')} — `
      + 'a probe that throws against the baseline is not being checked against real code',
  );
  const builtAtBaseline = baselineRows.filter((r) => r.done).map((r) => r.id);
  assert.deepEqual(
    builtAtBaseline,
    [],
    `these slices report BUILT at ${PRE_TRAIN_BASELINE}, a real commit predating all of this `
      + `work: ${builtAtBaseline.join(', ')}. Either the probe is true of any tree — a negation `
      + 'with no positive anchor does that — or it greps for something that was already there',
  );
}

// ------------------------------------------- how far a chain of sessions gets

// The case that makes this worth computing: `sg` is not blocked itself and its
// dependency is not blocked either, but the dependency's dependency is. A
// count of directly-blocked slices calls sg reachable, a chain of sessions is
// then planned as if it can finish, and it stalls one slice short with no
// explanation. Depth two, because depth one is the case a wrong implementation
// still gets right.
const chain = [
  { id: 'sroot', train: 'H', size: 'S', title: 'blocked at the root', needs: [], blocked: 'hold', done: false, probeError: null },
  { id: 'smid', train: 'H', size: 'S', title: 'needs the blocked root', needs: ['sroot'], blocked: null, done: false, probeError: null },
  { id: 'sg', train: 'H', size: 'S', title: 'two hops from a decision', needs: ['smid'], blocked: null, done: false, probeError: null },
  { id: 'sfree', train: 'I', size: 'S', title: 'nothing in its past is blocked', needs: [], blocked: null, done: false, probeError: null },
  { id: 'sdonedep', train: 'I', size: 'S', title: 'needs something already built', needs: ['sbuilt'], blocked: null, done: false, probeError: null },
  { id: 'sbuilt', train: 'I', size: 'S', title: 'built, and was once blocked', needs: [], blocked: 'a', done: true, probeError: null },
];

assert.equal(gatedBy('sg', chain), 'hold',
  'a slice two hops from a blocked one must report the decision that gates it — '
  + 'reporting null makes it look startable and a session will pick it up, get '
  + 'stuck, and have nothing to say about why');
assert.equal(gatedBy('smid', chain), 'hold');
assert.equal(gatedBy('sroot', chain), 'hold');
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
