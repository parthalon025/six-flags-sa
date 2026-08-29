#!/usr/bin/env node
/**
 * Photograph the running app and rebuild the twin from what it showed.
 *
 *   npm run design:twin           capture, then regenerate the design bundle
 *   npm run design:twin:check     is the committed twin still true of the code?
 *   npm run design:twin:resolve   re-annotate the capture, without a browser
 *   npm run design:twin:profile   re-run only the seeded-Profile leg
 *   node scripts/design-twin.mjs plan     the tour, without opening a browser
 *
 * The twin is the app's own screens, joined to the generated design system in
 * `docs/design/system/` so a designer opening the Design project sees what the
 * app looks like RIGHT NOW rather than an artist's impression of it.
 *
 * The modes cost very different things, and that is the point of having them.
 * `capture` needs a browser and a server and takes a quarter of an hour.
 * `profile` re-runs only the seeded-Profile leg against evidence the record
 * already holds — a few minutes. `resolve` re-derives every annotation from
 * that same evidence with no browser at all, in seconds, leaving the images
 * byte-identical, so improving a reader never means re-photographing the app.
 * `check` needs nothing and answers whether the committed twin is still true of
 * the code, which is why it is the one that can run on every commit.
 *
 * The server: `BASE_URL` points at it, `CHROMIUM_PATH` at the browser.
 *
 *   BASE_URL=http://127.0.0.1:3000 CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     npm run design:twin
 *
 * VERIFY THE SERVER IS SERVING THE TREE YOU ARE STANDING IN before trusting a
 * capture — this script checks `/app-version.json` against the working tree's
 * own HEAD and refuses a capture from a build that is behind it, because a
 * screenshot of yesterday's app filed as today's is worse than no screenshot.
 */
import { execFileSync } from 'node:child_process';
import { writeDesignBundle, OUT_DIR } from './lib/design-bundle/compose.mjs';
import {
  captureTwin,
  defaultVenue,
  launchForCapture,
  openTwinPhone,
  walkSeededProfile,
} from './lib/design-twin/capture.mjs';
import {
  readRecord,
  staleness,
  sweepShots,
  writeRecord,
  fingerprint,
  RECORD_FILE,
} from './lib/design-twin/record.mjs';
import { screenPlan } from './lib/design-twin/plan.mjs';
import { annotate, sourceIndex } from './lib/design-twin/resolve.mjs';
import { scrubGitEnv } from './lib/git-env.mjs';
import { root } from './lib/design-bundle/sources.mjs';

const mode = (process.argv[2] || 'capture').replace(/^--/, '');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

/* ------------------------------------------------------------------
   plan — what the tour would visit
   ------------------------------------------------------------------ */

if (mode === 'plan') {
  const plan = screenPlan(sourceIndex());
  console.log(`design-twin: ${plan.length} screens × 2 palettes = ${plan.length * 2} shots\n`);
  const width = Math.max(...plan.map((s) => s.id.length));
  for (const s of plan) console.log(`  ${s.id.padEnd(width)}  ${s.title}`);
  process.exit(0);
}

/* ------------------------------------------------------------------
   resolve — re-annotate what was already photographed
   ------------------------------------------------------------------ */

/* The shots are the expensive half and the annotations are the cheap one, so
   they are separable. Improve a reader in scripts/lib/design-twin/resolve.mjs
   and this re-derives every screen's components, tokens, copy and unshown
   branches from the evidence already in the record — no server, no browser, and
   the images stay byte-identical. It also re-keys the staleness fingerprint,
   because a better reader reads a different set of files. */
