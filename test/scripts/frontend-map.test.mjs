#!/usr/bin/env node
/**
 * Front-end map — derivation, the drift gate, and the contrast gate.
 *
 *   node test/scripts/frontend-map.test.mjs
 *
 * The map exists because a hand-written one went stale and nothing could tell.
 * So these assertions are about the *readers* being faithful to the app rather
 * than about the wording of the page: a screen resolved through the render
 * branch that actually draws it, a class counted only where it is really
 * written, a paired constant compared against the value the module computes,
 * and — the one that repays the whole file — a deliberate 308-vs-236 divergence
 * that has to turn the check red.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCES,
  readScreens,
  readClasses,
  readPairs,
  readFactory,
  readOrphans,
} from '../../scripts/lib/frontend-map/sources.mjs';
import { measureContrast, pairKey, FLOORS } from '../../scripts/lib/frontend-map/contrast.mjs';
import { KNOWN_CONTRAST_FAILURES } from '../../scripts/lib/frontend-map/contrast-known.mjs';
import { renderMap } from '../../scripts/lib/frontend-map/render.mjs';
import { buildModel, checkMap, OUT_PATH } from '../../scripts/lib/frontend-map/compose.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/* ---- screens ----------------------------------------------------------- */
const screens = readScreens();
const byId = new Map(screens.screens.map((s) => [s.id, s]));

assert.deepEqual(screens.gaps, [], 'every screen in the registry resolved to a branch');
assert.deepEqual(screens.unresolvedImports, [], 'every imported component resolved to a file on disk');

// The registry, as page.js keeps it: five tabs and the pushed views.
assert.deepEqual(
  screens.screens.filter((s) => s.kind === 'tab').map((s) => s.id),
  ['explore', 'party', 'quests', 'rides', 'settings'],
  'TAB_ORDER read in order — it is the slide direction, so order is meaning',
);

// A dynamic() panel counts. Half the screens arrive that way, and a reader
// that knew only `import X from` would call them all unowned.
assert.deepEqual(
  byId.get('quests').components.map((c) => c.path),
  ['apps/party-tracker/components/SideQuestsPanel.jsx'],
  'a dynamic() import resolves to its real file',
);

// Depth is what separates a screen's owner from a glyph inside it. Explore
// Worlds renders <Icon>; it belongs to page.js, which draws the list itself.
const venues = byId.get('venues');
assert.equal(venues.inline, true, 'a screen with no panel of its own is reported as inline');
assert.deepEqual(venues.also.map((c) => c.name), ['Icon'], 'the glyph is reported, but not as the owner');
assert.deepEqual(venues.components, [], 'a leaf component is never promoted to owner');

// A fragment holding two panels has two owners; both are things an agent
// editing that screen has to know about.
assert.deepEqual(
  byId.get('party').components.map((c) => c.name),
  ['PartyPanel'],
  'the tab root mounts its panel directly',
);

assert.ok(
  screens.chrome.some((c) => c.name === 'TabBar'),
  'components mounted outside every branch are reported as chrome',
);
assert.ok(
  !screens.chrome.some((c) => c.name === 'PlaceList'),
  'a screen owner is not also listed as chrome',
);

/* ---- unmounted components ---------------------------------------------- */
// Relative sibling imports count as importers. ParkMap reaches MapLegend as
// './MapLegend'; a reader that knew only the '@/' alias would call three
// mounted map layers dead — the mirror image of the twin's WorldPicker.
const orphans = readOrphans();
assert.ok(!orphans.includes('MapLegend.jsx'), "a './' sibling import counts as an importer");
assert.ok(!orphans.includes('WorldPicker.jsx'), 'a component mounted only by an overlay is not an orphan');

/* ---- classes ----------------------------------------------------------- */
const classes = readClasses();
const cls = (name) => classes.rows.find((r) => r.name === name);

assert.ok(classes.shared.length > 10, 'the shared-class index found the collision surface');
assert.ok(cls('btn').shared, '.btn is shared — the exact class four agents overrode at once');
assert.ok(cls('btn').files.length > 10, '.btn is counted in every file that writes it');
assert.equal(cls('btn').styled, true, 'a class with a rule in globals.css is marked styled');

// The state-dependent half. `` `chip ${on ? 'on' : ''}` `` is how nearly every
// toggle in this repo is written, and a reader that skipped the template hole
// would report `.on` as belonging to the three files that spell it plainly.
assert.ok(cls('on').files.length > 10, 'classes inside a ${…} hole are counted');

