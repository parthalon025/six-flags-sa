#!/usr/bin/env node
/**
 * The digital twin — derivation, provenance, and the staleness gate.
 *
 *   node test/scripts/design-twin.test.mjs
 *
 * The twin's whole claim is that **everything on its pages was read from
 * something real**. That claim is only worth as much as the assertions behind
 * it, so this file is mostly about proving the readers are faithful and that
 * nothing can appear on a page which the capture did not record.
 *
 * It needs no browser and no server: it reads the committed capture record, the
 * same way `design:build` does. Re-photographing the app is
 * `npm run design:twin`; this suite checks what that produced.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classLiterals,
  crossCheckTokens,
  declarationMap,
  resolveOwners,
  sourceIndex,
  profileShown,
  statesNotShown,
  traceCopy,
} from '../../scripts/lib/design-twin/resolve.mjs';
import { planSections, screenPlan, settingsTopics } from '../../scripts/lib/design-twin/plan.mjs';
import { readRecord, staleness, RECORD_FILE, SHOT_DIR } from '../../scripts/lib/design-twin/record.mjs';
import { twinPageIndex, twinPages, SHOT_SUBDIR } from '../../scripts/lib/design-twin/render.mjs';
import { SHOT_MAX_BYTES } from '../../scripts/lib/design-twin/capture.mjs';
import {
  buildModel,
  composeDesignBundle,
  designSyncPlan,
  auditPushReadiness,
  mimeFor,
  DESIGN_SYNC_LIMITS,
} from '../../scripts/lib/design-bundle/compose.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const index = sourceIndex();

/* ---- the tour is derived, not written down ----------------------------- */

const topics = settingsTopics(index);
assert.ok(topics.length >= 5, 'every Settings topic is read out of SettingsPanel.jsx');
const settingsSrc = index.read('apps/party-tracker/components/SettingsPanel.jsx');
for (const { id, label } of topics) {
  assert.ok(settingsSrc.includes(`id: '${id}'`), `${id} came from the component's TOPICS table`);
  assert.ok(settingsSrc.includes(`label: '${label}'`), `${label} is the component's own word`);
}

/* The order matters and is the bug that was actually hit: `setSection` is also
   called by the effect that jumps to Heights, ABOVE the tab strip, so reading
   the whole file returns the sections in an order the strip does not paint —
   and the tour then clicks the wrong tab and files the shot under the wrong
   name. Anchoring to the strip is what fixes it, so assert the strip's order. */
const sections = planSections(index);
const planSrc = index.read('apps/party-tracker/components/PlanPanel.jsx');
const stripAt = planSrc.indexOf('className="settingsTopics"');
const offsets = sections.map((id) => planSrc.indexOf(`setSection('${id}')`, stripAt));
assert.deepEqual(
  [...offsets].sort((a, b) => a - b),
  offsets,
  'Plan sections come back in the order the tab strip paints them',
);

const plan = screenPlan(index);
const ids = plan.map((s) => s.id);
assert.equal(new Set(ids).size, ids.length, 'no two screens share an id');
for (const { id, label } of topics) {
  assert.ok(ids.includes(`settings-${id}`), `the tour visits Settings — ${label}`);
}
for (const section of sections) {
  assert.ok(ids.includes(`plan-${section}`), `the tour visits Plan — ${section}`);
}

/* ---- the readers ------------------------------------------------------- */

/* Floors, not snapshots — the same rule the design bundle's readers are held
   to. The cheap way to make "nothing is missing" pass is to stop finding
   things, so each of these names something that is really in the file. */
const placeList = classLiterals(index.read('apps/party-tracker/components/PlaceList.jsx'));
assert.ok(placeList.has('poiRow'), 'a plain className="…" literal is read');
assert.ok(placeList.has('emptyNote'), "the empty branch's own class is read");
assert.ok(placeList.has('on'), 'a class chosen inside a template hole is read — that is a state');
assert.ok(placeList.get('emptyNote').line > 1, 'each class carries the line it is declared at');
assert.ok(
  index.read('apps/party-tracker/components/PlaceList.jsx').split('\n')[placeList.get('emptyNote').line - 1].includes('emptyNote'),
  'the recorded line really is the line the class is on',
);

const decl = declarationMap(index);
assert.ok(decl.byClass.get('poiRow').includes('apps/party-tracker/components/PlaceList.jsx'));

