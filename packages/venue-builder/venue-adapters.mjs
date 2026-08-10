#!/usr/bin/env node
/**
 * List and evaluate external adapters for the Universal Venue Builder.
 *
 *   npm run venues:adapters
 *   npm run venues:adapters -- --json
 *   npm run venues:adapters -- --stage research
 *   npm run venues:adapters -- --adopt wrap
 *   npm run venues:adapters -- matrix
 */

import {
  ADAPTER_REGISTRY,
  adaptersByAdopt,
  adaptersByStage,
  registrySummary,
} from './lib/adapters/index.mjs';

const USAGE = `
Universal Venue Builder — external dependency registry.

  node scripts/venue-adapters.mjs [command] [options]

Commands:
  list              all adapters (default)
  matrix            markdown table for docs
  summary           counts by adopt mode and stage

Options:
  --json            structured output
  --stage <name>    filter: research | geo | vision | venue_data | tiles | orchestration | runtime_map
  --adopt <mode>    filter: adopt | wrap | fork | replace | evaluate | defer | reject
`;

function parseArgs(argv) {
  const out = { cmd: 'list', json: false, stage: null, adopt: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--stage') out.stage = argv[++i];
    else if (a === '--adopt') out.adopt = argv[++i];
    else if (!a.startsWith('--')) out.cmd = a;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

function filterList(args) {
  let list = ADAPTER_REGISTRY;
  if (args.stage) list = adaptersByStage(args.stage);
  if (args.adopt) list = list.filter((a) => a.adopt === args.adopt);
  return list;
}

function renderMatrix(list) {
  const lines = [
    '| Adapter | Repo | Stage | Adopt | License | Commercial | Overlap |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const a of list) {
    const commercial = a.commercial_ok ? 'ok' : 'review';
    const overlap = String(a.overlap).replace(/\|/g, '\\|').slice(0, 60);
    lines.push(
      `| ${a.name} | ${a.repo} | ${a.stage} | ${a.adopt} | ${a.license} | ${commercial} | ${overlap} |`,
    );
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = filterList(args);

  if (args.cmd === 'summary') {
    const body = registrySummary();
    if (args.json) console.log(JSON.stringify(body, null, 2));
    else {
      console.log(`Registry: ${body.total} entries`);
      console.log('By adopt:', body.byAdopt);
      console.log('By stage:', body.byStage);
    }
    return;
  }

  if (args.cmd === 'matrix') {
    console.log(renderMatrix(list));
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(list.map((a) => a.describe()), null, 2));
    return;
  }

  console.log('Universal Venue Builder — external adapters\n');
  for (const a of list) {
    console.log(`${a.id}`);
    console.log(`  ${a.name} (${a.repo})`);
    console.log(`  role: ${a.role} | stage: ${a.stage} | adopt: ${a.adopt}`);
    console.log(`  license: ${a.license} | commercial: ${a.commercial_ok ? 'ok' : 'review'}`);
    if (a.evidence_sources?.length) console.log(`  evidence: ${a.evidence_sources.join(', ')}`);
    console.log(`  ${a.notes}`);
    console.log('');
  }
}

main();
