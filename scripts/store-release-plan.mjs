#!/usr/bin/env node
/**
 * Classify git changes into web vs metadata vs native store release tiers.
 *
 *   npm run store:release-plan
 *   npm run store:release-plan -- --base origin/main
 *   npm run store:release-plan -- --files apps/party-tracker/app/page.js
 */
import { execFileSync } from 'node:child_process';
import {
  classifyStoreRelease,
  formatStoreReleasePlan,
  storeReleaseCommands,
} from './lib/store-release-plan.mjs';

function parseArgs(argv) {
  const opts = { base: 'origin/main', head: 'HEAD', files: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--base') {
      opts.base = argv[++i];
    } else if (arg === '--head') {
      opts.head = argv[++i];
    } else if (arg === '--files') {
      opts.files = [];
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        opts.files.push(argv[++i]);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: store-release-plan.mjs [--base REF] [--head REF] [--files PATH ...] [--json]

Classify changes into store release tiers (web | metadata | native_binary).
Default diff: git diff --name-only <base>...<head>`);
      process.exit(0);
    }
  }
  return opts;
}

function gitChangedFiles(base, head) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
      encoding: 'utf8',
    });
    return out.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (err) {
    if (err.status === 128 || /bad revision|unknown revision/i.test(String(err.stderr || err.message))) {
      const out = execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' });
      return out.split('\n').map((line) => line.trim()).filter(Boolean);
    }
    throw err;
  }
}

const opts = parseArgs(process.argv.slice(2));
const files = opts.files ?? gitChangedFiles(opts.base, opts.head);
const result = classifyStoreRelease(files);
const commands = storeReleaseCommands(result);

if (opts.json) {
  console.log(JSON.stringify({ ...result, commands }, null, 2));
} else {
  console.log(formatStoreReleasePlan(result, commands));
}