/* Ownership: give the resolver the classes one component declares and it must
   name that component first. */
const owners = resolveOwners([...placeList.keys()], index, decl);
assert.equal(
  owners[0].file,
  'apps/party-tracker/components/PlaceList.jsx',
  'the file that declares the classes is the file that owns the screen',
);
assert.ok(owners[0].weight >= 1, 'weight is counted in whole exclusive classes');

/* Copy tracing: a line taken verbatim out of a component must trace back to it,
   and a line that exists nowhere must trace to nothing. The second half is the
   one that matters — a tracer that always finds a source is a tracer that
   launders invention as provenance. */
const traced = traceCopy(
  ['Search every place instead', 'Zizzle the frobnicating wumpus, twice'],
  index,
);
assert.equal(traced[0].how, 'exact');
assert.ok(
  traced[0].sources.includes('apps/party-tracker/components/PlaceList.jsx'),
  'real copy traces to the component that writes it',
);
assert.deepEqual(traced[1].sources, [], 'invented copy traces to nothing');
assert.equal(traced[1].how, 'untraced', 'and says so, rather than going quiet');

/* JSX writes `what&apos;s` where the browser shows `what's`; a tracer that does
   not know that reports real copy as untraced and teaches the reader to ignore
   the untraced list. */
assert.equal(
  traceCopy(["Hide what's likely down"], index)[0].how,
  'exact',
  'an entity in the source matches the character on screen',
);

/* An ordinary English phrase is in half the repo, and naming four of those files
   as where it is "written" would send a reader to the wrong one. A FALSE source
   is worse than no source — so past a handful of hits the tracer declines to
   name any and says how many there are. */
const common = traceCopy(['there'], index)[0];
assert.equal(common.how, 'ambiguous', 'a phrase found everywhere is not attributed to anywhere');
assert.ok(common.hits > 6, 'and the row carries the count that made it ambiguous');

/* Comments are stripped before a source is searched, because this repo writes
   its comments in full sentences and an English phrase on screen will otherwise
   match prose in a file that has nothing to do with the screen.

   `PlaceList.jsx` contains "nothing at all" — inside a comment about the render
   cap. `PartyPanel.jsx` contains it as real copy. Only the second is a source. */
assert.ok(
  index.read('apps/party-tracker/components/PlaceList.jsx').includes('nothing at all'),
  'PlaceList really does contain that phrase — in a comment',
);
const commentMatch = traceCopy(['shows nothing at all when somebody needs you'], index)[0];
assert.ok(
  commentMatch.sources.includes('apps/party-tracker/components/PartyPanel.jsx'),
  'the file that writes the copy is still found',
);
assert.ok(
  !traceCopy(['looks like it did nothing at all'], index)[0].sources.length,
  'a phrase that exists only inside a comment is not offered as the source of copy',
);

/* States by subtraction: hide `emptyNote` from the "seen" set and it must come
   back as a branch this shot does not show — flagged, because it is a state. */
const seen = [...placeList.keys()].filter((c) => c !== 'emptyNote');
const states = statesNotShown(
  [{ file: 'apps/party-tracker/components/PlaceList.jsx' }],
  seen,
  index,
  decl,
);
const empty = states.find((s) => s.className === 'emptyNote');
assert.ok(empty, 'a branch the capture did not contain is reported');
assert.equal(empty.flagged, true, 'and an empty-state branch is flagged as one');
assert.ok(
  !states.some((s) => seen.includes(s.className)),
  'nothing that WAS on screen is reported as unshown',
);

/* Tokens go through the design bundle's reader, never a second one. */
const checked = crossCheckTokens(['--bg', '--not-a-real-token']);
assert.equal(checked.find((t) => t.name === '--bg').inPalette, true);
assert.ok(checked.find((t) => t.name === '--bg').night, 'and carries its resolved value');
assert.equal(checked.find((t) => t.name === '--not-a-real-token').inPalette, false);

