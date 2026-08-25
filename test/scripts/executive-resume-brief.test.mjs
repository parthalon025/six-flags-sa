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
