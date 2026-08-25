#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fillHumanBrief } from '../../scripts/lib/executive-resume-brief.mjs';

const text = fillHumanBrief({
  overview: 'Parkbound helps families navigate the park together.',
  now: { task: 'Harden resume brief', doneWhen: ['One brief prints'], nextStep: 'Wire gather' },
  factoriesStanding: 'Venue builder bake path is green.',
  appStanding: 'Nothing in flight under this label set.',
  wayfinder: [
    {
      slug: 'factories-to-app',
      phase: 'wayfinder',
      destination: 'Factories feed the live app map',
      tickets: [{ id: '01', title: 'Who owns display bake?', status: 'open' }],
    },
  ],
  hanging: [
    { kind: 'github', title: 'Pin dashboard JSON', number: 643, label: 'ready-for-human' },
    { kind: 'blocked', title: 'Approve brief design' },
  ],
  clerkHealth: { ok: true, declared: '7.7.5', locked: '7.7.5', detail: 'Clerk @clerk/nextjs matches lockfile.' },
});

const headings = [...text.matchAll(/^## .+$/gm)].map((m) => m[0]);
assert.deepEqual(headings, [
  '## Overview',
  '## NOW',
  '## Factories',
  '## App',
  '## Wayfinder',
  '## Hanging / waiting on you',
]);
assert.match(text, /^# Executive brief/m);
assert.match(text, /Who owns display bake\?/);
assert.match(text, /Pin dashboard JSON \(#643\)/);
assert.match(text, /Clerk @clerk\/nextjs matches lockfile/);
assert.doesNotMatch(text, /<html/i);
console.log('executive-resume-brief template ok');

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherWayfinderFacts } from '../../scripts/lib/executive-resume-brief.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'brief-wf-'));
const root = join(scratch, 'repo');
const effort = join(root, '.scratch', 'factories-to-app');
mkdirSync(join(effort, 'issues'), { recursive: true });
writeFileSync(
  join(effort, 'map.md'),
  '# Map\n\n## Destination\n\nFactories feed the live app map\n\n## Decisions so far\n\n- none\n',
);
writeFileSync(
  join(effort, 'issues/01-who-owns-bake.md'),
  '# 01: Who owns display bake?\n\n**Type:** grilling\n\n**Status:** open\n\n**Blocked by:** None\n\n## Question\n\nWho?\n',
);
writeFileSync(
  join(effort, 'issues/02-impl.md'),
  '# 02: Implement bake\n\n**Status:** ready-for-agent\n\n**What to build:**\n\n- bake\n',
);

const wf = gatherWayfinderFacts(root);
assert.equal(wf.length, 1);
assert.equal(wf[0].slug, 'factories-to-app');
assert.match(wf[0].destination, /Factories feed/);
assert.equal(wf[0].tickets.length, 1);
assert.equal(wf[0].tickets[0].title, 'Who owns display bake?');
assert.ok(!wf[0].tickets.some((t) => /Implement bake/.test(t.title)));

rmSync(scratch, { recursive: true, force: true });
console.log('executive-resume-brief wayfinder gather ok');

import {
  APP_HINTS,
  FACTORY_HINTS,
  classifyStanding,
  gatherBriefFacts,
  gatherClerkHealth,
  gatherGithubHanging,
} from '../../scripts/lib/executive-resume-brief.mjs';

assert.equal(
  classifyStanding({
    blobs: ['feat: party-tracker clerk profile'],
    factoryHints: FACTORY_HINTS,
    appHints: APP_HINTS,
  }).app,
  true,
);

const hang = gatherGithubHanging({
  cwd: root,
  runner: (cmd, args) => {
    if (cmd === 'gh' && args.includes('ready-for-agent')) {
      return JSON.stringify([
        { number: 1, title: 'Agent work', labels: [{ name: 'ready-for-agent' }] },
        { number: 2, title: 'Noise', labels: [{ name: 'needs-triage' }] },
      ]);
    }
    if (cmd === 'gh' && args.includes('ready-for-human')) {
      return JSON.stringify([{ number: 3, title: 'Need human', labels: [{ name: 'ready-for-human' }] }]);
    }
    return '[]';
  },
});
assert.deepEqual(
  hang.map((h) => h.number).sort(),
  [1, 3],
);
assert.equal(hang.find((h) => h.number === 1)?.label, 'ready-for-agent');
assert.equal(hang.find((h) => h.number === 3)?.label, 'ready-for-human');
console.log('executive-resume-brief github hanging ok');

const clerkScratch = mkdtempSync(join(tmpdir(), 'brief-clerk-'));
const clerkRoot = join(clerkScratch, 'repo');
mkdirSync(join(clerkRoot, 'apps/party-tracker'), { recursive: true });
writeFileSync(
  join(clerkRoot, 'apps/party-tracker/package.json'),
  JSON.stringify({ dependencies: { '@clerk/nextjs': '^8.0.0' } }),
);
writeFileSync(
  join(clerkRoot, 'package-lock.json'),
  JSON.stringify({
    packages: { 'node_modules/@clerk/nextjs': { version: '7.7.5' } },
  }),
);
const clerkMismatch = gatherClerkHealth(clerkRoot);
assert.equal(clerkMismatch.ok, false);
assert.equal(clerkMismatch.declared, '^8.0.0');
assert.equal(clerkMismatch.locked, '7.7.5');
assert.match(clerkMismatch.detail, /7\.7\.5/);
assert.equal(gatherClerkHealth(join(clerkRoot, 'missing')), null);
rmSync(clerkScratch, { recursive: true, force: true });
console.log('executive-resume-brief clerk health ok');

const briefScratch = mkdtempSync(join(tmpdir(), 'brief-facts-'));
const briefRoot = join(briefScratch, 'repo');
const briefEffort = join(briefRoot, '.scratch', 'factories-to-app');
mkdirSync(join(briefEffort, 'issues'), { recursive: true });
writeFileSync(
  join(briefEffort, 'map.md'),
  '# Map\n\n## Destination\n\nFactories feed the live app map\n\n## Decisions so far\n\n- none\n',
);
writeFileSync(
  join(briefEffort, 'issues/01-who-owns-bake.md'),
  '# 01: Who owns display bake?\n\n**Type:** grilling\n\n**Status:** open\n\n**Blocked by:** None\n\n## Question\n\nWho?\n',
);

const resume = {
  now: { task: 'Wire party-tracker clerk profile', nextStep: 'Ship brief gather' },
  human: { blockedOnMe: ['Approve brief design'], parkingLot: ['Revisit capacitor'] },
  inventory: { worktrees: [], draftPrs: [] },
};

const facts = gatherBriefFacts({
  resume,
  root: briefRoot,
  runner: () => '[]',
});
assert.match(facts.overview, /Parkbound executive focus: Wire party-tracker clerk profile/);
assert.match(facts.appStanding, /^In flight:/);
assert.equal(facts.wayfinder.length, 1);
assert.deepEqual(
  facts.hanging.map((h) => h.title),
  ['Approve brief design', 'Revisit capacitor'],
);
assert.ok(!facts.warnings?.length);

const warnScratch = mkdtempSync(join(tmpdir(), 'brief-warn-'));
const warnRoot = join(warnScratch, 'repo');
mkdirSync(join(warnRoot, '.scratch'), { recursive: true });
const warnFacts = gatherBriefFacts({
  resume: { now: { task: 'x' }, human: {}, inventory: {} },
  root: warnRoot,
  runner: () => {
    throw new Error('gh down');
  },
});
assert.ok(warnFacts.warnings?.includes('GitHub hanging inventory incomplete'));
assert.ok(
  warnFacts.warnings?.some((w) => /factories-to-app/.test(w) && /map\.md/.test(w)),
);
rmSync(briefScratch, { recursive: true, force: true });
rmSync(warnScratch, { recursive: true, force: true });
console.log('executive-resume-brief gatherBriefFacts ok');