/* The seeded-Profile predicate. Both of the rules that were tried and thrown
   away are pinned here, because both looked right and both were wrong:
   a string-only diff calls a ticking clock a change, and a class-only diff
   misses Marks, where the gate and the signed-in state share their classes and
   differ only in words. */
{
  const clockTick = { classesGained: [], classesLost: [] };
  const live = [{ text: '3 min ago', sources: [], how: 'untraced' }];
  assert.equal(
    profileShown(clockTick, live, [{ text: '2 min ago', sources: [], how: 'untraced' }]),
    false,
    'a live value changing is not a Profile changing the screen',
  );
  assert.equal(
    profileShown({ classesGained: ['worldMark'], classesLost: [] }, [], []),
    true,
    'a branch appearing is',
  );
  assert.equal(
    profileShown(clockTick, [], [{ text: 'Sign in', sources: ['a.jsx'], how: 'exact' }]),
    true,
    'and so is a line of real copy going away, even with no class change at all',
  );
  assert.equal(
    profileShown(clockTick, [{ text: 'Here', sources: ['a.jsx', 'b.jsx'], how: 'ambiguous' }], []),
    false,
    'a phrase too common to attribute is not evidence of anything',
  );
}

/* ---- the committed record --------------------------------------------- */

const record = readRecord();
assert.ok(record, `a capture record is committed at ${RECORD_FILE} — run: npm run design:twin`);
assert.ok(record.screens.length >= 10, 'the tour photographed the app, not a corner of it');
assert.deepEqual(record.palettes, ['day', 'night'], 'both shipped palettes were captured');
for (const palette of record.palettes) {
  assert.ok(
    record.paletteLabels[palette],
    `the ${palette} palette was named by the app's own control, not by the generator`,
  );
}

const reached = record.screens.filter((s) => !s.unreached);
assert.ok(reached.length >= 10, 'most of the tour was reachable');
for (const screen of reached) {
  for (const palette of record.palettes) {
    const shot = screen.shots[palette];
    assert.ok(shot, `${screen.id} was photographed in ${palette}`);
    assert.ok(
      shot.bytes <= SHOT_MAX_BYTES,
      `${shot.file} is ${shot.bytes} bytes, over the twin's own ${SHOT_MAX_BYTES}-byte ceiling`,
    );
    assert.ok(
      shot.bytes <= DESIGN_SYNC_LIMITS.maxFileBytes,
      `${shot.file} is over DesignSync's per-file cap`,
    );
    assert.equal(
      readFileSync(join(root, SHOT_DIR, shot.file)).length,
      shot.bytes,
      `${shot.file} on disk is the file the record describes`,
    );
  }
  assert.ok(screen.owners.length, `${screen.id} resolved to at least one component`);
  assert.ok(screen.tokens.length, `${screen.id} recorded the tokens it is painted with`);
  assert.ok(screen.copy.length, `${screen.id} recorded the words on it`);
}

/* A screen that could not be reached carries a reason and NOTHING ELSE. This is
   the anti-fabrication rule at its sharpest: the failure mode being guarded
   against is a page that looks complete because somebody filled the gap. */
for (const screen of record.screens.filter((s) => s.unreached)) {
  assert.deepEqual(screen.shots, {}, `${screen.id} was not reached, so it has no shots`);
  assert.deepEqual(screen.copy, [], `${screen.id} was not reached, so it claims no copy`);
  assert.ok(screen.unreached.length > 8, `${screen.id} says why in a sentence, not a shrug`);
}

/* ---- provenance: nothing on a page that the capture did not record ------ */

const model = await buildModel();
const pages = twinPages(record, model);
assert.equal(pages.size, record.screens.length + 1, 'a page per screen, plus the contents');

/* The seeded-Profile leg, as it landed. */
const withProfile = record.screens.filter((s) => s.profile?.shown);
assert.ok(record.seededProfile, 'the record says how the signed-in rendering was reached');
assert.equal(
  record.seededProfile.key,
  'parkbound.session',
  'and names the session key it wrote, read out of lib/auth/session.js',
);
assert.ok(
  !record.seededProfile.rank && !record.seededProfile.title,
  'the seeded Profile hands the app no rank and no Title — it derives its own',
);
for (const screen of withProfile) {
  assert.ok(screen.profile.shot.bytes <= SHOT_MAX_BYTES, `${screen.id} profile shot is in budget`);
  const html = pages.get(`screen-${screen.id}.html`);
  assert.ok(
    html.includes('not with a sign-in'),
    `${screen.id} says on its face that the session was seeded rather than signed in`,
  );
}
/* A shot the predicate did not keep must not be referenced anywhere, or the
   push carries a file no page shows. */