if (mode === 'resolve') {
  const record = readRecord();
  if (!record) {
    console.error(`design-twin: no capture record at ${RECORD_FILE}. Run: npm run design:twin`);
    process.exit(1);
  }
  /* A screen's title and intent belong to the tour, not to the capture — they
     are the only two fields in the record that were written by a person rather
     than read off a screen. Re-reading them from the plan here means a reworded
     intent lands without a re-photograph, and a screen the plan has since
     dropped keeps the words it was captured with rather than losing them. */
  const index = sourceIndex();
  const fromPlan = new Map(screenPlan(index).map((s) => [s.id, s]));
  const refreshed = record.screens.map((screen) => {
    const planned = fromPlan.get(screen.id);
    return planned ? { ...screen, title: planned.title, intent: planned.intent } : screen;
  });
  const { annotated, sources } = annotate(refreshed, index);
  const inputs = fingerprint([
    'apps/party-tracker/app/globals.css',
    'apps/party-tracker/app/page.js',
    'apps/party-tracker/public/venues/manifest.json',
    ...sources,
  ]);
  const next = { ...record, screens: annotated, inputs };
  writeRecord(next);
  for (const file of sweepShots(next)) console.log(`  swept shot ${file} — no longer referenced`);
  const owners = new Set(annotated.flatMap((s) => s.owners.map((o) => o.file)));
  console.log(
    `design-twin: re-annotated ${annotated.length} screens from the capture of ` +
      `${record.capturedAt} — ${owners.size} components named, ` +
      `${Object.keys(inputs).length} files in the staleness key.`,
  );
  const { written } = await writeDesignBundle();
  console.log(`design-twin: rebuilt ${written.length} files in ${OUT_DIR}/`);
  process.exit(0);
}

/* ------------------------------------------------------------------
   profile — re-run only the seeded-Profile leg
   ------------------------------------------------------------------ */

/* The signed-out evidence is already in the record, so the leg that asks "what
   does a Profile change here" does not need the seventeen screens photographed
   again to answer. This walks the tour once, with a session seeded, and merges
   the result into the existing capture — minutes instead of a quarter of an
   hour, which is the difference between a rule that can be revised and one
   nobody dares touch. */
if (mode === 'profile') {
  const record = readRecord();
  if (!record) {
    console.error(`design-twin: no capture record at ${RECORD_FILE}. Run: npm run design:twin`);
    process.exit(1);
  }
  const served = await assertServerIsCurrent();
  const index = sourceIndex();
  const plan = screenPlan(index);
  const venue = defaultVenue();
  console.log(`design-twin: seeded-Profile leg against ${BASE} (build ${served.sha.slice(0, 8)})\n`);

  const browser = await launchForCapture();
  const { context, page, scratch } = await openTwinPhone(browser, { baseUrl: BASE, venue });
  const found = new Map();
  const error = await walkSeededProfile({
    page,
    scratch,
    plan,
    index,
    venue,
    onLog: (line) => console.log(line),
    signedOut: new Map(record.screens.map((s) => [s.id, s.evidence])),
    onShot: (id, profile) => found.set(id, profile),
  });
  await context.close();
  await browser.close();

  const merged = {
    ...record,
    seededProfile: { ...record.seededProfile, error },
    screens: record.screens.map((s) => (found.has(s.id) ? { ...s, profile: found.get(s.id) } : { ...s, profile: null })),
  };
  const { annotated, sources } = annotate(merged.screens, index);
  const next = {
    ...merged,
    screens: annotated,
    inputs: fingerprint([
      'apps/party-tracker/app/globals.css',
      'apps/party-tracker/app/page.js',
      'apps/party-tracker/public/venues/manifest.json',
      ...sources,
    ]),
  };
  writeRecord(next);
  for (const file of sweepShots(next)) console.log(`  swept shot ${file} — no longer referenced`);
  const shown = annotated.filter((s) => s.profile?.shown);
  console.log(
    `\ndesign-twin: a Profile changes ${shown.length} of ${annotated.length} screens` +
      `${shown.length ? ` — ${shown.map((s) => s.id).join(', ')}` : ''}.`,
  );
  const { written } = await writeDesignBundle();
  console.log(`design-twin: rebuilt ${written.length} files in ${OUT_DIR}/`);
  process.exit(0);
}

/* ------------------------------------------------------------------
   check — is the committed twin still true?
   ------------------------------------------------------------------ */

