#!/usr/bin/env node
/**
 * Factory validation CLI — one command to know whether a World's pipeline
 * is complete and certifiable.
 *
 *   npm run venues:factory-validate -- kings-island
 *   npm run venues:factory-validate -- --all
 *   npm run venues:factory-validate -- kings-island --json
 */

import process from 'node:process';
import { validateVenue, validateAll, renderValidationReport } from '../lib/factory-validate.mjs';

const USAGE = `
Factory validation — walk a venue through the Map factory and Visual factory routes.

  node packages/venue-builder/bin/factory-validate.mjs <venue id>
  node packages/venue-builder/bin/factory-validate.mjs --all [--json]

  --all   every venue in the shipped manifest
  --json  structured per-route output for CI
`;

function parseArgs(argv) {
  const out = { _: [], all: false, json: false };
  for (const a of argv) {
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let docs;
  if (args.all) {
    docs = validateAll();
  } else {
    const id = args._[0];
    if (!id) {
      console.error(USAGE.trim());
      process.exit(1);
    }
    docs = [validateVenue(id)];
  }

  if (args.json) {
    console.log(JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2));
  } else {
    for (const doc of docs) {
      console.log(renderValidationReport(doc));
      console.log('');
    }
    const ok = docs.filter((d) => d.ok).length;
    console.log(`==== ${ok}/${docs.length} venues pass factory validation ====`);
  }

  const failed = docs.filter((d) => !d.ok);
  process.exit(failed.length ? 1 : 0);
}

main();
