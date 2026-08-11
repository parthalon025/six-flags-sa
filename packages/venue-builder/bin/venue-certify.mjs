#!/usr/bin/env node
/**
 * Certify a built venue — report + compare + route-qa + ask gates.
 *
 *   npm run venues:certify -- kings-island
 *   npm run venues:certify -- --all
 *   npm run venues:certify -- cedar-point --json
 */

import process from 'node:process';
import { readJson, VENUE_DIR } from '../lib/venue-io.mjs';
import {
  certifyVenue,
  certifyAll,
  renderCertificationMarkdown,
} from '../lib/venue-certify.mjs';

const USAGE = `
Certify a built venue — the twin's birth certificate.

  node packages/venue-builder/bin/venue-certify.mjs <venue id>
  node packages/venue-builder/bin/venue-certify.mjs --all [--json] [--no-write]

  --all       every venue in the manifest
  --json      structured output
  --no-write  run gates without writing certification.json
`;

function parseArgs(argv) {
  const out = { _: [], all: false, json: false, write: true };
  for (const a of argv) {
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (a === '--no-write') out.write = false;
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const opts = { write: args.write };

  let docs;
  if (args.all) {
    docs = certifyAll(opts);
  } else {
    const id = args._[0];
    if (!id) {
      console.error(USAGE.trim());
      process.exit(1);
    }
    docs = [certifyVenue(id, opts)];
  }

  if (args.json) {
    console.log(JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2));
  } else {
    for (const doc of docs) {
      console.log(renderCertificationMarkdown(doc));
      console.log('');
    }
    const certified = docs.filter((d) => d.certified).length;
    console.log(`==== ${certified}/${docs.length} certified ====`);
  }

  const failed = docs.filter((d) => !d.certified);
  process.exit(failed.length ? 1 : 0);
}

main();
