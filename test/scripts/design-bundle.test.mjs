#!/usr/bin/env node
/**
 * Design-system bundle — derivation, cross-checks, and the staleness gate.
 *
 *   node test/scripts/design-bundle.test.mjs
 *
 * The point of the bundle is that it cannot quietly disagree with the app, so
 * these assertions are mostly about the *readers* being faithful: a token that
 * resolves through the cascade the browser runs, a glyph whose attributes
 * survive the JSX-to-SVG trip, a contrast number that matches the one the
 * stylesheet's own comment quotes, and a screen map that fails loudly.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { fileURLToPath } from 'node:url';
import {
  readTokens,
  readIcons,
  readVocabulary,
  readScreenMap,
  readSkins,
  crossCheckIconMaps,
  contrast,
  rgb,
  CONTRAST_PAIRS,
  VOCABULARY_TERMS,
  SCREEN_MAP,
} from '../../scripts/lib/design-bundle/sources.mjs';
import {
  renderPages,
  PAGES,
  FONT_WEIGHTS,
  FONT_DIR,
  fontFile,
} from '../../scripts/lib/design-bundle/render.mjs';
import {
  buildModel,
  checkDesignBundle,
  designSyncPlan,
  auditPushReadiness,
  pageReferences,
  mimeFor,
  DESIGN_SYNC_LIMITS,
  OUT_DIR,
} from '../../scripts/lib/design-bundle/compose.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/* ---- tokens ------------------------------------------------------------ */
const tokens = readTokens();

assert.ok(tokens.rows.length > 100, 'both palette blocks parsed');
assert.ok(
  tokens.groups.some((g) => g.name === 'radii'),
  "the stylesheet's own `---- radii ----` banner became a group",
);

const bg = tokens.rows.find((t) => t.name === '--bg');
assert.equal(bg.value, '#0B1829', 'night --bg read from :root');
assert.equal(bg.dayValue, '#F7F4EC', 'day --bg read from :root[data-theme=day]');

const peek = tokens.rows.find((t) => t.name === '--peek');
assert.match(peek.note, /PEEK_PX/, 'the comment above a token travels with it');

// The cascade: --blue is var(--adventure) in both blocks, but --adventure is
// declared only in night. Resolving day against day alone leaves it unpainted.
const blue = tokens.rows.find((t) => t.name === '--blue');
assert.equal(blue.resolved, '#FF6B35', 'night alias resolved');
assert.equal(blue.dayResolved, '#FF6B35', 'day alias resolved through the night base');
assert.equal(blue.alias, 'var(--adventure)', 'the alias itself is kept, not flattened away');

// Only the two top-level palette blocks — not the :root nested inside
// @supports, nor the accessibility media queries.
assert.equal(
  tokens.rows.filter((t) => t.name === '--matThin').length,
  1,
  'the @supports fallback :root is not read as a palette',
);

/* ---- contrast ---------------------------------------------------------- */
assert.deepEqual(rgb('#0B1829'), [11, 24, 41, 1], 'hex parsed');
assert.deepEqual(rgb('rgba(247, 244, 236, .62)'), [247, 244, 236, 0.62], 'rgba parsed');

// White on #FFFFFF is 1:1; black on white is 21:1. Anchors for the maths.
assert.equal(contrast('#FFFFFF', '#FFFFFF').toFixed(2), '1.00');
assert.equal(contrast('#000000', '#FFFFFF').toFixed(2), '21.00');

// The reading the app's own commit message and the guardrail doc both quote.
// If this number ever moves, one of the two is now wrong.
assert.equal(
  contrast('#ffffff', '#27B8B0').toFixed(2),
  '2.45',
  'white on --aqua is 2.45:1 — the measurement that sent the twin\'s chips back',
);
assert.equal(
  contrast('#0B1829', '#27B8B0').toFixed(1),
  '7.3',
  'the dark ink that replaced it clears 7.3:1 on the same fill',
);

// Translucent ink is composited onto its backdrop rather than measured raw.
const label2 = contrast('rgba(247, 244, 236, .62)', '#10233F');
assert.ok(label2 > 1 && label2 < 21, 'alpha composited, not treated as opaque');

for (const p of CONTRAST_PAIRS) {
  assert.ok(['ships', 'rejected', 'reference'].includes(p.status), `${p.fg}/${p.bg} has a status`);
}

