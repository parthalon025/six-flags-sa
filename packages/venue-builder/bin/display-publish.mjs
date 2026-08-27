#!/usr/bin/env node
/**
 * Publish baked Skin worlds to the app — the human-gated copy step.
 *
 * The display stage writes world files into the venue's builder pack
 * (data/venues/<id>/display/<skin>.world.png + .world.json). The app reads
 * them from public/venues/<id>/display/. This script is the only bridge:
 * run it by hand for the Skins the app actually consumes, review the diff,
 * and the PR that commits the copies is the gate (nothing publishes at CI
 * or build time).
 *
 *   npm run venues:publish-worlds -- kings-island watercolor-quest layered-atlas
 *   npm run venues:publish-worlds -- kings-island trail park-midnight --specs
 */

import { publishWorlds } from '../lib/display-world.mjs';

const argv = process.argv.slice(2);
const [id, ...skinIds] = argv.filter((a) => !a.startsWith('--'));
// A Skin's pack carries two very differently sized things: its visual spec
// (kilobytes, what the phone reads to paint Zones) and its baked world
// (megabytes). Publishing tones must not drag a re-bake along, so each can
// travel alone.
const kinds = [
  ...(argv.includes('--worlds') ? [] : ['spec']),
  ...(argv.includes('--specs') ? [] : ['world']),
];
if (!id || !skinIds.length || !kinds.length) {
  console.error('usage: display-publish.mjs <venueId> <skinId>… [--specs | --worlds]');
  process.exit(2);
}

const { published, missing } = publishWorlds(id, skinIds, { kinds });
for (const f of published) console.log(`published ${f}`);
for (const skin of missing) {
  console.error(`! ${skin}: nothing in the pack to publish — run venues:display (spec) or venues:bake + venues:display --bake (world) first`);
}
process.exitCode = missing.length ? 1 : 0;
