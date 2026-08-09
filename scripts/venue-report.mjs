#!/usr/bin/env node
/* What a built venue actually contains, in markdown.
 *
 * The build prints layer counts as it goes, which is the right amount of detail
 * while you are watching it run and the wrong amount afterwards. This is the
 * version for someone reviewing a venue they did not build: how much there is,
 * how big it is, and the two things that are worth being told rather than
 * discovering — that a park with no height data hides its filter, and that a
 * map file over about a megabyte is a lot to hand a phone on park wifi.
 *
 *   node scripts/venue-report.mjs cedar-point
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pointInRing } from './lib/geometry.mjs';
import { checklist, checklistTable, failures } from './lib/venue-checklist.mjs';
import { readRecipe } from './lib/venue-recipe.mjs';
import { requests } from './lib/venue-requests.mjs';

const VENUE_DIR = path.join(process.cwd(), 'public', 'venues');
const kb = (file) => Math.round(fs.statSync(file).size / 1024);

const manifest = JSON.parse(fs.readFileSync(path.join(VENUE_DIR, 'manifest.json'), 'utf8'));
const id = process.argv[2];

const readOverridesFor = (venueId) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'venues', `${venueId}.overrides.json`), 'utf8'));
  } catch {
    return null;
  }
};

const load = (v) => {
  const mapFile = path.join(VENUE_DIR, `${v.id}.map.json`);
  const poisFile = path.join(VENUE_DIR, `${v.id}.pois.json`);
  return {
    map: JSON.parse(fs.readFileSync(mapFile, 'utf8')),
    pois: JSON.parse(fs.readFileSync(poisFile, 'utf8')),
    mapFile,
    poisFile,
    sizes: { mapKb: kb(mapFile), poisKb: kb(poisFile) },
  };
};

/* No id: the checklist for every venue at once, which is what you want when the
   question is "is anything here half-built" rather than "tell me about Cedar
   Point". Every location is the same data about a different place, so the only
   useful review is the one that lines them up. */
if (!id) {
  const rows = [];
  let short = 0;
  for (const v of manifest.venues) {
    const { map, pois, sizes } = load(v);
    const items = checklist(v, map, pois, sizes);
    const bad = items.filter((i) => i.status === 'missing');
    short += failures(items).length;
    rows.push({ v, items, bad });
  }
  console.log('### What every location here is carrying\n');
  console.log(`| Venue | ${manifest.venues.length ? rows[0].items.map((i) => i.label).join(' | ') : ''} |`);
  console.log(`| --- | ${rows[0]?.items.map(() => ':-:').join(' | ') || ''} |`);
  for (const { v, items } of rows) {
    const marks = items.map((i) => ({ ok: '✅', missing: '❌', 'n/a': '–' })[i.status]);
    console.log(`| ${v.name} | ${marks.join(' | ')} |`);
  }
  console.log();
  for (const { v, bad } of rows) {
    if (!bad.length) continue;
    console.log(`**${v.name}**\n`);
    for (const i of bad) console.log(`* ${i.required ? '**' : ''}${i.label}${i.required ? '**' : ''} — ${i.detail}. ${i.fix}`);
    console.log();
  }
  if (short) {
    console.log(`> [!WARNING]`);
    console.log(`> ${short} required item(s) missing. \`npm run test:unit\` holds the same line.`);
    console.log('>');
  }
  /* The gaps above split in two, and the split is the useful part: some of them
     are a tag rule to fix in this repo, and some of them are a fact no amount of
     OpenStreetMap will ever supply. Only the second kind needs somebody to go
     and read a park's website, so only the second kind gets pointed at. */
  const outside = manifest.venues.filter((v) => {
    const { map, pois } = load(v);
    return requests({ venue: v, map, pois, overrides: readOverridesFor(v.id) }).length;
  });
  if (outside.length) {
    console.log(`> [!NOTE]`);
    console.log(
      `> ${outside.length} venue(s) need something OpenStreetMap does not carry — height rules, `
        + 'most often. What to go and find, venue by venue: `npm run venues:ask`.',
    );
  }
  process.exit(0);
}