/* ---- icons ------------------------------------------------------------- */
const icons = readIcons();
assert.ok(icons.icons.length >= 20, 'the glyph map parsed');
assert.equal(icons.viewBox, '0 0 24 24', 'the 24-unit box is read from the component');

const names = icons.icons.map((i) => i.name);
assert.equal(new Set(names).size, names.length, 'no duplicate glyph names');
assert.ok(names.includes('mappin.and.ellipse'), 'a dotted name survived the key match');

// The spread-then-override case. JSX resolves {...STROKE} strokeWidth="2.1" to
// 2.1; emitted literally it would be two stroke-width attributes and an HTML
// parser keeps the FIRST, silently drawing the glyph at the spread's 2.
// GLYPHS mixes two entry shapes and both must be read. Ten of them are
// single-line `'bolt.fill': <path … />,` with no parentheses; a pattern
// anchored on `: (` silently skipped every one and reported three real glyphs
// as missing. A design-system page that omits a glyph teaches a designer it
// does not exist, so under-detection is the failure mode to guard.
for (const name of ['sun.max.fill', 'safari', 'location.north.fill', 'bolt.fill', 'xmark']) {
  assert.ok(names.includes(name), `${name} parsed — both entry shapes are read`);
}
assert.ok(
  icons.icons.length >= 34,
  `expected at least 34 glyphs, parsed ${icons.icons.length} — the reader is under-detecting`,
);
// STROKE sits above GLYPHS and the Icon component below it; neither may leak in.
for (const notAGlyph of ['fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'name', 'size']) {
  assert.ok(!names.includes(notAGlyph), `${notAGlyph} is not a glyph — body is bounded to GLYPHS`);
}

// A single-line entry still gets its spread expanded and its override applied.
const xmark = icons.icons.find((i) => i.name === 'xmark');
assert.match(xmark.svg, /stroke-linecap="round"/, '{...STROKE} expanded on a single-line entry');
assert.match(xmark.svg, /stroke-width="2\.4"/, 'the override wins on a single-line entry');

const sun = icons.icons.find((i) => i.name === 'sun.max.fill');
assert.equal(
  (sun.svg.match(/stroke-width=/g) || []).length,
  1,
  'duplicate attributes collapsed to one',
);
assert.match(sun.svg, /stroke-width="2\.1"/, 'the override wins, not the spread');
assert.ok(!/strokeWidth|<>|\{/.test(sun.svg), 'no JSX left in the emitted markup');

/* ---- skins ------------------------------------------------------------- */
const skins = await readSkins({ night: 'Park Midnight', day: 'Trail' });
assert.ok(skins.skins.length > 5, 'skins enumerated from SKINS');

const postcard = skins.skins.find((s) => s.id === 'postcard');
assert.equal(postcard.label, 'Postcard', 'the display name comes off SKINS, not mapPaint');
assert.equal(postcard.ground, '#F4E4C8', 'ground is p.ground, as WorldCloset draws it');
assert.equal(postcard.stroke, '#C45C4A', 'border is p.path.stroke, as WorldCloset draws it');
assert.equal(typeof postcard.ink, 'string', 'label ink is the paint string, not the paint object');

for (const s of [...skins.skins, ...skins.palettes]) {
  assert.match(s.ground, /^#[0-9A-Fa-f]{6}$/, `${s.id} ground is a real colour`);
  assert.equal(typeof s.label, 'string', `${s.id} label is a name`);
}
assert.deepEqual(
  skins.palettes.map((p) => p.label),
  ['Park Midnight', 'Trail'],
  'the two always-on palettes are named, not read off the shadowed mapPaint label',
);

/* ---- vocabulary -------------------------------------------------------- */
const vocab = readVocabulary();
assert.equal(vocab.length, VOCABULARY_TERMS.length, 'every curated term resolved');
const mark = vocab.find((t) => t.term === 'Mark');
assert.match(mark.definition, /Profile-attributed object left at a \*\*Place\*\*/);
assert.match(mark.avoid, /Graffiti/, 'the _Avoid_ line travels with the definition');

// A renamed term must fail the build rather than keep stale wording.
const contextMd = readFileSync(join(root, 'CONTEXT.md'), 'utf8');
assert.ok(!contextMd.includes('**Definitely Not A Term**'), 'fixture name is unused');

/* ---- screen map -------------------------------------------------------- */
const screenMap = readScreenMap();
assert.equal(screenMap.rows.length, SCREEN_MAP.length, 'every screen kept');
for (const row of screenMap.rows) {
  for (const p of row.paths) {
    assert.ok(p.ok, `${row.screen} → ${p.path} exists`);
  }
}
assert.ok(
  screenMap.rows.some((r) => r.paths.some((p) => p.path === 'components/WorldPicker.jsx')),
  'the path the imported twin got wrong is now real and checked',
);
assert.ok(
  !JSON.stringify(SCREEN_MAP).includes('lib/worlds.js'),
  'lib/worlds.js never existed and must not reappear',
);

/* ---- rendering --------------------------------------------------------- */
const model = await buildModel();
const pages = renderPages(model);

assert.equal(pages.size, PAGES.length + 1, 'one file per card, plus the manifest');

for (const [file, group] of PAGES) {
  const html = pages.get(file);
  assert.ok(html, `${file} rendered`);
  assert.equal(
    html.split('\n')[0],
    `<!-- @dsCard group="${group}" -->`,
    `${file} opens with its dsCard marker on the FIRST line — the index is built from it`,
  );
  assert.match(html, /<title>[^<]+<\/title>/, `${file} has a title`);
  assert.ok(!html.includes('undefined'), `${file} has no undefined leaking into copy`);
  assert.ok(!html.includes('[object Object]'), `${file} has no stringified object`);
}

// The bundle must not embed the repository's position. An earlier version
// stamped `git rev-parse --short HEAD` into every footer, which made it
// impossible to commit: landing the bundle moves HEAD, so the pages instantly
// disagreed with the generator and design:check failed on the very commit that
// added them — and on every commit after. Freshness is a function of the
// SOURCES; provenance is `git log -- docs/design/system/`.
const currentHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: root,
  env: scrubGitEnv(),
})
  .toString()
  .trim();
for (const [file] of PAGES) {
  assert.ok(
    !pages.get(file).includes(currentHead),
    `${file} embeds the current commit — the bundle would go stale the moment it is committed`,
  );
}

/* The manifest indexes the WHOLE bundle, and the bundle has two halves now: the
   eight design-system pages here, plus the page-per-screen the twin contributes
   from a capture. `model.pageIndex` is that union — asserting against PAGES
   alone would have quietly stopped checking exactly the half that is new.
   test/scripts/design-twin.test.mjs holds the twin's own end up. */
const manifest = JSON.parse(pages.get('_ds_manifest.json'));
assert.equal(manifest.cards.length, model.pageIndex.length, 'manifest lists every card');
assert.deepEqual(
  manifest.cards.map((c) => c.file).sort(),
  model.pageIndex.map(([f]) => f).sort(),
  'manifest and the page index agree',
);
for (const [file] of PAGES) {
  assert.ok(
    manifest.cards.some((c) => c.file === file),
    `${file} is still a card — the twin joining the bundle must not displace it`,
  );
}

// Real values reached the pages rather than placeholders.
assert.match(pages.get('tokens-color.html'), /#FF6B35/, 'a real brand hex is on the colour page');
assert.match(pages.get('map-skins.html'), /#F4E4C8/, "postcard's real ground is on the skins page");
assert.match(pages.get('vocabulary.html'), /Rally Point/, 'vocabulary reached its page');

/* ---- cross-checks ------------------------------------------------------ */
// These describe the app, so they are reported and never thrown — the shape is
// what is asserted here, not the current count.
const gaps = crossCheckIconMaps(icons.icons, skins.world);
for (const g of gaps) {
  assert.ok(g.map && g.key && g.glyph, 'a gap names its map, key and glyph');
  assert.ok(!names.includes(g.glyph), 'a reported gap really is missing from GLYPHS');
}

// Every Kit and Mark resolves to a real glyph. This holds today, so it is
// asserted rather than merely reported: Icon returns null for a name it does
// not know, which draws nothing at all in a finished-looking row — invisible
// unless something checks. It also pins the parser, since the cheapest way to
// fake this passing is to stop finding glyphs.
for (const [mapName, map] of [
  ['KIT_ICONS', skins.world.KIT_ICONS],
  ['MARK_ICONS', skins.world.MARK_ICONS],
]) {
  for (const [key, glyph] of Object.entries(map)) {
    assert.ok(
      names.includes(glyph),
      `${mapName}.${key} -> ${glyph} has no glyph in GLYPHS (Icon would render nothing)`,
    );
  }
}
assert.deepEqual(gaps, [], 'no Kit or Mark names a glyph that does not exist');
assert.ok(Array.isArray(model.findings), 'findings collected for the CLI to echo');

/* ---- push readiness ----------------------------------------------------

   The bundle being correct on disk is not the same as it being pushable, and
   the gap between the two was live: every page carried
   `url('../parkbound-twin/vendor/fonts/…')`. DesignSync pushes files to
   PROJECT-relative paths, so a page pushed on its own has no
   `../parkbound-twin/` above it — the typeface fell back to the system stack
   and the design system quietly misrepresented the app's own type. Nothing
   failed, because nothing was looking.

   These assertions are what looks. They are stated against `auditPushReadiness`
   — the same function `design:plan` gates on — and then each rule is proved to
   actually fire by feeding the auditor a bundle that breaks it. An assertion
   that has never been seen to fail is a rumour.
------------------------------------------------------------------------- */

const plan = await designSyncPlan();
const planPaths = plan.map((f) => f.projectPath);

assert.deepEqual(
  auditPushReadiness(plan, pages),
  [],
  'the bundle as generated is pushable',
);

// The push root is a self-contained unit: the fonts ship inside it.
for (const weight of FONT_WEIGHTS) {
  const projectPath = `${FONT_DIR}/${fontFile(weight)}`;
  assert.ok(
    planPaths.includes(projectPath),
    `weight ${weight} is declared by the shell CSS, so ${projectPath} must travel with the pages`,
  );
}
assert.equal(mimeFor('a.woff2'), 'font/woff2', 'binary files carry a mimeType for write_files');
assert.equal(mimeFor('a.html'), 'text/html');
assert.equal(mimeFor('a.json'), 'application/json');

// The specific bug, named. No page may reach at the twin's folder again.
for (const [file] of PAGES) {
  assert.ok(
    !pages.get(file).includes('parkbound-twin'),
    `${file} reaches into docs/design/parkbound-twin — that folder is not pushed with the bundle`,
  );
}

// Every reference resolves inside the push root, and every declared @font-face
// points at a file that is actually in the plan.
for (const [file] of PAGES) {
  const refs = pageReferences(pages.get(file));
  assert.ok(refs.length > 0, `${file} has references to check — the extractor is not blind`);
  for (const ref of refs) {
    assert.ok(
      planPaths.includes(ref),
      `${file} references ${ref}, which is not in the push plan`,
    );
  }
}

// DesignSync's own limits.
assert.ok(
  plan.length <= DESIGN_SYNC_LIMITS.maxFilesPerCall,
  `${plan.length} files, over the ${DESIGN_SYNC_LIMITS.maxFilesPerCall}-file per-call limit`,
);
for (const f of plan) {
  assert.ok(
    f.bytes <= DESIGN_SYNC_LIMITS.maxFileBytes,
    `${f.projectPath} is ${f.bytes} bytes, over the ${DESIGN_SYNC_LIMITS.maxFileBytes}-byte cap`,
  );
  assert.ok(
    f.projectPath.length <= DESIGN_SYNC_LIMITS.maxProjectPathChars,
    `${f.projectPath} is over the ${DESIGN_SYNC_LIMITS.maxProjectPathChars}-char path cap`,
  );
}

/* ---- and now prove the auditor is not just saying yes -------------------

   Each rule gets a bundle that violates it, and the auditor has to say so. The
   cheapest way to make a "nothing is wrong" gate pass is for it to stop
   looking, which is the same failure the glyph reader had — so it is tested the
   same way.
------------------------------------------------------------------------- */

/** The real bundle with one page's HTML swapped for `html`. */
const withPage = (file, html) => new Map([...pages, [file, html]]);
const fires = (problems, needle, what) => {
  assert.ok(
    problems.some((p) => p.includes(needle)),
    `${what}: expected a violation mentioning "${needle}", got ${JSON.stringify(problems)}`,
  );
};

// 1. dsCard marker missing from the first line.
{
  const html = pages.get('icons.html').split('\n').slice(1).join('\n');
  fires(auditPushReadiness(plan, withPage('icons.html', html)), '@dsCard', 'stripped marker');
}
// ...and present, but on the wrong line — the reader only looks at the first.
{
  const lines = pages.get('icons.html').split('\n');
  const html = [lines[1], lines[0], ...lines.slice(2)].join('\n');
  fires(auditPushReadiness(plan, withPage('icons.html', html)), '@dsCard', 'marker on line two');
}
// ...and with the wrong group, which would file the card in the wrong place.
{
  const html = pages.get('icons.html').replace('group="Icons"', 'group="Glyphs"');
  fires(auditPushReadiness(plan, withPage('icons.html', html)), '@dsCard', 'wrong group');
}

// 2. references that leave the push root — the original bug and its neighbours.
for (const [ref, what] of [
  ['../parkbound-twin/vendor/fonts/plus-jakarta-sans-latin-400-normal.woff2', 'the original bug'],
  ['/Users/someone/six-flags-sa/docs/design/system/index.html', 'absolute filesystem path'],
  ['https://fonts.gstatic.com/s/plusjakartasans.woff2', 'remote https asset'],
  ['//fonts.gstatic.com/s/plusjakartasans.woff2', 'protocol-relative asset'],
  ['vendor/fonts/plus-jakarta-sans-latin-700-normal.woff2', 'a weight that is not vendored'],
]) {
  const html = pages.get('index.html').replace('</head>', `<link href="${ref}"></head>`);
  fires(auditPushReadiness(plan, withPage('index.html', html)), ref, what);
}
// The same, through CSS url() rather than an attribute.
{
  const html = pages
    .get('index.html')
    .replace("url('vendor/fonts/", "url('../parkbound-twin/vendor/fonts/");
  fires(auditPushReadiness(plan, withPage('index.html', html)), '../parkbound-twin', 'url() escape');
}

// 3. the per-file cap.
{
  const fat = plan.map((f) =>
    f.projectPath === 'icons.html'
      ? { ...f, bytes: DESIGN_SYNC_LIMITS.maxFileBytes + 1 }
      : f,
  );
  fires(auditPushReadiness(fat, pages), 'per-file cap', 'oversized file');
}

// 4. the per-call file limit.
{
  const many = Array.from({ length: DESIGN_SYNC_LIMITS.maxFilesPerCall + 1 }, (_, n) => ({
    ...plan[0],
    projectPath: `filler-${n}.html`,
  }));
  fires(auditPushReadiness([...plan, ...many], pages), 'per-call limit', 'too many files');
}

// 5. the project-path length cap.
{
  const long = 'x'.repeat(DESIGN_SYNC_LIMITS.maxProjectPathChars + 1);
  fires(
    auditPushReadiness([...plan, { ...plan[0], projectPath: long }], pages),
    'project-path cap',
    'over-long path',
  );
}

// 6. a page in PAGES that never rendered.
{
  const missing = new Map(pages);
  missing.delete('vocabulary.html');
  fires(auditPushReadiness(plan, missing), 'was not rendered', 'missing page');
}

/* ---- the staleness gate ------------------------------------------------ */
// The whole reason the bundle is generated: a committed copy that no longer
// matches its sources has to fail, or it is just another twin.
const fresh = await checkDesignBundle();
assert.deepEqual(
  fresh.drift,
  [],
  'the committed bundle matches its sources — run `npm run design:build`',
);

const victim = join(root, OUT_DIR, 'vocabulary.html');
const original = readFileSync(victim, 'utf8');
try {
  writeFileSync(victim, `${original}\n<!-- drift -->\n`, 'utf8');
  const stale = await checkDesignBundle();
  assert.equal(stale.drift.length, 1, 'exactly the edited file is reported');
  assert.equal(stale.drift[0].path, `${OUT_DIR}/vocabulary.html`);
  assert.equal(stale.drift[0].reason, 'content drift');
} finally {
  writeFileSync(victim, original, 'utf8');
}

assert.deepEqual((await checkDesignBundle()).drift, [], 'restored cleanly');

console.log('design-bundle: ok');
