#!/usr/bin/env node
/**
 * Split README.md body sections into docs/guide/*.md.
 * Run from repo root after editing the monolithic README sections.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = path.join(root, 'README.md');
const guideDir = path.join(root, 'docs/guide');

const readme = fs.readFileSync(readmePath, 'utf8');
const lines = readme.split('\n');

const h2 = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('## ')) h2.push({ i, title: lines[i].slice(3) });
}

const slugMap = {
  'Get it running': 'getting-started',
  'Walking directions': 'walking-directions',
  'How the party works': 'party',
  API: 'api',
  Notifications: 'notifications',
  'What a browser cannot do': 'browser-limits',
  Tests: 'testing',
  'Building a map of somewhere else': 'venue-builder',
  'Ride entrances': 'ride-entrances',
  'A word on privacy': 'privacy',
  'Where the data came from': 'data-sources',
  Layout: 'layout',
  Contributing: 'contributing',
};

const skip = new Set(['Screenshots', 'Table of contents']);

function rewriteLinks(text) {
  return text
    .replace(/\(INSTALL\.md\)/g, '(../../INSTALL.md)')
    .replace(/\(docs\//g, '(../')
    .replace(/\(packages\//g, '(../../packages/')
    .replace(/\(LICENSE\)/g, '(../../LICENSE)')
    .replace(/\(README\.md\)/g, '(../../README.md)')
    .replace(
      /\[Building a map of somewhere else\]\(#building-a-map-of-somewhere-else\)/g,
      '[Building a map of somewhere else](venue-builder.md)',
    )
    .replace(
      /\[Height rules\]\(#height-rules-and-other-corrections\)/g,
      '[Height rules](venue-builder.md#height-rules-and-other-corrections)',
    )
    .replace(/\[Ride entrances\]\(#ride-entrances\)/g, '[Ride entrances](ride-entrances.md)')
    .replace(/\]\(#ride-entrances\)/g, '](ride-entrances.md)')
    .replace(/\]\(#building-a-map-of-somewhere-else\)/g, '](venue-builder.md)');
}

function wrap(title, body) {
  const trimmed = body.trim();
  if (!trimmed) return '';
  return `# ${title}

[← README](../../README.md) · [Guide index](index.md)

${rewriteLinks(trimmed)}

---
[← README](../../README.md) · [Guide index](index.md)
`;
}

fs.mkdirSync(guideDir, { recursive: true });

const dash = lines.findIndex((l, i) => i > 50 && l === '---');
const featuresStart = dash + 2;
const firstBodyH2 = h2.find((s) => !skip.has(s.title));
const featuresBody = lines.slice(featuresStart, firstBodyH2.i).join('\n');
fs.writeFileSync(path.join(guideDir, 'features.md'), wrap('Features', featuresBody));

const bodySections = h2.filter((s) => !skip.has(s.title));
for (let n = 0; n < bodySections.length; n++) {
  const { title, i } = bodySections[n];
  const end = n + 1 < bodySections.length ? bodySections[n + 1].i : lines.length;
  const slug = slugMap[title];
  if (!slug) throw new Error(`No slug for section: ${title}`);
  const chunk = lines.slice(i + 1, end).join('\n');
  fs.writeFileSync(path.join(guideDir, `${slug}.md`), wrap(title, chunk));
}

const indexPages = [
  ['features.md', 'Features', 'What the app does — map, party, directions, weather, and more.'],
  ['getting-started.md', 'Getting started', 'Install, run on a phone, and local development.'],
  ['walking-directions.md', 'Walking directions', 'On-device routing from venue geometry.'],
  ['party.md', 'How the party works', 'Host, transports, failover, and standalone server.'],
  ['api.md', 'API', 'Mailbox, REST surface, weather proxy, and rate limits.'],
  ['notifications.md', 'Notifications', 'Web Push setup and what gets sent.'],
  ['browser-limits.md', 'Browser limits', 'What the web platform cannot do yet.'],
  ['testing.md', 'Tests', 'Unit, functional, grandma, visual, and CI modules.'],
  ['venue-builder.md', 'Venue builder', 'Build a map of anywhere OpenStreetMap covers.'],
  ['ride-entrances.md', 'Ride entrances', 'Why markers are not queue gates, and what is derived.'],
  ['privacy.md', 'Privacy', 'Party codes, keys, and what leaves the browser.'],
  ['data-sources.md', 'Data sources', 'OpenStreetMap, heights, weather, and attributions.'],
  ['layout.md', 'Repository layout', 'Where code and generated venue output live.'],
  ['contributing.md', 'Contributing', 'Issues, PRs, builder contract, and README screenshots.'],
];

const index = `# Parkbound guide

[← README](../../README.md)

Full documentation split out of the root README. Start with [Features](features.md) or jump to what you need.

| Topic | Summary |
| --- | --- |
${indexPages.map(([file, title, summary]) => `| [${title}](${file}) | ${summary} |`).join('\n')}

## See also

- [INSTALL.md](../../INSTALL.md) — non-technical install for end users
- [Architecture map](../architecture-map.md) — system diagram and execution flows
- [Repository structure](../repo-structure.md) — short tree
- [Packages](../../packages/README.md) — deep-module seams
`;

fs.writeFileSync(path.join(guideDir, 'index.md'), index);
console.log(`Wrote ${indexPages.length + 1} files to docs/guide/`);