for (const screen of record.screens.filter((s) => s.profile && !s.profile.shown)) {
  const html = pages.get(`screen-${screen.id}.html`);
  assert.ok(
    !html.includes(screen.profile.shot.file),
    `${screen.id} does not show a Profile shot the predicate dropped`,
  );
}


/* The gate the owner asked for, stated mechanically.
 *
 * Every string a twin page renders in its copy tables is matched back to the
 * record. A string on the page that is not in the record would be one the
 * generator wrote — which is exactly how `PB-4K9T` and `Search 100+ Worlds`
 * got into the last twin, and both were believable. Traced and untraced are
 * checked separately, so a string cannot be promoted from "traced to nothing"
 * into the sourced table without this failing. */
const cells = (html, section) => {
  const at = html.indexOf(section);
  const end = html.indexOf('</table>', at);
  const block = at === -1 ? '' : html.slice(at, end);
  return [...block.matchAll(/<td class="wrapcell" style="color:var\(--label\)">([^<]*)<\/td>/g)].map(
    (m) => m[1],
  );
};
const unescape = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

let checkedStrings = 0;
for (const screen of reached) {
  const html = pages.get(`screen-${screen.id}.html`);
  assert.ok(html, `${screen.id} has a page`);

  const recordedTraced = new Set(screen.copy.filter((c) => c.sources.length).map((c) => c.text));
  const recordedUntraced = new Set(screen.copy.filter((c) => !c.sources.length).map((c) => c.text));

  for (const text of cells(html, '<h2>Every word on it</h2>')) {
    assert.ok(
      recordedTraced.has(unescape(text)),
      `${screen.id} renders "${text}" as sourced copy, and the capture did not record it as sourced`,
    );
    checkedStrings += 1;
  }
  for (const text of cells(html, '<h3>Traced to nothing</h3>')) {
    assert.ok(
      recordedUntraced.has(unescape(text)),
      `${screen.id} renders "${text}" as untraced copy the capture did not record`,
    );
    checkedStrings += 1;
  }

  /* Every image a page shows is a shot the capture took. */
  for (const src of [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1])) {
    const file = src.slice(`${SHOT_SUBDIR}/`.length);
    assert.ok(
      Object.values(screen.shots).some((s) => s.file === file),
      `${screen.id} shows ${src}, which is not one of its shots`,
    );
  }
}
assert.ok(checkedStrings > 100, 'the provenance gate really looked at the copy tables');

/* An unreached screen's page says why and draws nothing. */
for (const screen of record.screens.filter((s) => s.unreached)) {
  const html = pages.get(`screen-${screen.id}.html`);
  assert.ok(html.includes('not reached'), `${screen.id}'s page says it was not reached`);
  assert.ok(!html.includes('<img '), `${screen.id}'s page draws nothing in place of the screen`);
}

/* ---- the twin joins the same push unit, under the same audit ----------- */

const pushPlan = await designSyncPlan();
const pushPaths = new Set(pushPlan.map((f) => f.projectPath));

/* The audit is run over the WHOLE bundle, because that is the unit that gets
   pushed — the twin's pages reference the shots, the bundle's index references
   the twin, and a rule applied to half of it proves nothing about the half that
   is pushed alongside. */
const { pages: allPages } = await composeDesignBundle();
assert.deepEqual(
  auditPushReadiness(pushPlan, allPages, model.pageIndex),
  [],
  'the bundle, twin included, passes the audit the bundle already enforces',
);
for (const [file] of twinPageIndex(record)) {
  assert.ok(pushPaths.has(file), `${file} travels with the push`);
  assert.equal(
    pages.get(file).split('\n')[0],
    '<!-- @dsCard group="Screens" -->',
    `${file} opens with its @dsCard marker on line 1`,
  );
}
for (const screen of reached) {
  for (const shot of Object.values(screen.shots)) {
    assert.ok(
      pushPaths.has(`${SHOT_SUBDIR}/${shot.file}`),
      `${shot.file} is copied into the push root — a page that reaches outside it shows a hole`,
    );
  }
}
assert.equal(mimeFor('a.webp'), 'image/webp', 'shots carry a mimeType for write_files');