if (mode === 'check') {
  const record = readRecord();
  if (!record) {
    console.error(
      `design-twin: no capture record at ${RECORD_FILE} (or it is an older shape). ` +
        'Run: npm run design:twin',
    );
    process.exit(1);
  }
  const { stale, changed, missing, advisory } = staleness(record);

  for (const note of advisory) console.log(`design-twin: note — ${note}`);
  if (advisory.length) {
    console.log(
      '  (advisory only: a component on disk is not yet a screen, so this never fails a build)',
    );
  }

  if (!stale) {
    console.log(
      `design-twin: ok — ${record.screens.length} screens, captured ${record.capturedAt}, ` +
        `every source they were read from is unchanged.`,
    );
    process.exit(0);
  }
  console.error('\ndesign-twin: the twin is stale. Its screens were read from files that have changed:');
  for (const p of changed) console.error(`  changed  ${p}`);
  for (const p of missing) console.error(`  gone     ${p}`);
  console.error('\nRe-photograph the app:  npm run design:twin');
  process.exit(1);
}

/* ------------------------------------------------------------------
   capture — the real thing
   ------------------------------------------------------------------ */

if (mode !== 'capture') {
  console.error('Usage: node scripts/design-twin.mjs <capture|profile|resolve|check|plan>');
  process.exit(1);
}

/**
 * Refuse to photograph a build that is behind the tree.
 *
 * A previous session on this box found port 3118 serving a build 32 commits
 * old, and every screenshot it produced would have been filed as current. The
 * app publishes the commit it was built from at `/app-version.json`, and git
 * can say whether that commit is where we are — so the check is cheap and the
 * failure is loud.
 */
async function assertServerIsCurrent() {
  let served;
  try {
    const res = await fetch(`${BASE}/app-version.json`);
    served = await res.json();
  } catch (err) {
    throw new Error(`design-twin: no app at ${BASE} (${err.message}). Start one: npm run build && npm run start`);
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    env: scrubGitEnv(),
    encoding: 'utf8',
  }).trim();
  if (served.sha === head) return served;

  let behind = null;
  try {
    behind = execFileSync('git', ['rev-list', '--count', `${served.sha}..${head}`], {
      cwd: root,
      env: scrubGitEnv(),
      encoding: 'utf8',
    }).trim();
  } catch {
    behind = null; // the served commit is not in this repo at all
  }
  throw new Error(
    `design-twin: ${BASE} is serving ${served.sha?.slice(0, 8) ?? '(no sha)'}, this tree is at ` +
      `${head.slice(0, 8)}${behind && behind !== '0' ? ` — ${behind} commits behind` : ''}.\n` +
      '  A screenshot of another build filed as this one is exactly the drift the twin exists to stop.\n' +
      '  Rebuild and restart the server, or point BASE_URL at one that is current.',
  );
}

const served = await assertServerIsCurrent();
const venue = defaultVenue();
console.log(`design-twin: photographing ${BASE} (build ${served.sha.slice(0, 8)}) at ${venue.name}\n`);

const record = await captureTwin({ baseUrl: BASE, venue, onLog: (line) => console.log(line) });
writeRecord(record);
const swept = sweepShots(record);
for (const file of swept) console.log(`  swept stale shot ${file}`);

const reached = record.screens.filter((s) => Object.keys(s.shots).length);
const missed = record.screens.filter((s) => !Object.keys(s.shots).length);
console.log(
  `\ndesign-twin: ${reached.length}/${record.screens.length} screens photographed in both palettes.`,
);
for (const s of missed) console.log(`  NOT REACHED  ${s.id} — ${s.unreached}`);
if (missed.length) {
  console.log(
    '  (these are written onto their own pages with the reason, not dropped — a visible gap is\n' +
      '   useful; a missing screen nobody notices is how a twin starts lying.)',
  );
}

const { written } = await writeDesignBundle();
console.log(`\ndesign-twin: rebuilt ${written.length} files in ${OUT_DIR}/`);
console.log(`design-twin: capture record at ${RECORD_FILE}`);
process.exit(0);
