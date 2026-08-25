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