/* And the rules are proved to FIRE on the twin's own shapes. An assertion that
   has never been seen to fail is a rumour — the same argument the design
   bundle's push test makes, restated for the half that carries images. */
const fires = (problems, needle, what) => {
  assert.ok(
    problems.some((p) => p.includes(needle)),
    `${what} must be caught — got ${JSON.stringify(problems)}`,
  );
};
{
  /* A page reaching back at the capture directory. This is THE failure the
     self-contained rule exists for: pushed to a project, `../twin-capture/`
     has nothing above it and the screenshot is a broken image. */
  const someScreen = reached[0];
  const file = `screen-${someScreen.id}.html`;
  const shot = Object.values(someScreen.shots)[0].file;
  const escaped = new Map(allPages);
  escaped.set(
    file,
    allPages.get(file).replace(`${SHOT_SUBDIR}/${shot}`, `../twin-capture/shots/${shot}`),
  );
  fires(
    auditPushReadiness(pushPlan, escaped, model.pageIndex),
    '../twin-capture',
    'a screen page reaching outside the push root for its shot',
  );
}
{
  const stripped = new Map(allPages);
  stripped.set('screens.html', allPages.get('screens.html').split('\n').slice(1).join('\n'));
  fires(
    auditPushReadiness(pushPlan, stripped, model.pageIndex),
    '@dsCard',
    "the twin's contents page losing its card marker",
  );
}
{
  const fat = pushPlan.map((f) =>
    f.projectPath.endsWith('.webp') ? { ...f, bytes: DESIGN_SYNC_LIMITS.maxFileBytes + 1 } : f,
  );
  fires(
    auditPushReadiness(fat, allPages, model.pageIndex),
    'per-file cap',
    'a shot over the per-file cap',
  );
}
assert.ok(
  pushPlan.length <= DESIGN_SYNC_LIMITS.maxFilesPerCall,
  `the bundle is ${pushPlan.length} files, over DesignSync's per-call limit`,
);

/* ---- staleness --------------------------------------------------------- */

/* Keyed on the INPUTS, never the image. The app draws a clock, live weather and
   a breathing GPS pulse, so two captures of an unchanged app differ in
   thousands of pixels — a check on the bytes would fail every run, and a check
   that fails every run gets switched off. */
assert.ok(Object.keys(record.inputs).length > 5, 'the record names the files it was read from');
assert.ok(
  record.inputs['apps/party-tracker/app/globals.css'],
  'the stylesheet the tokens were measured against is one of them',
);
for (const screen of reached) {
  for (const owner of screen.owners) {
    assert.ok(
      owner.file in record.inputs,
      `${owner.file} renders ${screen.id}, so a change to it has to make the twin stale`,
    );
  }
}

const now = staleness(record);
assert.equal(
  now.stale,
  false,
  `the committed twin is stale — ${now.changed.concat(now.missing).join(', ')}. ` +
    'Re-photograph the app: npm run design:twin',
);

/* Prove the gate fires. An assertion that has never been seen to fail is a
   rumour — the same argument the design bundle's own drift test makes. */
const victim = Object.keys(record.inputs).find((p) => p.endsWith('.jsx')) ?? 'apps/party-tracker/app/globals.css';
const drifted = staleness({
  ...record,
  inputs: { ...record.inputs, [victim]: 'deadbeef'.repeat(8) },
});
assert.equal(drifted.stale, true, 'a changed source makes the twin stale');
assert.deepEqual(drifted.changed, [victim], 'and names exactly the file that changed');

const gone = staleness({
  ...record,
  inputs: { ...record.inputs, 'apps/party-tracker/components/DoesNotExist.jsx': 'x'.repeat(64) },
});
assert.equal(gone.stale, true, 'a source that has been deleted makes the twin stale');
assert.ok(gone.missing.includes('apps/party-tracker/components/DoesNotExist.jsx'));

/* The advisory tier reports and never throws: a component on disk is not yet a
   screen, so it must not be able to fail a build. */
const advisory = staleness({ ...record, componentIndex: [] });
assert.equal(advisory.stale, false, 'a new component is noticed without failing anything');
assert.ok(advisory.advisory.length > 0, 'and it IS noticed');

console.log(
  `design-twin: ok — ${reached.length}/${record.screens.length} screens, ` +
    `${checkedStrings} copy strings traced back to the capture`,
);