// A hole is not a name. In `` `lyr-custom lyr-iso-map lyr-${spec.id}` `` the
// first two are real classes and the third only exists at runtime, so the
// `lyr-` in front of the hole must not become an entry of its own.
assert.equal(cls('lyr-'), undefined, 'the fragment in front of a hole is not a class');
assert.ok(cls('lyr-custom').shared === false && cls('lyr-custom').files.length === 1);
assert.ok(cls('lyr-iso-map'), 'a whole name beside a hole survives');

// A class used but unstyled is a real finding, so the flag has to be able to
// be false — otherwise the column is decoration.
assert.ok(
  classes.rows.some((r) => !r.styled),
  'a class with no rule in globals.css is reported as such',
);

/* ---- paired constants -------------------------------------------------- */
const pairs = await readPairs();
const pair = (css, palette = 'night') => pairs.pairs.find((p) => p.css === css && p.palette === palette);

// The pair list is read out of the stylesheet's own comments, not kept here.
assert.ok(pair('--peek'), '--peek pairs with the constant its comment names');
assert.equal(pair('--peek').js, 'SHEET_PEEK_PX');
assert.equal(pair('--peek').via, 'export', 'a computed constant is imported, not re-derived');
assert.equal(pair('--peek').ok, true, '--peek and SHEET_PEEK_PX agree');

// A module-local const is not an export. NIGHT_BARRED/DAY_BARRED are read from
// source, and one comment governs both palette blocks.
assert.equal(pair('--barred').js, 'NIGHT_BARRED');
assert.equal(pair('--barred', 'day').js, 'DAY_BARRED');
assert.equal(pair('--barred').via, 'literal', 'a module-local literal is read from source');
assert.equal(pair('--barred', 'day').ok, true, 'the day block pairs with the day constant');

assert.deepEqual(pairs.diverged, [], 'no committed pair has come apart');

// The honest gap. `--shut` says "SHUT_PX in app/page.js" and the number lives
// in SHEET_SHUT_PX in lib/sheet.js — a stale sentence, reported rather than
// papered over, with the constant it probably meant.
const shut = pair('--shut');
assert.equal(shut.value, null, 'a counterpart that does not exist is not guessed at');
assert.match(shut.why, /SHEET_SHUT_PX in lib\/sheet\.js/, 'the gap names the likely constant');
assert.ok(
  pairs.gaps.some((g) => g.includes('--shut')),
  'an unresolved counterpart is reported as a gap',
);

/* ---- the drift gate ---------------------------------------------------- */
// The whole reason the map is generated: a committed copy that no longer
// matches its sources has to fail, or it is another hand-written table.
assert.deepEqual(
  (await checkMap()).drift,
  [],
  `the committed map matches its sources — run \`npm run frontend:map\``,
);

const victim = join(root, OUT_PATH);
const original = readFileSync(victim, 'utf8');
try {
  writeFileSync(victim, `${original}\n<!-- drift -->\n`, 'utf8');
  const stale = await checkMap();
  assert.equal(stale.drift.length, 1, 'exactly the edited file is reported');
  assert.equal(stale.drift[0].path, OUT_PATH);
  assert.equal(stale.drift[0].reason, 'content drift');
} finally {
  writeFileSync(victim, original, 'utf8');
}
assert.deepEqual((await checkMap()).drift, [], 'restored cleanly');

/* ---- the divergence gate ----------------------------------------------- */
// The bug this was built for, reproduced. `--peek` shipped at 308px against a
// SHEET_PEEK_PX of 236 and no test failed, because the layout was not broken —
// only wrong on the first paint at the one stop the app rests on.
{
  const cssPath = join(root, SOURCES.css);
  const css = readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('--peek: 236px;'), 'the stylesheet still declares --peek at its derived value');
  try {
    writeFileSync(cssPath, css.replace('--peek: 236px;', '--peek: 308px;'), 'utf8');
    const broken = await readPairs();
    const diverged = broken.diverged.find((p) => p.css === '--peek');
    assert.ok(diverged, 'the 308-vs-236 divergence is caught');
    assert.equal(diverged.cssValue, '308px');
    assert.equal(diverged.value, 236);

    const model = await buildModel();
    assert.equal(model.pairs.diverged.length, 1, 'the model carries the divergence to the CLI');
  } finally {
    writeFileSync(cssPath, css, 'utf8');
  }
  assert.deepEqual((await readPairs()).diverged, [], 'restored cleanly');
}