const venue = manifest.venues.find((v) => v.id === id);
if (!venue) {
  console.error(`"${id}" is not in the manifest. It ships: ${manifest.venues.map((v) => v.id).join(', ')}`);
  process.exit(1);
}
const mapFile = path.join(VENUE_DIR, `${id}.map.json`);
const poisFile = path.join(VENUE_DIR, `${id}.pois.json`);
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const pois = JSON.parse(fs.readFileSync(poisFile, 'utf8'));

const layers = Object.entries(map)
  .filter(([, v]) => Array.isArray(v))
  .map(([k, v]) => [k, v.length])
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]);
const drawn = layers.reduce((n, [, count]) => n + count, 0);

const byCategory = {};
for (const poi of pois) byCategory[poi.c] = (byCategory[poi.c] || 0) + 1;

const out = [];
const say = (line = '') => out.push(line);

say(`### ${venue.name}`);
say();
say(checklistTable(checklist(venue, map, pois, { mapKb: kb(mapFile), poisKb: kb(poisFile) })));
say();
say(`* **${pois.length}** places, **${venue.counts.rides}** of them rides, **${venue.counts.heights}** with height rules`);
say(`* **${drawn}** drawn shapes across ${layers.length} layers — map **${kb(mapFile)} KB**, places **${kb(poisFile)} KB**`);
say(`* centre \`${venue.center.lat}, ${venue.center.lng}\`${venue.locality ? ` — ${venue.locality}` : ''}`);
/* How it was built, which used to be answerable only out of a merged pull
   request. Worth a line in a report somebody is reading to decide whether to
   trust a venue: a box drawn too wide is the commonest thing wrong with one. */
const { data: recipe } = readRecipe(id);
if (recipe?.box) {
  const b = recipe.box;
  const pad = recipe.options?.pad ?? 120;
  say(`* built from \`${b.south},${b.west},${b.north},${b.east}\` padded by ${pad} m`
    + `${recipe.place?.query ? `, resolved from "${recipe.place.query}"` : ''}`
    + ` — \`npm run venues:rebuild -- ${id}\``);
} else {
  say(`* **no recipe** — nothing on disk says how this venue was built, so it cannot be rebuilt `
    + 'without reconstructing the command line. Build it once more and it writes its own.');
}
if (map.boundary) {
  const within = pois.filter((p) => pointInRing([p.lng, p.lat], map.boundary)).length;
  say(`* boundary of **${map.boundary.length}** points, with **${within}/${pois.length}** places inside it`);
} else {
  say('* **no boundary** — nothing in the box is tagged as the venue itself');
}
say();
say('| Layer | Shapes |');
say('| --- | ---: |');
for (const [layer, count] of layers) say(`| ${layer} | ${count} |`);
say();
say('| Places | Count |');
say('| --- | ---: |');
for (const [category, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
  say(`| ${category} | ${count} |`);
}
say();

// A phone downloads this once, over whatever signal a queue line has.
if (kb(mapFile) > 1200) {
  say('> [!WARNING]');
  say(`> ${kb(mapFile)} KB is a lot for one venue. A tighter bounding box is usually the fix —`);
  say('> the box is padded by 120 m and keeps everything it finds inside it.');
  say();
}

/* Every "how to fix" the checklist raised, spelled out. The table above says
   what is missing; this says what to type. */
const gaps = checklist(venue, map, pois, { mapKb: kb(mapFile), poisKb: kb(poisFile) })
  .filter((i) => i.status === 'missing');
if (gaps.length) {
  say('> [!NOTE]');
  for (const gap of gaps) say(`> **${gap.label}** — ${gap.detail}. ${gap.fix}`);
  say();
}

/* And the ones no build can close. A gap that needs a tag rule and a gap that
   needs somebody to read a park's height chart look identical in the table
   above, and only one of them is work this repo can do to itself. */
const outside = requests({ venue, map, pois, overrides: readOverridesFor(id) });
if (outside.length) {
  const blocking = outside.filter((r) => r.blocking).length;
  say(`> [!IMPORTANT]`);
  say(`> ${outside.length} thing(s) here need a source outside OpenStreetMap`
    + `${blocking ? `, ${blocking} of them blocking` : ''}: ${outside.map((r) => r.need).join('; ')}.`);
  say(`> The brief, with the shape of every answer: \`npm run venues:ask -- ${id}\``);
  say();
}

console.log(out.join('\n'));