/* ---- contrast ---------------------------------------------------------- */
const contrast = measureContrast();

assert.ok(contrast.rows.length >= 8, 'both palettes measured for every named pairing');
assert.ok(
  FLOORS.some((f) => f.ratio === 4.5) && FLOORS.some((f) => f.ratio === 3),
  'the WCAG floors this app is held to are named',
);

// Only what the app paints is judged. A rejected proposal is measured and
// shown so the floor has a failing example beside it, but it cannot fail a
// build over a colour the app does not use.
const rejected = contrast.rows.find((r) => r.status === 'rejected');
assert.equal(rejected.judged, false, 'a rejected pairing is measured but not judged');
assert.ok(
  !contrast.failures.some((f) => f.status !== 'ships'),
  'nothing but a shipped pairing can fail',
);

// White on the Adventure orange: 2.84:1 on the app's most-pressed button.
const primary = contrast.rows.find((r) => pairKey(r) === '--onTint on --adventure');
assert.ok(primary.worst < primary.floor, 'the primary action still reads below its floor');
assert.ok(Math.abs(primary.worst - 2.84) < 0.01, 'measured at the ratio #576 records');

// Known debt is reported, never excluded — and it does not fail the command,
// or the gate could not have been run on the day it landed.
assert.deepEqual(contrast.regressions, [], 'no untracked contrast failure');
assert.equal(
  contrast.tracked.length,
  contrast.failures.length,
  'every current failure is accounted for in the baseline',
);
assert.deepEqual(contrast.fixed, [], 'the baseline lists nothing that has already been fixed');
assert.ok(
  KNOWN_CONTRAST_FAILURES.some((k) => k.issue === 576),
  'the tracked failure carries the issue tracking it',
);

// The baseline is a ratchet, not an allow-list: accepting 2.84:1 must not
// license 2.1:1 on the same pairing tomorrow.
{
  const entry = KNOWN_CONTRAST_FAILURES.find((k) => k.pair === '--onTint on --adventure');
  const original = entry.ratio;
  try {
    entry.ratio = 4.0;
    const worse = measureContrast();
    assert.equal(worse.regressions.length, 1, 'a tracked pairing that got worse fails the gate');
    assert.equal(pairKey(worse.regressions[0]), '--onTint on --adventure');
  } finally {
    entry.ratio = original;
  }
}

/* ---- the factory boundary ---------------------------------------------- */
const factory = readFactory();
assert.ok(
  factory.outputs.includes('apps/party-tracker/lib/venueIndex.js'),
  'the generated venue index is named as builder output',
);
assert.ok(
  factory.outputs.every((p) => p.includes('/')),
  'the policy sentence yielded paths, not the npm command beside them',
);
assert.deepEqual(
  factory.inputs,
  ['packages/venue-builder/data/venues/'],
  'builder input — the one place under the boundary that is meant to be hand-edited',
);

/* ---- the model the page is rendered from ------------------------------- */
const model = await buildModel();
assert.equal(model.gaps.length, model.screens.gaps.length + model.pairs.gaps.length, 'gaps gathered, not restated');
assert.ok(model.sources.includes(SOURCES.page), 'the page names what it was read from');

/* ---- the page ---------------------------------------------------------- */
// The renderer decides headings and column order and nothing else — so what
// is asserted here is that every reader's answer reaches the page, and that
// the page says loudly enough not to hand-edit it.
const page = renderMap(model);
assert.match(page, /GENERATED FILE — do not edit by hand/, 'the page says what it is');
assert.match(page, /scripts\/frontend-map\.mjs/, 'and what wrote it');
assert.match(page, /SideQuestsPanel\.jsx/, 'the screen table reached the page');
assert.match(page, /\| `\.btn` \|/, 'the shared-class table reached the page');
assert.match(page, /SHEET_PEEK_PX/, 'the paired-constant table reached the page');
assert.match(page, /venueIndex\.js/, 'the factory boundary reached the page');
assert.match(page, /2\.84/, 'the contrast measurements reached the page');
// Links are relative to where the page lands, not to the repo root.
assert.match(page, /\]\(policies\/builder-app-contract\.md\)/, 'a policy link resolves from docs/agents/');
for (const gap of model.gaps) assert.ok(page.includes(gap), 'every gap is printed, not summarised away');

console.log('frontend-map: ok');
